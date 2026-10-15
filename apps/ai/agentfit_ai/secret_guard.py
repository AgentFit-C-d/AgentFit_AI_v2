import json
import re
from .contracts import SCHEMA_ROOT

_PATTERNS = [re.compile(pattern, re.IGNORECASE) for pattern in json.loads((SCHEMA_ROOT / "secret-patterns.json").read_text(encoding="utf-8"))]


def assert_no_secrets(value, known_secrets=()):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    if any(pattern.search(text) for pattern in _PATTERNS) or any(len(secret) >= 12 and secret in text for secret in known_secrets):
        raise ValueError("SECRET_DETECTED")
