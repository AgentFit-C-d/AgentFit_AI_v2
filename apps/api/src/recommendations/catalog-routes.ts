import { Router } from 'express';
import { loadCatalog } from './catalog';
import { AppError } from '../http/errors';
export function catalogRoutes() {
  const router = Router();
  router.get('/tool-catalog', (req, res) => {
    const allowed: Record<string, readonly string[]> = { clientId: ['codex-desktop'], osFamily: ['WINDOWS', 'MACOS', 'LINUX', 'OTHER'], capabilityId: ['framework-guidance', 'frontend-review', 'component-architecture', 'database-access', 'test-guidance', 'documentation-reference', 'completion-verification', 'systematic-debugging', 'implementation-planning'] };
    for (const [key, value] of Object.entries(req.query)) if (typeof value !== 'string' || !allowed[key]?.includes(value)) throw new AppError('INVALID_INPUT', 422);
    const catalog = loadCatalog();
    const items = catalog.items.filter(item => (!req.query.clientId || item.supportMatrix.some(m => m.clientId === req.query.clientId)) && (!req.query.osFamily || item.supportMatrix.some(m => m.osFamily === req.query.osFamily)) && (!req.query.capabilityId || item.capabilities.includes(req.query.capabilityId as string)));
    res.json({ revision: catalog.revision, items });
  });
  return router;
}
