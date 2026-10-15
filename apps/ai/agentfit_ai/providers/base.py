import asyncio
import json
import time
import httpx
from ..contracts import validate_provider_output
from ..secret_guard import assert_no_secrets


class ProviderError(Exception):
    def __init__(self, code, raw=None):
        super().__init__(code)
        self.code = code
        self.raw = raw


class JsonProvider:
    endpoint = ""
    model = ""

    def __init__(self, key, client=None):
        self.key = key
        self.client = client

    async def extract(self, document, deadline, canonical=None):
        assert_no_secrets(document.text, [self.key])
        if not self.key:
            raise ProviderError("PROVIDER_NOT_CONFIGURED")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ProviderError("ANALYSIS_TIMEOUT")
        body = self.request_body(document, canonical)
        client = self.client or httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(retries=0), follow_redirects=False, trust_env=False)
        raw = None
        try:
            async with asyncio.timeout(remaining):
                async with client.stream("POST", self.endpoint, headers={"Authorization": f"Bearer {self.key}"}, json=body, timeout=remaining, follow_redirects=False) as response:
                    chunks, size = [], 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 524_288:
                            raise ProviderError("PROVIDER_RESPONSE_TOO_LARGE")
                        chunks.append(chunk)
                    raw = b"".join(chunks).decode("utf-8", errors="replace")
                    try:
                        assert_no_secrets(raw, [self.key])
                    except ValueError:
                        raise ProviderError("SECRET_DETECTED") from None
                    if response.status_code != 200:
                        code = {400: "PROVIDER_BAD_REQUEST", 404: "PROVIDER_MODEL_UNAVAILABLE", 401: "PROVIDER_AUTH_FAILED", 403: "PROVIDER_AUTH_FAILED", 402: "PROVIDER_BUDGET_EXHAUSTED", 429: "PROVIDER_RATE_LIMITED"}.get(response.status_code, "PROVIDER_UNAVAILABLE")
                        raise ProviderError(code, raw)
                    try:
                        envelope = json.loads(raw)
                        choice = envelope["choices"][0]
                        if choice.get("finish_reason") != "stop":
                            raise ValueError
                        content = choice["message"]["content"]
                        output = json.loads(content)
                        return self.parse_output(output)
                    except (ValueError, TypeError, KeyError, IndexError):
                        raise ProviderError("INVALID_PROVIDER_RESPONSE", raw) from None
        except (TimeoutError, httpx.TimeoutException):
            raise ProviderError("ANALYSIS_TIMEOUT") from None
        except httpx.HTTPError:
            raise ProviderError("PROVIDER_UNAVAILABLE") from None
        finally:
            if self.client is None:
                await client.aclose()

    def request_body(self, document, canonical):
        raise NotImplementedError

    def parse_output(self, output):
        return validate_provider_output(output)
