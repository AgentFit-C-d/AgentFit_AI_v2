import asyncio
from datetime import datetime, timezone
import json
import time
import httpx
from .contracts import validate_internal, validate_analysis_result
from .extraction import extract_document, MAX_BYTES
from .canonical_document import render_canonical_document, CanonicalDocument, CanonicalPage
from .grounding import validate_grounding
from .secret_guard import assert_no_secrets
from .providers.base import ProviderError
from .providers.upstage import UpstageProvider
from .providers.solar import SolarProvider
from .solar_budget import solar_reservation
from .secondary_review import review_ambiguities


class AnalysisService:
    def __init__(self, config, client=None, providers=None):
        self.config = config
        self.client = client
        self.injected = providers is not None
        self.providers = providers if providers is not None else {"upstage": UpstageProvider(config.upstage_key)}

    async def analyze(self, request):
        request = validate_internal("analyzeRequest", request)
        if request["documentId"] != request["attemptId"]:
            raise ProviderError("INVALID_INPUT_REFERENCE")
        try:
            remaining = (datetime.fromisoformat(request["deadline"].replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds() - 2
            expires = datetime.fromisoformat(request["inputRef"]["expiresAt"].replace("Z", "+00:00"))
        except ValueError:
            raise ProviderError("INVALID_INPUT_REFERENCE") from None
        if remaining <= 0 or expires <= datetime.now(timezone.utc):
            raise ProviderError("ANALYSIS_TIMEOUT")
        remaining = min(remaining, 178)
        started, deadline = time.monotonic(), time.monotonic() + remaining
        client = self.client or httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(retries=0), follow_redirects=False, trust_env=False)
        try:
            async with asyncio.timeout(remaining):
                ref = request["inputRef"]
                params = {"attemptId": request["attemptId"], "leaseId": request["leaseId"]}
                headers = {"Authorization": f"Bearer {self.config.token}"}
                input_url = f"{self.config.api_origin}/internal/v1/inputs/{ref['uploadId']}"
                metadata_bytes = await self._read(client, "GET", input_url + "/metadata", deadline, 16_384, headers=headers, params=params)
                try:
                    envelope = json.loads(metadata_bytes)
                    metadata = envelope["metadata"]
                    if envelope["inputRef"] != ref or metadata["kind"] != request["inputKind"] or type(metadata["size"]) is not int or not 1 <= metadata["size"] <= MAX_BYTES:
                        raise ValueError
                except (ValueError, KeyError, TypeError):
                    raise ProviderError("INVALID_INPUT_REFERENCE") from None
                if ref["storage"] == "vercel":
                    if not self.config.blob_origin or not self.config.blob_token:
                        raise ProviderError("INPUT_UNAVAILABLE")
                    data = await self._read(client, "GET", f"{self.config.blob_origin}/{ref['objectKey']}", deadline, MAX_BYTES, headers={"Authorization": f"Bearer {self.config.blob_token}", "Cache-Control": "no-cache"})
                else:
                    data = await self._read(client, "GET", input_url, deadline, MAX_BYTES, headers=headers, params=params)
                if len(data) != metadata["size"]:
                    raise ProviderError("INPUT_UNAVAILABLE")
                original_pdf = request['provider'] == 'upstage' and request['inputKind'] == 'pdf'
                document = extract_document(data, request["inputKind"], request["documentId"], layout=original_pdf)
                assert_no_secrets(document.text, [self.config.upstage_key, self.config.nvidia_key, self.config.token, self.config.blob_token])
                canonical = None
                if request["provider"] == "upstage":
                    canonical = CanonicalDocument(data, tuple(CanonicalPage(page.number, page.start, page.end) for page in document.pages)) if original_pdf else render_canonical_document(document)
                    grant_bytes = await self._read(client, "POST", self.config.api_origin + "/internal/v1/budget/reserve", deadline, 16_384, headers=headers, json={**params, "pages": len(canonical.pages)})
                    try:
                        grant = validate_internal("budgetGrant", json.loads(grant_bytes))
                        if grant["pages"] != len(canonical.pages):
                            raise ValueError
                    except ValueError:
                        raise ProviderError("BUDGET_EXCEEDED") from None
                provider = self.providers.get(request["provider"])
                if provider is None and request["provider"] == 'solar':
                    provider = SolarProvider(self.config.upstage_key, client, solar_reservation(self.config, client, 'analysis', request['attemptId'], request['leaseId'], 'extract'))
                if provider is None:
                    raise ProviderError('PROVIDER_MODEL_UNAVAILABLE')
                output = await provider.extract(document, deadline, canonical)
                assert_no_secrets(output, [self.config.upstage_key, self.config.nvidia_key, self.config.token, self.config.blob_token])
                result = validate_grounding(output, document, request["provider"], provider.model, input_format='original-pdf' if original_pdf else None)
                if request['provider'] == 'upstage':
                    reviewer = self.providers.get('solar') if self.injected else SolarProvider(self.config.upstage_key, client, solar_reservation(self.config, client, 'analysis', request['attemptId'], request['leaseId'], 'review'))
                    result = await review_ambiguities(output, result, document, reviewer, deadline, [self.config.upstage_key, self.config.nvidia_key, self.config.token, self.config.blob_token])
                result['modelMetadata']['latencyMs'] = round((time.monotonic() - started) * 1000)
                return validate_analysis_result(result)
        except (TimeoutError, httpx.TimeoutException):
            raise ProviderError("ANALYSIS_TIMEOUT") from None
        except httpx.HTTPError:
            raise ProviderError("INPUT_UNAVAILABLE") from None
        finally:
            if self.client is None:
                await client.aclose()

    async def _read(self, client, method, url, deadline, limit, **kwargs):
        async with client.stream(method, url, timeout=max(0.001, deadline - time.monotonic()), follow_redirects=False, **kwargs) as response:
            chunks, size = [], 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > limit:
                    raise ProviderError("FILE_TOO_LARGE" if limit == MAX_BYTES else "INVALID_INTERNAL_RESPONSE")
                chunks.append(chunk)
            body = b"".join(chunks)
            if response.status_code != 200:
                code = "INPUT_UNAVAILABLE"
                if url.endswith("/reserve"):
                    try:
                        possible = json.loads(body)["error"]["code"]
                        code = possible if possible in {"BUDGET_EXCEEDED", "PRICE_NOT_CONFIRMED", "INVALID_ANALYSIS_LEASE"} else "BUDGET_EXCEEDED"
                    except (ValueError, KeyError, TypeError):
                        code = "BUDGET_EXCEEDED"
                raise ProviderError(code)
            return body
