import { randomUUID } from 'node:crypto';
import type { Preview, PreviewInput, RecommendationBasis } from '@agentfit/contracts';
import { generateFiles } from './generator';
import { fingerprintPreview } from './hash';
import type { ValidatedSelection } from './permissions';
export const GENERATOR_VERSION = 'codex-library-guides-2.0';
export function buildPreview(basis: RecommendationBasis, input: PreviewInput, selection: ValidatedSelection, now = new Date()): Preview {
  const files = generateFiles(selection, input);
  const packageWarning = selection.items.some(x => x.package) ? [{ code: 'PACKAGE_ONLY_CHECKED', message: '새 후보는 출처·파일·라이선스 패키지 검사만 통과했습니다. 실제 Codex 사용과 전체 구성 조합은 미검증입니다.', targetKey: null }] : [];
  return { id: randomUUID(), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600000).toISOString(), status: 'READY', generatorVersion: GENERATOR_VERSION, basis, recommendationId: input.recommendationId, selectedToolIds: [...input.selectedToolIds].sort(), ...fingerprintPreview(basis, input, files, GENERATOR_VERSION), evidence: { environment: 'USER_DECLARED', existingFiles: input.existingState === 'PROVIDED' ? 'PROVIDED_CONTENT' : input.existingState === 'USER_SAYS_EMPTY' ? 'USER_DECLARED' : 'UNKNOWN', effectivePermissions: 'UNVERIFIED' }, files, policies: input.permissionPolicies, warnings: [...packageWarning, { code: 'PERMISSIONS_UNVERIFIED', message: '자연어 Skill은 실행 권한을 강제하지 않습니다. 실제 환경·상위 정책은 미검증입니다.', targetKey: null }, ...(files.some(f => f.comparisonScope === 'EXISTING_UNKNOWN') ? [{ code: 'EXISTING_UNKNOWN', message: '제공하지 않은 기존 파일은 비교하지 않았습니다. 적용 전 확인과 백업이 필요합니다.', targetKey: null }] : [])] };
}
