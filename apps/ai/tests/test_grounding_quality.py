import pytest
from agentfit_ai.extraction import ExtractedDocument, SourcePage, extract_document
from agentfit_ai.grounding import validate_grounding


def fact(field, value, quote, purpose=None, context="explicit"):
    result = {"field": field, "value": value, "quote": quote, "context": context}
    if purpose:
        result["usages"] = [{"value": value[0] if isinstance(value, list) else value, "purpose": purpose, "quote": quote}]
    return result


def analyze(text, items, document=None):
    return validate_grounding({"items": items}, document or extract_document(text.encode(), "text", "quality"), "nvidia", "test-model")


def test_repeated_current_fact_keeps_all_original_page_positions():
    quote = "프론트엔드: React"
    text = quote + "\n\f\n" + quote
    document = ExtractedDocument("quality", "pdf", text, (SourcePage(3, 0, len(quote)), SourcePage(7, len(quote) + 3, len(text))))
    result = analyze(text, [fact("frontend", ["React"], quote)], document)
    assert result["profile"]["frontend"] == ["React"]
    assert [e["page"] for e in result["candidates"][0]["evidence"]] == [3, 7]
    assert all(text[e["start"]:e["end"]] == quote for e in result["candidates"][0]["evidence"])


@pytest.mark.parametrize("heading", ["향후 도입", "이전 프로젝트", "기술 후보 검토"])
def test_repeated_quote_in_different_scopes_never_promotes_a_fact(heading):
    quote = "프론트엔드: React"
    text = f"# 현재 프로젝트\n{quote}\n# {heading}\n{quote}"
    result = analyze(text, [fact("frontend", ["React"], quote)])
    assert result["profile"]["frontend"] is None
    assert result["candidates"][0]["status"] == "unresolved"
    assert len(result["candidates"][0]["evidence"]) == 2


def test_generation_and_embedding_merge_only_with_grounded_purposes():
    lines = ["Solar Pro 4로 답변 생성", "Embed 2로 임베딩"]
    result = analyze("\n".join(lines), [fact("ai", ["Solar Pro 4"], lines[0], "답변 생성"), fact("ai", ["Embed 2"], lines[1], "임베딩")])
    assert result["profile"]["ai"] == ["Solar Pro 4", "Embed 2"]
    candidate = result["candidates"][0]
    assert len(result["candidates"]) == 1 and len(candidate["evidence"]) == 2
    assert [(usage["value"], usage["purpose"]) for usage in candidate["usages"]] == [("Solar Pro 4", "답변 생성"), ("Embed 2", "임베딩")]
    assert all(usage["evidence"] for usage in candidate["usages"])
    assert "quote" not in str(candidate)


@pytest.mark.parametrize("field,lines,purposes,values,expected", [
    ("deployment", ["프론트엔드를 Vercel로 배포", "백엔드를 GCP로 배포"], ["프론트엔드", "백엔드"], ["Vercel", "GCP"], "Vercel, GCP"),
    ("database", ["관계형 저장에 PostgreSQL 사용", "그래프 저장에 Neo4j 사용"], ["관계형 저장", "그래프 저장"], ["PostgreSQL", "Neo4j"], "PostgreSQL, Neo4j"),
])
def test_separate_component_purposes_resolve_scalar_coexistence(field, lines, purposes, values, expected):
    result = analyze("\n".join(lines), [fact(field, value, quote, purpose) for value, quote, purpose in zip(values, lines, purposes)])
    assert result["profile"][field] == expected
    assert len(result["candidates"]) == 1 and len(result["candidates"][0]["usages"]) == 2


def test_same_function_models_can_coexist_but_hallucinated_purpose_is_not_saved():
    lines = ["Solar로 답변 생성", "GPT로 답변 생성"]
    result = analyze("\n".join(lines), [fact("ai", ["Solar"], lines[0], "답변 생성"), fact("ai", ["GPT"], lines[1], "답변 생성")])
    assert result["profile"]["ai"] == ["Solar", "GPT"]
    hallucinated = analyze("AI: Solar", [fact("ai", ["Solar"], "AI: Solar", "임베딩")])
    assert not hallucinated["candidates"][0].get("usages")


def test_explicit_superset_and_individual_AI_lists_are_one_candidate():
    lines = ["AI: Solar, Embed, LangGraph", "생성 모델: Solar", "임베딩 모델: Embed"]
    result = analyze("\n".join(lines), [fact("ai", ["Solar, Embed, LangGraph"], lines[0]), fact("ai", ["Solar"], lines[1]), fact("ai", ["Embed"], lines[2])])
    assert result["profile"]["ai"] == ["Solar", "Embed", "LangGraph"]
    assert len(result["candidates"]) == 1 and len(result["candidates"][0]["evidence"]) == 3


def test_repeated_position_limit_never_truncates_or_confirms_incomplete_evidence():
    quote = "프론트엔드: React"
    result = analyze("\n".join([quote] * 31), [fact("frontend", ["React"], quote)])
    assert result["profile"]["frontend"] is None
    assert sum(len(c["evidence"]) for c in result["candidates"]) == 31
    assert all(c["status"] == "unresolved" for c in result["candidates"])


def test_competing_optional_ai_and_absence_are_not_merged_as_usage_facts():
    lines = ["향후 Solar로 답변 생성", "Embed로 임베딩"]
    result = analyze("\n".join(lines), [fact("ai", ["Solar"], lines[0], "답변 생성"), fact("ai", ["Embed"], lines[1], "임베딩")])
    assert result["profile"]["ai"] is None
    result = analyze("AI는 없습니다.\nAI: Solar", [fact("ai", [], "AI는 없습니다."), fact("ai", ["Solar"], "AI: Solar")])
    assert result["profile"]["ai"] is None


def test_exact_and_wrapped_repeated_quotes_both_retain_original_positions():
    text = "백엔드: Express.js\n백엔드:  Express.js"
    result = analyze(text, [fact("backend", ["Express.js"], "백엔드: Express.js")])
    assert result["profile"]["backend"] == ["Express.js"]
    assert len(result["candidates"][0]["evidence"]) == 2
    assert [text[e["start"]:e["end"]] for e in result["candidates"][0]["evidence"]] == ["백엔드: Express.js", "백엔드:  Express.js"]


def test_broad_clause_containing_two_technologies_does_not_prove_their_swapped_purposes():
    quote = "Vercel은 프론트엔드, GCP는 백엔드에 사용한다."
    items = [fact("deployment", "Vercel", quote, "백엔드"), fact("deployment", "GCP", quote, "프론트엔드")]
    result = analyze(quote, items)
    assert result["profile"]["deployment"] == "Vercel, GCP"
    assert not any(candidate.get("usages") for candidate in result["candidates"])
