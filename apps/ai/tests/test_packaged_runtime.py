import os
from pathlib import Path
import shutil
import subprocess
import sys


def test_packaged_ai_runtime_keeps_purpose_and_position_contract_without_shared_repo(tmp_path):
    source = Path(__file__).resolve().parents[1] / "agentfit_ai"
    repository = source.parents[2]
    staged = tmp_path / "staged"
    app = staged / "apps" / "ai"
    shutil.copytree(source, app / "agentfit_ai", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(repository / "packages" / "contracts" / "schema", staged / "packages" / "contracts" / "schema")
    shutil.copyfile(source.parent / "build.py", app / "build.py")
    packaged = subprocess.run([sys.executable, str(app / "build.py")], cwd=app, capture_output=True, text=True, timeout=10)
    assert packaged.returncode == 0, packaged.stderr
    isolated = tmp_path / "isolated"
    shutil.copytree(app / "agentfit_ai", isolated / "agentfit_ai")
    program = '''
from agentfit_ai.providers.upstage import UpstageProvider
from agentfit_ai.extraction import extract_document
from agentfit_ai.grounding import validate_grounding
wire = {"items": [{"field": "ai", "values": ["Solar"], "explicit_none": False, "quote": "Solar for generation", "context": "explicit", "purpose": "generation", "purpose_quote": "Solar for generation"}]}
parsed = UpstageProvider("synthetic-test-key").parse_output(wire)
result = validate_grounding(parsed, extract_document(b"Solar for generation", "text", "fixture"), "upstage", "test-model")
assert result["profile"]["ai"] == ["Solar"]
assert result["candidates"][0]["usages"][0]["purpose"] == "generation"
assert result["candidates"][0]["usages"][0]["evidence"][0]["start"] == 0
print("PACKAGED_RUNTIME_PASS")
'''
    env = {**os.environ, "PYTHONPATH": str(isolated)}
    completed = subprocess.run([sys.executable, "-c", program], cwd=isolated, env=env, capture_output=True, text=True, timeout=10)
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "PACKAGED_RUNTIME_PASS"
