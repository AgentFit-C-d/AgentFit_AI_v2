# Catalog 검증 기록

2026-10-06 KST. 20개 후보의 공개 skills.sh 공급자 → 원본 저장소 고정 commit → Markdown 파일 SHA256을 보관한다. 현재 활성 Skill은7개다. `sources.json`과 `snapshots/*.json`이 원본 근거다. 자동 실행·시스템 설치 없음. 라이선스 UNKNOWN은 재배포/추천 비활성.

## 최신 — 구현 계획 추가

같은 고정 commit의 `writing-plans`와 MIT LICENSE를 추가했다. 실제 파일을 읽고 [후속 구현 계획](../../work/harness/independent-candidates/plan.md)에 책임·인터페이스·제약·Review Focus·검증 단계를 적용했으며 [대표 수동 사용·조합 검토](../../work/harness/independent-candidates/usage-review.md)를 남겼다. 실제 Codex 발견은 단독7+전체조합1 모두 이름/경로 일치·scopedErrors0이다. [RPC 기록](../../work/harness/review-and-general-skills/discovery.json). 자동 모델 사용 검사는 NOT_RUN이며 수동 적용과 구분한다.

생성기1.3 전체 합성 구성118파일을 검사하고 고정7+Custom1의 실제 발견을 확인했다. 전체 Superpowers·모든 후속 하위 Skill·실행 명령 호환성을 검증하거나 사용자 전역 설정을 변경한 의미는 아니다. 이하3/6개 기록은 이전 검사 범위다.

대표 환경: Windows 11, 실행 중 Codex desktop 패키지26.930.4958.0, CLI/app-server0.160.0, Node24.19.0. 사용자의 실제 PC 연결 상태를 의미하지 않는다.

2026-10-06 사용자 요청으로 실행 권한 항목이 없는 자연어 Skill의 앱 버전 입력·일치 조건을 제거했다. 위 앱/engine 버전과 supportMatrix.clientVersion은 검사 당시 참고 기록으로 보존하며 모든 앱 버전의 사용을 검증했다고 주장하지 않는다. OS·개발 도구 종류·고정 도구 버전·PASS/만료·조합 조건은 유지한다. MCP/Hook/Plugin/Rules 및 권한 매핑이 있는 Skill에는 기존 앱 버전 검사를 유지한다. 생성기는 고정된 Markdown/text snapshot만 제공한다.

## 실제 발견 검사

`tools/verify-codex-skills.mjs`가 workspace의 격리 `.agents/skills` fixtures에 고정 Markdown을 작성하고 실제 app-server `initialize`→`skills/list(forceReload)`를 호출했다. 새 thread/turn/모델 호출·사용자 설정 변경은 없다.

- React best practices, Composition patterns, Prisma Client API 단독: 정확한 fixture path와 name이 enabled로 발견, scoped error0.
- 세 Skill 동시 발견: 세 name 일치, scoped error0.
- 상세 시간·결과: `work/harness/recommendations/discovery.json`.

## 실 사용 검사 범위

현재 Codex desktop 세션에서 고정 SKILL.md와 지정 rule/reference를 명시적으로 읽고 다음 합성 코드 리뷰 과제에 적용했다. 별도 CLI 모델 turn 실행이나 모든 규칙의 검증을 주장하지 않는다. 자연어 지침을 읽고 적용하는 범위이며 Shell/MCP/외부 인증/권한 집행 검사는 포함하지 않는다.

React 단독 입력:
```tsx
const developer = await fetchDeveloper();
const environment = await fetchEnvironment();
const latest = await fetchRecommendation();
// fullName을 firstName/lastName의 useEffect로 복제한다.
```
검사 결과: 독립 조회 세 개를 Promise.all로 시작해야 한다(async-parallel). fullName은 렌더 중 계산하며 파생 state와 effect를 제거한다(rerender-derived-state-no-effect). 서로 종속적인 저장은 병렬화하지 않는다.

Composition 단독 입력: `ProfileEditor({isDeveloper,isEnvironment,isPreview,isReadonly})`로 서로 배타적 폼을 구성.
검사 결과: DeveloperEditor/EnvironmentEditor/Preview로 명시적 컴포넌트를 분리하고 필요한 필드만 공유한다(architecture-avoid-boolean-props, patterns-explicit-variants). 독립적인 busy/disabled 상태까지 금지하지 않는다.

Prisma 단독 입력: Project 소유권 확인 후 transaction 밖에서 Profile upsert; 사용자 입력을 문자열 연결한 `$queryRawUnsafe`.
검사 결과: 잠금·버전 확인·upsert를 같은 interactive transaction의 tx에서 수행하고 5초 timeout을 설정한다(transactions). Prisma.sql 바인딩으로 입력을 전달한다(raw-queries). 기존 ProfileRepository 실제 경합 검사가 이 구현을 확인했다.

조합 입력: 위 세 문제가 같은 Next/Express/Prisma Profile 작업에 존재.
검사 결과: 조회는 Promise.all, 폼은 명시적 컴포넌트, 종속 쓰기는 단일 tx와 parameterized SQL로 구성한다. 조회 병렬 규칙을 쓰기 경합으로 확대하지 않고 적용되는 범위를 구분했다. 충돌된 규칙/누락 reference0.

위 기록은 초기 세 개 **고정 자연어 Skill의 대표 코드 리뷰 및 파일 발견** 검사다. 매뉴얼 검사이며 사용자의 프로젝트 코드/PC에 설치하거나 무해한 MCP 연결을 수행한 것으로 표시하지 않는다. MCP/Hook/Plugin 실행 mapping은 미검증이므로 활성 후보에 포함하지 않는다.

MIT frontmatter Vercel 항목은 공급자가 명시한 MIT 표기를 그대로 보관하고 원문·출처를 제공한다(저장소 LICENSE 파일은 없었음). Prisma는 실제 저장소 MIT LICENSE 원문 포함. 미확인 라이선스는 UNKNOWN.

## 2026-10-06 공통 개발 지침 추가

`obra/superpowers`의 commit `8ca22dba9a94f28898bbce59f2537ff4d87c747d`에서 systematic-debugging, test-driven-development, verification-before-completion과 Markdown 참조·MIT LICENSE를 고정했다. Shell 보조 스크립트, 전체 Plugin bootstrap, 전역 Hook은 생성 범위에 포함하지 않는다.

실제 Codex app-server에서 활성6개 각각의 단독 발견과 전체 조합 발견을 검사하여 이름·경로 일치와 scopedErrors0을 확인했다. [RPC 기록](../../work/harness/review-and-general-skills/discovery.json)의 사용 검사 NOT_RUN은 자동 모델 turn을 실행하지 않았다는 의미다. 별도로 현재 세션에서 지침을 읽고 원인 추적·실패 회귀 작성·실행 결과 확인 및 여섯 Skill의 합성 코드 리뷰에 적용한 범위는 [수동 사용 기록](../../work/harness/review-and-general-skills/usage-review.md)에 남겼다. 모든 규칙·OS·런타임을 검증한 증거는 아니다.

생성기1.2의 전체 선택·합성 Custom 구성116개 파일을 검사했고, 생성된 고정 Skill6개+Custom1개도 실제 `skills/list`에서 발견됐다(scopedErrors0). [생성 발견 기록](../../work/harness/configuration/discovery.json). 사용자 PC 설치·연결·권한 검증과는 구분한다.
