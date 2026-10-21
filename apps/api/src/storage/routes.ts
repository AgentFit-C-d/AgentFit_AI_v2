import { Router, raw } from 'express';
import type { UploadService } from './uploads';
import { MAX_UPLOAD_BYTES } from './ports';
import { AppError } from '../http/errors';
export function uploadRoutes(service: UploadService) {
  const router = Router({ mergeParams: true });
  router.post<{ projectId: string }>('/uploads', async (req, res) => { res.status(201).json(await service.createUpload(res.locals.user.id, req.params.projectId, req.body)); });
  router.put<{ projectId: string; uploadId: string }>('/uploads/:uploadId/content', raw({ type: '*/*', limit: MAX_UPLOAD_BYTES }), async (req, res) => {
    if (!(req.body instanceof Uint8Array)) throw new AppError('INVALID_UPLOAD_BODY');
    await service.completeLocalUpload(res.locals.user.id, req.params.projectId as string, req.params.uploadId as string, req.body);
    res.status(204).end();
  });
  return router;
}
