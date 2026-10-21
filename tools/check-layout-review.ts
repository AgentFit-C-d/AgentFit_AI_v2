// Fixed synthetic inputs only; use the normal API and budget reservation boundary.
import { createRequire } from 'node:module';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createDatabase } from '../apps/api/src/db';
import type { AnalysisResult, AttemptDto, ProjectDto, UploadGrant } from '../packages/contracts/src';
const { config } = createRequire(new URL('../apps/api/package.json', import.meta.url))('dotenv');
config({ path: '.env', quiet: true });
if (process.env.RUNTIME_MODE !== 'local' || !['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error('LOCAL_EVALUATION_REQUIRED');
const origin = 'http://localhost:3000'; const owner = `evaluation-layout-${randomUUID()}`; const token = randomUUID();
const db = createDatabase(process.env.DATABASE_URL!);
const cookie = `better-auth.session_token=${encodeURIComponent(token + '.' + createHmac('sha256', process.env.BETTER_AUTH_SECRET!).update(token).digest('base64'))}`;
const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
const root = 'work/harness/layout-secondary-review';
const selectedMode = process.argv[2];
if (selectedMode && selectedMode !== 'original-pdf') throw new Error('INVALID_EVALUATION_SCOPE');
const records: object[] = [];
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(origin + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('EVALUATION_API_FAILED');
  return await response.json() as T;
}
function assess(result: AnalysisResult) {
  const equal = (actual: unknown, expected: string[]) => Array.isArray(actual) && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
  return {
    inputFormat: result.modelMetadata.inputFormat, promptVersion: result.modelMetadata.promptVersion,
    aiMatches: equal(result.profile.ai, ['Solar Pro 4', 'Embed 2']), frontendMatches: equal(result.profile.frontend, ['React']),
    deploymentMatches: typeof result.profile.deployment === 'string' && equal(result.profile.deployment.split(',').map(name => name.trim()), ['Vercel', 'GCP']),
    missingDatabasePreserved: result.profile.database === null, groundedPurposeCount: result.candidates.flatMap(candidate => candidate.usages ?? []).length,
    secondaryReview: result.modelMetadata.secondaryReview ?? null,
    fieldStates: result.fieldStates,
    candidateChecks: result.candidates.map(candidate => ({ field: candidate.field, status: candidate.status, evidenceCount: candidate.evidence.length, values: candidate.proposedValue })),
  };
}
try {
  await db.$connect();
  const before = (await db.budgetCounter.findUnique({ where: { id: 'development-upstage' } }))?.spentMicroUsd ?? 0;
  await db.user.create({ data: { id: owner, name: 'Synthetic layout evaluation', email: `${owner}@example.invalid` } });
  await db.session.create({ data: { id: randomUUID(), userId: owner, token, expiresAt: new Date(Date.now() + 600000) } });
  for (const mode of selectedMode ? [selectedMode] : ['original-pdf', 'canonical-text']) {
    const project = await api<ProjectDto>('/api/projects', 'POST', { name: `Synthetic layout ${mode}` });
    const started = Date.now(); let attempt: AttemptDto | undefined;
    try {
      let input: object;
      if (mode === 'original-pdf') {
        const bytes = await readFile(`${root}/synthetic-table.pdf`);
        const grant = await api<UploadGrant>(`/api/projects/${project.id}/uploads`, 'POST', { kind: 'pdf', size: bytes.length, contentType: 'application/pdf' });
        if (grant.storage !== 'local' || !grant.uploadUrl.startsWith(`/api/projects/${project.id}/uploads/`)) throw new Error('LOCAL_UPLOAD_REQUIRED');
        const upload = await fetch(origin + grant.uploadUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/pdf' }, body: bytes, signal: AbortSignal.timeout(10000) });
        if (!upload.ok) throw new Error('EVALUATION_UPLOAD_FAILED');
        input = { kind: 'upload', uploadId: grant.uploadId };
      } else input = { kind: 'text', text: await readFile(`${root}/synthetic-table.txt`, 'utf8') };
      attempt = await api<AttemptDto>(`/api/projects/${project.id}/analysis`, 'POST', { provider: 'upstage', input });
      let terminal = false;
      while (Date.now() - started < 185000) {
        const current = await api<AttemptDto>(`/api/projects/${project.id}/analysis/${attempt.id}`);
        if (!['QUEUED', 'PROCESSING'].includes(current.status)) {
          const result = current.status === 'SUCCEEDED' ? (await api<ProjectDto>(`/api/projects/${project.id}`)).draft!.result : undefined;
          const record = { mode, status: current.status, latencyMs: Date.now() - started, ...(result ? assess(result) : { errorCode: current.errorCode }) };
          records.push(record); console.info(JSON.stringify(record)); terminal = true; break;
        }
        await new Promise(done => setTimeout(done, 500));
      }
      if (!terminal) { await api(`/api/projects/${project.id}/analysis/${attempt.id}/cancel`, 'POST'); records.push({ mode, status: 'FAILED', errorCode: 'EVALUATION_TIMEOUT' }); }
    } catch { if (attempt) await api(`/api/projects/${project.id}/analysis/${attempt.id}/cancel`, 'POST').catch(() => undefined); records.push({ mode, status: 'FAILED', errorCode: 'EVALUATION_API_FAILED' }); }
  }
  const after = (await db.budgetCounter.findUnique({ where: { id: 'development-upstage' } }))?.spentMicroUsd ?? 0;
  const path = `${root}/model-smoke-${Date.now()}.json`;
  await writeFile(path, JSON.stringify({ scope: 'FIXED_SYNTHETIC_PDF_AND_TEXT_NO_RETRIES', records, budget: { beforeMicroUsd: before, afterMicroUsd: after, maximumMicroUsd: 20000000, actualBilledCost: 'UNVERIFIED' } }, null, 2));
  console.info(JSON.stringify({ report: path, budgetBeforeMicroUsd: before, budgetAfterMicroUsd: after }));
} finally {
  for (const project of await db.project.findMany({ where: { ownerId: owner }, select: { id: true } })) {
    await fetch(`${origin}/api/projects/${project.id}`, { method: 'DELETE', headers, body: JSON.stringify({ confirmation: true }), signal: AbortSignal.timeout(10000) }).catch(() => undefined);
  }
  await db.session.deleteMany({ where: { userId: owner } });
  if (!await db.project.count({ where: { ownerId: owner } })) await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
}
