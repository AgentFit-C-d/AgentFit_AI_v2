import { Router } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import type { SessionUser } from '@agentfit/contracts';
import type { UploadService } from './uploads';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { AppError } from '../http/errors';
export function blobRoutes(options: { token: string; apiOrigin: string; webOrigin: string; session(headers: IncomingHttpHeaders): Promise<SessionUser | null>; uploads: UploadService }) {
  const router = Router();
  router.post('/api/projects/:projectId/uploads/:uploadId/blob', async (req, res) => {
    const body: unknown = req.body;
    if (!body || typeof body !== 'object' || !('type' in body) || !['blob.generate-client-token', 'blob.upload-completed'].includes(String(body.type))) throw new AppError('INVALID_BLOB_CALLBACK');
    try {
      const result = await handleUpload({ token: options.token, request: req, body: body as HandleUploadBody,
        onBeforeGenerateToken: async (pathname, _payload, multipart) => {
          if (req.headers.origin !== options.webOrigin) throw new AppError('UNTRUSTED_ORIGIN', 403);
          const user = await options.session(req.headers);
          if (!user) throw new AppError('AUTH_REQUIRED', 401);
          const grant = await options.uploads.issueBlobOptions(user.id, req.params.projectId, req.params.uploadId, pathname, multipart);
          return { ...grant, callbackUrl: `${options.apiOrigin}/api/projects/${encodeURIComponent(req.params.projectId)}/uploads/${encodeURIComponent(req.params.uploadId)}/blob` };
        },
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          if (tokenPayload !== req.params.uploadId || blob.pathname !== `inputs/${req.params.uploadId}`) throw new AppError('INVALID_UPLOAD_PATH');
          await options.uploads.completeBlob(req.params.uploadId, blob.pathname);
        }
      });
      res.json(result);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('INVALID_BLOB_CALLBACK', 403);
    }
  });
  return router;
}
