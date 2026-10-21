import { labels, ProfileInputError } from './profile-form';
const messages: Record<string, string> = {
  INVALID_INPUT: '입력값의 필수 항목과 형식을 확인해 주세요. 입력은 그대로 유지됩니다.',
  AUTH_REQUIRED: '로그인이 만료되었습니다. 다시 로그인한 뒤 진행해 주세요. 현재 입력은 화면에 남아 있습니다.',
  VERSION_CONFLICT: '다른 변경이 먼저 저장되었습니다. 입력을 보존했으니 최신 결과를 확인한 뒤 다시 저장해 주세요.',
  DRAFT_VERSION_CONFLICT: '새 분석 초안이 있습니다. 입력을 보존했으니 새 초안을 검토한 뒤 다시 저장해 주세요.',
  PROJECT_NOT_FOUND: '프로젝트를 찾을 수 없습니다. 목록으로 돌아가 주세요.',
  SECRET_DETECTED: 'API 키나 비밀번호로 보이는 값이 있습니다. 비밀값을 제거한 뒤 다시 진행해 주세요.',
  ANALYSIS_TIMEOUT: '분석 시간이 초과되었습니다. 기존 확인 결과는 유지됩니다. 문서를 다시 입력하거나 직접 작성해 주세요.',
  INPUT_UNAVAILABLE: '임시 입력을 읽을 수 없습니다. 문서를 다시 입력해 주세요.',
  PROVIDER_AUTH_FAILED: '모델 인증에 실패했습니다. 서버 API 키 설정을 확인하거나 직접 작성해 주세요.',
  PROVIDER_RATE_LIMITED: '모델 요청 한도에 도달했습니다. 잠시 후 문서를 다시 입력하거나 직접 작성해 주세요.',
  PROVIDER_UNAVAILABLE: '선택한 모델 서비스가 요청을 처리하지 못했습니다. 기존 확인 결과는 유지됩니다. 잠시 후 문서를 다시 제출하거나 분석 모델을 바꿔 시도해 주세요.',
  BUDGET_EXCEEDED: '문서 분석 예산 한도에 도달했습니다. 다른 모델을 선택하거나 직접 작성해 주세요.',
  PRICE_NOT_CONFIRMED: '유료 모델의 가격 설정이 확인되지 않았습니다. 다른 모델을 선택하거나 직접 작성해 주세요.',
  ANALYSIS_ALREADY_RUNNING: '이 프로젝트에서 분석이 진행 중입니다. 완료를 기다리거나 취소해 주세요.',
  USER_ANALYSIS_LIMIT: '다른 프로젝트에서 분석이 진행 중입니다. 완료 후 다시 진행해 주세요.',
  GLOBAL_ANALYSIS_LIMIT: '분석 요청이 많습니다. 잠시 후 다시 진행해 주세요.',
  DELETE_INCOMPLETE: '임시 입력 정리가 끝나지 않아 삭제를 완료하지 못했습니다. 다시 삭제해 주세요.',
  NO_TEXT_LAYER: 'PDF에 읽을 수 없는 페이지가 있습니다. OCR 없이 읽을 수 있는 PDF 또는 텍스트를 입력해 주세요.',
  LOCKED_PDF: '잠긴 PDF입니다. 잠금을 해제한 파일을 입력해 주세요.',
  INVALID_PROFILE: '입력값을 확인해 주세요. 항목당 200자, 기능은 100개, 다른 목록은 30개까지 입력할 수 있습니다.',
  NETWORK_ERROR: '서버에 연결하지 못했습니다. 입력은 그대로 유지됩니다. 연결 후 다시 진행해 주세요.',
  CONFIGURATION_STALE: '프로젝트·역할·환경 또는 도구 검증 기준이 바뀌었습니다. 저장된 정보를 확인하고 다시 추천·미리보기를 생성해 주세요.',
  CONFIGURATION_CHANGED: '승인한 미리보기와 내용이 달라졌습니다. 변경한 입력으로 새 미리보기를 검토하고 승인해 주세요.',
  PREVIEW_EXPIRED: '미리보기의 10분 유효 시간이 지났습니다. 입력을 보존했으니 새 미리보기를 생성해 주세요.',
  EXISTING_FILE_CONFLICT: '제공한 기존 파일에서 안전하게 교체할 관리 블록을 확인하지 못했습니다. 원본을 보존하고 별도로 비교·백업해 주세요.',
  NATURAL_LANGUAGE_REQUIRED: '작업 규칙에는 자연어만 입력할 수 있습니다. 실행 코드·명령·외부 URL을 제거해 주세요.',
  UNSUPPORTED_TARGET: '선택한 구성의 파일 경로와 비교 파일이 일치하지 않습니다. 미리보기의 경로를 확인해 주세요.',
  REQUIRED_PERMISSION_DENIED: '선택한 구성에 필요한 권한이 거부되었습니다. 해당 구성을 제외하거나 지원되는 정책을 다시 선택해 주세요.',
};
export function errorMessage(error: unknown): string {
  if (error instanceof ProfileInputError) return `${labels[error.field]}: ${error.detail} 입력은 그대로 유지됩니다.`;
  const code = error instanceof Error ? error.message : '';
  return messages[code] ?? '처리하지 못했습니다. 입력은 그대로 유지됩니다. 다시 시도하거나 직접 작성해 주세요.';
}
