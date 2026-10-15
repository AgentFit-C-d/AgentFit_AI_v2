import asyncio
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import time
import httpx
import pytest
from reportlab.pdfgen import canvas
from agentfit_ai.config import AiConfig
from agentfit_ai.providers.base import ProviderError
from agentfit_ai.service import AnalysisService

CONFIG = AiConfig('synthetic-token-' + 'x' * 32, 'http://127.0.0.1:4000', 'synthetic-upstage', 'synthetic-nvidia')


def request(kind='text', seconds=50):
    now = datetime.now(timezone.utc)
    return {'attemptId': 'attempt', 'leaseId': 'lease', 'documentId': 'attempt', 'provider': 'upstage', 'inputKind': kind, 'deadline': (now + timedelta(seconds=seconds)).isoformat(timespec='milliseconds').replace('+00:00', 'Z'), 'inputRef': {'uploadId': 'upload', 'storage': 'local', 'objectKey': 'inputs/upload', 'expiresAt': (now + timedelta(minutes=8)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}}


def item(field='ai', value=None, quote='AI: Solar', context='ambiguous'):
    return {'field': field, 'value': ['Solar'] if value is None else value, 'quote': quote, 'context': context}


class Primary:
    model = 'test-upstage'
    def __init__(self, items):
        self.items, self.calls = items, []
    async def extract(self, document, deadline, canonical=None):
        self.calls.append((document, canonical))
        return {'items': self.items}


class Reviewer:
    model = 'test-nvidia'
    def __init__(self, output=None, failure=None):
        self.output, self.failure, self.calls = output, failure, []
    async def review(self, document, targets, deadline):
        self.calls.append((document, targets, deadline))
        if self.failure:
            raise ProviderError(self.failure)
        return self.output


async def analyze(data, primary, reviewer=None, kind='text', seconds=50):
    body = request(kind, seconds)
    reservations = []
    def handler(req):
        if req.url.path.endswith('/metadata'):
            return httpx.Response(200, json={'inputRef': body['inputRef'], 'metadata': {'kind': kind, 'size': len(data)}})
        if req.url.path.endswith('/reserve'):
            assert not primary.calls
            pages = json.loads(req.content)['pages']; reservations.append(pages)
            return httpx.Response(200, json={'reservationId': 'reservation', 'pages': pages, 'amountMicroUsd': pages * 44000})
        return httpx.Response(200, content=data)
    providers = {'upstage': primary, **({'solar': reviewer} if reviewer else {})}
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await AnalysisService(CONFIG, client, providers).analyze(body)
    return result, reservations


def table_pdf():
    output = BytesIO(); drawing = canvas.Canvas(output)
    for title, names in [('AI stack', ('Solar', 'Generation')), ('Deployment', ('Vercel', 'Frontend'))]:
        drawing.drawString(40, 750, title)
        drawing.drawString(40, 720, 'Technology'); drawing.drawString(280, 720, 'Purpose')
        drawing.drawString(280, 690, names[1]); drawing.drawString(40, 690, names[0])
        drawing.rect(35, 680, 460, 65); drawing.line(260, 680, 260, 745); drawing.line(35, 710, 495, 710)
        drawing.showPage()
    drawing.save(); return output.getvalue()


async def test_original_pdf_keeps_exact_bytes_and_reserves_original_pages():
    data = table_pdf(); primary = Primary([item(quote='Solar', context='explicit')])
    result, reservations = await analyze(data, primary, kind='pdf')
    assert primary.calls[0][1].data == data
    assert reservations == [2]
    assert result['modelMetadata']['inputFormat'] == 'original-pdf'
    assert result['candidates'][0]['evidence'][0]['page'] == 1
    lines = primary.calls[0][0].text.splitlines()
    assert any('Solar' in line and 'Generation' in line and line.index('Solar') < line.index('Generation') for line in lines)


@pytest.mark.parametrize('quote', ['Technology Purpose\nSolarGeneration', 'TechnologySolar PurposeGeneration', 'SolarGeneration'])
async def test_pdf_table_cell_quotes_keep_real_row_and_page_offsets(quote):
    result, _ = await analyze(table_pdf(), Primary([item(quote=quote, context='explicit')]), kind='pdf')
    assert result['profile']['ai'] == ['Solar']
    assert result['candidates'][0]['evidence'][0]['page'] == 1


@pytest.mark.parametrize('quote', ['SolarFrontend', 'Technology Purpose Solar Embedding', 'Solar Generat ion'])
async def test_table_quote_cannot_mix_pages_or_invent_cell_content(quote):
    result, _ = await analyze(table_pdf(), Primary([item(quote=quote, context='explicit')]), kind='pdf')
    assert result['profile']['ai'] is None


@pytest.mark.parametrize('quote', ['SolarGeneration', 'Solar Generation'])
async def test_pdf_future_table_heading_never_becomes_current_fact(quote):
    output = BytesIO(); drawing = canvas.Canvas(output)
    drawing.drawString(40, 750, 'Future AI stack')
    drawing.drawString(40, 720, 'Technology'); drawing.drawString(280, 720, 'Purpose')
    drawing.drawString(40, 690, 'Solar'); drawing.drawString(280, 690, 'Generation'); drawing.save()
    reviewer = Reviewer({'items': [item(quote=quote, context='explicit')]})
    result, _ = await analyze(output.getvalue(), Primary([item(quote=quote)]), reviewer, kind='pdf')
    assert result['profile']['ai'] is None and not reviewer.calls


async def test_table_matching_does_not_relax_normal_text_grounding():
    result, _ = await analyze(b'Technology    Purpose\nSolar    Generation', Primary([item(quote='SolarGeneration', context='explicit')]))
    assert result['profile']['ai'] is None


async def test_table_purpose_proof_maps_to_its_actual_row():
    fact = {**item(quote='TechnologyPurposeSolarGeneration', context='explicit'), 'usages': [{'value': 'Solar', 'purpose': 'Generation', 'quote': 'SolarGeneration'}]}
    result, _ = await analyze(table_pdf(), Primary([fact]), kind='pdf')
    assert result['candidates'][0]['usages'][0]['purpose'] == 'Generation'


async def test_table_ambiguity_probe_uses_the_same_layout_evidence():
    fact = item(quote='TechnologyPurposeSolarGeneration')
    result, _ = await analyze(table_pdf(), Primary([fact]), Reviewer({'items': [{**fact, 'context': 'explicit'}]}), kind='pdf')
    assert result['profile']['ai'] == ['Solar'] and result['modelMetadata']['secondaryReview']['acceptedCount'] == 1


async def test_reviews_only_ambiguous_evidence_and_preserves_confident_fields():
    data = ('AI: Solar\n' + 'separator ' * 200 + '\nBackend: Express.js').encode()
    primary = Primary([item(), item('backend', ['Express.js'], 'Backend: Express.js', 'explicit')])
    reviewer = Reviewer({'items': [item(context='explicit')]})
    result, reservations = await analyze(data, primary, reviewer)
    assert len(reviewer.calls) == 1 and reservations == [1]
    assert 'Backend: Express.js' not in reviewer.calls[0][0].text
    assert result['profile']['ai'] == ['Solar'] and result['profile']['backend'] == ['Express.js']
    assert result['modelMetadata']['secondaryReview']['status'] == 'COMPLETED'
    assert result['modelMetadata']['secondaryReview']['acceptedCount'] == 1


@pytest.mark.parametrize('failure', ['ANALYSIS_TIMEOUT', 'PROVIDER_RATE_LIMITED', 'INVALID_PROVIDER_RESPONSE'])
async def test_review_failures_keep_first_draft_without_retry(failure):
    reviewer = Reviewer(failure=failure)
    result, _ = await analyze(b'AI: Solar', Primary([item()]), reviewer)
    assert result['profile']['ai'] is None and result['candidates'][0]['proposedValue'] == ['Solar']
    assert len(reviewer.calls) == 1
    assert result['modelMetadata']['secondaryReview']['status'] == 'FAILED'


@pytest.mark.parametrize('review_items', [
    [item(value=['GPT'], quote='AI: Solar', context='explicit')],
    [item(context='explicit'), item('database', 'PostgreSQL', 'AI: Solar', 'explicit')],
    [item(quote='Solar is a confirmed model', context='explicit')],
    [],
])
async def test_review_cannot_invent_values_fields_evidence_or_remove_candidates(review_items):
    result, _ = await analyze(b'AI: Solar', Primary([item()]), Reviewer({'items': review_items}))
    assert result['profile']['ai'] is None and result['profile']['database'] is None
    assert result['candidates'][0]['proposedValue'] == ['Solar']
    assert result['modelMetadata']['secondaryReview']['acceptedCount'] == 0


@pytest.mark.parametrize('quote,context', [('AI: Solar is a future candidate', 'ambiguous'), ('AI: Solar', 'future')])
async def test_current_fact_probe_never_reviews_future_or_uncertain_source(quote, context):
    reviewer = Reviewer({'items': [item(quote=quote, context='explicit')]})
    result, _ = await analyze(quote.encode(), Primary([item(quote=quote, context=context)]), reviewer)
    assert not reviewer.calls and result['profile']['ai'] is None


async def test_unavailable_review_preserves_primary_result():
    result, _ = await analyze(b'AI: Solar', Primary([item()]))
    assert result['profile']['ai'] is None
    assert result['modelMetadata']['secondaryReview']['status'] == 'SKIPPED_UNAVAILABLE'


async def test_insufficient_time_skips_review_and_returns_primary():
    reviewer = Reviewer({'items': [item(context='explicit')]})
    result, _ = await analyze(b'AI: Solar', Primary([item()]), reviewer, seconds=6)
    assert not reviewer.calls
    assert result['modelMetadata']['secondaryReview']['status'] == 'SKIPPED_TIME'


async def test_180_second_request_passes_remaining_time_to_both_models():
    class DeadlinePrimary(Primary):
        async def extract(self, document, deadline, canonical=None):
            self.remaining = deadline - time.monotonic()
            return await super().extract(document, deadline, canonical)
    primary = DeadlinePrimary([item()]); reviewer = Reviewer({'items': [item(context='explicit')]})
    result, _ = await analyze(b'AI: Solar', primary, reviewer, seconds=180)
    assert 170 < primary.remaining <= 178
    assert reviewer.calls[0][2] - time.monotonic() > 165
    assert result['profile']['ai'] == ['Solar']


async def test_local_review_timeout_does_not_expire_primary_draft(monkeypatch):
    from agentfit_ai import secondary_review
    monkeypatch.setattr(secondary_review, 'REVIEW_TIMEOUT_SECONDS', 0.01)
    class SlowReviewer(Reviewer):
        async def review(self, document, targets, deadline):
            self.calls.append((document, targets, deadline))
            await asyncio.sleep(1)
    reviewer = SlowReviewer()
    result, _ = await analyze(b'AI: Solar', Primary([item()]), reviewer)
    assert result['modelMetadata']['secondaryReview']['status'] == 'FAILED'
    assert result['profile']['ai'] is None and len(reviewer.calls) == 1


async def test_narrower_review_quote_preserves_every_original_source_position():
    text = b'AI: Solar\nModel: Solar'
    primary = Primary([item(quote='AI: Solar'), item(quote='Model: Solar')])
    first, _ = await analyze(text, primary)
    result, _ = await analyze(text, Primary(primary.items), Reviewer({'items': [item(context='explicit')]}))
    original = {json.dumps(e, sort_keys=True) for c in first['candidates'] for e in c['evidence']}
    after = {json.dumps(e, sort_keys=True) for c in result['candidates'] for e in c['evidence']}
    assert original <= after and result['profile']['ai'] == ['Solar']


@pytest.mark.parametrize('count', [11, 35])
async def test_large_review_scope_keeps_first_result_without_external_call(count):
    text = '\n'.join(f'AI: Model{i}' for i in range(count))
    primary = Primary([item(value=[f'Model{i}'], quote=f'AI: Model{i}') for i in range(count)])
    reviewer = Reviewer({'items': []})
    result, _ = await analyze(text.encode(), primary, reviewer)
    assert not reviewer.calls and result['profile']['ai'] is None


async def test_secret_in_secondary_output_is_discarded():
    reviewer = Reviewer({'items': [item(quote='nvapi-' + 'a' * 40, context='explicit')]})
    result, _ = await analyze(b'AI: Solar', Primary([item()]), reviewer)
    assert result['modelMetadata']['secondaryReview']['errorCode'] == 'SECRET_DETECTED'
    assert result['profile']['ai'] is None and 'nvapi-' not in json.dumps(result)
