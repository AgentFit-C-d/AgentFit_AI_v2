from io import BytesIO
from pypdf import PdfReader
from agentfit_ai.extraction import extract_document
from agentfit_ai.canonical_document import render_canonical_document


def test_canonical_preserves_korean_and_original_codepoint_locations():
    text = "기획 문서 😀 é\n백엔드 Express.js, DB는 미정입니다.\n" * 100
    document = extract_document(text.encode(), "markdown", "doc")
    canonical = render_canonical_document(document)
    pages = PdfReader(BytesIO(canonical.data)).pages
    assert len(pages) == len(canonical.pages)
    normalized = "".join(page.extract_text() for page in pages)
    assert "기획 문서" in normalized
    assert "Express.js" in normalized
    assert "😀" in normalized
    assert canonical.pages[0].start == 0
    assert canonical.pages[-1].end == len(text)
    for previous, following in zip(canonical.pages, canonical.pages[1:]):
        assert previous.end == following.start
