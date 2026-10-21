import type { DeveloperProfile, EnvironmentProfile, ProjectProfile, RecommendationResult } from '@agentfit/contracts';
import { compatible, type CatalogItem, type CatalogSnapshot, type SupportMatrix } from './catalog';
import { deriveCapabilities, deriveWorkflowCapabilities } from './capabilities';
export interface RecommendationInputs { profile: ProjectProfile; developer: DeveloperProfile | null; environment: EnvironmentProfile | null }
export function recommend(inputs: RecommendationInputs, catalog: CatalogSnapshot, now = new Date()): RecommendationResult {
  const capabilities = deriveCapabilities(inputs.profile, inputs.developer);
  const workflows = deriveWorkflowCapabilities(inputs.profile, inputs.developer).filter(capability => catalog.items.some(item => item.verificationStatus === 'VERIFIED' && item.license !== 'UNKNOWN' && item.capabilities.includes(capability.id)));
  const result: RecommendationResult = { status: 'NO_ADDITIONS_NEEDED', capabilities: [...capabilities, ...workflows], items: [], questions: [], reasons: [], evidenceLevel: inputs.environment ? 'ENVIRONMENT_DECLARED' : 'PLAN_ONLY' };
  if (!capabilities.length && !workflows.length) { result.reasons = ['현재 확인한 작업은 Codex의 기본 코드 작성·파일 편집 기능으로 시작할 수 있습니다.']; return result; }
  const environment = inputs.environment;
  const ask = (field: string, message: string) => result.questions.push({ id: field.replaceAll('.', '-'), field, message, required: true });
  if (!environment?.os?.version) ask('environment.os', 'OS 종류와 버전을 입력해 주세요.');
  if (!environment?.client?.id) ask('environment.client', 'AI 개발 도구를 선택해 주세요.');
  if (!environment || environment.installedComponents === null) ask('environment.installedComponents', '기존 확장이 있는지 확인해 주세요. 없으면 명시적으로 없음으로 입력하세요.');
  if (result.questions.length) { result.status = 'NEEDS_INFORMATION'; return result; }
  const valid = new Map<string, { item: CatalogItem; matrix: SupportMatrix }>();
  for (const item of catalog.items) { const matrix = compatible(item, environment!, now); if (matrix) valid.set(item.id, { item, matrix }); }
  const installed = new Set<string>(); const covered = new Set<string>();
  for (const component of environment!.installedComponents!) {
    if (!component.catalogItemId) continue;
    const match = valid.get(component.catalogItemId);
    if (!match) continue;
    if (!component.version) { ask('environment.installedComponents', `${match.item.name}의 설치 버전을 확인해 주세요.`); continue; }
    if (component.version !== match.item.version) continue;
    installed.add(match.item.id);
    match.item.components.forEach(id => installed.add(id));
    match.item.capabilities.forEach(id => covered.add(id));
  }
  if (result.questions.length) { result.status = 'NEEDS_INFORMATION'; return result; }
  const needed = capabilities.filter(c => !covered.has(c.id)).map(c => c.id);
  const risk = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  function expand(id: string, selection: Set<string>, chain: Set<string>): boolean {
    if (installed.has(id) || selection.has(id)) return true;
    const entry = valid.get(id);
    if (!entry || chain.has(id)) return false;
    const next = new Set(chain).add(id);
    for (const dependency of entry.item.dependencies) if (!expand(dependency, selection, next)) return false;
    selection.add(id); return true;
  }
  function allowed(selection: Set<string>) {
    const ids = [...selection];
    for (const id of ids) {
      const { item, matrix } = valid.get(id)!;
      if (item.conflicts.some(conflict => installed.has(conflict) || selection.has(conflict))) return false;
      for (const installedId of installed) if (valid.get(installedId)?.item.conflicts.includes(id)) return false;
      for (const installedId of installed) {
        const other = valid.get(installedId);
        if (other && (!matrix.allowedCombinationIds.includes(installedId) || !other.matrix.allowedCombinationIds.includes(id))) return false;
      }
      for (const otherId of ids) if (id !== otherId) {
        const other = valid.get(otherId)!;
        if (item.components.includes(otherId) || other.item.components.includes(id)) return false;
        if (!matrix.allowedCombinationIds.includes(otherId) || !other.matrix.allowedCombinationIds.includes(id)) return false;
      }
    }
    return true;
  }
  let best: string[] | null = null;
  const visited = new Set<string>();
  function rank(ids: string[]) { return [ids.length, ids.reduce((sum, id) => sum + risk[valid.get(id)!.item.risk], 0), ids.reduce((sum, id) => sum + valid.get(id)!.item.dependencies.length, 0)] as const; }
  function better(ids: string[]) {
    if (!best) return true;
    const a = rank(ids), b = rank(best);
    for (const i of [0, 1, 2] as const) if (a[i] !== b[i]) return a[i] < b[i];
    return ids.join('\0') < best.join('\0');
  }
  function search(selection: Set<string>) {
    const ids = [...selection].sort(); const key = ids.join('\0');
    if (visited.has(key) || (best && ids.length > best.length)) return;
    visited.add(key);
    const missing = needed.find(capability => !ids.some(id => valid.get(id)!.item.capabilities.includes(capability)));
    if (!missing) { if (better(ids)) best = ids; return; }
    for (const { item } of valid.values()) {
      if (installed.has(item.id) || !item.capabilities.includes(missing)) continue;
      const next = new Set(selection);
      if (expand(item.id, next, new Set()) && allowed(next)) search(next);
    }
  }
  search(new Set());
  if (!best) {
    result.status = 'NO_COMPATIBLE_TOOLS';
    if (valid.size) {
      result.reasons = ['입력한 환경에서 검사한 후보는 있지만, 필요한 기능·의존성·구성 조합을 모두 충족하는 검증된 구성이 없습니다. 미검증 도구는 추천하지 않습니다.'];
    } else {
      const osNames: Record<string, string> = { WINDOWS: 'Windows', MACOS: 'macOS', LINUX: 'Linux', OTHER: '기타 OS' };
      const describe = (family: string, version: string, clientId: string) => `${osNames[family] ?? family} ${version} / ${clientId === 'codex-desktop' ? 'Codex 앱' : clientId}`;
      const checked = [...new Set(catalog.items.filter(candidate => candidate.verificationStatus === 'VERIFIED' && candidate.license !== 'UNKNOWN').flatMap(candidate => candidate.supportMatrix.filter(m => Date.parse(m.checkedAt) <= now.getTime() && Date.parse(m.expiresAt) > now.getTime() && Object.values(m.checks).every(c => c === 'PASS') && m.permissionMappingVerified).map(m => describe(m.osFamily, m.osVersion, m.clientId))))];
      result.reasons = [
        `저장한 환경: ${describe(environment!.os!.family, environment!.os!.version!, environment!.client!.id)}.`,
        ...(checked.length ? [`현재 검사한 OS·개발 도구: ${checked.join(' · ')}. 저장한 조건에서 추천 가능한 검증된 구성이 없습니다.`] : ['현재 활성화된 환경 검증 기록이 없습니다.']),
        '입력한 OS·개발 도구와 도구 검증 범위를 확인해 주세요. 자연어 Skill은 Codex 앱 버전의 입력이나 일치를 요구하지 않습니다.',
      ];
    }
    return result;
  }
  const core = new Set(best as string[]); const selected = new Set(core);
  for (const capability of workflows) {
    if (covered.has(capability.id) || [...selected].some(id => valid.get(id)!.item.capabilities.includes(capability.id))) continue;
    const candidates = [...valid.values()].filter(entry => entry.item.capabilities.includes(capability.id) && !installed.has(entry.item.id)).sort((a, b) => risk[a.item.risk] - risk[b.item.risk] || a.item.id.localeCompare(b.item.id));
    for (const { item } of candidates) {
      const next = new Set(selected);
      if (expand(item.id, next, new Set()) && allowed(next)) { for (const id of next) selected.add(id); break; }
    }
  }
  if (!selected.size) { result.reasons = ['사용자가 입력한 기존 검증 버전의 구성 또는 기본 기능으로 시작할 수 있습니다. 실제 연결 여부는 별도 확인이 필요합니다.']; return result; }
  result.status = 'RECOMMENDED';
  result.items = [...selected].sort().map(id => {
    const { item, matrix } = valid.get(id)!;
    const required = core.has(id);
    const names = (required ? capabilities : workflows).filter(c => item.capabilities.includes(c.id)).map(c => c.name);
    return { catalogItemId: id, catalogVersion: item.version, supportMatrixId: matrix.id, required, reason: required ? (names.length ? `${names.join(', ')}에 필요한 최소 구성입니다.` : '선택한 구성의 검증된 필수 의존성입니다.') : (names.length ? `${names.join(', ')}을 돕는 선택 지침입니다. ${workflows.filter(c => item.capabilities.includes(c.id)).map(c => c.reason).join(' ')}` : '선택 지침을 함께 사용할 때 필요한 검증된 의존성입니다.'), permissionOptions: structuredClone(item.permissionOptions), authenticationRequirements: [] };
  });
  result.reasons = ['기술별 최소 구성과 공통 개발 업무를 돕는 선택 지침을 구분합니다. 공통 지침을 선택하지 않아도 진행할 수 있습니다. 자연어 Skill은 실행 권한을 제한하는 기능이 아닙니다.'];
  return result;
}
