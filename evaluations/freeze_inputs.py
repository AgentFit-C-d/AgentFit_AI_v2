from pathlib import Path
import hashlib
import json
root = Path(__file__).resolve().parent / 'gold'
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
result = {'frozenBeforeMixedProviderCalls': True, 'goldManifestSha256': hashlib.sha256((root / 'manifest.json').read_bytes()).hexdigest(),
          'inputs': [{'caseId': row['caseId'], 'kind': ['pdf', 'markdown', 'text'][(int(row['caseId'].split('-')[-1]) - 1) % 3]} for row in manifest['cases']]}
path = root / 'input-plan.json'
if path.exists():
    if json.loads(path.read_text(encoding='utf-8')) != result:
        raise ValueError('FROZEN_INPUT_PLAN_CHANGED')
else:
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Input plan frozen: PDF/Markdown/text = 17/17/17; original gold unchanged')
