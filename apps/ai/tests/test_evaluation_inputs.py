from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from evaluations.inputs import prepare_input, load_input_plan
from evaluations.report import load_gold


def test_each_gold_group_has_balanced_file_formats_and_preserves_required_facts():
    root = Path(__file__).resolve().parents[3]
    cases = load_gold(root / 'evaluations/gold/manifest.json')
    plan = load_input_plan(root / 'evaluations/gold/input-plan.json', cases)
    for group, count in [('fact', 3), ('semantic', 4), ('normal', 10)]:
        formats = [plan[case['caseId']] for case in cases if case['group'] == group]
        assert all(formats.count(kind) == count for kind in ['pdf', 'markdown', 'text'])
    for kind in ['pdf', 'markdown', 'text']:
        source = {'caseId': 'synthetic', 'text': '😀 프로젝트명: 한글\n백엔드: Express.js', 'expected': {}}
        data, extracted = prepare_input(source, kind)
        assert extracted.text.rstrip('\n') == source['text']
        assert (data.startswith(b'%PDF-')) is (kind == 'pdf')
