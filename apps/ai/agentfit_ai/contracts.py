import copy
import json
from pathlib import Path
from jsonschema import Draft7Validator
from referencing import Registry, Resource

SCHEMA_ROOT = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "schema"
if not SCHEMA_ROOT.is_dir():
    SCHEMA_ROOT = Path(__file__).resolve().parent / "schema"
PROFILE_SCHEMA = json.loads((SCHEMA_ROOT / "profile.json").read_text(encoding="utf-8"))
PROFILE_FIELDS = list(PROFILE_SCHEMA["properties"])
def profile_array_limit(field):
    return PROFILE_SCHEMA["definitions"]["features" if field == "features" else "array"]["anyOf"][0]["maxItems"]
_profile_validator = Draft7Validator(PROFILE_SCHEMA)
ANALYSIS_SCHEMA = json.loads((SCHEMA_ROOT / "analysis.json").read_text(encoding="utf-8"))
_registry = Registry().with_resources([
    (schema["$id"], Resource.from_contents(schema))
    for schema in [PROFILE_SCHEMA, ANALYSIS_SCHEMA]
])
_analysis_validator = Draft7Validator(ANALYSIS_SCHEMA, registry=_registry)
PROVIDER_SCHEMA = json.loads((SCHEMA_ROOT / "provider-output.json").read_text(encoding="utf-8"))
_provider_validator = Draft7Validator(PROVIDER_SCHEMA)
INTERNAL_SCHEMA = json.loads((SCHEMA_ROOT / "internal.json").read_text(encoding="utf-8"))


def validate_internal(name, value):
    schema = {"$schema": INTERNAL_SCHEMA["$schema"], "definitions": INTERNAL_SCHEMA["definitions"], "$ref": f"#/definitions/{name}"}
    if not Draft7Validator(schema).is_valid(value):
        raise ValueError("INVALID_INTERNAL_REQUEST")
    return copy.deepcopy(value)


def validate_provider_output(value):
    if not _provider_validator.is_valid(value):
        raise ValueError("INVALID_PROVIDER_OUTPUT")
    for item in value["items"]:
        validate_profile({**empty_profile(), item["field"]: item["value"]})
    return copy.deepcopy(value)

def validate_profile(value: object) -> dict:
    if not _profile_validator.is_valid(value):
        raise ValueError("INVALID_PROFILE")
    return copy.deepcopy(value)

def empty_profile() -> dict:
    return dict.fromkeys(PROFILE_FIELDS)

def validate_analysis_result(value):
    if not _analysis_validator.is_valid(value):
        raise ValueError("INVALID_ANALYSIS_RESULT")
    metadata = value['modelMetadata']
    review = metadata.get('secondaryReview')
    if (metadata['inputFormat'] == 'original-pdf' or review) and metadata['provider'] != 'upstage':
        raise ValueError('INVALID_ANALYSIS_RESULT')
    if review and (review['acceptedCount'] > review['targetCount'] or (review['status'] != 'COMPLETED' and review['acceptedCount'] != 0)):
        raise ValueError('INVALID_ANALYSIS_RESULT')
    ids = [candidate["id"] for candidate in value["candidates"]]
    if len(ids) != len(set(ids)):
        raise ValueError("INVALID_ANALYSIS_RESULT")
    for candidate in value["candidates"]:
        if candidate["field"]:
            validate_profile({**empty_profile(), candidate["field"]: candidate["proposedValue"]})
        for evidence in candidate["evidence"]:
            if "start" in evidence and evidence["start"] >= evidence["end"]:
                raise ValueError("INVALID_ANALYSIS_RESULT")
        proposed = candidate["proposedValue"]
        names = proposed if isinstance(proposed, list) else [name.strip() for name in proposed.split(",")] if isinstance(proposed, str) else []
        for usage in candidate.get("usages", []):
            if usage["value"] not in names:
                raise ValueError("INVALID_ANALYSIS_RESULT")
            for evidence in usage["evidence"]:
                if "start" not in evidence or evidence["start"] >= evidence["end"] or not any(source["documentId"] == evidence["documentId"] and "start" in source and source["start"] <= evidence["start"] and evidence["end"] <= source["end"] for source in candidate["evidence"]):
                    raise ValueError("INVALID_ANALYSIS_RESULT")
    return copy.deepcopy(value)
