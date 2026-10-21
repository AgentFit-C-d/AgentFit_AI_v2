import { Router } from 'express';
import { bodyLimit } from '../http/body-limit';
import type { ConfigurationService } from './service';
export function configurationRoutes(service: ConfigurationService) {
  const router = Router({ mergeParams: true });
  router.post<{ projectId: string }>('/config-previews', bodyLimit(1048576), async (req, res) => { res.status(201).json({ preview: await service.preview(res.locals.user.id, req.params.projectId, req.body) }); });
  router.post<{ projectId: string }>('/config-approvals', bodyLimit(65536), async (req, res) => { res.status(201).json({ approval: await service.approve(res.locals.user.id, req.params.projectId, req.body) }); });
  router.post<{ projectId: string }>('/config-exports', bodyLimit(1048576), async (req, res) => {
    const result = await service.export(res.locals.user.id, req.params.projectId, req.body);
    res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename="agentfit-config.zip"'); res.setHeader('X-Configuration-Id', result.configurationId); res.send(Buffer.from(result.bytes));
  });
  router.get<{ projectId: string }>('/configuration-history', async (req, res) => { res.json(await service.history(res.locals.user.id, req.params.projectId, req.query)); });
  router.post<{ projectId: string; configurationId: string }>('/configuration-history/:configurationId/reports', bodyLimit(65536), async (req, res) => { res.status(201).json({ report: await service.report(res.locals.user.id, req.params.projectId, req.params.configurationId, req.body) }); });
  return router;
}
