// Fixed synthetic cases only. Full local API/worker/AI/budget path, no automatic retries.
import { createRequire } from 'node:module';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createDatabase } from '../apps/api/src/db';
import { assertNoSecretsData, validateAnalysisResult, type AttemptDto, type ProjectDto } from '../packages/contracts/src';
import { assessFeatureExtraction, type FeatureCase } from '../evaluations/feature-metrics';
createRequire(new URL('../apps/api/package.json', import.meta.url))('dotenv').config({ path: '.env', quiet: true });
const phase = process.argv[2]; const providerSelection = process.argv[3]; const caseSelection = process.argv[4];
if (!phase || !['before', 'after', 'holdout'].includes(phase) || providerSelection && !['upstage', 'solar'].includes(providerSelection) || process.env.RUNTIME_MODE !== 'local' || !['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error('INVALID_EVALUATION_SCOPE');
const raw = await readFile('evaluations/feature-integration-cases.json', 'utf8');
const all = JSON.parse(raw) as FeatureCase[];
if (caseSelection && !all.some(c => c.id === caseSelection)) throw new Error('INVALID_EVALUATION_SCOPE');
assertNoSecretsData(all);
const cases = all.filter(c => !caseSelection || c.id === caseSelection);
const providers = providerSelection ? [providerSelection] : ['solar', 'upstage'];
const db = createDatabase(process.env.DATABASE_URL!); const owner = `feature-eval-${randomUUID()}`; const session = randomUUID(); const origin = 'http://localhost:3000';
const cookie = `better-auth.session_token=${encodeURIComponent(session + '.' + createHmac('sha256', process.env.BETTER_AUTH_SECRET!).update(session).digest('base64'))}`;
const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
const records: unknown[] = []; const path = `work/harness/feature-extraction/${phase}-${Date.now()}.json`;
async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(origin + url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('EVALUATION_API_FAILED');
  return response.json() as Promise<T>;
}
const budget = async () => (await db.budgetCounter.findUnique({ where: { id: 'development-upstage' } }))?.spentMicroUsd ?? 0;
try {
  const before = await budget();
  await db.user.create({ data: { id: owner, name: 'Feature extraction synthetic evaluation', email: `${owner}@example.invalid` } });
  await db.session.create({ data: { id: randomUUID(), userId: owner, token: session, expiresAt: new Date(Date.now() + 3600000) } });
  for (const provider of providers) for (const fixture of cases) {
    const project = await api<ProjectDto>('/api/projects', 'POST', { name: `Synthetic ${fixture.id}` });
    const started = Date.now(); const record: { caseId: string; provider: string; status: string; errorCode?: string; latencyMs: number; checks?: unknown; promptVersion?: string } = { caseId: fixture.id, provider, status: 'NOT_RUN', latencyMs: 0 };
    try {
      const attempt = await api<AttemptDto>(`/api/projects/${project.id}/analysis`, 'POST', { provider, input: { kind: 'text', text: fixture.text } });
      while (Date.now() - started < 185000) {
        const current = await api<AttemptDto>(`/api/projects/${project.id}/analysis/${attempt.id}`);
        if (!['QUEUED', 'PROCESSING'].includes(current.status)) {
          record.status = current.status;
          if (current.status === 'SUCCEEDED') {
            const refreshed = await api<ProjectDto>(`/api/projects/${project.id}`);
            const result = validateAnalysisResult(refreshed.draft!.result);
            record.checks = assessFeatureExtraction(fixture, result); record.promptVersion = result.modelMetadata.promptVersion;
          } else record.errorCode = current.errorCode ?? 'ANALYSIS_FAILED';
          break;
        }
        await new Promise(done => setTimeout(done, 500));
      }
      if (record.status === 'NOT_RUN') { record.status = 'FAILED'; record.errorCode = 'EVALUATION_TIMEOUT'; await api(`/api/projects/${project.id}/analysis/${attempt.id}/cancel`, 'POST'); }
    } catch { record.status = 'FAILED'; record.errorCode = 'EVALUATION_API_FAILED'; }
    record.latencyMs = Date.now() - started; records.push(record);
    const report = { phase, manifestSha256: createHash('sha256').update(raw).digest('hex'), scope: 'SYNTHETIC_ONLY_ONE_CALL_PER_CASE_PROVIDER_NO_RETRIES', records, budget: { beforeMicroUsd: before, afterMicroUsd: await budget(), maximumMicroUsd: 20000000, actualBilledCost: 'UNVERIFIED' } };
    await writeFile(path, JSON.stringify(report, null, 2)); console.info(JSON.stringify({ report: path, ...record }));
    if (record.errorCode === 'BUDGET_EXCEEDED' || record.errorCode === 'PROVIDER_BUDGET_EXHAUSTED') throw new Error('EVALUATION_BUDGET_STOP');
  }
} finally {
  let cleanupFailed = false;
  let remainingProjects = 0;
  try {
  for (const project of await db.project.findMany({ where: { ownerId: owner }, select: { id: true } })) {
    try {
      const response = await fetch(`${origin}/api/projects/${project.id}`, { method: 'DELETE', headers, body: JSON.stringify({ confirmation: true }), signal: AbortSignal.timeout(10000) });
      if (!response.ok) cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
  remainingProjects = await db.project.count({ where: { ownerId: owner } });
  await db.session.deleteMany({ where: { userId: owner } });
  if (!remainingProjects) await db.user.deleteMany({ where: { id: owner } });
  const report = JSON.parse(await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return JSON.stringify({ phase, records });
    throw error;
  })) as Record<string, unknown>;
  report.cleanup = { status: cleanupFailed || remainingProjects ? 'FAILED' : 'SUCCEEDED', remainingProjects };
  await writeFile(path, JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ report: path, cleanup: report.cleanup }));
  } finally { await db.$disconnect(); }
  if (cleanupFailed || remainingProjects) throw new Error('EVALUATION_CLEANUP_FAILED');
}
