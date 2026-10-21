import { expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app';
import { MemoryProjectRepository } from '../support/projects';
test('fails closed when session lookup cannot reach its dependency', async () => {
  const app = createApp({ webOrigin: 'http://localhost:3000', projects: new MemoryProjectRepository(), session: async () => { throw new Error('oauth-secret-hidden'); } });
  const response = await request(app).get('/api/projects');
  expect(response.status).toBe(503);
  expect(JSON.stringify(response.body)).not.toContain('oauth-secret');
});
