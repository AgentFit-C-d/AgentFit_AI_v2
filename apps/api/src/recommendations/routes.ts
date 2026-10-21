import { Router } from 'express';
import type { RecommendationService } from './service';
import { bodyLimit } from '../http/body-limit';
export function recommendationRoutes(service: RecommendationService) {
  const router = Router({ mergeParams: true });
  router.post<{ projectId: string }>('/recommendations', bodyLimit(64 * 1024), async (req, res) => { res.status(201).json({ recommendation: await service.create(res.locals.user.id, req.params.projectId, req.body) }); });
  router.get<{ projectId: string }>('/recommendations/latest', async (req, res) => { res.json({ recommendation: await service.latest(res.locals.user.id, req.params.projectId) }); });
  return router;
}
