import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import type { TemporaryInputStore } from '../storage/ports';
import type { BudgetService } from './budget';
import { AppError } from '../http/errors';
import { timingSafeEqual } from 'node:crypto';
import { validateInternal } from '@agentfit/contracts';
import { uploadRecord } from '../storage/prisma-uploads';
import type { SolarBudgetService } from './solar-budget';
export interface InternalDependencies { db: PrismaClient; token: string; inputs: TemporaryInputStore; budget: BudgetService; solarBudget?: SolarBudgetService; now?: () => number }
export function internalRoutes(deps: InternalDependencies) {
  const router = Router(); const now = deps.now ?? Date.now;
  router.use((req, _res, next) => {
    const actual = Buffer.from(req.get('Authorization') ?? ''); const expected = Buffer.from(`Bearer ${deps.token}`);
    if (deps.token.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError('INTERNAL_AUTH_REQUIRED', 403);
    next();
  });
  async function input(uploadId: string, attemptId: unknown, leaseId: unknown) {
    if (typeof attemptId !== 'string' || typeof leaseId !== 'string' || attemptId.length > 100 || leaseId.length > 100) throw new AppError('INVALID_ANALYSIS_LEASE', 403);
    const attempt = await deps.db.analysisAttempt.findFirst({ where: { id: attemptId, leaseId, uploadId, status: 'PROCESSING', deadline: { gt: new Date(now()) } }, include: { upload: true } });
    if (!attempt || attempt.upload.state !== 'CLAIMED' || attempt.upload.expiresAt.getTime() <= now()) throw new AppError('INVALID_ANALYSIS_LEASE', 403);
    return uploadRecord(attempt.upload);
  }
  router.get('/inputs/:uploadId/metadata', async (req, res) => {
    const value = await input(req.params.uploadId, req.query.attemptId, req.query.leaseId);
    res.json({ inputRef: value.ref, metadata: value.metadata });
  });
  router.get('/inputs/:uploadId', async (req, res) => {
    const value = await input(req.params.uploadId, req.query.attemptId, req.query.leaseId);
    if (value.ref.storage !== 'local') throw new AppError('LOCAL_INPUT_ENDPOINT_ONLY', 400);
    const bytes = await deps.inputs.read(value.ref);
    res.setHeader('Content-Type', 'application/octet-stream'); res.send(Buffer.from(bytes)); bytes.fill(0);
  });
  router.post('/budget/reserve', async (req, res) => {
    const body = validateInternal<{ attemptId: string; leaseId: string; pages: number }>('budgetRequest', req.body);
    res.json(await deps.budget.reserveBudget(body.attemptId, body.leaseId, body.pages));
  });
  router.post('/budget/solar', async (req, res) => {
    if (!deps.solarBudget) throw new AppError('BUDGET_EXCEEDED', 503);
    res.json(await deps.solarBudget.reserve(req.body));
  });
  return router;
}
