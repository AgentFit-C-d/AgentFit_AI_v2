import hashlib
import json
from agentfit_ai.extraction import extract_document
from agentfit_ai.canonical_document import render_canonical_document


def prepare_input(case, kind):
    data = case['text'].encode('utf-8')
    if kind == 'pdf':
        data = render_canonical_document(extract_document(data, 'text', case['caseId'])).data
    return data, extract_document(data, kind, case['caseId'])


def load_input_plan(path, cases):
    plan = json.loads(path.read_text(encoding='utf-8'))
    if plan.get('frozenBeforeMixedProviderCalls') is not True or hashlib.sha256((path.parent / 'manifest.json').read_bytes()).hexdigest() != plan.get('goldManifestSha256'):
        raise ValueError('INPUT_PLAN_NOT_FROZEN')
    entries = plan['inputs']
    result = {entry['caseId']: entry['kind'] for entry in entries}
    if len(entries) != len(result) or set(result) != {case['caseId'] for case in cases} or any(kind not in {'pdf', 'markdown', 'text'} for kind in result.values()):
        raise ValueError('INVALID_INPUT_PLAN')
    return result
