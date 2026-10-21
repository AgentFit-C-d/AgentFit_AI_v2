"""Freeze distinct, synthetic inputs and expected facts before any model calls."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "evaluations" / "gold"
FIELDS = ["project_name", "project_type", "domain", "frontend", "backend", "ai", "database", "deployment", "features", "external_integrations"]


def freeze():
    if (ROOT / "manifest.json").exists():
        raise SystemExit("Gold already frozen; explicit new version required")
    cases = []
    def add(group, number, text, expected):
        identifier = f"{group}-{number:02d}"
        path = ROOT / group / f"{identifier}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        body = {"caseId": identifier, "text": text, "expected": {field: expected.get(field) for field in FIELDS}}
        raw = (json.dumps(body, ensure_ascii=False, indent=2) + "\n").encode()
        path.write_bytes(raw)
        cases.append({"caseId": identifier, "group": group, "path": str(path.relative_to(ROOT)).replace("\\", "/"), "sha256": hashlib.sha256(raw).hexdigest()})
    for i, (frontend, backend) in enumerate([
        ("React", "Express.js"), ("Vue", "FastAPI"), ("Svelte", "Django"),
        ("Next.js", "NestJS"), ("Angular", "Spring Boot"), ("React", "Flask"),
        ("Vue", "Express.js"), ("SvelteKit", "FastAPI"), ("Next.js", "Django"),
    ], 1):
        text = f"프로젝트명: 사실검증{i}\n프론트엔드: {frontend}\n백엔드: {backend}\n기능: 일정 관리\n데이터베이스와 배포 환경은 아직 정하지 않았습니다."
        add("fact", i, text, {"project_name": f"사실검증{i}", "frontend": [frontend], "backend": [backend], "features": ["일정 관리"]})
    semantics = [
        "백엔드: Express.js는 사용하지 않습니다.", "데이터베이스: PostgreSQL을 제외합니다.",
        "프론트엔드: React는 후보입니다.", "배포: Vercel 또는 GCP를 검토합니다.",
        "향후 백엔드에 FastAPI를 도입할 예정입니다.", "2차 단계에서 PostgreSQL을 사용할 계획입니다.",
        "다른 프로젝트의 백엔드: Django입니다. 우리 프로젝트는 미정입니다.",
        "참고 사례의 프론트엔드: Vue입니다. 현재 프로젝트는 미정입니다.",
        "백엔드: Express.js로 확정합니다.\n백엔드: FastAPI로 확정합니다.",
        "배포: Vercel로 확정합니다.\n배포: GCP로 확정합니다.",
        "프론트엔드: React가 적합할까요?", "데이터베이스: PostgreSQL일 수도 있습니다.",
    ]
    for i, text in enumerate(semantics, 1):
        add("semantic", i, f"검증 문서 SEM{i:02d}\n{text}", {})
    for i in range(1, 31):
        name = f"지역모임{i:02d}"
        text = f"프로젝트명: {name}\n프로젝트 유형: 웹 서비스\n도메인: 지역 커뮤니티\n프론트엔드: React\n백엔드: Express.js\n기능: 모임 검색, 참가 신청\n외부 연동은 없습니다.\n데이터베이스와 배포 환경은 미정입니다.\n운영 지역 번호는 {100 + i}입니다."
        add("normal", i, text, {"project_name": name, "project_type": "웹 서비스", "domain": "지역 커뮤니티", "frontend": ["React"], "backend": ["Express.js"], "features": ["모임 검색", "참가 신청"], "external_integrations": []})
    manifest = {"version": "1.0", "frozenBeforeProviderCalls": True, "cases": cases}
    (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Frozen {len(cases)} distinct synthetic cases")


if __name__ == "__main__":
    freeze()
