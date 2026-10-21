import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createDatabase } from '../apps/api/src/db';
loadEnvFile('.env');
if (process.env.RUNTIME_MODE !== 'local' || !['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error('NOT_LOCAL');
const db = createDatabase(process.env.DATABASE_URL!); const owner = `solar-diagnostic-${randomUUID()}`;
try {
  await db.user.create({ data: { id: owner, name: 'Synthetic diagnostic', email: `${owner}@example.invalid` } });
  const project = await db.project.create({ data: { ownerId: owner, name: 'Synthetic diagnostic' } });
  for (const operation of process.argv[2] ? [process.argv[2]] : ['needs', 'extract']) {
    if (!['needs', 'extract', 'review'].includes(operation)) throw new Error('INVALID_OPERATION');
    const leaseId = randomUUID();
    const deadline = new Date(Date.now() + 120000);
    const upload = operation !== 'needs' ? await db.upload.create({ data: { id: randomUUID(), ownerId: owner, projectId: project.id, objectKey: `synthetic/${randomUUID()}`, storage: 'local', kind: 'text', size: 100, contentType: 'text/plain', expiresAt: deadline, state: 'DELETED' } }) : null;
    const row = upload
      ? await db.analysisAttempt.create({ data: { projectId: project.id, ownerId: owner, uploadId: upload.id, provider: operation === 'review' ? 'upstage' : 'solar', status: 'PROCESSING', deadline, leaseId } })
      : await db.skillDiscovery.create({ data: { projectId: project.id, basis: {}, result: {}, deadline, status: 'SEARCHING', leaseId } });
    const path = `work/harness/solar-migration/context-${operation}.json`;
    await writeFile(path, JSON.stringify({ operation, scope: operation === 'needs' ? 'discovery' : 'analysis', targetId: row.id, leaseId }));
    const code = await new Promise<number>(done => {
      const child = spawn('rtk', ['proxy', 'uv', '--cache-dir', 'work/harness/mvp-implementation/uv-cache', 'run', '--project', 'apps/ai', 'python', 'evaluations/diagnose_solar.py', path], { stdio: 'inherit', windowsHide: true });
      child.on('error', () => done(1)); child.on('exit', code => done(code ?? 1));
    });
    if (code) throw new Error('SYNTHETIC_DIAGNOSTIC_FAILED');
  }
} finally {
  await db.analysisAttempt.deleteMany({ where: { ownerId: owner } });
  await db.upload.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
}
