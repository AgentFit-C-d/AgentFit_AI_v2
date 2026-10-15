"""Experimental Parse boundary: external HTTP is mocked, transformation is real."""
import time
import httpx
import pytest
from agentfit_ai.extraction import extract_document
from agentfit_ai.providers.base import ProviderError
from agentfit_ai.providers.document_parse import DocumentParseProvider, parse_document_response, bind_table_quotes


def envelope():
    return {'model': 'document-parse', 'usage': {'pages': 2}, 'elements': [
        {'id': 0, 'page': 1, 'category': 'heading1', 'content': {'html': '<h1>AI stack</h1>'}},
        {'id': 1, 'page': 1, 'category': 'table', 'content': {'html': '<table><tr><th>Technology</th><th>Purpose</th></tr><tr><td>Solar Pro 4</td><td>Generation</td></tr><tr><td>Embed 2</td><td>Embedding</td></tr></table>'}},
        {'id': 2, 'page': 2, 'category': 'heading1', 'content': {'html': '<h1>Future deployment</h1>'}},
        {'id': 3, 'page': 2, 'category': 'table', 'content': {'html': '<table><tr><td>Technology</td><td>Purpose</td></tr><tr><td>Vercel</td><td>Frontend</td></tr></table>'}},
    ]}


def test_table_pairs_and_page_locations_preserved_without_joining_rows():
    parsed = parse_document_response(envelope(), 'doc', 2)
    assert 'Technology: Solar Pro 4 | Purpose: Generation' in parsed.text
    assert 'Technology: Embed 2 | Purpose: Embedding' in parsed.text
    assert '# Future deployment' in parsed.text
    assert [page.number for page in parsed.pages] == [1, 2]
    assert 'Vercel' not in parsed.text[parsed.pages[0].start:parsed.pages[0].end]
    assert 'Vercel' in parsed.text[parsed.pages[1].start:parsed.pages[1].end]


@pytest.mark.parametrize('mutation', ['missing_page', 'extra_page', 'page_count', 'duplicate_id', 'empty_html', 'script', 'spanning_cells', 'ragged_table', 'too_long'])
def test_invalid_or_incomplete_parse_rejected(mutation):
    response = envelope()
    if mutation == 'missing_page': response['elements'] = response['elements'][:2]
    elif mutation == 'extra_page': response['elements'][-1]['page'] = 3
    elif mutation == 'page_count': response['usage']['pages'] = 1
    elif mutation == 'duplicate_id': response['elements'][-1]['id'] = 0
    elif mutation == 'empty_html': response['elements'][-1]['content']['html'] = ''
    elif mutation == 'script': response['elements'][0]['content']['html'] = '<script>alert(1)</script>'
    elif mutation == 'spanning_cells': response['elements'][1]['content']['html'] = '<table><tr><td colspan="2">Technology</td></tr><tr><td>A</td><td>B</td></tr></table>'
    elif mutation == 'ragged_table': response['elements'][1]['content']['html'] = '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>'
    else: response['elements'][0]['content']['html'] = '<p>' + 'x' * 100001 + '</p>'
    with pytest.raises(ProviderError, match='INVALID_PARSE_RESPONSE|TEXT_TOO_LONG|UNSUPPORTED_PARSE_TABLE'):
        parse_document_response(response, 'doc', 2)


@pytest.mark.parametrize('mode', ['standard', 'enhanced'])
async def test_http_upload_then_structure_conversion(mode):
    from io import BytesIO
    from reportlab.pdfgen import canvas
    buffer = BytesIO(); draw = canvas.Canvas(buffer)
    for text in ['AI stack', 'Deployment']:
        draw.drawString(40, 700, text); draw.showPage()
    draw.save(); data = buffer.getvalue()
    source = extract_document(data, 'pdf', 'doc')
    def handler(request):
        assert request.url == 'https://api.upstage.ai/v1/document-digitization'
        assert data in request.content
        assert mode.encode() in request.content and b'auto' in request.content
        return httpx.Response(200, json=envelope())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await DocumentParseProvider('synthetic-key', client, mode=mode).parse(data, source, time.monotonic() + 5)
    assert 'Purpose: Embedding' in result.text


@pytest.mark.parametrize('status,body,code', [(429, '{}', 'PROVIDER_RATE_LIMITED'), (401, '{}', 'PROVIDER_AUTH_FAILED'), (200, 'no json', 'INVALID_PARSE_RESPONSE'), (200, 'nvapi-' + 'a' * 40, 'SECRET_DETECTED')])
async def test_safe_errors_without_raw_or_retry(status, body, code):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, text=body)
    source = extract_document(b'hello', 'text', 'doc')
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ProviderError) as error:
            await DocumentParseProvider('synthetic-key', client).parse(b'%PDF-fixture', source, time.monotonic() + 5)
    assert error.value.code == code and error.value.raw is None
    assert len(calls) == 1


def test_derived_table_pairs_can_be_grounded_and_future_heading_remains_unresolved():
    from agentfit_ai.grounding import validate_grounding
    document = parse_document_response(envelope(), 'doc', 2)
    output = {'items': [
        {'field': 'ai', 'value': ['Solar Pro 4'], 'quote': 'Technology: Solar Pro 4 | Purpose: Generation', 'context': 'explicit', 'usages': [{'value': 'Solar Pro 4', 'purpose': 'Generation', 'quote': 'Technology: Solar Pro 4 | Purpose: Generation'}]},
        {'field': 'ai', 'value': ['Embed 2'], 'quote': 'Technology: Embed 2 | Purpose: Embedding', 'context': 'explicit', 'usages': [{'value': 'Embed 2', 'purpose': 'Embedding', 'quote': 'Technology: Embed 2 | Purpose: Embedding'}]},
        {'field': 'deployment', 'value': 'Vercel', 'quote': 'Technology: Vercel | Purpose: Frontend', 'context': 'explicit'},
    ]}
    result = validate_grounding(output, document, 'upstage', 'information-extract')
    assert result['profile']['ai'] == ['Solar Pro 4', 'Embed 2']
    assert [usage['purpose'] for usage in result['candidates'][0]['usages']] == ['Generation', 'Embedding']
    assert result['profile']['deployment'] is None
    assert result['fieldStates']['deployment'] == 'unresolved'


async def test_expired_deadline_never_calls_provider():
    source = extract_document(b'hello', 'text', 'doc')
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail('unexpected call'))) as client:
        with pytest.raises(ProviderError, match='ANALYSIS_TIMEOUT'):
            await DocumentParseProvider('synthetic-key', client).parse(b'%PDF-fixture', source, time.monotonic() - 1)


def test_cell_only_model_proof_binds_to_matching_complete_row_without_changing_context():
    from agentfit_ai.grounding import validate_grounding
    document = parse_document_response(envelope(), 'doc', 2)
    output = {'items': [
        {'field': 'ai', 'value': ['Embed 2'], 'quote': 'Technology: Embed 2 Purpose: Embedding', 'context': 'explicit', 'usages': [{'value': 'Embed 2', 'purpose': 'Embedding', 'quote': 'Embedding'}]},
        {'field': 'deployment', 'value': 'Vercel', 'quote': 'Vercel Frontend', 'context': 'explicit', 'usages': [{'value': 'Vercel', 'purpose': 'Frontend', 'quote': 'Frontend'}]},
    ]}
    bound = bind_table_quotes(output, document)
    assert output['items'][0]['usages'][0]['quote'] == 'Embedding'
    result = validate_grounding(bound, document, 'upstage', 'information-extract')
    assert result['profile']['ai'] == ['Embed 2']
    assert result['candidates'][0]['usages'][0]['purpose'] == 'Embedding'
    assert result['profile']['deployment'] is None


@pytest.mark.parametrize('name,purpose,proof', [('Embed 2', 'Generation', 'Generation'), ('Invented model', 'Embedding', 'Embedding'), ('Embed 2', 'Embedding', 'Invented source quote')])
def test_table_binding_cannot_invent_or_swap_cells(name, purpose, proof):
    document = parse_document_response(envelope(), 'doc', 2)
    output = {'items': [{'field': 'ai', 'value': [name], 'quote': f'{name} {purpose}', 'context': 'explicit', 'usages': [{'value': name, 'purpose': purpose, 'quote': proof}]}]}
    assert bind_table_quotes(output, document) == output


def test_purpose_letter_case_does_not_break_verified_cell_pair():
    from agentfit_ai.grounding import validate_grounding
    document = parse_document_response(envelope(), 'doc', 2)
    output = {'items': [{'field': 'ai', 'value': ['Embed 2'], 'quote': 'Embed 2 Embedding', 'context': 'explicit', 'usages': [{'value': 'Embed 2', 'purpose': 'embedding', 'quote': 'Embedding'}]}]}
    result = validate_grounding(bind_table_quotes(output, document), document, 'upstage', 'information-extract')
    assert result['candidates'][0]['usages'][0]['purpose'] == 'embedding'
