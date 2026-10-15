import pytest
from agentfit_ai.contracts import validate_profile

UNKNOWN = dict.fromkeys(["project_name", "project_type", "domain", "frontend", "backend", "ai", "database", "deployment", "features", "external_integrations"])

def test_unknown_is_not_explicit_none():
    assert validate_profile(UNKNOWN)["backend"] is None
    assert validate_profile({**UNKNOWN, "backend": []})["backend"] == []

def test_unicode_boundary():
    assert validate_profile({**UNKNOWN, "backend": ["😀" * 200]})["backend"] == ["😀" * 200]
    with pytest.raises(ValueError):
        validate_profile({**UNKNOWN, "backend": ["😀" * 201]})

def test_features_allow_100_but_other_arrays_remain_30():
    features = [f"기능 {index}" for index in range(100)]
    assert validate_profile({**UNKNOWN, "features": features})["features"] == features
    with pytest.raises(ValueError):
        validate_profile({**UNKNOWN, "features": features + ["초과"]})
    for field in ["frontend", "backend", "ai", "external_integrations"]:
        with pytest.raises(ValueError):
            validate_profile({**UNKNOWN, field: features[:31]})

@pytest.mark.parametrize("patch", [{"purpose": "injected"}, {"backend": ["Node"] * 31}, {"database": []}])
def test_bad_values_are_rejected(patch):
    with pytest.raises(ValueError):
        validate_profile({**UNKNOWN, **patch})

def test_missing_field_is_rejected():
    with pytest.raises(ValueError):
        validate_profile({k: v for k, v in UNKNOWN.items() if k != "domain"})
