import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { testDatabase } from '../support/postgres';
import { createLocalRuntime } from '../../apps/api/src/runtime';
import type { Server } from 'node:http';
import { browserSkillPorts } from './skill-fixture';
const origin = 'http://localhost:3011'; const api = 'http://127.0.0.1:4011'; const token = 'e2e-service-token'.repeat(3); const secret = 'e2e-auth-secret'.repeat(3);
function environment(extra: Record<string, string>) {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PATHEXT']) if (process.env[key]) result[key] = process.env[key];
  return { ...result, ...extra };
}
async function ready(url: string) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* Wait only for this test server. */ }
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error('E2E_SERVER_NOT_READY');
}
async function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  await new Promise<void>(done => { const kill = spawn('rtk', ['proxy', 'taskkill', '/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); kill.on('exit', () => done()); kill.on('error', () => done()); });
}
export default async function setup() {
  const fixture = await testDatabase(); let ai: ChildProcess | undefined; let web: ChildProcess | undefined;
  let runtime: Awaited<ReturnType<typeof createLocalRuntime>> | undefined; let server: Server | undefined;
  const cleanup = async () => { await stop(web); await stop(ai); runtime?.loop?.stop(); runtime?.inputs.dispose(); if (server) await new Promise<void>(done => server!.close(() => done())); await runtime?.db.$disconnect(); await fixture.stop(); };
  try {
    runtime = await createLocalRuntime({ databaseUrl: fixture.databaseUrl, authSecret: secret, port: 4011, webOrigin: origin, github: null, diagnosticKey: 'ab'.repeat(32), analysis: { token, url: 'http://127.0.0.1:8011', budgetMicroUsd: 20000000, priceMicroUsd: 44000 } }, [], browserSkillPorts);
    const owner = randomUUID(); const sessionToken = randomUUID();
    await fixture.db.user.create({ data: { id: owner, name: 'Browser fixture', email: `${owner}@example.invalid` } });
    await fixture.db.session.create({ data: { id: randomUUID(), token: sessionToken, userId: owner, expiresAt: new Date(Date.now() + 600000) } });
    process.env.E2E_SESSION_COOKIE = `${sessionToken}.${createHmac('sha256', secret).update(sessionToken).digest('base64')}`;
    server = runtime.app.listen(4011, '127.0.0.1'); runtime.loop?.start();
    ai = spawn('rtk', ['proxy', 'uv', '--cache-dir', 'work/harness/mvp-implementation/uv-cache', 'run', '--project', 'apps/ai', 'uvicorn', 'tests.e2e_factory:app_factory', '--factory', '--app-dir', 'apps/ai', '--host', '127.0.0.1', '--port', '8011', '--no-access-log'], { env: environment({ AI_SERVICE_TOKEN: token, API_INTERNAL_URL: api }), windowsHide: true, stdio: 'ignore' });
    await ready('http://127.0.0.1:8011/health');
    web = spawn('rtk', ['proxy', 'powershell', '-NoProfile', '-Command', 'pnpm --filter @agentfit/web dev --port 3011'], { env: environment({ API_PROXY_URL: api, WEB_DIST_DIR: '.next-e2e' }), windowsHide: true, stdio: 'ignore' });
    await ready(`${origin}/api/runtime`);
    return cleanup;
  } catch (error) { await cleanup(); throw error; }
}
