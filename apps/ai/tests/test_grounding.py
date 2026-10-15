import json
from pathlib import Path
import pytest
from agentfit_ai.extraction import extract_document
from agentfit_ai.grounding import validate_grounding
from agentfit_ai.secret_guard import assert_no_secrets


def item(field, value, quote, context="explicit"):
    return {"field": field, "value": value, "quote": quote, "context": context}


def ground(text, items):
    return validate_grounding({"items": items}, extract_document(text.encode(), "text", "doc-1"), "nvidia", "deepseek-ai/deepseek-v4.1-flash")


def test_exact_unicode_evidence_missing_fields_and_none():
    text = "😀 프로젝트명: 모임\n백엔드: Express.js\n외부 연동은 없습니다."
    result = ground(text, [item("project_name", "모임", "프로젝트명: 모임"), item("backend", ["Express.js"], "백엔드: Express.js"), item("external_integrations", [], "외부 연동은 없습니다.")])
    assert result["profile"]["database"] is None
    assert result["profile"]["deployment"] is None
    assert result["profile"]["external_integrations"] == []
    evidence = result["candidates"][0]["evidence"][0]
    assert text[evidence["start"]:evidence["end"]] == "프로젝트명: 모임"
    assert evidence["start"] == 2
    assert result["fieldStates"]["backend"] == "suggested"
    assert "quote" not in json.dumps(result)


@pytest.mark.parametrize("number,items", [
    (1, [item("backend", ["Express.js"], "백엔드: Express.js는 사용하지 않습니다.")]),
    (2, [item("database", "PostgreSQL", "데이터베이스: PostgreSQL을 제외합니다.")]),
    (3, [item("frontend", ["React"], "프론트엔드: React는 후보입니다.")]),
    (4, [item("deployment", "Vercel", "배포: Vercel 또는 GCP를 검토합니다.")]),
    (5, [item("backend", ["FastAPI"], "향후 백엔드에 FastAPI를 도입할 예정입니다.")]),
    (6, [item("database", "PostgreSQL", "2차 단계에서 PostgreSQL을 사용할 계획입니다.")]),
    (7, [item("backend", ["Django"], "백엔드: Django입니다.")]),
    (8, [item("frontend", ["Vue"], "프론트엔드: Vue입니다.")]),
    (9, [item("backend", ["Express.js"], "백엔드: Express.js로 확정합니다."), item("backend", ["FastAPI"], "백엔드: FastAPI로 확정합니다.")]),
    (10, [item("deployment", "Vercel", "배포: Vercel로 확정합니다."), item("deployment", "GCP", "배포: GCP로 확정합니다.")]),
    (11, [item("frontend", ["React"], "프론트엔드: React가 적합할까요?")]),
    (12, [item("database", "PostgreSQL", "데이터베이스: PostgreSQL일 수도 있습니다.")]),
])
def test_semantic_gold_does_not_promote_context_to_fact(number, items):
    path = Path(__file__).resolve().parents[3] / "evaluations" / "gold" / "semantic" / f"semantic-{number:02d}.json"
    case = json.loads(path.read_text(encoding="utf-8"))
    result = ground(case["text"], items)
    assert all(value is None for value in result["profile"].values())
    assert all(candidate["status"] != "suggested" for candidate in result["candidates"])


def test_hallucinated_value_and_ambiguous_quote_are_unresolved():
    result = ground("백엔드: Express.js\n백엔드: Express.js", [item("backend", ["FastAPI"], "백엔드: Express.js"), item("deployment", "GCP", "존재하지 않는 근거")])
    assert result["profile"]["backend"] is None
    assert result["profile"]["deployment"] is None
    assert all(candidate["status"] == "unresolved" for candidate in result["candidates"])


def test_shared_secret_detection_never_returns_secret():
    secret = "nvapi-" + "a" * 40
    with pytest.raises(ValueError, match="^SECRET_DETECTED$"):
        assert_no_secrets({"items": [secret]})
    with pytest.raises(ValueError, match="^SECRET_DETECTED$"):
        assert_no_secrets("custom-sensitive-value-abcdef", ["custom-sensitive-value-abcdef"])
    assert_no_secrets("Express.js와 API key 설정을 안내한다")


def test_explicit_absence_is_a_current_fact_even_when_provider_classifies_it_as_negated():
    result = ground("외부 연동은 없습니다.\n데이터베이스와 배포 환경은 미정입니다.", [item("external_integrations", [], "외부 연동은 없습니다.", "negated")])
    assert result["profile"]["external_integrations"] == []
    assert result["fieldStates"]["external_integrations"] == "suggested"


@pytest.mark.parametrize("text", ["외부 연동이 없는 것은 후보 방안입니다.", "# 이전 프로젝트\n외부 연동은 없습니다."])
def test_absence_cannot_promote_candidates_or_other_projects(text):
    quote = text.splitlines()[-1]
    result = ground(text, [item("external_integrations", [], quote, "negated")])
    assert result["profile"]["external_integrations"] is None


def test_current_requirements_under_generic_planning_heading_are_not_uncertain():
    result = ground("# 개발 계획\n프론트엔드: React를 사용한다.\n기능: 코드 검토와 일정 관리", [item("frontend", ["React"], "프론트엔드: React를 사용한다."), item("features", ["코드 검토", "일정 관리"], "기능: 코드 검토와 일정 관리")])
    assert result["profile"]["frontend"] == ["React"]
    assert result["profile"]["features"] == ["코드 검토", "일정 관리"]


def test_complementary_array_facts_and_stated_multiple_databases_merge():
    result = ground("프론트엔드: React\n사용 언어: TypeScript\n데이터베이스: MySQL\n데이터베이스: PostgreSQL", [item("frontend", ["React"], "프론트엔드: React"), item("frontend", ["TypeScript"], "사용 언어: TypeScript"), item("database", "MySQL", "데이터베이스: MySQL"), item("database", "PostgreSQL", "데이터베이스: PostgreSQL")])
    assert result["profile"]["frontend"] == ["React", "TypeScript"]
    assert result["fieldStates"]["frontend"] == "suggested"
    assert result["profile"]["database"] == "MySQL, PostgreSQL"
    assert all(c["status"] == "suggested" for c in result["candidates"] if c["field"] == "database")


@pytest.mark.parametrize("heading", ["開発 plan future", "향후 개발 계획", "기술 후보 검토", "이전 프로젝트 계획"])
def test_generic_heading_exception_does_not_hide_uncertainty_or_other_project(heading):
    result = ground(f"# {heading}\n프론트엔드: React", [item("frontend", ["React"], "프론트엔드: React")])
    assert result["profile"]["frontend"] is None


def test_explicit_absence_and_positive_list_cannot_merge():
    result = ground("외부 연동은 없습니다.\n외부 연동: GitHub", [item("external_integrations", [], "외부 연동은 없습니다."), item("external_integrations", ["GitHub"], "외부 연동: GitHub")])
    assert result["profile"]["external_integrations"] is None


def test_competing_frontend_frameworks_are_not_merged_as_complementary_layers():
    result = ground("프론트엔드: React\n프론트엔드: Vue", [item("frontend", ["React"], "프론트엔드: React"), item("frontend", ["Vue"], "프론트엔드: Vue")])
    assert result["profile"]["frontend"] is None


def test_merged_frontend_has_one_review_candidate_and_all_original_evidence():
    result = ground("프론트엔드: React\n사용 언어: TypeScript", [item("frontend", ["React"], "프론트엔드: React"), item("frontend", ["TypeScript"], "사용 언어: TypeScript")])
    assert len(result["candidates"]) == 1
    assert result["candidates"][0]["proposedValue"] == ["React", "TypeScript"]
    assert len(result["candidates"][0]["evidence"]) == 2


def test_code_review_as_a_feature_name_is_not_an_uncertain_decision():
    result = ground("기능: 코드 검토", [item("features", ["코드 검토"], "기능: 코드 검토")])
    assert result["profile"]["features"] == ["코드 검토"]


def test_combining_facts_never_exceeds_shared_value_limit():
    first = [f"기능{i}" for i in range(60)]; second = [f"기능{i}" for i in range(60, 120)]
    text = "첫 기능: " + ", ".join(first) + "\n추가 기능: " + ", ".join(second)
    result = ground(text, [item("features", first, text.splitlines()[0]), item("features", second, text.splitlines()[1])])
    assert result["profile"]["features"] is None


def test_features_merge_up_to_100_with_original_evidence():
    first = [f"기능{i}" for i in range(50)]; second = [f"기능{i}" for i in range(50, 100)]
    text = "첫 기능: " + ", ".join(first) + "\n추가 기능: " + ", ".join(second)
    result = ground(text, [item("features", first, text.splitlines()[0]), item("features", second, text.splitlines()[1])])
    assert result["profile"]["features"] == first + second
    assert len(result["candidates"][0]["evidence"]) == 2


def test_explicit_complementary_integrations_merge_with_all_evidence():
    result = ground("외부 연동: GitHub\n외부 연동: Upstage", [item("external_integrations", ["GitHub"], "외부 연동: GitHub"), item("external_integrations", ["Upstage"], "외부 연동: Upstage")])
    assert result["profile"]["external_integrations"] == ["GitHub", "Upstage"]
    assert len(result["candidates"]) == 1
    assert len(result["candidates"][0]["evidence"]) == 2


def test_integration_absence_or_future_candidate_is_not_merged():
    result = ground("외부 연동: GitHub\n향후 외부 연동: Upstage", [item("external_integrations", ["GitHub"], "외부 연동: GitHub"), item("external_integrations", ["Upstage"], "향후 외부 연동: Upstage")])
    assert result["profile"]["external_integrations"] is None
    assert len(result["candidates"]) == 2
    assert len(result["candidates"]) == 2


def test_combining_facts_never_exceeds_shared_evidence_limit():
    lines = [f"항목{i}: 기능{i % 2}" for i in range(31)]
    result = ground("\n".join(lines), [item("features", [f"기능{i % 2}"], line) for i, line in enumerate(lines)])
    assert result["profile"]["features"] is None
    assert len(result["candidates"]) == 31
