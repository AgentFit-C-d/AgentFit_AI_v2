// A bounded real-provider smoke check using only a synthetic, predeclared fixture.
// Original documents, cookies, credentials and model responses are never reported.
import { createRequire } from 'node:module';
import { createDecipheriv, createHmac, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createDatabase } from '../apps/api/src/db';
import { assertNoSecretsData, type AnalysisResult, type AttemptDto, type ProjectDto } from '../packages/contracts/src';
const { config } = createRequire(new URL('../apps/api/package.json', import.meta.url))('dotenv');
config({ path: '.env', quiet: true });
if (process.env.RUNTIME_MODE !== 'local' || !['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error('LOCAL_EVALUATION_REQUIRED');
const selection = process.argv[2]; if (selection && !['upstage', 'solar'].includes(selection)) throw new Error('INVALID_EVALUATION_SCOPE');
const providers = selection ? [selection] as ('upstage' | 'solar')[] : ['upstage', 'solar'] as const;
const text = 'Solar Pro 4로 답변 생성\nEmbed 2로 임베딩\n프론트엔드는 Vercel\n백엔드는 GCP\n프론트엔드: React\n프론트엔드: React';
const expected = { ai: ['Solar Pro 4', 'Embed 2'], deployment: 'Vercel, GCP', frontend: ['React'] };
const expectedUsages = new Map([['Solar Pro 4', '답변 생성'], ['Embed 2', '임베딩'], ['Vercel', '프론트엔드'], ['GCP', '백엔드']]);
const owner = `evaluation-quality-${randomUUID()}`; const session = randomUUID(); const origin = 'http://localhost:3000';
const cookie = `better-auth.session_token=${encodeURIComponent(session + '.' + createHmac('sha256', process.env.BETTER_AUTH_SECRET!).update(session).digest('base64'))}`;
const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
const db = createDatabase(process.env.DATABASE_URL!);
type Record = { provider: string; status: string; latencyMs: number; errorCode?: string; promptVersion?: string; profileMatches?: boolean; groundedPurposeCount?: number; repeatedEvidenceCount?: number; passed?: boolean; schemaHints?: string[] };
const records: Record[] = [];
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(origin + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('EVALUATION_API_FAILED');
  return await response.json() as T;
}
function assess(result: AnalysisResult) {
  const matches = Object.entries(expected).every(([field, value]) => {
    const actual = result.profile[field as keyof typeof expected];
    return field === 'deployment' ? typeof actual === 'string' && JSON.stringify(actual.split(',').map(name => name.trim()).sort()) === JSON.stringify(['GCP', 'Vercel']) : Array.isArray(actual) && Array.isArray(value) && JSON.stringify([...actual].sort()) === JSON.stringify([...value].sort());
  }) && result.profile.database === null;
  const usages = result.candidates.flatMap(candidate => candidate.usages ?? []);
  const count = [...expectedUsages].filter(([name, purpose]) => usages.some(usage => usage.value === name && usage.purpose === purpose && usage.evidence.length)).length;
  const evidence = result.candidates.find(candidate => candidate.field === 'frontend' && candidate.proposedValue?.includes('React'))?.evidence.length ?? 0;
  return { profileMatches: matches, groundedPurposeCount: count, repeatedEvidenceCount: evidence, passed: matches && count === 4 && evidence === 2,
    syntheticChecks: { frontend: result.profile.frontend, ai: result.profile.ai, deployment: result.profile.deployment, fieldStates: result.fieldStates,
      purposes: usages.map(u => ({ value: u.value, purpose: u.purpose })) } };
}
async function schemaHints(attemptId: string) {
  const diagnostic = await db.failureDiagnostic.findUnique({ where: { attemptId } });
  if (!diagnostic || !process.env.DIAGNOSTIC_ENCRYPTION_KEY) return [];
  let bytes: Buffer | undefined;
  try {
    const decrypt = createDecipheriv('aes-256-gcm', Buffer.from(process.env.DIAGNOSTIC_ENCRYPTION_KEY, 'hex'), diagnostic.iv);
    decrypt.setAAD(Buffer.from(attemptId)); decrypt.setAuthTag(diagnostic.authTag);
    bytes = Buffer.concat([decrypt.update(diagnostic.ciphertext), decrypt.final()]);
    const envelope = JSON.parse(bytes.toString('utf8')); assertNoSecretsData(envelope);
    const description = JSON.stringify(envelope.error ?? envelope.detail ?? {});
    return [['REQUIRED_PROPERTIES', /required/i], ['NESTED_STRUCTURES', /nested|depth/i], ['ARRAY_SCHEMA', /array/i], ['UNSUPPORTED_SCHEMA', /unsupported|not supported/i], ['SCHEMA_ERROR', /schema/i]].filter(([, pattern]) => (pattern as RegExp).test(description)).map(([label]) => label as string);
  } catch { return ['DIAGNOSTIC_UNAVAILABLE']; }
  finally { bytes?.fill(0); }
}
try {
  await db.$connect();
  const before = (await db.budgetCounter.findUnique({ where: { id: 'development-upstage' } }))?.spentMicroUsd ?? 0;
  await db.user.create({ data: { id: owner, name: 'Synthetic quality evaluation', email: `${owner}@example.invalid` } });
  await db.session.create({ data: { id: randomUUID(), userId: owner, token: session, expiresAt: new Date(Date.now() + 600000) } });
  for (const provider of providers) {
    const project = await api<ProjectDto>('/api/projects', 'POST', { name: `Synthetic quality ${provider}` });
    const started = Date.now(); const record: Record = { provider, status: 'NOT_RUN', latencyMs: 0 };
    records.push(record);
    try {
      const attempt = await api<AttemptDto>(`/api/projects/${project.id}/analysis`, 'POST', { provider, input: { kind: 'text', text } });
      while (Date.now() - started < 185000) {
        const current = await api<AttemptDto>(`/api/projects/${project.id}/analysis/${attempt.id}`);
        if (!['QUEUED', 'PROCESSING'].includes(current.status)) {
          record.status = current.status;
          if (current.status === 'SUCCEEDED') {
            const updated = await api<ProjectDto>(`/api/projects/${project.id}`);
            Object.assign(record, assess(updated.draft!.result), { promptVersion: updated.draft!.result.modelMetadata.promptVersion });
          } else { record.errorCode = current.errorCode ?? 'ANALYSIS_FAILED'; if (record.errorCode === 'PROVIDER_BAD_REQUEST') record.schemaHints = await schemaHints(attempt.id); }
          break;
        }
        await new Promise(done => setTimeout(done, 500));
      }
      if (record.status === 'NOT_RUN') { record.status = 'FAILED'; record.errorCode = 'EVALUATION_TIMEOUT'; await api(`/api/projects/${project.id}/analysis/${attempt.id}/cancel`, 'POST'); }
    } catch { record.status = 'FAILED'; record.errorCode = 'EVALUATION_API_FAILED'; }
    record.latencyMs = Date.now() - started;
    console.info(JSON.stringify(record));
  }
  const after = (await db.budgetCounter.findUnique({ where: { id: 'development-upstage' } }))?.spentMicroUsd ?? 0;
  const path = `work/harness/extraction-quality/model-smoke-${Date.now()}.json`;
  await writeFile(path, JSON.stringify({ scope: 'ONE_SYNTHETIC_TEXT_CASE_PER_PROVIDER_NO_RETRIES', expectedChecks: 4, records, budget: { beforeMicroUsd: before, afterMicroUsd: after, maximumMicroUsd: 20000000, actualBilledCost: 'UNVERIFIED' } }, null, 2));
  console.info(JSON.stringify({ report: path, budgetBeforeMicroUsd: before, budgetAfterMicroUsd: after }));
} finally {
  for (const project of await db.project.findMany({ where: { ownerId: owner }, select: { id: true } })) {
    await fetch(`${origin}/api/projects/${project.id}`, { method: 'DELETE', headers, body: JSON.stringify({ confirmation: true }), signal: AbortSignal.timeout(10000) }).catch(() => undefined);
  }
  await db.session.deleteMany({ where: { userId: owner } });
  if (!await db.project.count({ where: { ownerId: owner } })) await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
}
