import pytest
from agentfit_ai.contracts import validate_analysis_result, empty_profile, PROFILE_FIELDS

def result():
    return {"schemaVersion": "1.0", "profile": empty_profile(), "fieldStates": dict.fromkeys(PROFILE_FIELDS, "unknown"), "candidates": [], "questions": [], "safeWarnings": ["REVIEW_CONFIRMATION_REQUIRED"], "modelMetadata": {"provider": "nvidia", "model": "deepseek-ai/deepseek-v4.1-flash", "latencyMs": 50, "promptVersion": "1.0", "inputFormat": "text"}}

def test_valid_analysis_result():
    assert validate_analysis_result(result())["profile"]["database"] is None

def test_evidence_and_candidate_identity():
    data = result()
    candidate = {"id": "c1", "version": 1, "field": "backend", "proposedValue": ["Node.js"], "status": "suggested", "evidence": [{"documentId": "d1", "start": 0, "end": 7}]}
    data["candidates"] = [candidate]
    assert validate_analysis_result(data)["candidates"][0]["id"] == "c1"
    data["candidates"] = [candidate, candidate]
    with pytest.raises(ValueError):
        validate_analysis_result(data)


def test_usage_provenance_must_belong_to_candidate_value_and_source():
    import copy
    data = result()
    evidence = {"documentId": "d1", "start": 0, "end": 25, "page": 1}
    candidate = {"id": "c1", "version": 1, "field": "ai", "proposedValue": ["Solar"], "status": "suggested", "evidence": [evidence], "usages": [{"value": "Solar", "purpose": "답변 생성", "evidence": [{**evidence, "start": 2, "end": 20}]}]}
    data["candidates"] = [candidate]
    assert validate_analysis_result(data)["candidates"][0]["usages"][0]["purpose"] == "답변 생성"
    for change in [{"value": "GPT"}, {"evidence": [{**evidence, "documentId": "foreign"}]}, {"evidence": [{**evidence, "end": 26}]}, {"evidence": [{**evidence, "start": 20, "end": 2}]}]:
        invalid = copy.deepcopy(data)
        invalid["candidates"][0]["usages"][0].update(change)
        with pytest.raises(ValueError):
            validate_analysis_result(invalid)
