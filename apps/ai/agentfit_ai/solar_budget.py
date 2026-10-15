import json
import time

import httpx

from .contracts import validate_internal
from .providers.base import ProviderError


def solar_reservation(config, client, scope, target_id, lease_id, operation):
    async def reserve(body, deadline):
        payload = {"scope": scope, "targetId": target_id, "leaseId": lease_id, "operation": operation, "inputBytes": len(json.dumps(body, ensure_ascii=False).encode("utf-8")), "outputTokens": body["max_tokens"]}
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ProviderError("ANALYSIS_TIMEOUT")
        try:
            response = await client.post(config.api_origin + "/internal/v1/budget/solar", headers={"Authorization": f"Bearer {config.token}"}, json=payload, timeout=min(5, remaining), follow_redirects=False)
            if len(response.content) > 16384:
                raise ProviderError("BUDGET_EXCEEDED")
            if response.status_code != 200:
                code = response.json().get("error", {}).get("code")
                raise ProviderError(code if code in {"BUDGET_EXCEEDED", "INVALID_ANALYSIS_LEASE", "BUDGET_RESERVATION_MISMATCH"} else "BUDGET_EXCEEDED")
            validate_internal("solarBudgetGrant", response.json())
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise ProviderError("BUDGET_EXCEEDED") from None
    return reserve
