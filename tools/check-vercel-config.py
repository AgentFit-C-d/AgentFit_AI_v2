import json
from pathlib import Path
from urllib.request import urlopen
from jsonschema.validators import validator_for

root = Path(__file__).resolve().parents[1]
with urlopen("https://openapi.vercel.sh/vercel.json", timeout=20) as response:
    schema = json.load(response)
validator = validator_for(schema)(schema)
for name in ("api", "ai"):
    path = root / "apps" / name / "vercel.json"
    validator.validate(json.loads(path.read_text(encoding="utf-8")))
    print(f"{name}: official configuration schema passed; cloud deployment unverified.")
