> 현재 브랜치: **backend**. 기존 AI main을 기반으로 backend 작업을 추가했습니다.
> 이 브랜치의 실행·검증·포함 범위는 [backend 안내](docs/backend.md)를 먼저 확인하세요.
> 아래 본문은 기반 main의 AI 서버 안내입니다.

# AgentFit AI v2

AgentFit의 Python/FastAPI AI 서버입니다. 기존 프로젝트에서 AI 담당 코드와 테스트, 합성 평가 데이터, 필수 공통 JSON 계약만 분리했습니다. 원래 경로를 유지하므로 `apps/ai`가 Python 프로젝트 루트입니다.

## 포함 기능

- PDF·Markdown·텍스트 추출과 입력 한도 검증.
- Upstage Solar Pro 4 및 Information Extract를 통한 프로젝트 정보 후보 추출.
- 원문 위치·인용 검증, 기술별 용도, 문맥·부정·상충 검사와 애매한 항목의 추가 검토.
- 확인한 프로젝트·업무로 필요한 능력과 검색어 도출, 전달받은 공개 Skill 후보의 적합도 평가.
- 내부 Bearer 인증, 공급자 오류 분류, 비밀값 검사와 백엔드 예산 예약 연동.
- AI 테스트와 합성 정답 51개(FACT 9, SEMANTIC 12, NORMAL 30).

웹 화면, Express API, 사용자 로그인, DB, skills.sh/GitHub 검색·패키지 검사, 최종 추천 선택·라이브러리 묶음·ZIP 생성은 별도 서비스의 책임이며 이 저장소에 포함하지 않습니다. AI의 점수 출력 이후 75점 추천·70~74점 추가 후보 노출은 별도 API/UI에서 처리합니다.

팀의 Spring Boot 기반 FullStack에 연결하려면 [연동 비교와 다음 변경안](docs/fullstack-integration.md)을 먼저 확인하세요. 현재 두 서비스는 HTTP 계약이 달라 바로 교체할 수는 없습니다.

현재 서비스의 공급자는 Solar와 Information Extract입니다. NVIDIA·Document Parse 코드는 기존 실험·회귀 테스트를 보존하기 위해 포함했으며 현재 분석 서비스에서 호출하지 않습니다.

## 개발 환경과 실행

Python 3.12와 uv가 필요합니다. 저장소 루트에서 실행하세요.

```powershell
uv sync --frozen --project apps/ai
Copy-Item .env.example .env
```

`.env`의 `AI_SERVICE_TOKEN`에 32자 이상의 임의 값을 넣고 호출하는 Express 서버와 일치시키세요. 실제 모델을 사용하려면 `UPSTAGE_API_KEY`를 입력합니다. 비밀값은 Git에 올리지 않습니다. `API_INTERNAL_URL`은 Express 내부 API 주소입니다.

```powershell
uv run --project apps/ai --env-file .env uvicorn --app-dir apps/ai agentfit_ai.main:app_factory --factory --host 127.0.0.1 --port 8000
```

`GET /health`로 서버 준비 상태를 확인합니다. 모델 키가 없어도 충분한 길이의 서비스 토큰이 있으면 시작할 수 있으며 실제 분석 호출에는 키와 연결된 백엔드가 필요합니다. 건강 상태의 키 설정 여부는 실제 모델 연결 검증을 뜻하지 않습니다.

## 검증

```powershell
uv run --frozen --project apps/ai pytest apps/ai/tests -q
uv run --frozen --project apps/ai python apps/ai/build.py
```

테스트는 합성 입력과 가짜 HTTP 공급자를 사용하며 유료 모델을 호출하지 않습니다. 패키징 테스트는 공통 스키마를 AI 배포 폴더에 복사한 뒤 별도 경로에서도 계약·근거 검증을 사용할 수 있는지 확인합니다. `packages/contracts/schema`는 소비하는 공통 계약의 스냅샷이므로 연동 백엔드와 함께 버전을 맞춰야 합니다.

`evaluations/inputs.py`, `report.py`, `gold/`는 합성 평가의 입력·정답·채점 도구입니다. `evaluations/run.py`는 실행 중인 전체 AgentFit API와 명시적으로 준비한 평가 세션을 필요로 합니다. 실제 평가에는 별도 예산 승인과 환경 준비가 필요하며 이 저장소의 테스트 통과가 실제 모델 정확도를 입증하지는 않습니다. 공급자 원본 응답·사용자 기획서·개인 평가 결과는 포함하지 않았습니다.

## 백엔드 연동 계약

| AI 엔드포인트 | 역할 |
| --- | --- |
| `GET /health` | 서버 준비 및 모델 키 설정 여부 |
| `POST /internal/v1/analyze` | 입력 참조에 따른 문서 분석 |
| `POST /internal/v1/skills/needs` | 확인한 사실에서 필요한 능력 도출 |
| `POST /internal/v1/skills/rank` | 전달받은 후보의 적합도 평가 |

내부 POST 요청에는 `Authorization: Bearer <AI_SERVICE_TOKEN>`이 필요합니다. 요청·응답 구조는 `packages/contracts/schema/internal.json`, `skills.json`, `analysis.json`을 참조하세요. 분석은 원문을 직접 업로드하는 API가 아니라 백엔드에서 발급한 입력 참조·작업 lease·마감 시각을 받습니다.

호출 대상 백엔드는 다음 내부 기능을 제공해야 합니다.

- `/internal/v1/inputs/{uploadId}/metadata` 및 로컬 원문 조회 `/internal/v1/inputs/{uploadId}`.
- Information Extract 페이지 예산 예약 `/internal/v1/budget/reserve`.
- Solar 분석·추가 검토·Skill 평가 예산 예약 `/internal/v1/budget/solar`.

비공개 Blob 입력은 백엔드 메타데이터 검증 후 허용된 Blob origin에서 읽습니다. 원문 수명·Queue·DB 저장·프로젝트 권한은 백엔드가 담당합니다. 분석 처리의 마감은 호출자가 넘긴 시각을 따르며 AI 서버는 최대 178초로 제한해 전체 180초 예산에 여유를 둡니다.

## 배포 상태

`apps/ai/vercel.json`과 `build.py`는 기존 Vercel용 설정입니다. Vercel 프로젝트 Root Directory는 `apps/ai`이며 빌드 시 상위 `packages/contracts/schema`가 포함되어야 합니다. 이 저장소에서 실제 Vercel 배포와 운영 환경 연동은 아직 검증하지 않았습니다.

한국어 PDF 생성용 NanumGothic 폰트의 라이선스는 `apps/ai/assets/fonts/OFL.txt`에 포함돼 있습니다.
