import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '../support/postgres';
import { SolarBudgetService } from '../../apps/api/src/analysis/solar-budget';
import { BudgetService } from '../../apps/api/src/analysis/budget';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase(); }, 60000);
afterAll(async () => { if (fixture) await fixture.stop(); });
async function job() {
  const id = randomUUID(); await fixture.db.user.create({ data: { id, name: 'Solar budget', email: `${id}@example.invalid` } });
  const project = await fixture.db.project.create({ data: { ownerId: id, name: 'Solar budget' } });
  const discovery = await fixture.db.skillDiscovery.create({ data: { projectId: project.id, status: 'SEARCHING', leaseId: id, basis: {}, result: {}, deadline: new Date(Date.now() + 60000) } });
  return { scope: 'discovery' as const, targetId: discovery.id, leaseId: id, operation: 'needs' as const, inputBytes: 1000, outputTokens: 1000 };
}
test('reserves Solar conservatively and idempotently against the existing shared cap', async () => {
  const body = await job(); const service = new SolarBudgetService(fixture.db, 20000000);
  const grant = await service.reserve(body);
  expect(grant.amountMicroUsd).toBe(1988); // ceil(((1000+1024)*0.30 + 1000*1.20)*1.1)
  expect(await service.reserve(body)).toEqual(grant);
  await expect(service.reserve({ ...body, inputBytes: 2000 })).rejects.toMatchObject({ code: 'BUDGET_RESERVATION_MISMATCH' });
  await expect(service.reserve({ ...body, leaseId: 'forged' })).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_LEASE' });
  await fixture.db.skillDiscovery.update({ where: { id: body.targetId }, data: { deadline: new Date(0) } });
  await expect(service.reserve(body)).rejects.toMatchObject({ code: 'INVALID_ANALYSIS_LEASE' });
});
test('Solar and Information Extract reservations serialize under the same $20 counter', async () => {
  const body = await job();
  await fixture.db.budgetCounter.upsert({ where: { id: 'development-upstage' }, create: { id: 'development-upstage', spentMicroUsd: 19997500 }, update: { spentMicroUsd: 19997500 } });
  const other = await job();
  const project = await fixture.db.skillDiscovery.findUniqueOrThrow({ where: { id: other.targetId } });
  const upload = await fixture.db.upload.create({ data: { id: randomUUID(), ownerId: other.leaseId, projectId: project.projectId, objectKey: `inputs/${randomUUID()}`, storage: 'local', kind: 'text', size: 5, contentType: 'text/plain', state: 'CLAIMED', expiresAt: new Date(Date.now() + 60000) } });
  const attempt = await fixture.db.analysisAttempt.create({ data: { projectId: project.projectId, ownerId: other.leaseId, uploadId: upload.id, provider: 'upstage', status: 'PROCESSING', leaseId: other.leaseId, deadline: new Date(Date.now() + 60000) } });
  const results = await Promise.allSettled([new SolarBudgetService(fixture.db, 20000000).reserve(body), new BudgetService(fixture.db, 20000000, 2000).reserveBudget(attempt.id, other.leaseId, 1)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'BUDGET_EXCEEDED' } });
  expect((await fixture.db.budgetCounter.findUniqueOrThrow({ where: { id: 'development-upstage' } })).spentMicroUsd).toBeLessThanOrEqual(20000000);
});
