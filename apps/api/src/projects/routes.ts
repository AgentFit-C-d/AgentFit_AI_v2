import { Router } from 'express';
import { ProjectsService } from './service';
export function projectRoutes(service: ProjectsService) {
  const router = Router();
  router.get('/', async (_req, res) => { res.json(await service.listProjects(res.locals.user.id)); });
  router.post('/', async (req, res) => { res.status(201).json(await service.createProject(res.locals.user.id, req.body)); });
  router.get('/:projectId', async (req, res) => { res.json(await service.getOwnedProject(res.locals.user.id, req.params.projectId)); });
  router.patch('/:projectId/profile', async (req, res) => { res.json(await service.saveConfirmedProfile(res.locals.user.id, req.params.projectId, req.body)); });
  return router;
}
