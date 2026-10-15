import pytest
from agentfit_ai.extraction import extract_document
from agentfit_ai.grounding import validate_grounding


def analyze(field, values, lines, contexts=None):
    contexts = contexts or ['explicit'] * len(values)
    items = [{"field": field, "value": value, "quote": line, "context": context} for value, line, context in zip(values, lines, contexts)]
    return validate_grounding({"items": items}, extract_document('\n'.join(lines).encode(), 'text', 'lenient'), 'upstage', 'fixture')


@pytest.mark.parametrize('field,values,lines,expected', [
    ('ai', [['Solar'], ['Embed']], ['AI: Solar 사용', 'AI: Embed 사용'], ['Solar', 'Embed']),
    ('backend', [['Express.js'], ['FastAPI']], ['백엔드: Express.js 사용', '백엔드: FastAPI 사용'], ['Express.js', 'FastAPI']),
    ('deployment', ['Vercel', 'GCP'], ['배포: Vercel 사용', '배포: GCP 사용'], 'Vercel, GCP'),
    ('database', ['PostgreSQL', 'Neo4j'], ['DB: PostgreSQL 사용', 'DB: Neo4j 사용'], 'PostgreSQL, Neo4j'),
])
def test_stated_technologies_can_be_reviewed_together_without_purpose_metadata(field, values, lines, expected):
    result = analyze(field, values, lines)
    assert result['profile'][field] == expected
    assert result['fieldStates'][field] == 'suggested'
    assert len(result['candidates']) == 1
    assert len(result['candidates'][0]['evidence']) == 2
    assert not result['candidates'][0].get('usages')
    assert not any(question['field'] == field for question in result['questions'])


@pytest.mark.parametrize('lines,contexts', [
    (['AI: Solar 사용', 'AI: Embed는 후보입니다.'], ['explicit', 'explicit']),
    (['AI: Solar 사용', '향후 AI: Embed 사용'], ['explicit', 'explicit']),
    (['AI: Solar 사용', 'AI: Embed 사용하지 않습니다.'], ['explicit', 'explicit']),
    (['AI: Solar 또는 Embed 중 하나'], ['explicit']),
    (['AI: Solar 사용', 'AI: Embed 사용'], ['explicit', 'conflict']),
    (['AI: Solar로 확정합니다.', 'AI: Embed로 확정합니다.'], ['explicit', 'explicit']),
])
def test_relaxation_retains_alternatives_exclusions_and_conflicting_selections(lines, contexts):
    values = [['Solar'], ['Embed']] if len(lines) == 2 else [['Solar', 'Embed']]
    result = analyze('ai', values, lines, contexts)
    assert result['profile']['ai'] is None
    assert all(candidate['status'] == 'unresolved' for candidate in result['candidates'])


def test_lenient_ai_union_never_truncates_the_value_limit():
    first = [f'Model{i}' for i in range(20)]
    second = [f'Model{i}' for i in range(20, 40)]
    result = analyze('ai', [first, second], ['AI: ' + ', '.join(first), 'AI: ' + ', '.join(second)])
    assert result['profile']['ai'] is None
    assert sum(len(candidate['proposedValue']) for candidate in result['candidates']) == 40


def test_confirmed_full_list_and_its_parts_are_not_conflicting_selections():
    lines = ['AI: Solar, Embed로 확정합니다.', 'AI: Solar', 'AI: Embed']
    result = analyze('ai', [['Solar', 'Embed'], ['Solar'], ['Embed']], lines)
    assert result['profile']['ai'] == ['Solar', 'Embed']
    text = '\n'.join(lines)
    assert all(any(text[evidence['start']:evidence['end']] == line for evidence in result['candidates'][0]['evidence']) for line in lines)


def test_multiple_scalar_names_in_one_confirmed_statement_are_not_conflicting_selections():
    quote = '배포: Vercel, GCP로 확정합니다.'
    result = analyze('deployment', ['Vercel', 'GCP'], [quote, quote])
    assert result['profile']['deployment'] == 'Vercel, GCP'
    assert len(result['candidates'][0]['evidence']) == 2
