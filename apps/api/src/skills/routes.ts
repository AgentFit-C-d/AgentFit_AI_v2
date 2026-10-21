import { Router } from 'express';
import { bodyLimit } from '../http/body-limit';
import type { SkillDiscoveryService } from './service';
export function skillDiscoveryRoutes(service: SkillDiscoveryService) {
  const router = Router({ mergeParams: true });
  router.post<{ projectId: string }>('/skill-discoveries', bodyLimit(65536), async (req, res) => { res.status(202).json({ discovery: await service.start(res.locals.user.id, req.params.projectId, req.body) }); });
  router.get<{ projectId: string }>('/skill-discoveries/latest', async (req, res) => { res.json({ discovery: await service.latest(res.locals.user.id, req.params.projectId) }); });
  router.get<{ projectId: string; discoveryId: string }>('/skill-discoveries/:discoveryId', async (req, res) => { res.json({ discovery: await service.get(res.locals.user.id, req.params.projectId, req.params.discoveryId) }); });
  return router;
}
