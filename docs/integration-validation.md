# 통합 브랜치 검증 기록

검증일: 2026-10-21. 저장소의 `integration`은 다음 두 브랜치를 실제 Git merge로 합쳤습니다. 두 브랜치의 공통 조상은 AI main `2164a43193f0748a2bb80cdee107f776257f8c03`입니다.

- frontend: `27516181912e943820380857d2dd1c602fa466f2`
- backend: `eb61458de0464bb0b58f943ca713e6caf727fb2e`

충돌은 README와 Vitest 설정 두 파일에만 있었습니다. README를 전체 실행 안내로 정리하고 공통 계약 경로를 지정한 frontend 테스트 설정을 유지했습니다. 웹·Express·AI 구현, API 계약, DB 마이그레이션은 수정하지 않았습니다.

## 실행 결과

Windows, Node.js 24/pnpm 11.25.0, Python 3.12.11 환경의 별도 통합 복사본에서 실행했습니다. Node/Python 의존성은 기존 lockfile로 설치했고 Prisma client를 새로 생성했습니다.

| 검증 | 결과 |
| --- | --- |
| `pnpm test` | 55개 파일, 277개 테스트 통과. UI·계약·API·격리 PostgreSQL 통합 테스트 포함 |
| 통합 복사본의 Python venv로 `python -m pytest apps/ai/tests -q` | 186개 통과. 임시 경로를 별도 지정했고 AI 패키징 테스트 포함 |
| `pnpm typecheck` | API·공통 코드·도구·테스트와 Next.js 타입 검사 통과 |
| `pnpm lint` | 통과 |
| `pnpm build` | API 검사와 Next.js 프로덕션 빌드 통과 |
| `pnpm test:e2e` | 브라우저 14개 테스트 통과, 56.7초 |

첫 Python 검증에서 로컬 보조 스크립트가 존재하지 않는 임시 상위 경로를 지정해 fixture 2개가 실행되지 않았습니다. 보조 스크립트의 경로를 바로잡은 뒤 186개 전체가 통과했으며 AI 앱이나 테스트 코드는 수정하지 않았습니다.

## 브라우저 통합 범위

E2E는 격리 PostgreSQL과 실제 Express runtime, 별도 FastAPI 프로세스, Next.js 서버·Chromium을 함께 사용합니다. 원문 조회·작업 Queue·추출·근거 검증·결과 저장·API·화면을 연결하고, 외부 모델 추출·추가 검토 및 Skill 공급원 응답은 합성 fixture로 대체합니다. GitHub OAuth 대신 테스트용 세션을 발급합니다.

- 문서 초안 → 사용자 검토·수정 → 저장·새로고침 → 오래된 편집 충돌 → 삭제.
- 중복 기술·병행 AI/배포 용도·대량 기능 목록과 핵심 기능 정리.
- 제한된 추가 검토의 성공 및 실패 시 첫 결과 보존.
- 역할·환경 저장, 추천 재생성, 최소 추천과 Superpowers 라이브러리 선택.
- 70점 후보의 초기 미선택 → 명시적 선택 → 미리보기 → 최종 승인 → ZIP 내용 확인.
- 적용 진술·이력·취소, 모바일 가로 넘침, 다른 탭 로그아웃 시 미저장 원문 해제.

## 확인하지 않은 범위

실제 GitHub 로그인, 유료 Upstage 모델 호출·품질, 실시간 skills.sh/GitHub 공급원, 실제 Codex 설치·사용, Vercel 운영 배포는 이번 통합 테스트에 포함하지 않았습니다. 팀의 Spring Boot `FullStack` 저장소를 합친 것이 아니라 기존 Express·Next.js·FastAPI 세 컴포넌트를 합친 결과입니다.

실제 비밀키·사용자 기획서·평가 결과·로컬 DB·생성 Prisma client·의존성/빌드 캐시는 Git에 포함하지 않습니다. 기존 main·frontend·backend 브랜치에는 통합 커밋을 반영하지 않습니다.
