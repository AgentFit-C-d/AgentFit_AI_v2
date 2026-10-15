import asyncio
import json
import time
import httpx
import pytest
from agentfit_ai.extraction import extract_document
from agentfit_ai.canonical_document import render_canonical_document
from agentfit_ai.providers.base import ProviderError
from agentfit_ai.providers.nvidia import NvidiaProvider
from agentfit_ai.providers.upstage import UpstageProvider

DOCUMENT = extract_document("프로젝트명: 검증\n백엔드: Express.js".encode(), "text", "doc-1")
OUTPUT = {"items": [{"field": "backend", "value": ["Express.js"], "quote": "백엔드: Express.js", "context": "explicit"}]}


async def test_nvidia_secondary_request_contains_only_scoped_source_and_limited_tokens():
    requests = []
    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(OUTPUT, ensure_ascii=False)}}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        actual = await NvidiaProvider('synthetic-key', client).review(DOCUMENT, [{'field': 'backend', 'value': ['Express.js']}], time.monotonic() + 5)
    assert actual == OUTPUT and len(requests) == 1
    assert requests[0]['max_tokens'] == 2048
    assert requests[0]['messages'][1]['content'] == DOCUMENT.text
    assert 'existing candidate fields' in requests[0]['messages'][0]['content']
    assert '"enum": ["backend"]' in requests[0]['messages'][0]['content']
    assert '"project_name"' not in requests[0]['messages'][0]['content']
UPSTAGE_OUTPUT = {"items": [{"field": "backend", "values": ["Express.js"], "explicit_none": False, "quote": "백엔드: Express.js", "context": "explicit"}, {"field": "database", "values": [], "explicit_none": False, "quote": "DB는 미정입니다.", "context": "ambiguous"}]}


def test_upstage_preserves_purpose_proofs_for_each_scalar_technology():
    from agentfit_ai.grounding import validate_grounding
    text = "프론트엔드는 Vercel\n백엔드는 GCP"
    parsed = UpstageProvider("synthetic-test-key").parse_output({"items": [{"field": "deployment", "values": ["Vercel"], "explicit_none": False, "quote": "프론트엔드는 Vercel", "context": "explicit", "purpose": "프론트엔드", "purpose_quote": "프론트엔드는 Vercel"}, {"field": "deployment", "values": ["GCP"], "explicit_none": False, "quote": "백엔드는 GCP", "context": "explicit", "purpose": "백엔드", "purpose_quote": "백엔드는 GCP"}]})
    result = validate_grounding(parsed, extract_document(text.encode(), "text", "proof"), "upstage", "information-extract")
    assert result["profile"]["deployment"] == "Vercel, GCP"
    assert [usage["purpose"] for usage in result["candidates"][0]["usages"]] == ["프론트엔드", "백엔드"]


async def test_upstage_wire_requires_every_object_property_while_legacy_response_is_valid():
    def all_required(schema):
        if schema.get("type") == "object" and set(schema.get("properties", {})) != set(schema.get("required", [])):
            return False
        return all(all_required(child) for child in schema.get("properties", {}).values()) and ("items" not in schema or all_required(schema["items"]))
    async def handler(request):
        schema = json.loads(request.content)["response_format"]["json_schema"]["schema"]
        if not all_required(schema):
            return httpx.Response(400, json={"error": {"message": "schema requires all object properties"}})
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(UPSTAGE_OUTPUT)}}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        output = await UpstageProvider("synthetic-test-key", client).extract(DOCUMENT, time.monotonic() + 5, render_canonical_document(DOCUMENT))
    assert output == OUTPUT


def test_upstage_scalar_alternatives_remain_separate_unresolved_candidates():
    from agentfit_ai.grounding import validate_grounding
    source = extract_document('배포: Vercel 또는 GCP를 검토합니다.'.encode(), 'text', 'alternatives')
    wire = {'items': [{'field': 'deployment', 'values': ['Vercel', 'GCP'], 'explicit_none': False, 'quote': source.text, 'context': 'candidate'}]}
    parsed = UpstageProvider('synthetic-test-key', None).parse_output(wire)
    result = validate_grounding(parsed, source, 'upstage', 'information-extract')
    assert result['profile']['deployment'] is None
    assert len(result['candidates']) == 2
    assert all(candidate['status'] == 'unresolved' for candidate in result['candidates'])


@pytest.mark.parametrize("provider,url,model", [
    (NvidiaProvider, "https://integrate.api.nvidia.com/v1/chat/completions", "deepseek-ai/deepseek-v4.1-flash"),
    (UpstageProvider, "https://api.upstage.ai/v1/information-extraction/chat/completions", "information-extract"),
])
async def test_exact_independent_request_and_schema(provider, url, model):
    requests = []
    async def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"model": model, "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(UPSTAGE_OUTPUT if provider == UpstageProvider else OUTPUT, ensure_ascii=False)}}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await provider("synthetic-test-key", client).extract(DOCUMENT, time.monotonic() + 10, render_canonical_document(DOCUMENT) if provider == UpstageProvider else None)
    assert result == OUTPUT
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == url
    assert request.headers["authorization"] == "Bearer synthetic-test-key"
    body = json.loads(request.content)
    assert body["model"] == model
    if provider == UpstageProvider:
        assert body["mode"] == "standard"
        assert body["response_format"]["type"] == "json_schema"
        assert body["messages"][0]["content"][0]["image_url"]["url"].startswith("data:application/octet-stream;base64,JVBER")
        assert body.get("split", False) is False
        schema = body["response_format"]["json_schema"]["schema"]
        assert "anyOf" not in json.dumps(schema)
        assert all("type" in prop for prop in schema["properties"]["items"]["items"]["properties"].values())
    else:
        assert body["stream"] is False
        assert body["messages"][1]["content"] == DOCUMENT.text
        assert "information-extract" not in request.content.decode()


@pytest.mark.parametrize("status,body,code", [
    (401, "{\"error\":\"invalid key\"}", "PROVIDER_AUTH_FAILED"),
    (400, "{\"error\":\"invalid request\"}", "PROVIDER_BAD_REQUEST"),
    (404, "{\"error\":\"model or endpoint unavailable\"}", "PROVIDER_MODEL_UNAVAILABLE"),
    (429, "rate limited", "PROVIDER_RATE_LIMITED"),
    (503, "unavailable", "PROVIDER_UNAVAILABLE"),
    (200, "invalid JSON", "INVALID_PROVIDER_RESPONSE"),
    (200, '{"error":"failure"}', "INVALID_PROVIDER_RESPONSE"),
    (200, '{"choices":[{"finish_reason":"length","message":{"content":"{}"}}]}', "INVALID_PROVIDER_RESPONSE"),
])
async def test_no_retries_safe_error_and_only_received_failure_raw(status, body, code):
    calls = 0
    async def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(status, text=body)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ProviderError) as raised:
            await NvidiaProvider("synthetic-test-key", client).extract(DOCUMENT, time.monotonic() + 10)
    assert str(raised.value) == code
    assert raised.value.raw == body
    assert calls == 1


async def test_timeout_no_received_raw_and_secret_response_discarded():
    async def slow(request):
        await asyncio.sleep(0.1)
        return httpx.Response(200, text="late")
    async with httpx.AsyncClient(transport=httpx.MockTransport(slow)) as client:
        with pytest.raises(ProviderError) as raised:
            await NvidiaProvider("synthetic-test-key", client).extract(DOCUMENT, time.monotonic() + 0.01)
        assert raised.value.code == "ANALYSIS_TIMEOUT"
        assert raised.value.raw is None
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, text="nvapi-" + "a" * 40))) as client:
        with pytest.raises(ProviderError) as raised:
            await NvidiaProvider("synthetic-test-key", client).extract(DOCUMENT, time.monotonic() + 10)
        assert raised.value.code == "SECRET_DETECTED"
        assert raised.value.raw is None


async def test_input_secret_blocked_before_external_request():
    calls = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: calls.append(request))) as client:
        with pytest.raises(ValueError, match="SECRET_DETECTED"):
            await NvidiaProvider("synthetic-test-key", client).extract(extract_document(("password=" + "a" * 20).encode(), "text", "secret-doc"), time.monotonic() + 10)
    assert calls == []
