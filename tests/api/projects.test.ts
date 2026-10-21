import { expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app';
import { MemoryProjectRepository } from '../support/projects';
const origin = 'http://localhost:3000';
function setup() {
  const projects = new MemoryProjectRepository();
  const app = createApp({ webOrigin: origin, projects, session: async headers => headers.authorization === 'Bearer alice' ? { id: 'alice', name: 'Alice' } : headers.authorization === 'Bearer bob' ? { id: 'bob', name: 'Bob' } : null });
  return { app, projects };
}
test('rejects anonymous project access regardless of claimed user header', async () => {
  const { app } = setup();
  expect((await request(app).get('/api/projects').set('x-user-id', 'alice')).status).toBe(401);
});
test('creates and lists only projects owned by the server session', async () => {
  const { app } = setup();
  const created = await request(app).post('/api/projects').set('Authorization', 'Bearer alice').set('Origin', origin).send({ name: 'AgentFit' });
  expect(created.status).toBe(201);
  expect(created.body.name).toBe('AgentFit');
  expect(created.body.ownerId).toBeUndefined();
  const own = await request(app).get('/api/projects').set('Authorization', 'Bearer alice');
  expect(own.body).toHaveLength(1);
  expect(own.body[0].id).toBe(created.body.id);
  expect((await request(app).get('/api/projects').set('Authorization', 'Bearer bob')).body).toEqual([]);
});
test('makes foreign and nonexistent project responses indistinguishable', async () => {
  const { app, projects } = setup();
  const project = await projects.create('alice', 'Private');
  const foreign = await request(app).get(`/api/projects/${project.id}`).set('Authorization', 'Bearer bob');
  const missing = await request(app).get('/api/projects/nonexistent').set('Authorization', 'Bearer bob');
  expect(foreign.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(foreign.body.error.code).toBe(missing.body.error.code);
  expect(foreign.body).not.toHaveProperty('name');
});
test('rejects untrusted Origin and invalid ownership/name fields', async () => {
  const { app } = setup();
  expect((await request(app).post('/api/projects').set('Authorization', 'Bearer alice').set('Origin', 'https://evil.example').send({ name: 'X' })).status).toBe(403);
  for (const body of [{ name: '  ' }, { name: 'X', ownerId: 'bob' }]) {
    expect((await request(app).post('/api/projects').set('Authorization', 'Bearer alice').set('Origin', origin).send(body)).status).toBe(400);
  }
});
test('hides repository exception details behind a safe failure', async () => {
  const { app, projects } = setup();
  projects.list = async () => { throw new Error('postgres://hidden-password@db/secret'); };
  const response = await request(app).get('/api/projects').set('Authorization', 'Bearer alice');
  expect(response.status).toBe(503);
  expect(JSON.stringify(response.body)).not.toContain('hidden-password');
});

test('blocks secrets in project names and user profile before persistence', async () => {
  const { app, projects } = setup();
  const secret = 'nvapi-' + 'a'.repeat(40);
  const response = await request(app).post('/api/projects').set('Authorization', 'Bearer alice').set('Origin', origin).send({ name: secret });
  expect(response.status).toBe(400);
  expect(JSON.stringify(response.body)).not.toContain(secret);
  expect(await projects.list('alice')).toEqual([]);
  const project = await projects.create('alice', 'Safe');
  const { emptyProfile } = await import('../../packages/contracts/src/index');
  const save = await request(app).patch(`/api/projects/${project.id}/profile`).set('Authorization', 'Bearer alice').set('Origin', origin).send({ expectedVersion: 1, profile: { ...emptyProfile(), database: secret } });
  expect(save.status).toBe(400);
  expect(save.body.error.code).toBe('SECRET_DETECTED');
  expect((await projects.findOwned('alice', project.id))?.version).toBe(1);
});
test('blocks known credentials after JSON decoding even when their characters were escaped', async () => {
  const projects = new MemoryProjectRepository(); const secret = 'synthetic-sensitive-"quoted"-value';
  const app = createApp({ webOrigin: origin, projects, knownSecrets: [secret], session: async () => ({ id: 'alice', name: 'Alice' }) });
  const project = await projects.create('alice', 'Safe'); const { emptyProfile } = await import('../../packages/contracts/src');
  const response = await request(app).patch(`/api/projects/${project.id}/profile`).set('Origin', origin).send({ expectedVersion: 1, profile: { ...emptyProfile(), project_name: secret } });
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('SECRET_DETECTED');
  expect((await projects.findOwned('alice', project.id))?.version).toBe(1);
});
