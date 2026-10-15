"""Test-only upstream substitution; production never imports this module."""
import os
from agentfit_ai.config import AiConfig
from agentfit_ai.main import create_app
from agentfit_ai.service import AnalysisService
from agentfit_ai.providers.base import ProviderError


class SyntheticProvider:
    model = "test-upstream"

    async def extract(self, document, deadline, canonical=None):
        if "SYNTHETIC_FAILURE" in document.text:
            raise ProviderError("PROVIDER_UNAVAILABLE")
        items = []
        if 'LIST_REVIEW_FIXTURE' in document.text:
            for line in document.text.splitlines():
                for prefix, field in [('기능 항목: ', 'features'), ('외부 서비스: ', 'external_integrations')]:
                    if line.startswith(prefix):
                        items.append({'field': field, 'value': [line[len(prefix):]], 'quote': line, 'context': 'explicit'})
        for field, value, purpose, quote in [
            ("ai", ["Solar Pro 4"], "답변 생성", "Solar Pro 4로 답변 생성"),
            ("ai", ["Embed 2"], "임베딩", "Embed 2로 임베딩"),
            ("deployment", "Vercel", "프론트엔드", "프론트엔드는 Vercel"),
            ("deployment", "GCP", "백엔드", "백엔드는 GCP"),
        ]:
            if quote in document.text:
                name = value[0] if isinstance(value, list) else value
                items.append({"field": field, "value": value, "quote": quote, "context": "explicit", "usages": [{"value": name, "purpose": purpose, "quote": quote}]})
        if "프론트엔드: React" in document.text:
            items.append({"field": "frontend", "value": ["React"], "quote": "프론트엔드: React", "context": "explicit"})
        quote = "AI 전체: Upstage Solar Pro 4, Upstage Embed 2"
        if quote in document.text:
            items.append({"field": "ai", "value": ["Upstage Solar Pro 4, Upstage Embed 2"], "quote": quote, "context": "explicit"})
        for quote in ["프론트엔드 (소개): React", "프론트엔드 (구현): React"]:
            if quote in document.text:
                items.append({"field": "frontend", "value": ["React"], "quote": quote, "context": "explicit"})
        if "백엔드: Express.js" in document.text:
            items.append({"field": "backend", "value": ["Express.js"], "quote": "백엔드: Express.js", "context": "explicit"})
        if "기능: 코드 검토" in document.text:
            items.append({"field": "features", "value": ["코드 검토"], "quote": "기능: 코드 검토", "context": "explicit"})
        for field, label, value in [("ai", "AI", "Upstage Solar Pro 4"), ("ai", "AI", "Upstage Embed 2"), ("deployment", "배포 환경", "Vercel"), ("deployment", "배포 환경", "GCP"), ("external_integrations", "외부 연동", "GitHub"), ("external_integrations", "외부 연동", "Upstage")]:
            quote = f"{label}: {value}"
            if quote in document.text:
                context = 'ambiguous' if field == 'ai' and 'SECONDARY_FIXTURE' in document.text else 'explicit'
                items.append({"field": field, "value": value if field == "deployment" else [value], "quote": quote, "context": context})
        return {"items": items}

    async def review(self, document, targets, deadline):
        if 'SECONDARY_FIXTURE_FAIL' in document.text:
            raise ProviderError('PROVIDER_RATE_LIMITED')
        return {'items': [{'field': target['field'], 'value': target['value'], 'quote': f"AI: {target['value'][0]}", 'context': 'explicit'} for target in targets]}


def app_factory():
    config = AiConfig(os.environ["AI_SERVICE_TOKEN"], os.environ["API_INTERNAL_URL"], 'synthetic-upstage', 'synthetic-nvidia')
    return create_app(config, AnalysisService(config, providers={"solar": SyntheticProvider(), "upstage": SyntheticProvider()}))
