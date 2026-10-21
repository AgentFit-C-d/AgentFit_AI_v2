import { Router } from 'express';
import type { ProfileRepository } from './profiles';
import { bodyLimit } from '../http/body-limit';
export function profileRoutes(profiles: ProfileRepository) {
  const router = Router({ mergeParams: true });
  router.get<{ projectId: string }>('/developer-profile', async (req, res) => { res.json({ profile: await profiles.getDeveloper(res.locals.user.id, req.params.projectId) }); });
  router.get<{ projectId: string }>('/environment-profile', async (req, res) => { res.json({ profile: await profiles.getEnvironment(res.locals.user.id, req.params.projectId) }); });
  router.put<{ projectId: string }>('/developer-profile', bodyLimit(64 * 1024), async (req, res) => { const profile = await profiles.putDeveloper(res.locals.user.id, req.params.projectId, req.body); res.status(profile.version === 1 ? 201 : 200).json({ profile }); });
  router.put<{ projectId: string }>('/environment-profile', bodyLimit(64 * 1024), async (req, res) => { const profile = await profiles.putEnvironment(res.locals.user.id, req.params.projectId, req.body); res.status(profile.version === 1 ? 201 : 200).json({ profile }); });
  return router;
}
