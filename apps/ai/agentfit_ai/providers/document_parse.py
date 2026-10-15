"""Document Parse adapter for opt-in evaluations; not the default analysis path.

Evidence offsets refer to Parse-derived text, never original PDF text offsets.
"""
import asyncio
import copy
from html.parser import HTMLParser
import json
import re
import time
import httpx
from ..extraction import ExtractedDocument, SourcePage, MAX_CODEPOINTS
from ..secret_guard import assert_no_secrets
from .base import ProviderError


class _StructuredHtml(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.rows, self.cell = [], [], None
        self.row, self.header, self.in_table = None, False, False

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style', 'iframe', 'object'}:
            raise ProviderError('INVALID_PARSE_RESPONSE')
        if tag == 'table':
            if self.in_table:
                raise ProviderError('UNSUPPORTED_PARSE_TABLE')
            self.in_table = True; self.rows = []
        elif tag == 'tr':
            if self.row is not None:
                raise ProviderError('INVALID_PARSE_RESPONSE')
            self.row = []
        elif tag in {'td', 'th'}:
            if not self.in_table or self.row is None or self.cell is not None:
                raise ProviderError('INVALID_PARSE_RESPONSE')
            if any(name in {'rowspan', 'colspan'} and value != '1' for name, value in attrs):
                raise ProviderError('UNSUPPORTED_PARSE_TABLE')
            self.cell = []; self.header = tag == 'th'
        elif tag == 'br':
            (self.cell if self.cell is not None else self.parts).append('\n')
        elif tag in {'p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'} and not self.in_table:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in {'td', 'th'}:
            if self.cell is None or self.row is None:
                raise ProviderError('INVALID_PARSE_RESPONSE')
            value = re.sub(r'\s+', ' ', ''.join(self.cell)).strip()
            if not value:
                raise ProviderError('INVALID_PARSE_RESPONSE')
            self.row.append((value, self.header)); self.cell = None
        elif tag == 'tr':
            if self.row is None or self.cell is not None or not self.row:
                raise ProviderError('INVALID_PARSE_RESPONSE')
            self.rows.append(self.row); self.row = None
        elif tag == 'table':
            if not self.in_table or not self.rows or self.row is not None:
                raise ProviderError('INVALID_PARSE_RESPONSE')
            columns = len(self.rows[0])
            if not 1 <= columns <= 20 or any(len(row) != columns for row in self.rows):
                raise ProviderError('UNSUPPORTED_PARSE_TABLE')
            labels = [value for value, _ in self.rows[0]]
            recognized = {'technology', 'purpose', 'name', 'role', 'model', '기술', '기술 스택', '용도', '역할', '모델', '이름', '항목', '분류'}
            has_header = all(flag for _, flag in self.rows[0]) or all(value.casefold() in recognized for value in labels)
            if has_header and len(set(labels)) != columns:
                raise ProviderError('UNSUPPORTED_PARSE_TABLE')
            self.parts.append('\n')
            for row in self.rows[1:] if has_header else self.rows:
                values = [value for value, _ in row]
                self.parts.append(' | '.join(f'{label}: {value}' for label, value in zip(labels, values)) if has_header else ' | '.join(values))
                self.parts.append('\n')
            self.in_table = False

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)
        elif not self.in_table:
            self.parts.append(data)

    def text(self, html):
        self.feed(html); self.close()
        if self.in_table or self.row is not None or self.cell is not None:
            raise ProviderError('INVALID_PARSE_RESPONSE')
        return '\n'.join(line.strip() for line in ''.join(self.parts).splitlines() if line.strip())


def parse_document_response(response, document_id, expected_pages):
    try:
        if type(response['usage']['pages']) is not int or response['usage']['pages'] != expected_pages:
            raise ValueError
        elements = response['elements']
        if not isinstance(elements, list) or not 1 <= len(elements) <= 5000:
            raise ValueError
        page_parts, ids = {number: [] for number in range(1, expected_pages + 1)}, set()
        for element in elements:
            page, identifier = element['page'], element['id']
            if type(page) is not int or page not in page_parts or type(identifier) is not int or identifier < 0 or identifier in ids:
                raise ValueError
            ids.add(identifier)
            html = element['content']['html']
            if not isinstance(html, str) or not html.strip():
                raise ValueError
            text = _StructuredHtml().text(html)
            if not text:
                raise ValueError
            category = element['category']
            if re.fullmatch(r'heading[1-6]', category):
                text = '#' * int(category[-1]) + ' ' + text
            page_parts[page].append((identifier, text))
        text_parts, pages, offset = [], [], 0
        for number, parts in page_parts.items():
            if not parts:
                raise ValueError
            text = '\n'.join(part for _, part in sorted(parts))
            if number > 1:
                text_parts.append('\n\f\n'); offset += 3
            pages.append(SourcePage(number, offset, offset + len(text)))
            text_parts.append(text); offset += len(text)
            if offset > MAX_CODEPOINTS:
                raise ProviderError('TEXT_TOO_LONG')
        document = ExtractedDocument(document_id, 'markdown', ''.join(text_parts), tuple(pages))
        assert_no_secrets(document.text)
        return document
    except (ValueError, KeyError, TypeError, IndexError):
        raise ProviderError('INVALID_PARSE_RESPONSE') from None


def bind_table_quotes(output, document):
    """Use a verified Parse row when IE quotes only its purpose cell.

    Experimental only. Never match arbitrary prose, partial cell names, swapped
    purposes, or invented proof text. Grounding still checks section qualifiers.
    """
    bound = copy.deepcopy(output)
    rows = []
    pattern = re.compile(r'^(?:Technology|기술|기술 스택): (.+?) \| (?:Purpose|용도|역할): (.+)$', re.IGNORECASE)
    for line in document.text.splitlines():
        match = pattern.fullmatch(line)
        if match and ' | ' not in match[2]:
            rows.append((match[1], match[2], line))
    for item in bound['items']:
        values = item['value'] if isinstance(item['value'], list) else [item['value']]
        if len(values) != 1 or item['field'] not in {'ai', 'backend', 'database', 'deployment', 'frontend', 'external_integrations'}:
            continue
        usages = item.get('usages', [])
        if len(usages) != 1:
            continue
        usage = usages[0]
        matches = [row for name, purpose, row in rows if name == values[0] == usage['value'] and purpose.casefold() == usage['purpose'].casefold() and usage['quote'].casefold() in {purpose.casefold(), row.casefold()} and name.casefold() in item['quote'].casefold() and purpose.casefold() in item['quote'].casefold()]
        if len(set(matches)) == 1:
            item['quote'] = matches[0]
            usage['quote'] = matches[0]
    return bound


class DocumentParseProvider:
    endpoint = 'https://api.upstage.ai/v1/document-digitization'
    model = 'document-parse'

    def __init__(self, key, client=None, *, mode='standard'):
        if mode not in {'standard', 'enhanced'}:
            raise ValueError('INVALID_PARSE_MODE')
        self.key, self.client = key, client
        self.mode = mode

    async def parse(self, data, source, deadline):
        assert_no_secrets(source.text, [self.key])
        if not self.key:
            raise ProviderError('PROVIDER_NOT_CONFIGURED')
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ProviderError('ANALYSIS_TIMEOUT')
        client = self.client or httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(retries=0), follow_redirects=False, trust_env=False)
        try:
            async with asyncio.timeout(remaining):
                async with client.stream('POST', self.endpoint, headers={'Authorization': f'Bearer {self.key}'}, files={'document': ('document.pdf', data, 'application/pdf')}, data={'model': self.model, 'mode': self.mode, 'ocr': 'auto', 'output_formats': '["html"]', 'coordinates': 'false'}, timeout=remaining, follow_redirects=False) as response:
                    chunks, size = [], 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 2_097_152:
                            raise ProviderError('PROVIDER_RESPONSE_TOO_LARGE')
                        chunks.append(chunk)
                    raw = b''.join(chunks).decode('utf-8', errors='strict')
                    try:
                        assert_no_secrets(raw, [self.key])
                    except ValueError:
                        raise ProviderError('SECRET_DETECTED') from None
                    if response.status_code != 200:
                        code = {400: 'PROVIDER_BAD_REQUEST', 401: 'PROVIDER_AUTH_FAILED', 403: 'PROVIDER_AUTH_FAILED', 402: 'PROVIDER_BUDGET_EXHAUSTED', 404: 'PROVIDER_MODEL_UNAVAILABLE', 429: 'PROVIDER_RATE_LIMITED'}.get(response.status_code, 'PROVIDER_UNAVAILABLE')
                        raise ProviderError(code)
                    try:
                        return parse_document_response(json.loads(raw), source.document_id, len(source.pages))
                    except ValueError:
                        raise ProviderError('INVALID_PARSE_RESPONSE') from None
        except (TimeoutError, httpx.TimeoutException):
            raise ProviderError('ANALYSIS_TIMEOUT') from None
        except httpx.HTTPError:
            raise ProviderError('PROVIDER_UNAVAILABLE') from None
        except UnicodeDecodeError:
            raise ProviderError('INVALID_PARSE_RESPONSE') from None
        finally:
            if self.client is None:
                await client.aclose()
