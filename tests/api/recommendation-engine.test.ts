import { expect, test } from 'vitest';
import { emptyProfile, type DeveloperProfile, type EnvironmentProfile } from '../../packages/contracts/src';
import { deriveCapabilities, deriveWorkflowCapabilities } from '../../apps/api/src/recommendations/capabilities';
import { recommend } from '../../apps/api/src/recommendations/engine';
import type { CatalogItem } from '../../apps/api/src/recommendations/catalog';
const environment: EnvironmentProfile = { os: { family: 'WINDOWS', version: '11' }, client: { id: 'codex-desktop', version: '26.930.4958.0' }, runtimes: [], installedComponents: [], configurationKnowledge: 'USER_SAYS_EMPTY', authenticationReadiness: [] };
const developer: DeveloperProfile = { role: 'FRONTEND', responsibilities: ['화면 구현'], experienceLevel: null };
const profile = { ...emptyProfile(), frontend: ['Next.js', 'React'], backend: [] };
const matrix = { id: 'matrix', osFamily: 'WINDOWS', osVersion: '11', clientId: 'codex-desktop', clientVersion: '26.930.4958.0', engineVersion: '0.160.0', checks: { documentation: 'PASS', format: 'PASS', standalone: 'PASS', combination: 'PASS' }, checkedAt: '2026-10-01', expiresAt: '2027-01-01', permissionMappingVerified: true, allowedCombinationIds: [] } as const;
const item: CatalogItem = { id: 'react', name: 'React', kind: 'SKILL', version: 'pin1', capabilities: ['framework-guidance', 'frontend-review'], components: [], dependencies: [], conflicts: [], risk: 'LOW', verificationStatus: 'VERIFIED', license: 'MIT', skillsUrl: 'https://www.skills.sh/example/repo/react', repository: 'example/repo', commit: 'pin1', snapshotSha256: 'a'.repeat(64), supportMatrix: [{ ...matrix, allowedCombinationIds: ['dependency', 'database'] }], permissionOptions: [] };
const now = new Date('2026-10-06');
test('derives needs from confirmed fields and ties reasons to their fields', () => {
  expect(deriveCapabilities(profile, developer).map(x => x.id)).toEqual(['framework-guidance', 'frontend-review']);
  expect(deriveCapabilities(profile, developer)[0]?.sourceFields).toContain('project.frontend');
});
test('returns minimum verified configuration without requiring an app build match for Skills', () => {
  const result = recommend({ profile, developer, environment }, { revision: 'one', items: [item, { ...item, id: 'duplicate', risk: 'HIGH' }] }, now);
  expect(result.status).toBe('RECOMMENDED');
  expect(result.items.map(x => x.catalogItemId)).toEqual(['react']);
  expect(recommend({ profile, developer, environment: { ...environment, client: { id: 'codex-desktop', version: 'different' } } }, { revision: 'one', items: [item] }, now).status).toBe('RECOMMENDED');
});

test('known Codex client with no app version gets Skill recommendations without a version question', () => {
  const result = recommend({ profile, developer, environment: { ...environment, client: { id: 'codex-desktop', version: null } } }, { revision: 'one', items: [item] }, now);
  expect(result.status).toBe('RECOMMENDED'); expect(result.questions).toEqual([]); expect(result.items.map(x => x.catalogItemId)).toEqual(['react']);
});

test('unsupported environment explains entered and verified revisions without asking for more information', () => {
  const result = recommend({ profile, developer, environment: { ...environment, os: { family: 'WINDOWS', version: '10' }, client: { id: 'codex-desktop', version: '26.999.1.0' } } }, { revision: 'one', items: [item] }, now);
  expect(result.status).toBe('NO_COMPATIBLE_TOOLS'); expect(result.questions).toEqual([]); expect(result.items).toEqual([]);
  const explanation = result.reasons.join('\n'); expect(explanation).toContain('Windows 10'); expect(explanation).toContain('Windows 11'); expect(explanation).toContain('OS·개발 도구');
});

test('matched environment with missing dependency explains a configuration limitation rather than a version mismatch', () => {
  const result = recommend({ profile, developer, environment }, { revision: 'one', items: [{ ...item, dependencies: ['missing'] }] }, now);
  expect(result.status).toBe('NO_COMPATIBLE_TOOLS'); expect(result.items).toEqual([]); expect(result.reasons.join('\n')).toContain('의존성'); expect(result.reasons.join('\n')).not.toContain('버전이 일치하지');
});
test('asks only missing environment information and accepts unknown experience', () => {
  const result = recommend({ profile, developer, environment: null }, { revision: 'one', items: [item] }, now);
  expect(result.status).toBe('NEEDS_INFORMATION');
  expect(result.questions.some(x => x.field === 'environment.client')).toBe(true);
  expect(result.items).toEqual([]);
});
test('Codex basic tasks need no addition and installed exact revisions prevent duplicate recommendations', () => {
  expect(recommend({ profile: { ...emptyProfile(), frontend: [], backend: ['Node.js'] }, developer: null, environment: null }, { revision: 'one', items: [item] }, now).status).toBe('NO_ADDITIONS_NEEDED');
  const installed = { ...environment, installedComponents: [{ catalogItemId: 'react', name: 'React', version: 'pin1' }] };
  expect(recommend({ profile, developer, environment: installed }, { revision: 'one', items: [item] }, now).status).toBe('NO_ADDITIONS_NEEDED');
});
test('does not double count a verified plugin containing an installed Skill', () => {
  const plugin: CatalogItem = { ...item, id: 'pack', kind: 'PLUGIN', components: ['react'] };
  const installed = { ...environment, installedComponents: [{ catalogItemId: 'pack', name: 'Pack', version: 'pin1' }] };
  expect(recommend({ profile, developer, environment: installed }, { revision: 'one', items: [item, plugin] }, now).items).toEqual([]);
});
test('excludes unverified dependencies and incompatible combinations, includes verified dependency once', () => {
  const needsDependency = { ...item, dependencies: ['dependency'] };
  const dependency: CatalogItem = { ...item, id: 'dependency', capabilities: [], supportMatrix: [{ ...matrix, allowedCombinationIds: ['react'] }] };
  expect(recommend({ profile, developer, environment }, { revision: 'one', items: [needsDependency] }, now).status).toBe('NO_COMPATIBLE_TOOLS');
  const result = recommend({ profile, developer, environment }, { revision: 'one', items: [needsDependency, dependency] }, now);
  expect(result.items.map(x => x.catalogItemId)).toEqual(['dependency', 'react']);
  expect(recommend({ profile, developer, environment }, { revision: 'one', items: [needsDependency, { ...dependency, conflicts: ['react'] }] }, now).status).toBe('NO_COMPATIBLE_TOOLS');
});

const workflow = (id: string, capability: string): CatalogItem => ({ ...item, id, capabilities: [capability], supportMatrix: [{ ...matrix, allowedCombinationIds: ['react', 'debug', 'verify', 'tdd'].filter(other => other !== id) }] });
const workflowCatalog = { revision: 'workflow', items: [{ ...item, supportMatrix: [{ ...matrix, allowedCombinationIds: ['debug', 'verify', 'tdd'] }] }, workflow('debug', 'systematic-debugging'), workflow('verify', 'completion-verification'), workflow('tdd', 'test-guidance')] };

test('offers common development Skills alongside React guidance without making them mandatory', () => {
  const result = recommend({ profile, developer, environment }, workflowCatalog, now);
  expect(result.status).toBe('RECOMMENDED');
  expect(result.items.filter(x => x.required).map(x => x.catalogItemId)).toEqual(['react']);
  expect(result.items.filter(x => !x.required).map(x => x.catalogItemId).sort()).toEqual(['debug', 'tdd', 'verify']);
  expect(result.capabilities.find(x => x.id === 'completion-verification')?.sourceFields).toContain('developer.role');
});

test('implementation work offers planning and TDD without requiring a testing responsibility', () => {
  const capabilities = deriveWorkflowCapabilities({ ...emptyProfile(), ai: ['Solar Pro 4', 'Upstage Embed 2'] }, { role: 'AI', responsibilities: ['RAG 구현'], experienceLevel: null });
  expect(capabilities.map(capability => capability.id)).toContain('test-guidance');
  expect(capabilities.map(capability => capability.id)).toContain('implementation-planning');
  expect(capabilities.find(capability => capability.id === 'test-guidance')?.sourceFields).toContain('project.ai');
});

test('offers common workflow Skills for a non-React implementation and adds TDD for testing work', () => {
  const other = { ...emptyProfile(), backend: ['FastAPI'], features: ['계정 관리'] };
  const result = recommend({ profile: other, developer: { role: 'BACKEND', responsibilities: ['API 구현', '테스트'], experienceLevel: null }, environment }, workflowCatalog, now);
  expect(result.status).toBe('RECOMMENDED'); expect(result.items.map(x => x.catalogItemId).sort()).toEqual(['debug', 'tdd', 'verify']);
  expect(result.items.every(x => !x.required)).toBe(true);
});

test('optional workflow candidates do not block the core recommendation when unverified or incompatible', () => {
  const broken = { ...workflowCatalog, items: [workflowCatalog.items[0]!, { ...workflow('debug', 'systematic-debugging'), verificationStatus: 'NOT_VERIFIED' as const }, { ...workflow('verify', 'completion-verification'), supportMatrix: [{ ...matrix, allowedCombinationIds: [] }] }] };
  const result = recommend({ profile, developer, environment }, broken, now);
  expect(result.status).toBe('RECOMMENDED'); expect(result.items.map(x => x.catalogItemId)).toEqual(['react']);
});

test('installed pinned workflow Skills are not offered again and unrelated document work gets no extras', () => {
  const installed = { ...environment, installedComponents: [{ catalogItemId: 'debug', name: 'Debug', version: 'pin1' }] };
  const result = recommend({ profile: { ...emptyProfile(), backend: ['FastAPI'] }, developer: null, environment: installed }, workflowCatalog, now);
  expect(result.items.map(x => x.catalogItemId)).toEqual(['tdd', 'verify']);
  expect(recommend({ profile: emptyProfile(), developer: { role: null, responsibilities: ['문서 번역'], experienceLevel: null }, environment }, workflowCatalog, now).items).toEqual([]);
});
