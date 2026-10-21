import { Router } from 'express';
import type { AnalysisService } from './service';
import { AppError } from '../http/errors';
export function analysisRoutes(service: AnalysisService) {
  const router = Router({ mergeParams: true });
  router.post<{ projectId: string }>('/analysis', async (req, res) => {
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('input' in body) || !('provider' in body) || Object.keys(body).some(k => !['input', 'provider'].includes(k)) || (body.provider !== 'upstage' && body.provider !== 'solar')) throw new AppError('INVALID_INPUT');
    res.status(202).json(await service.startAnalysis(res.locals.user.id, req.params.projectId as string, body.input, body.provider));
  });
  router.get<{ projectId: string; attemptId: string }>('/analysis/:attemptId', async (req, res) => { res.json(await service.getAttempt(res.locals.user.id, req.params.projectId, req.params.attemptId)); });
  router.post<{ projectId: string; attemptId: string }>('/analysis/:attemptId/cancel', async (req, res) => { res.json(await service.cancelAttempt(res.locals.user.id, req.params.projectId, req.params.attemptId)); });
  return router;
}
