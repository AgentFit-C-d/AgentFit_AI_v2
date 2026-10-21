import { expect, test } from 'vitest';
import { compatible, type CatalogItem, type SupportMatrix } from '../../apps/api/src/recommendations/catalog';
import type { EnvironmentProfile } from '../../packages/contracts/src';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app';
import { MemoryProjectRepository } from '../support/projects';
import { checkPackage } from '../../apps/api/src/skills/package';
const environment: EnvironmentProfile = { os: { family: 'WINDOWS', version: '11' }, client: { id: 'codex-desktop', version: '26.930.4958.0' }, runtimes: null, installedComponents: [], configurationKnowledge: 'USER_SAYS_EMPTY', authenticationReadiness: null };
const matrix: SupportMatrix = { id: 'checked', osFamily: 'WINDOWS', osVersion: '11', clientId: 'codex-desktop', clientVersion: '26.930.4958.0', engineVersion: '0.160.0', checkedAt: '2026-10-06T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', checks: { documentation: 'PASS', format: 'PASS', standalone: 'PASS', combination: 'PASS' }, permissionMappingVerified: true, allowedCombinationIds: [] };
export const catalogItem: CatalogItem = { id: 'react-guidance', name: 'React guidance', kind: 'SKILL', version: 'pinned', capabilities: ['framework-guidance'], components: [], dependencies: [], conflicts: [], risk: 'LOW', verificationStatus: 'VERIFIED', license: 'MIT', skillsUrl: 'https://www.skills.sh/vendor/repo/skill', repository: 'vendor/repo', commit: '123', snapshotSha256: 'a'.repeat(64), supportMatrix: [matrix], permissionOptions: [] };
test('keeps the inspected OS and client identity checks for Skills', () => {
  expect(compatible(catalogItem, environment, new Date('2026-10-06'))?.id).toBe('checked');
  expect(compatible(catalogItem, { ...environment, client: { id: 'other-client', version: null } })).toBeNull();
  expect(compatible(catalogItem, { ...environment, os: { family: 'MACOS', version: '11' } })).toBeNull();
  expect(compatible(catalogItem, { ...environment, os: { family: 'WINDOWS', version: null } })).toBeNull();
});

test.each([null, '26.930.41038'])('recommends an instruction-only Skill when app version is %s', version => {
  expect(compatible(catalogItem, { ...environment, client: { id: 'codex-desktop', version } }, new Date('2026-10-06'))?.id).toBe('checked');
});

test.each(['MCP', 'HOOK', 'PLUGIN', 'RULES'] as const)('does not relax the version check for %s', kind => {
  const item = { ...catalogItem, kind };
  expect(compatible(item, environment, new Date('2026-10-06'))?.id).toBe('checked');
  for (const version of [null, '26.930.41038']) expect(compatible(item, { ...environment, client: { id: 'codex-desktop', version } }, new Date('2026-10-06'))).toBeNull();
});

test('keeps version-dependent permission mappings strict even for a Skill', () => {
  const item = { ...catalogItem, permissionOptions: [{ key: 'write', resourceScope: 'project', supportedPolicies: ['ASK_EACH_TIME' as const], defaultPolicy: 'ASK_EACH_TIME' as const, mapping: 'checked-write' }] };
  expect(compatible(item, { ...environment, client: { id: 'codex-desktop', version: null } }, new Date('2026-10-06'))).toBeNull();
});
test.each(['documentation', 'format', 'standalone', 'combination'] as const)('excludes %s checks that were not performed', check => {
  const item = { ...catalogItem, supportMatrix: [{ ...matrix, checks: { ...matrix.checks, [check]: 'NOT_RUN' as const } }] };
  expect(compatible(item, environment, new Date('2026-10-06'))).toBeNull();
});
test('excludes expired, unverified and unverified permission mappings', () => {
  expect(compatible(catalogItem, environment, new Date('2027-01-02'))).toBeNull();
  expect(compatible({ ...catalogItem, verificationStatus: 'NOT_VERIFIED' }, environment, new Date('2026-10-06'))).toBeNull();
  expect(compatible({ ...catalogItem, supportMatrix: [{ ...matrix, permissionMappingVerified: false }] }, environment, new Date('2026-10-06'))).toBeNull();
});
test('serves a public snapshot and rejects unknown, repeated or object query filters', async () => {
  const app = createApp({ webOrigin: 'http://localhost:3000', projects: new MemoryProjectRepository(), session: async () => null });
  const response = await request(app).get('/api/tool-catalog?clientId=codex-desktop&osFamily=WINDOWS&capabilityId=framework-guidance');
  expect(response.status).toBe(200);
  expect(response.body.items.some((x: { name: string }) => x.name === 'vercel-react-best-practices')).toBe(true);
  for (const query of ['unknown=x', 'clientId=x', 'osFamily=x', 'capabilityId=x', 'clientId=codex-desktop&clientId=codex-desktop', 'clientId[]=codex-desktop']) expect((await request(app).get(`/api/tool-catalog?${query}`)).status).toBe(422);
  expect(response.body).not.toHaveProperty('files');
});

test.each(['Linux-only', 'Only supported on Linux', 'Claude Code only', 'Only compatible with Claude Code'])('excludes an explicitly incompatible package: %s', restriction => {
  const pkg = checkPackage('org/repo/testing', 'a'.repeat(40), [{ path: 'SKILL.md', content: '---\nname: testing\ndescription: Testing\n---\n[Environment](references/environment.md)' }, { path: 'references/environment.md', content: restriction }, { path: 'LICENSE.txt', content: 'MIT License' }], new Date('2026-10-06'));
  expect(compatible({ ...catalogItem, verificationStatus: 'PACKAGE_CHECKED', package: pkg }, environment, new Date('2026-10-07'))).toBeNull();
});

test('keeps neutral and matching explicit package restrictions eligible', () => {
  for (const restriction of ['Use Linux, Windows or macOS.', 'Windows-only. Codex only.', 'Only supported on Windows. Only compatible with Codex.']) {
    const pkg = checkPackage('org/repo/testing', 'a'.repeat(40), [{ path: 'SKILL.md', content: `---\nname: testing\ndescription: Testing\n---\n${restriction}` }, { path: 'LICENSE.txt', content: 'MIT License' }], new Date('2026-10-06'));
    expect(compatible({ ...catalogItem, verificationStatus: 'PACKAGE_CHECKED', package: pkg }, environment, new Date('2026-10-07'))?.checks.standalone).toBe('NOT_RUN');
  }
});
