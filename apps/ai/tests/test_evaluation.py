import copy
import json
from pathlib import Path
import sys
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from evaluations.report import load_gold, score_case, summarize
from agentfit_ai.contracts import empty_profile


def case(identifier="normal-01"):
    return {"caseId": identifier, "group": "normal", "expected": empty_profile(), "text": "Synthetic source"}


def record(identifier="normal-01", attempt=1, status="SUCCEEDED"):
    return {"caseId": identifier, "attempt": attempt, "firstAttemptStatus": status, "latencyMs": 100, "factScore": 1, "groundingScore": 1, "unknownInfraCorrect": True}


def test_retry_and_duplicate_do_not_inflate_first_success():
    cases = [case()]
    result = summarize(cases, [record(status="FAILED"), record(attempt=2), record()])
    assert result["firstSuccessCount"] == 0
    assert result["distinctCases"] == 1
    assert result["duplicatesIgnored"] == 1


def test_missing_gold_and_unscorable_success_are_explicit_failures():
    with pytest.raises(ValueError, match="UNKNOWN_GOLD_CASE"):
        summarize([case()], [record("foreign")])
    incomplete = record()
    incomplete["factScore"] = None
    with pytest.raises(ValueError, match="UNSCORABLE_RESULT"):
        summarize([case()], [incomplete])
    with pytest.raises(ValueError, match="MISSING_GOLD_RESULT"):
        summarize([case()], [])


def test_requires_exact_values_and_valid_evidence_in_unicode_source():
    source = case()
    source["text"] = "😀 React"
    source["expected"]["frontend"] = ["React"]
    result = {"profile": copy.deepcopy(source["expected"]), "candidates": [{"field": "frontend", "status": "suggested", "proposedValue": ["React"], "evidence": [{"start": 2, "end": 7}]}]}
    assert score_case(source, result)["groundingScore"] == 1
    result["candidates"][0]["evidence"][0]["end"] = 8
    assert score_case(source, result)["groundingScore"] == 0


def test_frozen_manifest_hash_is_checked_before_any_evaluation(tmp_path):
    payload = json.dumps(case())
    (tmp_path / "case.json").write_text(payload, encoding="utf-8")
    (tmp_path / "manifest.json").write_text(json.dumps({"frozenBeforeProviderCalls": True, "cases": [{"caseId": "normal-01", "group": "normal", "path": "case.json", "sha256": "0" * 64}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="GOLD_HASH_MISMATCH"):
        load_gold(tmp_path / "manifest.json")


def test_group_scores_do_not_hide_failed_fact_or_semantic_cases():
    cases = [{**case('fact-01'), 'group': 'fact'}, {**case('fact-02'), 'group': 'fact'}, {**case('semantic-01'), 'group': 'semantic'}]
    rows = [record('fact-01'), record('fact-02', status='FAILED'), {**record('semantic-01'), 'factScore': 0}]
    result = summarize(cases, rows)
    assert result['groups']['fact']['factMeanIncludingFailures'] == 0.5
    assert result['groups']['semantic']['exactCorrectCount'] == 0
    assert result['groups']['fact']['firstSuccessCount'] == 1


def test_normal_acceptance_requires_required_facts_not_only_saved_drafts():
    cases = [case(f'normal-{number:02d}') for number in range(1, 31)]
    rows = [{**record(source['caseId']), 'factScore': 0.9} for source in cases]
    assert summarize(cases, rows)['normalAcceptance'] is False
