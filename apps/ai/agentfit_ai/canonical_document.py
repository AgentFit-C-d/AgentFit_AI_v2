from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
import re
from threading import Lock
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from .extraction import ExtractedDocument


@dataclass(frozen=True)
class CanonicalPage:
    number: int
    start: int
    end: int


@dataclass(frozen=True)
class CanonicalDocument:
    data: bytes
    pages: tuple[CanonicalPage, ...]


_render_lock = Lock()


def render_canonical_document(document: ExtractedDocument) -> CanonicalDocument:
    with _render_lock:
        return _render(document)


def _render(document: ExtractedDocument) -> CanonicalDocument:
    font_path = Path(__file__).resolve().parents[1] / "assets/fonts/NanumGothic-Regular.ttf"
    if not font_path.is_file():
        raise ValueError("CANONICAL_FONT_UNAVAILABLE")
    if "AgentFitCanonical" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("AgentFitCanonical", str(font_path)))
    font = pdfmetrics.getFont("AgentFitCanonical")
    missing = {ord(char) for char in document.text} - font.face.charToGlyph.keys()
    # A missing visual glyph must still have its own logical Unicode identity.
    # These temporary mappings are removed after rendering, leaving no input cache.
    for code in missing:
        font.face.charToGlyph[code] = 0
    try:
        return _draw(document)
    finally:
        for code in missing:
            del font.face.charToGlyph[code]


def _draw(document: ExtractedDocument) -> CanonicalDocument:
    output = BytesIO()
    drawing = canvas.Canvas(output, pagesize=A4, invariant=True)
    drawing.setTitle("AgentFit normalized document")
    width, height = A4
    pages, page_start, offset, line_count = [], 0, 0, 0
    drawing.setFont("AgentFitCanonical", 10)
    dense = document.text.count("\n") + len(document.text) / 40 > 5200
    # Wrap by display width while retaining every original codepoint in ranges.
    while offset < len(document.text):
        start, measured = offset, 0.0
        while offset < len(document.text):
            char = document.text[offset]
            if char == "\n" and not dense:
                offset += 1
                break
            char_width = pdfmetrics.stringWidth(" " if char == "\n" else char, "AgentFitCanonical", 10)
            if measured + char_width > width - 80 and offset > start:
                break
            measured += char_width
            offset += 1
        drawing.drawString(40, height - 50 - line_count * 14, document.text[start:offset].rstrip("\n").replace("\n", " ").replace("\f", " ").replace("\t", " "))
        line_count += 1
        if line_count >= 52 or offset == len(document.text):
            pages.append(CanonicalPage(len(pages) + 1, page_start, offset))
            drawing.showPage()
            drawing.setFont("AgentFitCanonical", 10)
            line_count, page_start = 0, offset
    drawing.save()
    if not pages:
        raise ValueError("EMPTY_DOCUMENT")
    # ReportLab 5 emits non-BMP CMaps as a single hex scalar; PDF requires UTF-16BE.
    reader = PdfReader(BytesIO(output.getvalue()))
    for page in reader.pages:
        for reference in page["/Resources"]["/Font"].values():
            font_object = reference.get_object()
            if "/ToUnicode" not in font_object:
                continue
            cmap = font_object["/ToUnicode"].get_data().decode("ascii")
            cmap = re.sub(r"(<[0-9A-Fa-f]{2}>\s+)<([0-9A-Fa-f]{5,6})>", lambda m: m[1] + "<" + chr(int(m[2], 16)).encode("utf-16-be").hex().upper() + ">", cmap)
            stream = DecodedStreamObject()
            stream.set_data(cmap.encode("ascii"))
            font_object[NameObject("/ToUnicode")] = stream
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    final = BytesIO()
    writer.write(final)
    return CanonicalDocument(final.getvalue(), tuple(pages))
