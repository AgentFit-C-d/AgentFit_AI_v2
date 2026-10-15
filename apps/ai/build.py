"""Package the authoritative monorepo schemas for an isolated Python function."""
from pathlib import Path
import shutil

source = Path(__file__).resolve().parents[2] / "packages" / "contracts" / "schema"
target = Path(__file__).resolve().parent / "agentfit_ai" / "schema"
target.mkdir(exist_ok=True)
for path in source.glob("*.json"):
    shutil.copyfile(path, target / path.name)
print("Shared contracts packaged; no environment files copied.")
