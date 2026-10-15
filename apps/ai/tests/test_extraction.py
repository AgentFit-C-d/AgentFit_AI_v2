from io import BytesIO
import pytest
from pypdf import PdfWriter
from reportlab.pdfgen import canvas
from agentfit_ai.extraction import extract_document, MAX_BYTES


def pdf(pages=1, text="Backend: Express.js"):
    output = BytesIO()
    drawing = canvas.Canvas(output)
    for _ in range(pages):
        drawing.drawString(40, 750, text)
        drawing.showPage()
    drawing.save()
    return output.getvalue()


def test_utf8_offsets_and_equal_codepoint_limit():
    text = "😀한글\n" * 25_000
    result = extract_document(text.encode(), "markdown", "doc-1")
    assert result.text == text
    assert len(result.text) == 100_000
    assert result.pages[0].end == 100_000
    with pytest.raises(ValueError, match="TEXT_TOO_LONG"):
        extract_document((text + "!").encode(), "text", "doc-1")


def test_pdf_page_limit_and_source_locations():
    result = extract_document(pdf(100), "pdf", "doc")
    assert len(result.pages) == 100
    assert result.text[result.pages[-1].start:result.pages[-1].end].strip() == "Backend: Express.js"
    with pytest.raises(ValueError, match="TOO_MANY_PAGES"):
        extract_document(pdf(101), "pdf", "doc")


def test_byte_limit_accepts_equal_without_truncation():
    data = pdf() + b" " * (MAX_BYTES - len(pdf()))
    assert len(data) == MAX_BYTES
    assert extract_document(data, "pdf", "doc").text.strip() == "Backend: Express.js"
    with pytest.raises(ValueError, match="FILE_TOO_LARGE"):
        extract_document(data + b" ", "pdf", "doc")


@pytest.mark.parametrize("data,kind,code", [
    (b"", "text", "EMPTY_DOCUMENT"), (b" \n", "markdown", "EMPTY_DOCUMENT"),
    (b"\xff", "text", "INVALID_UTF8"), (b"a\x00b", "text", "INVALID_TEXT"),
    (b"pretend PDF", "pdf", "INVALID_PDF"), (b"%PDF-1.7 corrupt", "pdf", "INVALID_PDF"),
    (pdf(text=""), "pdf", "NO_TEXT_LAYER"), (b"anything", "exe", "UNSUPPORTED_FORMAT"),
])
def test_bad_document_is_never_partial_success(data, kind, code):
    with pytest.raises(ValueError, match=code):
        extract_document(data, kind, "doc")


def test_locked_pdf_rejected():
    writer = PdfWriter()
    writer.append(BytesIO(pdf()))
    writer.encrypt("not-a-real-secret")
    output = BytesIO()
    writer.write(output)
    with pytest.raises(ValueError, match="LOCKED_PDF"):
        extract_document(output.getvalue(), "pdf", "doc")
