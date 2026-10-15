import json
from datetime import datetime, timedelta, timezone
import httpx
import pytest
from agentfit_ai.config import AiConfig, read_config
from agentfit_ai.main import create_app
from agentfit_ai.service import AnalysisService
from agentfit_ai.providers.base import ProviderError

TOKEN = "synthetic-internal-token-" + "x" * 32
CONFIG = AiConfig(TOKEN, "http://127.0.0.1:4000", "synthetic-upstage-key", "synthetic-nvidia-key")
TEXT = "프로젝트명: 테스트\n백엔드: Express.js".encode()


def request(provider="nvidia", storage="local"):
    now = datetime.now(timezone.utc)
    return {"attemptId": "attempt-1", "leaseId": "lease-1", "documentId": "attempt-1", "provider": provider, "inputKind": "text", "deadline": (now + timedelta(seconds=50)).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "inputRef": {"uploadId": "upload-1", "storage": storage, "objectKey": "inputs/upload-1", "expiresAt": (now + timedelta(minutes=8)).isoformat(timespec="milliseconds").replace("+00:00", "Z")}}


class FakeProvider:
    model = "test-model"
    def __init__(self):
        self.calls = []
    async def extract(self, document, deadline, canonical=None):
        self.calls.append((document.text, canonical))
        return {"items": [{"field": "backend", "value": ["Express.js"], "quote": "백엔드: Express.js", "context": "explicit"}]}


@pytest.mark.parametrize("provider", ["upstage", "nvidia"])
async def test_internal_input_attestation_and_budget_before_paid_call(provider):
    body = request(provider)
    calls = []
    fake = FakeProvider()
    async def handler(req):
        calls.append(req)
        assert req.headers["authorization"] == f"Bearer {TOKEN}"
        if req.url.path.endswith("/metadata"):
            assert req.url.params["leaseId"] == "lease-1"
            return httpx.Response(200, json={"inputRef": body["inputRef"], "metadata": {"kind": "text", "size": len(TEXT), "contentType": "text/plain"}})
        if req.url.path.endswith("/reserve"):
            assert not fake.calls
            assert json.loads(req.content) == {"attemptId": "attempt-1", "leaseId": "lease-1", "pages": 1}
            return httpx.Response(200, json={"reservationId": "reserve-1", "pages": 1, "amountMicroUsd": 44000})
        return httpx.Response(200, content=TEXT)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await AnalysisService(CONFIG, client, {provider: fake}).analyze(body)
    assert result["profile"]["backend"] == ["Express.js"]
    assert len(fake.calls) == 1
    assert sum(req.url.path.endswith("/reserve") for req in calls) == (1 if provider == "upstage" else 0)
    assert (fake.calls[0][1] is not None) == (provider == "upstage")


async def test_budget_denied_or_input_lease_mismatch_means_zero_calls():
    for mismatch in [True, False]:
        body = request("upstage")
        fake = FakeProvider()
        def handler(req):
            if req.url.path.endswith("/metadata"):
                ref = {**body["inputRef"], "objectKey": "inputs/other"} if mismatch else body["inputRef"]
                return httpx.Response(200, json={"inputRef": ref, "metadata": {"kind": "text", "size": len(TEXT), "contentType": "text/plain"}})
            if req.url.path.endswith("/reserve"):
                return httpx.Response(503, json={"error": {"code": "BUDGET_EXCEEDED"}})
            return httpx.Response(200, content=TEXT)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(ProviderError) as raised:
                await AnalysisService(CONFIG, client, {"upstage": fake}).analyze(body)
        assert raised.value.code == ("INVALID_INPUT_REFERENCE" if mismatch else "BUDGET_EXCEEDED")
        assert fake.calls == []


async def test_cloud_input_is_fetched_only_from_configured_private_origin():
    body = request(storage="vercel")
    config = AiConfig(TOKEN, CONFIG.api_origin, nvidia_key="synthetic-key", blob_origin="https://abc123.private.blob.vercel-storage.com", blob_token="synthetic-blob-token")
    calls = []
    def handler(req):
        calls.append(req)
        if req.url.path.endswith("/metadata"):
            return httpx.Response(200, json={"inputRef": body["inputRef"], "metadata": {"kind": "text", "size": len(TEXT), "contentType": "text/plain"}})
        assert req.url.host == "abc123.private.blob.vercel-storage.com"
        assert req.headers["authorization"] == "Bearer synthetic-blob-token"
        return httpx.Response(200, content=TEXT)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await AnalysisService(config, client, {"nvidia": FakeProvider()}).analyze(body)
    assert len(calls) == 2
    body["inputRef"]["objectKey"] = "https://attacker.invalid/file"
    with pytest.raises(ValueError, match="INVALID_INTERNAL_REQUEST"):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await AnalysisService(config, client, {"nvidia": FakeProvider()}).analyze(body)
    assert len(calls) == 2


async def test_http_auth_body_and_errors_do_not_echo_input():
    class Service:
        async def analyze(self, body):
            raise ProviderError("INVALID_PROVIDER_RESPONSE", "synthetic received failure")
    app = create_app(CONFIG, Service())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        denied = await client.post("/internal/v1/analyze", json=request())
        assert denied.status_code == 403
        invalid = await client.post("/internal/v1/analyze", headers={"Authorization": f"Bearer {TOKEN}"}, json={"secret": "do not echo"})
        assert invalid.status_code == 400
        assert "do not echo" not in invalid.text
        failed = await client.post("/internal/v1/analyze", headers={"Authorization": f"Bearer {TOKEN}"}, json=request())
        assert failed.status_code == 503
        assert failed.json()["error"]["code"] == "INVALID_PROVIDER_RESPONSE"
        assert failed.json()["diagnosticRaw"] == "synthetic received failure"
        assert failed.headers["cache-control"] == "no-store"


def test_config_reads_only_explicit_env_and_rejects_remote_http_or_blob_urls():
    config = read_config({"AI_SERVICE_TOKEN": TOKEN, "API_INTERNAL_URL": CONFIG.api_origin, "NVIDIA_API_KEY": "key", "DATABASE_URL": "must-not-read"})
    assert config.nvidia_key == "key"
    assert not hasattr(config, "database_url")
    for origin in ["http://evil.invalid", "https://example.com/path", "https://user:pass@example.com", "https://example.com?query=yes"]:
        with pytest.raises(ValueError, match="INVALID_AI_CONFIG"):
            read_config({"AI_SERVICE_TOKEN": TOKEN, "API_INTERNAL_URL": origin})
    with pytest.raises(ValueError, match="INVALID_AI_CONFIG"):
        read_config({"AI_SERVICE_TOKEN": TOKEN, "API_INTERNAL_URL": CONFIG.api_origin, "BLOB_PRIVATE_ORIGIN": "https://attacker.invalid", "BLOB_READ_WRITE_TOKEN": "token"})
