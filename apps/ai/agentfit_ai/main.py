import hmac
import json
import os
from uuid import uuid4
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from .config import read_config
from .contracts import validate_internal
from .secret_guard import assert_no_secrets
from .providers.base import ProviderError
from .service import AnalysisService
from .skill_discovery import SkillDiscoveryAI


def create_app(config, service=None, skill_service=None):
    if len(config.token) < 32:
        raise ValueError("INVALID_AI_CONFIG")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    analyzer = service or AnalysisService(config)
    skill_ai = skill_service or SkillDiscoveryAI(config)

    @app.post("/internal/v1/skills/{operation}")
    async def skills(operation: str, request: Request):
        headers = {"Cache-Control": "no-store", "X-Request-ID": str(uuid4())}
        if not hmac.compare_digest(request.headers.get("authorization", "").encode(), f"Bearer {config.token}".encode()):
            return JSONResponse({"error": {"code": "INTERNAL_AUTH_REQUIRED"}}, status_code=403, headers=headers)
        if operation not in {"needs", "rank"}:
            return JSONResponse({"error": {"code": "INVALID_INTERNAL_REQUEST"}}, status_code=400, headers=headers)
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 196608:
                return JSONResponse({"error": {"code": "INVALID_INTERNAL_REQUEST"}}, status_code=413, headers=headers)
        try:
            return JSONResponse(await skill_ai.run(operation, json.loads(data)), headers=headers)
        except ProviderError as error:
            code = error.code if error.code in {"ANALYSIS_TIMEOUT", "PROVIDER_NOT_CONFIGURED", "PROVIDER_AUTH_FAILED", "PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE", "INVALID_PROVIDER_RESPONSE", "BUDGET_EXCEEDED"} else "SKILL_AI_UNAVAILABLE"
            return JSONResponse({"error": {"code": code}}, status_code=503, headers=headers)
        except ValueError as error:
            code = "INVALID_PROVIDER_RESPONSE" if str(error) == "INVALID_SKILL_RESPONSE" else "SKILL_AI_UNAVAILABLE"
            return JSONResponse({"error": {"code": code}}, status_code=503, headers=headers)
        except Exception:
            return JSONResponse({"error": {"code": "SKILL_AI_UNAVAILABLE"}}, status_code=503, headers=headers)

    @app.get("/health")
    async def health():
        return JSONResponse({"status": "ready", "providersConfigured": {"upstage": bool(config.upstage_key), "solar": bool(config.upstage_key)}}, headers={"Cache-Control": "no-store"})

    @app.post("/internal/v1/analyze")
    async def analyze(request: Request):
        identifier = str(uuid4())
        headers = {"Cache-Control": "no-store", "X-Request-ID": identifier}
        def failure(code, status=503, raw=None):
            body = {"error": {"code": code, "requestId": identifier}}
            if raw is not None:
                try:
                    assert_no_secrets(raw, [config.token, config.upstage_key, config.nvidia_key, config.blob_token])
                    body["diagnosticRaw"] = raw
                except ValueError:
                    pass
            return JSONResponse(body, status_code=status, headers=headers)
        if not hmac.compare_digest(request.headers.get("authorization", "").encode(), f"Bearer {config.token}".encode()):
            return failure("INTERNAL_AUTH_REQUIRED", 403)
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 16_384:
                return failure("INVALID_INTERNAL_REQUEST", 413)
        try:
            body = validate_internal("analyzeRequest", json.loads(data))
        except (ValueError, TypeError):
            return failure("INVALID_INTERNAL_REQUEST", 400)
        try:
            return JSONResponse(await analyzer.analyze(body), headers=headers)
        except ProviderError as error:
            return failure(error.code, raw=error.raw)
        except ValueError as error:
            safe = {"SECRET_DETECTED", "INVALID_PDF", "INVALID_UTF8", "INVALID_TEXT", "EMPTY_DOCUMENT", "NO_TEXT_LAYER", "LOCKED_PDF", "TOO_MANY_PAGES", "TEXT_TOO_LONG", "FILE_TOO_LARGE", "CANONICAL_FONT_UNAVAILABLE", "INVALID_PROVIDER_OUTPUT"}
            return failure(str(error) if str(error) in safe else "ANALYSIS_FAILED")
        except Exception:
            return failure("ANALYSIS_FAILED")
    return app


def app_factory():
    return create_app(read_config(os.environ))
