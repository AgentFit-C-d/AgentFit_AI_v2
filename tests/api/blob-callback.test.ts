import { expect, test, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { errorHandler } from '../../apps/api/src/http/errors';
import { blobRoutes } from '../../apps/api/src/storage/blob-routes';
import type { UploadService } from '../../apps/api/src/storage/uploads';
const token = 'vercel_blob_rw_synthetic_testkey';
const express: typeof import('express') = createRequire(new URL('../../apps/api/package.json', import.meta.url))('express');
function setup() {
  const completeBlob = vi.fn(async () => {}); const issueBlobOptions = vi.fn();
  const uploads = { completeBlob, issueBlobOptions } as unknown as UploadService;
  const app = express(); app.use(express.json());
  app.use(blobRoutes({ token, apiOrigin: 'https://api.example', webOrigin: 'https://web.example', session: async () => null, uploads })); app.use(errorHandler);
  return { app, completeBlob, issueBlobOptions };
}
test('uses real SDK callback signature; unauthenticated token generation and forged completion fail', async () => {
  const { app, completeBlob, issueBlobOptions } = setup();
  const body = { type: 'blob.upload-completed', payload: { blob: { pathname: 'inputs/u1' }, tokenPayload: 'u1' } };
  const path = '/api/projects/p1/uploads/u1/blob';
  expect((await request(app).post(path).send(body)).status).toBe(403);
  expect((await request(app).post(path).set('x-vercel-signature', '00'.repeat(32)).send(body)).status).toBe(403);
  expect(completeBlob).not.toHaveBeenCalled();
  const signature = createHmac('sha256', token).update(JSON.stringify(body)).digest('hex');
  expect((await request(app).post(path).set('x-vercel-signature', signature).send(body)).status).toBe(200);
  expect(completeBlob).toHaveBeenCalledWith('u1', 'inputs/u1');
  const generate = await request(app).post(path).set('Origin', 'https://web.example').send({ type: 'blob.generate-client-token', payload: { pathname: 'inputs/u1', multipart: false } });
  expect(generate.status).toBe(401);
  expect(issueBlobOptions).not.toHaveBeenCalled();
});
test('signed callback cannot substitute upload identity or pathname', async () => {
  const { app, completeBlob } = setup();
  const body = { type: 'blob.upload-completed', payload: { blob: { pathname: 'inputs/foreign' }, tokenPayload: 'foreign' } };
  const signature = createHmac('sha256', token).update(JSON.stringify(body)).digest('hex');
  expect((await request(app).post('/api/projects/p1/uploads/u1/blob').set('x-vercel-signature', signature).send(body)).status).toBe(400);
  expect(completeBlob).not.toHaveBeenCalled();
});
