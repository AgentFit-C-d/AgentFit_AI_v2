from io import BytesIO
from pypdf import PdfReader
from agentfit_ai.extraction import extract_document
from agentfit_ai.canonical_document import render_canonical_document
from agentfit_ai.grounding import validate_grounding


def test_other_project_heading_cannot_confirm_next_line_fact():
    document = extract_document("현재 프로젝트\n배포는 미정\n## 참고 사례: 다른 프로젝트\n백엔드: Express.js\n## 현재 프로젝트 구성\n프론트엔드: React".encode(), "text", "doc")
    result = validate_grounding({"items": [{"field": "backend", "value": ["Express.js"], "quote": "백엔드: Express.js", "context": "explicit"}, {"field": "frontend", "value": ["React"], "quote": "프론트엔드: React", "context": "explicit"}]}, document, "nvidia", "synthetic")
    assert result["profile"]["backend"] is None
    assert result["profile"]["frontend"] == ["React"]


def test_canonical_preserves_maximum_short_lines_within_provider_page_limit():
    text = "가\n" * 50000
    document = extract_document(text.encode(), "text", "doc")
    canonical = render_canonical_document(document)
    assert len(canonical.pages) <= 100
    assert canonical.pages[-1].end == 100000
    extracted = "".join(page.extract_text() for page in PdfReader(BytesIO(canonical.data)).pages)
    assert extracted.count("가") == 50000
