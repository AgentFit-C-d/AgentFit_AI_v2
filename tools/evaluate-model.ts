import { createRequire } from 'node:module';
import { createDecipheriv, createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDatabase } from '../apps/api/src/db';
const Ajv = createRequire(new URL('../packages/contracts/package.json', import.meta.url))('ajv');
const wireSchema = process.argv[2] === 'upstage' ? 'upstage-output' : 'provider-output';
const validateWire = new Ajv({ strict: false, allErrors: true }).compile(JSON.parse(await readFile(new URL(`../packages/contracts/schema/${wireSchema}.json`, import.meta.url), 'utf8')));
const { config: loadEnv } = createRequire(new URL('../apps/api/package.json', import.meta.url))('dotenv');
loadEnv({ path: '.env', quiet: true });
const provider = process.argv[2]; const limit = Number(process.argv[3] ?? 1);
const inputMode = process.argv[4] ?? 'text';
const caseId = process.argv[5];
if (!provider || !['solar', 'upstage'].includes(provider) || !Number.isInteger(limit) || limit < 1 || limit > 51 || process.env.RUNTIME_MODE !== 'local') throw new Error('INVALID_EVALUATION_SCOPE');
if (!['text', 'mixed'].includes(inputMode)) throw new Error('INVALID_EVALUATION_SCOPE');
if (caseId && !/^(fact-0[1-9]|semantic-(0[1-9]|1[0-2])|normal-(0[1-9]|[12][0-9]|30))$/.test(caseId)) throw new Error('INVALID_EVALUATION_SCOPE');
const db = createDatabase(process.env.DATABASE_URL!);
const owner = `evaluation-${randomUUID()}`; const sessionToken = randomUUID(); const origin = 'http://localhost:3000';
const cookie = `better-auth.session_token=${encodeURIComponent(sessionToken + '.' + createHmac('sha256', process.env.BETTER_AUTH_SECRET!).update(sessionToken).digest('base64'))}`;
const file = resolve(`work/harness/mvp-implementation/evaluation-${provider}-${inputMode}-${Date.now()}.json`);
try {
  await db.$connect();
  await db.user.create({ data: { id: owner, name: 'Local evaluation fixture', email: `${owner}@example.invalid` } });
  await db.session.create({ data: { id: randomUUID(), token: sessionToken, userId: owner, expiresAt: new Date(Date.now() + 3600000) } });
  const before = (await db.budgetCounter.findUnique({ where: { id: 'development-upstage' } }))?.spentMicroUsd ?? 0;
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PATHEXT']) if (process.env[key]) environment[key] = process.env[key];
  Object.assign(environment, { EVALUATION_COOKIE: cookie, EVALUATION_ORIGIN: origin, PYTHONIOENCODING: 'utf-8' });
  const exit = await new Promise<number>(done => { const child = spawn('rtk', ['proxy', 'uv', '--cache-dir', 'work/harness/mvp-implementation/uv-cache', 'run', '--project', 'apps/ai', 'python', 'evaluations/run.py', '--provider', provider!, '--limit', String(limit), '--input-mode', inputMode, '--output', file, ...(caseId ? ['--case-id', caseId] : [])], { env: environment, windowsHide: true, stdio: 'inherit' }); child.on('error', () => done(1)); child.on('exit', code => done(code ?? 1)); });
  if (exit) throw new Error('EVALUATION_RUN_FAILED');
  const report = JSON.parse(await readFile(file, 'utf8'));
  for (const record of report.records) if (record.attemptId) {
    record.costReservationMicroUsd = (await db.budgetLedger.findUnique({ where: { attemptId: record.attemptId } }))?.amountMicroUsd ?? 0;
    const diagnostic = await db.failureDiagnostic.findUnique({ where: { attemptId: record.attemptId } });
    if (diagnostic && process.env.DIAGNOSTIC_ENCRYPTION_KEY) {
      try {
        const decrypt = createDecipheriv('aes-256-gcm', Buffer.from(process.env.DIAGNOSTIC_ENCRYPTION_KEY, 'hex'), diagnostic.iv);
        decrypt.setAAD(Buffer.from(record.attemptId)); decrypt.setAuthTag(diagnostic.authTag);
        const bytes = Buffer.concat([decrypt.update(diagnostic.ciphertext), decrypt.final()]);
        try {
          const envelope = JSON.parse(bytes.toString('utf8'));
          const choice = envelope.choices?.[0]; const output = choice?.message?.content ? JSON.parse(choice.message.content) : undefined;
          const type = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
          const validWire = output ? validateWire(output) : false;
          record.failureValidation = { schema: wireSchema, validWire, issues: (validateWire.errors ?? []).map((issue: { keyword: string; instancePath: string }) => ({ keyword: issue.keyword, path: /^\/items(?:\/\d+(?:\/(?:field|value|values|explicit_none|quote|context)(?:\/\d+)?)?)?$/.test(issue.instancePath) ? issue.instancePath : 'root' })), emptyValuesCount: Array.isArray(output?.items) ? output.items.filter((item: { values?: unknown[] }) => item.values?.length === 0).length : null };
          record.failureShape = { hasChoices: Array.isArray(envelope.choices), hasError: !!envelope.error, finishReason: ['stop', 'length'].includes(choice?.finish_reason) ? choice.finish_reason : 'other', itemsType: type(output?.items), itemShapes: Array.isArray(output?.items) ? output.items.slice(0, 20).map((item: Record<string, unknown>) => Object.fromEntries(['field', 'values', 'explicit_none', 'quote', 'context'].map(key => [key, type(item?.[key])]))) : [] };
        } finally { bytes.fill(0); }
      } catch { record.failureShape = { unavailable: true }; }
    }
  }
  const after = (await db.budgetCounter.findUnique({ where: { id: 'development-upstage' } }))?.spentMicroUsd ?? 0;
  report.budget = { beforeMicroUsd: before, afterMicroUsd: after, maximumMicroUsd: 20000000, actualBilledCost: 'UNVERIFIED' };
  await writeFile(file, JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ report: file, summary: report.summary, budget: report.budget, failureShapes: report.records.filter((row: { failureShape?: unknown }) => row.failureShape).map((row: { failureShape: unknown; failureValidation: unknown }) => ({ shape: row.failureShape, validation: row.failureValidation })) }));
} finally {
  for (const project of await db.project.findMany({ where: { ownerId: owner }, select: { id: true } })) await fetch(`${origin}/api/projects/${project.id}`, { method: 'DELETE', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: true }) });
  await db.session.deleteMany({ where: { userId: owner } });
  if (!await db.project.count({ where: { ownerId: owner } })) await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
}
