import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from agentfit_ai.config import AiConfig
from agentfit_ai.main import create_app
from agentfit_ai.skill_discovery import SkillDiscoveryAI, validate_needs, validate_ranking


def test_needs_must_reference_input_facts_and_general_terms():
    facts = [{"id": "features:0", "field": "features", "value": "결제 승인"}]
    need = {"id": "n1", "name": "결제 검증", "query": "payment integration testing", "sourceFields": ["features:0"]}
    assert validate_needs({"needs": [need]}, facts)["needs"][0]["query"] == need["query"]
    for changed in ({"sourceFields": ["features:99"]}, {"query": "privatecompany payment"}, {"id": "n2", "skillId": "fake"}):
        with pytest.raises(ValueError):
            validate_needs({"needs": [{**need, **changed}]}, facts)

def test_ranking_never_accepts_invented_ids_or_empty_evidence():
    needs = [{"id": "n1", "name": "문서 검색", "query": "retrieval augmented generation", "sourceFields": ["features:0"]}]
    match = {"candidateId": "real", "needIds": ["n1"], "score": 90, "reason": "검색 파이프라인을 구성하는 지침"}
    assert validate_ranking({"matches": [match]}, needs, [{"id": "real"}])["matches"] == [match]
    for changed in ({"candidateId": "invented"}, {"needIds": ["n2"]}, {"needIds": []}):
        with pytest.raises(ValueError):
            validate_ranking({"matches": [{**match, **changed}]}, needs, [{"id": "real"}])
    with pytest.raises(ValueError):
        validate_ranking({'matches': [match, match]}, needs, [{'id': 'real'}])

async def test_real_json_transport_and_internal_auth_boundary():
    config = AiConfig("synthetic-token-" * 3, "http://localhost:4000", upstage_key="synthetic-upstage")
    need = {"id": "n1", "name": "결제 검증", "query": "payment integration testing", "sourceFields": ["features:0"]}
    seen = []
    def upstream(request):
        if request.url.path.endswith('/budget/solar'):
            assert request.headers['authorization'] == f'Bearer {config.token}'
            return httpx.Response(200, json={'reservationId': 'budget-1', 'amountMicroUsd': 10000})
        seen.append(json.loads(request.content))
        assert request.headers["authorization"] == "Bearer synthetic-upstage"
        assert seen[-1]["model"] == "solar-pro4"
        wire = seen[-1]['response_format']
        assert wire['type'] == 'json_schema' and wire['json_schema']['strict'] is True
        terms = wire['json_schema']['schema']['properties']['needs']['items']['properties']['queryTerms']
        assert 'payment' in terms['items']['enum'] and 'privatecompany' not in terms['items']['enum']
        assert 'uniqueItems' not in json.dumps(wire)
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"needs": [{key: value for key, value in need.items() if key != 'query'} | {'queryTerms': need['query'].split()}]})}}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as model:
        app = create_app(config, skill_service=SkillDiscoveryAI(config, model))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api:
            body = {"facts": [{"id": "features:0", "field": "features", "value": "결제 승인"}], "deadline": (datetime.now(UTC) + timedelta(seconds=60)).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "budget": {"targetId": "discovery-1", "leaseId": "lease-1"}}
            denied = await api.post("/internal/v1/skills/needs", json=body)
            assert denied.status_code == 403 and not seen
            result = await api.post("/internal/v1/skills/needs", json=body, headers={"Authorization": f"Bearer {config.token}"})
            assert result.status_code == 200 and result.json() == {"needs": [need]}
            assert "untrusted DATA" in seen[0]["messages"][0]["content"]
            too_large = await api.post("/internal/v1/skills/needs", content=b"x" * 196609, headers={"Authorization": f"Bearer {config.token}"})
            assert too_large.status_code == 413 and len(seen) == 1


async def test_semantic_output_failure_remains_distinguishable_without_raw_data():
    class InvalidOutput:
        async def run(self, operation, body):
            raise ValueError("INVALID_SKILL_RESPONSE")
    config = AiConfig("synthetic-token-" * 3, "http://localhost:4000")
    app = create_app(config, skill_service=InvalidOutput())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as api:
        response = await api.post("/internal/v1/skills/needs", json={}, headers={"Authorization": f"Bearer {config.token}"})
        assert response.status_code == 503
        assert response.json() == {"error": {"code": "INVALID_PROVIDER_RESPONSE"}}


@pytest.mark.parametrize(('matches', 'completed', 'category'), [
    ([{'candidateId': 'private-invented-id', 'needIds': ['n1'], 'score': 90, 'reason': 'private-reason'}], True, 'unknown_candidate'),
    ([{'candidateId': 'real', 'needIds': [], 'score': 0, 'reason': 'private-reason'}], True, 'schema_minItems'),
    ([{'candidateId': 'real', 'needIds': ['n2'], 'score': 90, 'reason': 'private-reason'}], True, 'unknown_need'),
    ([], False, 'incomplete_output'),
])
async def test_failed_rank_logs_only_safe_validation_category(caplog, matches, completed, category):
    from agentfit_ai.providers.base import ProviderError
    config = AiConfig('synthetic-token-' * 3, 'http://localhost:4000', upstage_key='synthetic-upstage')
    def upstream(request):
        if request.url.path.endswith('/budget/solar'):
            return httpx.Response(200, json={'reservationId': 'budget-1', 'amountMicroUsd': 10000})
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop' if completed else 'length', 'message': {'content': json.dumps({'matches': matches})}}]})
    body = {
        'needs': [{'id': 'n1', 'name': '문서 검색', 'query': 'search retrieval', 'sourceFields': ['features:0']}],
        'candidates': [{'id': 'real', 'name': 'real', 'content': 'private-skill-content'}],
        'deadline': (datetime.now(UTC) + timedelta(seconds=60)).isoformat(),
        'budget': {'targetId': 'discovery-1', 'leaseId': 'lease-1'},
    }
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as model:
        with pytest.raises((ProviderError, ValueError)):
            await SkillDiscoveryAI(config, model).run('rank', body)
    assert f'operation=rank category={category}' in caplog.text
    for private in ['private-invented-id', 'private-reason', 'private-skill-content', config.token, config.upstage_key, 'sourceFields', '문서 검색']:
        assert private not in caplog.text


async def test_failed_needs_diagnostic_handles_converted_wire_format(caplog):
    config = AiConfig('synthetic-token-' * 3, 'http://localhost:4000', upstage_key='synthetic-upstage')
    def upstream(request):
        if request.url.path.endswith('/budget/solar'):
            return httpx.Response(200, json={'reservationId': 'budget-1', 'amountMicroUsd': 10000})
        output = {'needs': [{'id': 'n1', 'name': 'private-name', 'queryTerms': ['search'], 'sourceFields': ['features:99']}]}
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(output)}}]})
    body = {'facts': [{'id': 'features:0', 'field': 'features', 'value': 'private-fact'}], 'deadline': (datetime.now(UTC) + timedelta(seconds=60)).isoformat(), 'budget': {'targetId': 'discovery-1', 'leaseId': 'lease-1'}}
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as model:
        with pytest.raises(ValueError, match='INVALID_SKILL_RESPONSE'):
            await SkillDiscoveryAI(config, model).run('needs', body)
    assert 'operation=needs category=unknown_source' in caplog.text
    assert 'private-' not in caplog.text and 'features:99' not in caplog.text


@pytest.mark.parametrize('empty_matches', [False, True])
async def test_rank_generation_schema_allows_only_supplied_references(empty_matches, caplog):
    from jsonschema import Draft7Validator
    config = AiConfig('synthetic-token-' * 3, 'http://localhost:4000', upstage_key='synthetic-upstage')
    match = {'candidateId': 'owner/repository/search', 'needIds': ['n3'], 'score': 88, 'reason': '검색 파이프라인 구현 지침'}
    expected = {'matches': [] if empty_matches else [match]}
    def upstream(request):
        if request.url.path.endswith('/budget/solar'):
            return httpx.Response(200, json={'reservationId': 'budget-1', 'amountMicroUsd': 10000})
        sent = json.loads(request.content)
        schema = sent['response_format']['json_schema']['schema']
        validator = Draft7Validator(schema)
        assert validator.is_valid({'matches': [match]})
        assert validator.is_valid({'matches': []})
        assert not validator.is_valid({'matches': [{**match, 'candidateId': 'search'}]})
        assert not validator.is_valid({'matches': [{**match, 'needIds': ['n1']}]})
        assert 'uniqueItems' not in json.dumps(schema)
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(expected)}}]})
    body = {
        'needs': [{'id': 'n3', 'name': '문서 검색', 'query': 'retrieval search', 'sourceFields': ['features:0']}],
        'candidates': [{'id': 'owner/repository/search', 'name': 'search', 'content': '검색 파이프라인 구현 지침'}],
        'deadline': (datetime.now(UTC) + timedelta(seconds=60)).isoformat(),
        'budget': {'targetId': 'discovery-1', 'leaseId': 'lease-1'},
    }
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as model:
        assert await SkillDiscoveryAI(config, model).run('rank', body) == expected
    assert 'skill_ai_validation_failed' not in caplog.text


@pytest.mark.parametrize('missing', ['needs', 'candidates'])
async def test_rank_without_needs_or_candidates_returns_empty_without_paid_request(missing):
    config = AiConfig('synthetic-token-' * 3, 'http://localhost:4000', upstage_key='synthetic-upstage')
    def upstream(request):
        pytest.fail('Empty ranking must not reserve budget or contact a model')
    body = {
        'needs': [{'id': 'n1', 'name': '문서 검색', 'query': 'search', 'sourceFields': ['features:0']}],
        'candidates': [{'id': 'real', 'name': 'real', 'content': '검색 지침'}],
        'deadline': (datetime.now(UTC) + timedelta(seconds=60)).isoformat(),
        'budget': {'targetId': 'discovery-1', 'leaseId': 'lease-1'},
    }
    body[missing] = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as model:
        assert await SkillDiscoveryAI(config, model).run('rank', body) == {'matches': []}


async def test_expired_empty_ranking_still_fails_without_paid_request():
    from agentfit_ai.providers.base import ProviderError
    config = AiConfig('synthetic-token-' * 3, 'http://localhost:4000', upstage_key='synthetic-upstage')
    def upstream(request):
        pytest.fail('Expired ranking must not contact a model or reserve budget')
    body = {'needs': [], 'candidates': [], 'deadline': (datetime.now(UTC) - timedelta(seconds=1)).isoformat(), 'budget': {'targetId': 'discovery-1', 'leaseId': 'lease-1'}}
    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as model:
        with pytest.raises(ProviderError, match='ANALYSIS_TIMEOUT'):
            await SkillDiscoveryAI(config, model).run('rank', body)
