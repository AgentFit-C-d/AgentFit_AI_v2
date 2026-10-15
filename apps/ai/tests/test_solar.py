import json
import time
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from agentfit_ai.config import AiConfig
from agentfit_ai.extraction import extract_document
from agentfit_ai.providers.base import ProviderError
from agentfit_ai.providers.solar import SolarProvider
from agentfit_ai.service import AnalysisService
from agentfit_ai.solar_budget import solar_reservation

DOCUMENT = extract_document('백엔드: Express.js'.encode(), 'text', 'synthetic')
OUTPUT = {'items': [{'field': 'backend', 'value': ['Express.js'], 'quote': '백엔드: Express.js', 'context': 'explicit'}]}


def test_feature_integration_wire_accepts_separate_actions_not_unknown_placeholders():
    from jsonschema import Draft7Validator

    from agentfit_ai.providers.solar import extraction_schema

    validator = Draft7Validator(extraction_schema())
    item = {'field': 'features', 'value': ['초대 메일 전송'], 'quote': 'Mailjet API로 초대 메일 전송을 수행한다.', 'context': 'explicit', 'usages': []}
    service = {**item, 'field': 'external_integrations', 'value': ['Mailjet API']}
    assert validator.is_valid({'items': [item, service]})
    assert not validator.is_valid({'items': [{**item, 'value': None}]})
    assert not validator.is_valid({'items': [{**service, 'value': None}]})
    assert not validator.is_valid({'items': [{**item, 'value': ['초대 메일 전송', '초대 수락']}]})


async def test_failed_budget_connection_blocks_paid_request_and_preserves_primary_review():
    from agentfit_ai.grounding import validate_grounding
    from agentfit_ai.secondary_review import review_ambiguities

    calls = []
    def handler(request):
        calls.append(str(request.url))
        raise httpx.ConnectError('internal service unavailable', request=request)
    config = AiConfig('synthetic-token-' * 3, 'http://127.0.0.1:4000', upstage_key='solar-test-key')
    output = {'items': [{**OUTPUT['items'][0], 'context': 'ambiguous'}]}
    primary = validate_grounding(output, DOCUMENT, 'upstage', 'test-primary', input_format='text')
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        reserve = solar_reservation(config, client, 'analysis', 'attempt', 'lease', 'review')
        reviewer = SolarProvider('solar-test-key', client, reserve)
        result = await review_ambiguities(output, primary, DOCUMENT, reviewer, time.monotonic() + 20)
    assert result['profile'] == primary['profile'] and result['candidates'] == primary['candidates']
    assert result['modelMetadata']['secondaryReview']['errorCode'] == 'BUDGET_EXCEEDED'
    assert len(calls) == 1 and calls[0].endswith('/budget/solar')


async def test_solar_reserves_before_sending_and_returns_validated_facts():
    events = []
    async def reserve(body, deadline):
        events.append('reserved')
        assert body['model'] == 'solar-pro4' and body['reasoning_effort'] == 'none'
    def handler(request):
        assert events == ['reserved']
        events.append('sent')
        assert str(request.url) == 'https://api.upstage.ai/v1/chat/completions'
        assert request.headers['authorization'] == 'Bearer solar-test-key'
        body = json.loads(request.content)
        wire = body['response_format']
        assert wire['type'] == 'json_schema' and wire['json_schema']['strict'] is True
        branches = wire['json_schema']['schema']['properties']['items']['items']['anyOf']
        deployment = next(branch for branch in branches if branch['properties']['field']['enum'] == ['deployment'])
        assert deployment['properties']['value']['anyOf'][0]['type'] == 'string'
        assert 'usages' in deployment['required']
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(OUTPUT)}}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await SolarProvider('solar-test-key', client, reserve).extract(DOCUMENT, time.monotonic() + 5)
    assert result == OUTPUT and events == ['reserved', 'sent']


async def test_denied_solar_budget_never_sends_a_paid_request():
    sent = []
    async def denied(body, deadline):
        raise ProviderError('BUDGET_EXCEEDED')
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: sent.append(request))) as client:
        with pytest.raises(ProviderError, match='BUDGET_EXCEEDED'):
            await SolarProvider('solar-test-key', client, denied).extract(DOCUMENT, time.monotonic() + 5)
        with pytest.raises(ProviderError, match='BUDGET_AUTH_REQUIRED'):
            await SolarProvider('solar-test-key', client).extract(DOCUMENT, time.monotonic() + 5)
    assert not sent


async def test_default_analysis_uses_solar_key_and_budget_without_nvidia_dependency():
    now = datetime.now(UTC)
    body = {"attemptId": "attempt", "leaseId": "lease", "documentId": "attempt", "provider": "solar", "inputKind": "text", "deadline": (now + timedelta(seconds=50)).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "inputRef": {"uploadId": "upload", "storage": "local", "objectKey": "inputs/upload", "expiresAt": (now + timedelta(minutes=8)).isoformat(timespec="milliseconds").replace("+00:00", "Z")}}
    events = []
    def handler(request):
        if request.url.path.endswith('/metadata'):
            return httpx.Response(200, json={"inputRef": body["inputRef"], "metadata": {"kind": "text", "size": len(DOCUMENT.text.encode())}})
        if request.url.path.endswith('/inputs/upload'):
            return httpx.Response(200, content=DOCUMENT.text.encode())
        if request.url.path.endswith('/budget/solar'):
            events.append('budget')
            paid = json.loads(request.content)
            assert paid['scope'] == 'analysis' and paid['operation'] == 'extract' and paid['leaseId'] == 'lease'
            return httpx.Response(200, json={"reservationId": "r1", "amountMicroUsd": 10000})
        assert str(request.url) == 'https://api.upstage.ai/v1/chat/completions'
        assert events == ['budget']
        events.append('solar')
        assert request.headers['authorization'] == 'Bearer solar-test-key'
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(OUTPUT)}}]})
    config = AiConfig('synthetic-token-' * 3, 'http://127.0.0.1:4000', upstage_key='solar-test-key')
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await AnalysisService(config, client).analyze(body)
    assert result['modelMetadata']['provider'] == 'solar'
    assert result['profile']['backend'] == ['Express.js'] and events == ['budget', 'solar']
