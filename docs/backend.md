# Backend 브랜치

기존 AI `main`에 Express.js API·DB·추천·설정 생성 작업을 추가한 브랜치입니다. Next.js 웹 전체는 `frontend` 브랜치에 있습니다. 이 코드는 팀의 Spring Boot FullStack과 별도로 만든 Express 구현이며, Spring 통합본을 의미하지 않습니다.

## 포함 범위

- `apps/api`: GitHub OAuth/세션·소유권·프로젝트·문서 분석 작업·비공개 Blob·Queue·예산 예약·보관/삭제·진단.
- 개발자/환경 Profile, skills.sh/GitHub 후보 조회·패키지 검사·점수 선별·라이브러리 추천.
- 권한 선택·설정 미리보기·최종 승인·ZIP·생성 이력.
- `apps/api/prisma`: DB 스키마와 전체 마이그레이션. 생성된 Prisma client는 제외하고 설치 후 생성합니다.
- 공통 contracts/Catalog/고정 공개 Skill 스냅샷, API·계약·DB 통합 테스트, 지원 fixture, 개발·평가 도구, Docker PostgreSQL 및 Vercel 설정.
- E2E 테스트와 Playwright 설정도 보관했으며 실행에는 frontend 브랜치의 웹 소스가 필요합니다.

## 로컬 실행

Node.js 24, pnpm 11.25.0, Python 3.12/uv가 필요합니다. 저장소 루트 기준입니다.

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm setup:local
pnpm db:local
pnpm --filter @agentfit/api db:generate
pnpm --filter @agentfit/api db:deploy
```

`db:local`은 Windows embedded PostgreSQL을 사용하는 기존 개발 도구입니다. Docker에서는 `pnpm db:up`을 대신 사용하세요. 두 방법 모두 같은 포트를 사용하므로 하나만 실행합니다. `setup:local`은 누락한 로컬 토큰·DB 설정만 생성하고 기존 값을 보존합니다.

`.env`에 GitHub OAuth 앱 ID/Secret과 Upstage 키를 직접 넣습니다. GitHub 콜백은 웹 기준 `http://localhost:3000/api/auth/callback/github`입니다. 실제 비밀값은 저장소에 포함하지 않았습니다.

```powershell
pnpm dev:api
# 별도 터미널: RTK와 uv가 필요한 기존 AI 실행 도구
pnpm dev:ai
```

RTK 없이 AI만 시작하려면 기존 [AI 안내](../README.md)의 직접 uvicorn 명령을 사용하세요. API는 기본 4000, AI는 8000 포트입니다. 서비스 토큰은 두 서버에서 같아야 합니다. Upstage 호출 전에는 공통 예산 예약을 통과해야 하며 새 환경의 예산 카운터는 과거 실제 결제 내역을 자동으로 가져오지 않습니다.

## 검증

```powershell
pnpm --filter @agentfit/api db:generate
pnpm exec tsc --noEmit
pnpm exec eslint .
pnpm exec vitest run tests/api tests/contracts tests/integration
```

현재 DB 통합 테스트와 E2E 실행 지원 도구는 Windows와 RTK를 전제로 합니다. 외부 공급자는 합성 fixture를 사용합니다. 프론트와 합친 뒤 `pnpm build`, `pnpm typecheck`, `pnpm test:e2e` 같은 원래 전체 프로젝트 명령을 사용할 수 있습니다. 두 브랜치는 같은 AI main에서 나뉘었으므로 합칠 때 README 등 공통 문서의 충돌은 확인해야 합니다.

일부 개발·실제 모델 평가 도구는 별도 입력·세션·명시적 예산 준비를 필요로 하며 일회성 작업 경로를 참조합니다. 해당 `work/` 자료나 사용자 원문·진단 로그·실제 모델 결과는 올리지 않았습니다. Vercel 운영 검증·Spring FullStack 연동·새 유료 모델 평가는 수행하지 않았습니다.
