import { expect, test, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app';
import { MemoryProjectRepository } from '../support/projects';
import type { DeleteProjectService } from '../../apps/api/src/projects/delete';
import { AppError } from '../../apps/api/src/http/errors';
test('delete requires trusted authenticated request and reports cleanup failure without success', async () => {
  const deleteProject = vi.fn(async (_owner: string, _id: string, _body: unknown) => {});
  const app = createApp({ webOrigin: 'http://localhost:3000', projects: new MemoryProjectRepository(), session: async headers => headers.authorization ? { id: 'alice', name: 'Alice' } : null, deletion: { deleteProject } as unknown as DeleteProjectService });
  const path = '/api/projects/p1';
  expect((await request(app).delete(path).set('Origin', 'http://localhost:3000').send({ confirmation: true })).status).toBe(401);
  expect((await request(app).delete(path).set('Authorization', 'alice').set('Origin', 'https://evil.example').send({ confirmation: true })).status).toBe(403);
  expect(deleteProject).not.toHaveBeenCalled();
  expect((await request(app).delete(path).set('Authorization', 'alice').set('Origin', 'http://localhost:3000').send({ confirmation: true })).status).toBe(204);
  expect(deleteProject).toHaveBeenCalledWith('alice', 'p1', { confirmation: true });
  deleteProject.mockRejectedValueOnce(new AppError('DELETE_INCOMPLETE', 503));
  const failed = await request(app).delete(path).set('Authorization', 'alice').set('Origin', 'http://localhost:3000').send({ confirmation: true });
  expect(failed.status).toBe(503); expect(failed.body.error.code).toBe('DELETE_INCOMPLETE');
});
