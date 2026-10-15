from dataclasses import dataclass
from io import BytesIO
import logging
from pypdf import PdfReader

MAX_BYTES = 10_485_760
MAX_CODEPOINTS = 100_000
MAX_PAGES = 100


@dataclass(frozen=True)
class SourcePage:
    number: int
    start: int
    end: int


@dataclass(frozen=True)
class ExtractedDocument:
    document_id: str
    kind: str
    text: str
    pages: tuple[SourcePage, ...]


def extract_document(data: bytes, kind: str, document_id: str, *, layout=False) -> ExtractedDocument:
    if kind not in {"pdf", "markdown", "text"}:
        raise ValueError("UNSUPPORTED_FORMAT")
    if len(data) > MAX_BYTES:
        raise ValueError("FILE_TOO_LARGE")
    if not data:
        raise ValueError("EMPTY_DOCUMENT")
    if kind != "pdf":
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError("INVALID_UTF8") from None
        if "\x00" in text:
            raise ValueError("INVALID_TEXT")
        if not text.strip():
            raise ValueError("EMPTY_DOCUMENT")
        if len(text) > MAX_CODEPOINTS:
            raise ValueError("TEXT_TOO_LONG")
        return ExtractedDocument(document_id, kind, text, (SourcePage(1, 0, len(text)),))
    if not data.startswith(b"%PDF-"):
        raise ValueError("INVALID_PDF")
    # Malformed PDFs can place original content in parser warnings.
    logger = logging.getLogger("pypdf")
    logger.handlers = [logging.NullHandler()]
    logger.propagate = False
    try:
        reader = PdfReader(BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise ValueError("LOCKED_PDF")
        if len(reader.pages) > MAX_PAGES:
            raise ValueError("TOO_MANY_PAGES")
        if not reader.pages:
            raise ValueError("EMPTY_DOCUMENT")
        texts, pages, offset = [], [], 0
        for number, page in enumerate(reader.pages, 1):
            text = page.extract_text(extraction_mode='layout', layout_mode_strip_rotated=False, layout_mode_space_vertically=False) if layout else page.extract_text()
            if not text or not text.strip():
                raise ValueError("NO_TEXT_LAYER")
            if number > 1:
                texts.append("\n\f\n")
                offset += 3
            pages.append(SourcePage(number, offset, offset + len(text)))
            texts.append(text)
            offset += len(text)
            if offset > MAX_CODEPOINTS:
                raise ValueError("TEXT_TOO_LONG")
        return ExtractedDocument(document_id, kind, "".join(texts), tuple(pages))
    except ValueError as error:
        if str(error) in {"LOCKED_PDF", "TOO_MANY_PAGES", "EMPTY_DOCUMENT", "NO_TEXT_LAYER", "TEXT_TOO_LONG"}:
            raise
        raise ValueError("INVALID_PDF") from None
    except Exception:
        raise ValueError("INVALID_PDF") from None
