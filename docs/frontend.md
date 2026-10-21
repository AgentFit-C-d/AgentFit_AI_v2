# Frontend 브랜치

기존 AI `main`에 Next.js/React 프론트엔드 작업만 추가한 브랜치입니다. 전체 Express 서버는 `backend` 브랜치에 있습니다. 현재 웹 앱은 Express 계약을 사용하므로 팀의 Spring Boot FullStack과 바로 호환되지는 않습니다.

## 포함 범위

- `apps/web`: 로그인·프로젝트·문서 입력·분석 상태·묶음 검토·개발환경·추천·권한·미리보기·ZIP 화면.
- `packages/contracts`: API 타입과 공통 검증 스키마.
- `tests/web`, `tests/contracts`, 두 공유 fixture 및 공통 Catalog.
- `apps/api/src/projects/profile.ts`, `http/errors.ts`, `recommendations/catalog.ts`: 기존 프론트 회귀 테스트가 소비하는 백엔드 헬퍼만 포함합니다. 이 파일만으로 API 서버를 실행할 수는 없습니다.
- 원본 workspace manifest·lockfile·빌드/검증 설정. 버전과 기존 구현은 바꾸지 않았습니다.

별도 API workspace 없이도 공유 회귀 테스트가 공통 패키지를 찾도록 Vitest에 `@agentfit/contracts` 경로만 지정했습니다. 앱 동작 코드는 원본 그대로입니다.

## 실행과 검증

Node.js 24 및 pnpm 11.25.0에서 저장소 루트 기준으로 실행합니다.

```powershell
pnpm install --frozen-lockfile
pnpm --filter @agentfit/web dev
pnpm --filter @agentfit/web build
pnpm --filter @agentfit/web typecheck
pnpm exec vitest run tests/web tests/contracts
```

기본 웹 주소는 `http://localhost:3000`이며 `/api/*`는 기본 `http://127.0.0.1:4000`의 Express API로 전달합니다. 별도 API 주소는 시작/빌드 시 `API_PROXY_URL`에 origin만 설정하세요. 브라우저에는 OAuth Secret·Upstage 키를 넣지 않습니다.

실제 로그인·저장·분석·다운로드를 사용하려면 `backend` 브랜치의 API와 DB, AI 서버도 실행해야 합니다. 원본 root `pnpm build`, `pnpm typecheck`, E2E 등 전체 프로젝트 명령은 양쪽 브랜치를 합친 환경을 전제로 합니다. 이 브랜치만 검증할 때는 위 컴포넌트 명령을 사용하세요. 앱 코드 수정이나 백엔드 계약 변경 없이 옮겼습니다.

비밀값·로컬 DB·원본 기획서·로그·평가 결과·node_modules·빌드 결과는 포함하지 않았습니다. Vercel 배포와 Spring FullStack 통합은 수행하지 않았습니다.
