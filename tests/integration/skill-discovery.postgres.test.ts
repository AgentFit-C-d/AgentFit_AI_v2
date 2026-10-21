import { beforeAll, afterAll, expect, test } from 'vitest';
import { testDatabase } from '../support/postgres';
import { SkillDiscoveryService } from '../../apps/api/src/skills/service';
import { checkPackage } from '../../apps/api/src/skills/package';
import { RecommendationService } from '../../apps/api/src/recommendations/service';
import { ConfigurationService } from '../../apps/api/src/configuration/service';
import { ProfileRepository } from '../../apps/api/src/recommendations/profiles';
import { PrismaProjectRepository } from '../../apps/api/src/projects/prisma-repository';
import { emptyProfile } from '../../packages/contracts/src';
import { resolveProjectCatalog } from '../../apps/api/src/skills/catalog';
import { unzipSync, strFromU8 } from '../../apps/api/node_modules/fflate';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase(); await fixture.db.user.create({ data: { id: 'discovery-owner', name: 'Synthetic', email: 'discovery@example.invalid' } }); }, 60000);
afterAll(async () => { if (fixture) await fixture.stop(); });
const packageValue = checkPackage('synthetic/payment/payment-checks', 'a'.repeat(40), [{ path: 'SKILL.md', content: '---\nname: payment-checks\ndescription: Payment idempotency tests\n---\nTest duplicate checkout, payment authorization and refunds.\n' }, { path: 'LICENSE.txt', content: 'MIT License\nPermission is hereby granted, free of charge' }]);
async function project() {
  const row = await fixture.db.project.create({ data: { ownerId: 'discovery-owner', name: 'Synthetic' } });
  await new PrismaProjectRepository(fixture.db).saveProfile('discovery-owner', row.id, { expectedVersion: 1, profile: { ...emptyProfile(), frontend: ['React'], backend: ['Node.js'], features: ['결제 승인', '주문 취소'] } });
  const repo = new ProfileRepository(fixture.db);
  await repo.putDeveloper('discovery-owner', row.id, { expectedVersion: 0, data: { role: 'FULL_STACK', responsibilities: ['서비스 구현'], experienceLevel: null } });
  await repo.putEnvironment('discovery-owner', row.id, { expectedVersion: 0, data: { os: { family: 'WINDOWS', version: '11' }, client: { id: 'codex-desktop', version: null }, runtimes: [], installedComponents: [], configurationKnowledge: 'USER_SAYS_EMPTY', authenticationReadiness: [] } });
  return row;
}
const versions = { project: 2, developer: 1, environment: 1 };
function service(overrides = {}) {
  return new SkillDiscoveryService(fixture.db, {
    needs: async () => [{ id: 'n1', name: '결제 검증', query: 'payment testing', sourceFields: ['features:0'] }],
    rank: async (_needs, candidates) => [{ candidateId: candidates.find(x => x.name === 'payment-checks')!.id, needIds: ['n1'], score: 95, reason: '결제 승인·중복 주문 검증에 필요한 지침입니다.' }], ...overrides,
  }, { search: async () => [{ id: packageValue.id, name: packageValue.name, repository: packageValue.repository, installs: 1 }], inspect: async () => packageValue }, async () => {});
}
test.each([70, 95])('score%s outside fixed7 flows through discovery, current recommendation, approval and actual ZIP', async score => {
  const row = await project(); const discovery = service({ rank: async () => [{ candidateId: packageValue.id, needIds: ['n1'], score, reason: '결제 승인·중복 주문 검증에 필요한 지침입니다.' }] });
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions });
  expect((await discovery.start('discovery-owner', row.id, { expectedVersions: versions })).id).toBe(queued.id);
  await expect(discovery.get('foreign', row.id, queued.id)).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  await discovery.process(queued.id);
  const done = await discovery.get('discovery-owner', row.id, queued.id); expect(done.status).toBe('SUCCEEDED');
  const rec = await new RecommendationService(fixture.db, undefined, [], resolveProjectCatalog).create('discovery-owner', row.id, { expectedVersions: versions });
  const added = rec.items.find(x => x.tool?.verification === 'PACKAGE_CHECKED')!; expect(added?.matchScore).toBe(score); expect(added?.required).toBe(false); expect(added.tool?.actualUse).toBe('NOT_RUN'); expect(rec.discoveryId).toBe(queued.id);
  const configurations = new ConfigurationService(fixture.db, undefined, [], undefined, resolveProjectCatalog);
  const input = { recommendationId: rec.id, expectedBasis: rec.basis, selectedToolIds: [added.catalogItemId], permissionPolicies: [], existingState: 'USER_SAYS_EMPTY', existingFiles: [] };
  const preview = await configurations.preview('discovery-owner', row.id, input);
  expect(preview.files.map(x => x.relativePath)).toEqual(['AGENTFIT-APPLY.md', 'AGENTFIT-SOURCES.md']);
  const approval = await configurations.approve('discovery-owner', row.id, { previewId: preview.id, previewFingerprint: preview.fingerprint, confirmation: true });
  const exported = await configurations.export('discovery-owner', row.id, { previewId: preview.id, previewFingerprint: preview.fingerprint, approvalId: approval.id, input });
  expect(strFromU8(unzipSync(exported.bytes)['AGENTFIT-APPLY.md']!)).toContain('https://github.com/synthetic/payment#readme');
  await fixture.db.skillArtifact.updateMany({ data: { expiresAt: new Date(0) } });
  await expect(configurations.approve('discovery-owner', row.id, { previewId: preview.id, previewFingerprint: preview.fingerprint, confirmation: true })).rejects.toMatchObject({ code: 'CONFIGURATION_STALE' });
});
test('provider failure preserves old recommendation and confirmed profile; timeout is explicit', async () => {
  const row = await project(); const recs = new RecommendationService(fixture.db);
  const previous = await recs.create('discovery-owner', row.id, { expectedVersions: versions });
  const discovery = service({ needs: async () => { throw new Error('private provider details'); } });
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions }); await discovery.process(queued.id);
  expect((await discovery.get('discovery-owner', row.id, queued.id))).toMatchObject({ status: 'FAILED', errorCode: 'SKILL_DISCOVERY_FAILED' });
  expect((await recs.latest('discovery-owner', row.id))?.id).toBe(previous.id);
  expect((await fixture.db.project.findUniqueOrThrow({ where: { id: row.id } })).confirmedProfile).not.toBeNull();
  const next = await discovery.start('discovery-owner', row.id, { expectedVersions: versions }); await fixture.db.skillDiscovery.update({ where: { id: next.id }, data: { deadline: new Date(0) } });
  await discovery.expire(next.id); expect((await discovery.get('discovery-owner', row.id, next.id)).errorCode).toBe('SKILL_DISCOVERY_TIMEOUT');
});
test('late result after version change or deletion is never published; IO holds no project lock', async () => {
  const row = await project(); const discovery = service({ needs: async () => {
    await new ProfileRepository(fixture.db).putDeveloper('discovery-owner', row.id, { expectedVersion: 1, data: { role: 'AI', responsibilities: [], experienceLevel: null } });
    return [{ id: 'n1', name: '결제', query: 'payment testing', sourceFields: ['features:0'] }];
  } });
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions }); await discovery.process(queued.id);
  expect((await discovery.get('discovery-owner', row.id, queued.id)).status).toBe('STALE');
  await fixture.db.project.delete({ where: { id: row.id } }); await discovery.process(queued.id);
  expect(await fixture.db.skillDiscovery.count({ where: { projectId: row.id } })).toBe(0);
});

test.each([[69, false], [74, true], [75, true]] as const)('score%s is selectable=%s at the optional/recommended boundary', async (score, visible) => {
  const row = await project();
  const discovery = service({ rank: async () => [{ candidateId: packageValue.id, needIds: ['n1'], score, reason: '결제 검증 지침' }] });
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions }); await discovery.process(queued.id);
  expect((await discovery.get('discovery-owner', row.id, queued.id)).status).toBe('SUCCEEDED');
  const rec = await new RecommendationService(fixture.db, undefined, [], resolveProjectCatalog).create('discovery-owner', row.id, { expectedVersions: versions });
  const added = rec.items.find(x => x.tool?.artifactHash === packageValue.hash);
  expect(!!added).toBe(visible);
  if (visible) expect(added).toMatchObject({ matchScore: score, required: false });
});

test('a70-point choice remains selectable when a95-point candidate covers the same need', async () => {
  const alternative = checkPackage('synthetic/alternative/payment-alternative', 'b'.repeat(40), [{ path: 'SKILL.md', content: '---\nname: payment-alternative\ndescription: Payment edge case checks\n---\nReview payment edge cases.\n' }, { path: 'LICENSE.txt', content: 'MIT License\nPermission is hereby granted, free of charge' }]);
  const row = await project();
  const discovery = new SkillDiscoveryService(fixture.db, {
    needs: async () => [{ id: 'n1', name: '결제 검증', query: 'payment testing', sourceFields: ['features:0'] }],
    rank: async () => [{ candidateId: packageValue.id, needIds: ['n1'], score: 95, reason: '결제 검증에 직접 활용' }, { candidateId: alternative.id, needIds: ['n1'], score: 70, reason: '결제 예외 처리 보조' }],
  }, { search: async () => [packageValue, alternative].map(p => ({ id: p.id, name: p.name, repository: p.repository, installs: 1 })), inspect: async c => c.id === packageValue.id ? packageValue : alternative }, async () => {});
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions }); await discovery.process(queued.id);
  const rec = await new RecommendationService(fixture.db, undefined, [], resolveProjectCatalog).create('discovery-owner', row.id, { expectedVersions: versions });
  expect(rec.items.find(x => x.tool?.artifactHash === packageValue.hash)).toMatchObject({ matchScore: 95 });
  expect(rec.items.find(x => x.tool?.artifactHash === alternative.hash)).toMatchObject({ matchScore: 70, required: false });
});

test('a lower optional AI match does not downgrade a required rule-based core item', async () => {
  const row = await project();
  const discovery = service({ rank: async (_needs: unknown, candidates: { id: string; name: string }[]) => [{ candidateId: candidates.find(c => c.name === 'vercel-react-best-practices')!.id, needIds: ['n1'], score: 70, reason: '부분적 적합성' }] });
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions }); await discovery.process(queued.id);
  const rec = await new RecommendationService(fixture.db, undefined, [], resolveProjectCatalog).create('discovery-owner', row.id, { expectedVersions: versions });
  const core = rec.items.find(x => x.required);
  expect(core).toBeDefined(); expect(core?.matchScore).toBeUndefined(); expect(core?.reason).not.toContain('부분적 적합성');
});
test('does not search with private model terms or accept fabricated recommendation IDs', async () => {
  const row = await project(); let searches = 0;
  const discovery = new SkillDiscoveryService(fixture.db, { needs: async () => [{ id: 'n1', name: '결제', query: 'privatecompany payment', sourceFields: ['features:0'] }], rank: async () => [] }, { search: async () => { searches++; return []; }, inspect: async () => packageValue }, async () => {});
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions }); await discovery.process(queued.id);
  expect(searches).toBe(0); expect((await discovery.get('discovery-owner', row.id, queued.id)).status).toBe('FAILED');
  const fabricated = service({ rank: async () => [{ candidateId: 'invented/skills/fake', needIds: ['n1'], score: 100, reason: 'fabricated' }] });
  const second = await fabricated.start('discovery-owner', row.id, { expectedVersions: versions }); await fabricated.process(second.id);
  expect((await fabricated.get('discovery-owner', row.id, second.id)).status).toBe('FAILED');
});
test('duplicate worker delivery performs one model call; interrupted worker expires without replacing existing result', async () => {
  const row = await project(); let calls = 0;
  const discovery = service({ needs: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 100)); return []; } });
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions });
  await Promise.all([discovery.process(queued.id), discovery.process(queued.id)]); expect(calls).toBe(1);
  expect((await discovery.get('discovery-owner', row.id, queued.id)).status).toBe('SUCCEEDED');
});
test('a fresh full package inspection renews an expired identical artifact without changing its pinned files', async () => {
  const row = await project(); const discovery = service();
  await fixture.db.skillArtifact.updateMany({ where: { id: packageValue.hash }, data: { expiresAt: new Date(0) } });
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions }); await discovery.process(queued.id);
  const rec = await new RecommendationService(fixture.db, undefined, [], resolveProjectCatalog).create('discovery-owner', row.id, { expectedVersions: versions });
  expect(rec.items.some(x => x.tool?.artifactHash === packageValue.hash)).toBe(true);
});

test.each(['SKILL_SOURCE_RATE_LIMITED', 'SKILL_SOURCE_AUTH_FAILED'])('stops common source failure %s without replacing old recommendation', async code => {
  const row = await project();
  const previous = await new RecommendationService(fixture.db).create('discovery-owner', row.id, { expectedVersions: versions });
  let inspections = 0; let rankings = 0;
  const discovery = new SkillDiscoveryService(fixture.db, {
    needs: async () => [{ id: 'n1', name: '결제 검증', query: 'payment testing', sourceFields: ['features:0'] }],
    rank: async () => { rankings++; return []; },
  }, {
    search: async () => ['first-checks', 'second-checks'].map(name => ({ id: `synthetic/payment/${name}`, name, repository: 'synthetic/payment', installs: 1 })),
    inspect: async () => { inspections++; throw new Error(code); },
  }, async () => {});
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions });
  await discovery.process(queued.id);
  expect(await discovery.get('discovery-owner', row.id, queued.id)).toMatchObject({ status: 'FAILED', errorCode: code, checks: [{ code, status: 'BLOCKED' }] });
  expect(inspections).toBe(1); expect(rankings).toBe(0);
  expect((await new RecommendationService(fixture.db).latest('discovery-owner', row.id))?.id).toBe(previous.id);
});

test('keeps already checked packages if quota runs out and stops remaining source requests', async () => {
  const row = await project(); let inspections = 0; let rankings = 0;
  const discovery = new SkillDiscoveryService(fixture.db, {
    needs: async () => [{ id: 'n1', name: '결제 검증', query: 'payment testing', sourceFields: ['features:0'] }],
    rank: async () => { rankings++; return [{ candidateId: packageValue.id, needIds: ['n1'], score: 95, reason: '검사한 결제 지침' }]; },
  }, {
    search: async () => [packageValue.name, 'zzz-first', 'zzz-second'].map(name => ({ id: `synthetic/payment/${name}`, name, repository: 'synthetic/payment', installs: 1 })),
    inspect: async candidate => { inspections++; if (candidate.id === packageValue.id) return packageValue; throw new Error('SKILL_SOURCE_RATE_LIMITED'); },
  }, async () => {});
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions }); await discovery.process(queued.id);
  const done = await discovery.get('discovery-owner', row.id, queued.id);
  expect(done).toMatchObject({ status: 'SUCCEEDED', checks: [{ status: 'PASS' }, { code: 'SKILL_SOURCE_RATE_LIMITED', status: 'BLOCKED' }] });
  expect(inspections).toBe(2); expect(rankings).toBe(1);
  const recommendation = await new RecommendationService(fixture.db, undefined, [], resolveProjectCatalog).create('discovery-owner', row.id, { expectedVersions: versions });
  expect(recommendation.items.some(item => item.tool?.artifactHash === packageValue.hash)).toBe(true);
});

test.each(['SKILL_AI_INVALID_RESPONSE', 'SKILL_AI_AUTH_FAILED', 'SKILL_AI_RATE_LIMITED'])('preserves safe provider category %s while leaving recommendation unchanged', async code => {
  const row = await project();
  const previous = await new RecommendationService(fixture.db).create('discovery-owner', row.id, { expectedVersions: versions });
  const discovery = service({ needs: async () => { throw new Error(code); } });
  const queued = await discovery.start('discovery-owner', row.id, { expectedVersions: versions });
  await discovery.process(queued.id);
  expect((await discovery.get('discovery-owner', row.id, queued.id)).errorCode).toBe(code);
  expect((await new RecommendationService(fixture.db).latest('discovery-owner', row.id))?.id).toBe(previous.id);
});
