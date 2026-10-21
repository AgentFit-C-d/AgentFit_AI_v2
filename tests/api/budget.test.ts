import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from '../support/postgres';
import { BudgetService } from '../../apps/api/src/analysis/budget';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase(); }, 60_000);
afterAll(async () => { if (fixture) await fixture.stop(); });
async function paidAttempt() {
  const db = fixture.db; const id = randomUUID();
  const user = await db.user.create({ data: { id, name: 'Budget test', email: `${id}@example.invalid` } });
  const project = await db.project.create({ data: { ownerId: user.id, name: 'Budget test' } });
  const upload = await db.upload.create({ data: { id, ownerId: id, projectId: project.id, objectKey: `inputs/${id}`, storage: 'local', kind: 'text', size: 5, contentType: 'text/plain', state: 'CLAIMED', expiresAt: new Date(Date.now() + 540_000) } });
  return db.analysisAttempt.create({ data: { projectId: project.id, ownerId: id, uploadId: upload.id, provider: 'upstage', status: 'PROCESSING', leaseId: id, deadline: new Date(Date.now() + 60_000) } });
}
test('reserves conservative cost before paid call and never refunds uncertain spend', async () => {
  const record = await paidAttempt(); const service = new BudgetService(fixture.db, 20_000_000, 44_000);
  const grant = await service.reserveBudget(record.id, record.leaseId!, 100);
  expect(grant.amountMicroUsd).toBe(4_400_000);
  expect(await service.reserveBudget(record.id, record.leaseId!, 100)).toEqual(grant);
  await expect(service.reserveBudget(record.id, record.leaseId!, 101)).rejects.toThrow();
  await expect(service.reserveBudget(record.id, 'forged-lease', 100)).rejects.toThrow();
  await fixture.db.analysisAttempt.delete({ where: { id: record.id } });
  expect((await fixture.db.budgetCounter.findUnique({ where: { id: 'development-upstage' } }))?.spentMicroUsd).toBe(4_400_000);
});
test('parallel reservations cannot exceed $20 and unknown price denies paid calls', async () => {
  await fixture.db.budgetCounter.upsert({ where: { id: 'development-upstage' }, create: { id: 'development-upstage', spentMicroUsd: 18_000_000 }, update: { spentMicroUsd: 18_000_000 } });
  const a = await paidAttempt(), b = await paidAttempt(); const service = new BudgetService(fixture.db, 20_000_000, 44_000);
  const outcomes = await Promise.allSettled([service.reserveBudget(a.id, a.leaseId!, 30), service.reserveBudget(b.id, b.leaseId!, 30)]);
  expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'BUDGET_EXCEEDED' } });
  expect((await fixture.db.budgetCounter.findUnique({ where: { id: 'development-upstage' } }))?.spentMicroUsd).toBe(19_320_000);
  await expect(new BudgetService(fixture.db, 20_000_000, null).reserveBudget(b.id, b.leaseId!, 1)).rejects.toThrow('PRICE_NOT_CONFIRMED');
});
