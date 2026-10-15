import base64
import copy
import json

from jsonschema import Draft7Validator

from ..contracts import SCHEMA_ROOT, profile_array_limit, validate_provider_output
from .base import JsonProvider
from .field_guidance import EXTRACTION_GUIDANCE, FEATURE_GUIDANCE, INTEGRATION_GUIDANCE

PROVIDER_SCHEMA = json.loads((SCHEMA_ROOT / "upstage-output.json").read_text(encoding="utf-8"))
_validator = Draft7Validator(PROVIDER_SCHEMA)
_lists = {"frontend", "backend", "ai", "features", "external_integrations"}


class UpstageProvider(JsonProvider):
    endpoint = "https://api.upstage.ai/v1/information-extraction/chat/completions"
    model = "information-extract"

    def parse_output(self, output):
        if not _validator.is_valid(output):
            raise ValueError("INVALID_PROVIDER_OUTPUT")
        items = []
        for item in output["items"]:
            values, none, field = item["values"], item["explicit_none"], item["field"]
            if len(values) > profile_array_limit(field):
                raise ValueError("INVALID_PROVIDER_OUTPUT")
            usages = [{"value": values[0], "purpose": item["purpose"], "quote": item["purpose_quote"]}] if len(values) == 1 and item.get("purpose") and item.get("purpose_quote") else []
            if not values and not none:
                continue  # Missing/undecided is unknown, never an explicit empty list.
            if none:
                if values or field not in _lists:
                    raise ValueError("INVALID_PROVIDER_OUTPUT")
                value = []
            elif field not in _lists:
                for alternative in values:
                    items.append({"field": field, "value": alternative, "quote": item["quote"], "context": item["context"], **({"usages": [usage for usage in usages if usage["value"] == alternative]} if usages else {})})
                continue
            else:
                value = values if field in _lists else values[0]
            items.append({"field": field, "value": value, "quote": item["quote"], "context": item["context"], **({"usages": usages} if usages else {})})
        return validate_provider_output({"items": items})

    def request_body(self, document, canonical):
        if canonical is None:
            raise ValueError("CANONICAL_DOCUMENT_REQUIRED")
        encoded = base64.b64encode(canonical.data).decode("ascii")
        schema = copy.deepcopy(PROVIDER_SCHEMA)
        item_schema = schema["properties"]["items"]["items"]
        item_schema["required"] = list(item_schema["properties"])
        schema['properties']['items']['description'] += ' ' + EXTRACTION_GUIDANCE
        props = item_schema['properties']
        props['field']['description'] += ' ' + FEATURE_GUIDANCE + ' ' + INTEGRATION_GUIDANCE
        props['values']['description'] += ' For features use one concise, verbatim core business capability per item, excluding minor workflow substeps and presentation requirements; never invent a rewritten feature name. For external_integrations use one exact full service name per item, including API/OAuth qualifiers.'
        props['purpose']['description'] += ' Include explicitly stated external service purposes, even for APIs also listed in ai. One service and one purpose per item; repeat the service for different purposes.'
        return {"model": self.model, "mode": "standard", "split": False, "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": f"data:application/octet-stream;base64,{encoded}"}}]}], "response_format": {"type": "json_schema", "json_schema": {"name": "project_facts", "schema": schema}}}
