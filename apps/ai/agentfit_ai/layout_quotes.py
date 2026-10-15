"""Match PDF table quotations to complete cells from one source row."""
import re

_HEADER = re.compile(r'(?:technology|purpose|tool|stack|model|name|role|service|기술(?: 스택)?|스택|모델|이름|항목|용도|역할|서비스|기능|분류)', re.IGNORECASE)

def compact(text):
    return re.sub(r'\s+', '', text)

def table_quote_index(text):
    lines, offset = [], 0
    for line in text.splitlines(keepends=True):
        content = line.rstrip('\r\n')
        cells = re.split(r' {2,}|\t+', content.strip()) if '\f' not in content else []
        lines.append((offset, offset + len(content), cells))
        offset += len(line)
    index, contexts = {}, []
    for number, (start, _, headers) in enumerate(lines):
        if not 2 <= len(headers) <= 8 or not all(_HEADER.fullmatch(cell) for cell in headers):
            continue
        heading_start = lines[number - 1][0] if number and '\f' not in text[lines[number - 1][0]:start] else start
        table_end = start
        for row_number in range(number + 1, len(lines)):
            row_start, row_end, row = lines[row_number]
            if len(row) != len(headers) or all(_HEADER.fullmatch(cell) for cell in row) or any(not cell or len(cell) > 1000 for cell in row):
                break
            table_end = row_end
            # A header and the current row may be serialized by row or by cell.
            # Every cell must still match in full, including spaces inside names.
            forms = [(row, row_start), (headers + row, start), ([part for pair in zip(headers, row) for part in pair], start)]
            for cells, begin in forms:
                key = compact(''.join(cells))
                index.setdefault(key, []).append((cells, begin, row_end))
        if table_end > start:
            contexts.append((start, table_end, text[heading_start:start]))
    return {'quotes': index, 'contexts': contexts}

def table_quote_spans(quote, index):
    normalized = re.sub(r'\s+', ' ', quote).strip()
    return [(start, end) for cells, start, end in index['quotes'].get(compact(quote), []) if re.fullmatch(r'\s*'.join(re.escape(cell) for cell in cells), normalized)]
