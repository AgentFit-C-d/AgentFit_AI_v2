// Experimental A/B runner; no user documents, no profile writes, shared $20 cap.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createDatabase } from '../apps/api/src/db';
import { Prisma } from '../apps/api/src/generated/prisma/client';
import { aiEnvironment } from './run-ai.mjs';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
require('dotenv').config({ path: '.env', quiet: true });
const databaseUrl = process.env.DATABASE_URL;
if (process.env.RUNTIME_MODE !== 'local' || !databaseUrl || !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname)) throw new Error('LOCAL_EVALUATION_REQUIRED');
const db = createDatabase(databaseUrl);
const path = `work/harness/document-parse-experiment/comparison-${Date.now()}.json`;
const reservations: { stage: string; pages: number; amountMicroUsd: number }[] = [];
const records: unknown[] = [];
const selectedMode = process.argv[2];
if (selectedMode && !['parsed-only', 'enhanced-only'].includes(selectedMode)) throw new Error('INVALID_EVALUATION_SCOPE');
let beforeMicroUsd = 0;
let exitCode = 1;
const stages = new Set<string>();
const maximumMicroUsd = Math.min(20_000_000, Number(process.env.UPSTAGE_DEVELOPMENT_BUDGET_MICRO_USD));
if (!Number.isSafeInteger(maximumMicroUsd) || maximumMicroUsd < 1) throw new Error('BUDGET_NOT_CONFIGURED');

try {
  await db.$connect();
  beforeMicroUsd = (await db.budgetCounter.findUnique({ where: { id: 'development-upstage' } }))?.spentMicroUsd ?? 0;
  const child = spawn('rtk', ['proxy', 'uv', '--cache-dir', 'work/harness/mvp-implementation/uv-cache', 'run', '--project', 'apps/ai', 'python', 'evaluations/check_document_parse.py', ...(selectedMode ? [selectedMode] : [])], { env: { ...aiEnvironment(process.env), PYTHONPATH: 'apps/ai' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  // Child reports only safe JSON; do not forward stderr, which can contain responses.
  child.stderr.resume();
  const completion = once(child, 'exit');
  const killTimer = setTimeout(() => child.kill(), 370_000);
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      try {
        const event = JSON.parse(line) as { event?: string; stage?: string; pages?: number; record?: unknown };
        if (event.event === 'reserve') {
          const stage = event.stage; const pages = event.pages;
          if (!stage || !['original-ie', 'parse-standard', 'parse-enhanced', 'parsed-ie'].includes(stage) || stages.has(stage) || !Number.isInteger(pages) || !pages || pages < 1 || pages > (stage === 'parsed-ie' ? 4 : 2)) throw new Error('INVALID_RESERVATION');
          const amountMicroUsd = pages * (stage === 'parse-standard' ? 11_000 : stage === 'parse-enhanced' ? 33_000 : 44_000);
          await db.$transaction(async tx => {
            await tx.$queryRaw(Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(90133702)`);
            const counter = await tx.budgetCounter.upsert({ where: { id: 'development-upstage' }, create: { id: 'development-upstage' }, update: {} });
            if (counter.spentMicroUsd + amountMicroUsd > maximumMicroUsd) throw new Error('BUDGET_EXCEEDED');
            await tx.budgetCounter.update({ where: { id: counter.id }, data: { spentMicroUsd: { increment: amountMicroUsd } } });
          });
          stages.add(stage); reservations.push({ stage, pages, amountMicroUsd });
          await writeFile(path, JSON.stringify({ status: 'RUNNING', records, reservations, budget: { beforeMicroUsd, maximumMicroUsd, actualBilledCost: 'UNVERIFIED' } }, null, 2));
          child.stdin.write(JSON.stringify({ approved: true }) + '\n');
        } else if (event.event === 'record' && event.record) {
          records.push(event.record); console.info(JSON.stringify(event.record));
        } else if (event.event === 'failed') {
          console.info('EVALUATION_RUN_FAILED');
        }
      } catch {
        child.stdin.write(JSON.stringify({ approved: false }) + '\n');
        child.kill(); console.info('EVALUATION_OR_BUDGET_FAILED'); break;
      }
    }
    const [code] = await completion;
    exitCode = typeof code === 'number' ? code : 1;
  } finally { clearTimeout(killTimer); child.stdin.end(); }
} finally {
  const afterMicroUsd = (await db.budgetCounter.findUnique({ where: { id: 'development-upstage' } }))?.spentMicroUsd ?? 0;
  await writeFile(path, JSON.stringify({ status: exitCode === 0 ? 'COMPLETED' : 'FAILED', scope: selectedMode ? 'FIXED_SYNTHETIC_PARSED_ONLY_ROW_BINDING_NO_RETRIES' : 'FIXED_SYNTHETIC_ONE_PAIR_NO_RETRIES_NO_SECONDARY_REVIEW', records, reservations, budget: { beforeMicroUsd, afterMicroUsd, maximumMicroUsd, actualBilledCost: 'UNVERIFIED' } }, null, 2));
  console.info(JSON.stringify({ report: path, reservedMicroUsd: reservations.reduce((sum, row) => sum + row.amountMicroUsd, 0), budgetAfterMicroUsd: afterMicroUsd }));
  await db.$disconnect();
}
process.exitCode = exitCode;
