from dataclasses import dataclass
import re
from urllib.parse import urlsplit


@dataclass(frozen=True)
class AiConfig:
    token: str
    api_origin: str
    upstage_key: str = ""
    nvidia_key: str = ""
    blob_origin: str = ""
    blob_token: str = ""


def read_config(environment):
    token = environment.get("AI_SERVICE_TOKEN", "")
    origin = environment.get("API_INTERNAL_URL", "http://127.0.0.1:4000")
    parsed = urlsplit(origin)
    if len(token) < 32 or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or not parsed.hostname or (parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"})):
        raise ValueError("INVALID_AI_CONFIG")
    blob = environment.get("BLOB_PRIVATE_ORIGIN", "")
    blob_token = environment.get("BLOB_READ_WRITE_TOKEN", "")
    if bool(blob) != bool(blob_token) or (blob and not re.fullmatch(r"https://[a-zA-Z0-9-]+\.private\.blob\.vercel-storage\.com", blob)):
        raise ValueError("INVALID_AI_CONFIG")
    return AiConfig(token, origin, environment.get("UPSTAGE_API_KEY", ""), environment.get("NVIDIA_API_KEY", ""), blob, blob_token)
