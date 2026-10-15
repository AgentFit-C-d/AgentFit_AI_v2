# FullStack 연동 조사와 다음 변경안

2026-10-15에 [AgentFit-C-d/FullStack](https://github.com/AgentFit-C-d/FullStack)의 커밋 [`1046f467a11b4cb8eb7d8d8cdc51aa6176686d67`](https://github.com/AgentFit-C-d/FullStack/tree/1046f467a11b4cb8eb7d8d8cdc51aa6176686d67)을 읽고 비교했습니다. 상대 저장소는 수정하지 않았으며 두 서버의 실제 통합 실행은 아직 하지 않았습니다.

## 바로 교체할 수 있는가?

현재는 아닙니다. 문서 추출·모델 호출·근거 검증 코어는 재사용할 수 있지만, 외부 HTTP 계약과 원문 전달·예산 관리 방식을 연결하는 어댑터가 필요합니다. FullStack의 루트 README 일부는 초기 상태를 설명하므로 아래 판단은 실제 FastAPI·Java 호출 코드와 OpenAPI를 우선합니다.

| 항목 | 이 AI 저장소 | FullStack 확인 상태 |
| --- | --- | --- |
| 호출 서버 | 별도 Express 내부 API | Spring Boot `core-api` |
| 분석 경로 | `/internal/v1/analyze` | `/internal/v1/analysis` |
| 인증 | 고정 내부 Bearer 서비스 토큰 | `X-AgentFit-Key-Id`, `X-AgentFit-Timestamp`, `X-AgentFit-Signature` HMAC 및 재전송 검사 |
| 요청 | `attemptId`, `documentId`, `leaseId`, `provider`, `inputKind`, `inputRef`, `deadline` 등 공통 JSON 계약 | `requestId`, `generation`, `contractVersion`, `input` envelope. `input`의 모델 의미는 아직 상세 미정 |
| 응답 | 검증한 Profile·후보·근거 위치·모델 메타데이터 | 같은 요청 문맥을 돌려주며 현재 FastAPI 구현은 `result.kind=CONTRACT_TEST_DOUBLE` |
| 원문·비용 | 백엔드 원문 조회와 Upstage/Solar 사전 예산 예약 API에 의존 | 같은 조회·예산 API의 호환 구현은 이번 조사 범위에서 확인하지 못함 |
| 추천 AI | 공개 검색어용 needs와 전달된 Skill 후보 ranking | B측 `AiCapabilityIntake`의 고정 Capability·필요도·근거 경로 계약. 직접 호환되지 않음 |
| Python | `>=3.12,<3.13`, lockfile 및 테스트는 3.12 | AI Dockerfile은 `python:3.11-slim` |
| 처리 제한 | 전체 180초를 전제로 AI 상한 178초 | `ProjectAnalysisService`의 기본 설정값은 600초 |

근거 파일은 상대 커밋의 다음 경로입니다.

- `contracts/openapi/ai-service.yml`
- `services/ai-service/app/main.py`, `internal_auth.py`, `settings.py`
- `services/core-api/src/main/java/com/agentfit/coreapi/domain/analysis/client/HttpAiAnalysisClient.java`
- `services/core-api/src/main/java/com/agentfit/coreapi/domain/analysis/service/ProjectAnalysisService.java`
- `services/core-api/src/main/java/com/agentfit/coreapi/recommendation/ai/AiCapabilityIntake.java`
- `infra/docker/ai-service.Dockerfile`

## 제안하는 연동 순서

아래는 구현 전 제안이며 확정된 공통 계약이나 연동 완료 상태가 아닙니다.

1. **문서 분석부터 연결합니다.** FullStack의 HMAC 인증과 `requestId/generation/contractVersion` 문맥을 보존하는 별도 엔드포인트 어댑터에서 검증한 분석 코어를 호출합니다. 기존 Express용 API는 유지하고 HMAC을 Bearer로 약화시키지 않습니다.
2. **입력과 결과의 v2 계약을 고정합니다.** 본문 전달인지 제한된 입력 참조인지, 파일 종류·크기·마감 시각·Provider 선택, Profile·근거·오류의 필드를 합의합니다. 현재 `CONTRACT_TEST_DOUBLE`은 실제 분석 결과로 바꾸되 OpenAPI와 Java 소비 코드·저장 검증을 함께 갱신해야 합니다.
3. **원문 수명과 비용 예약을 연결합니다.** Express 전용 경로가 이미 있다고 가정하지 않습니다. Spring의 원문 조회·lease 확인·정리 및 비용 승인 방식에 맞는 어댑터를 정하고, 유료 호출 전에 예산 검사를 통과하게 합니다. DB 접근과 프로젝트 권한·최종 저장은 Spring에 둡니다.
4. **실행 환경과 마감 시각을 맞춥니다.** Python 3.12, 폰트·공통 스키마 패키징, Docker 경로, 내부 주소와 타임아웃을 조정합니다. 다른 서버가 넘긴 600초를 AI가 그대로 수용한다고 가정하지 않습니다.
5. **합성 입력으로 통합 검증한 뒤 실제 모델을 확인합니다.** 유효 HMAC, 변조·중복 요청 거부, 요청 문맥 일치, 근거 검증, 지연 응답·삭제 후 저장 차단, 모델 장애와 예산 거부를 검증합니다. 이후 승인한 예산 안에서 실제 Upstage를 호출합니다.
6. **Capability 추천은 별도 연결합니다.** B의 고정 Capability와 이 서버의 needs/rank 의미를 먼저 맞춥니다. 서로 다른 키를 자동으로 동일시하거나 미정 항목을 임의 필수·선택으로 바꾸지 않습니다. skills.sh 조회·패키지 검사는 모델 호출과 별도 책임입니다.

공통 API·데이터 모델과 서비스 경계가 바뀌므로 위 필드와 소유권을 구체화한 뒤 상대 담당자와 계약을 확인하고 구현해야 합니다. 현재 커밋은 재사용 가능한 AI 코드와 연동 조사까지 제공하며, FullStack 통합을 완료했다고 표시하지 않습니다.
