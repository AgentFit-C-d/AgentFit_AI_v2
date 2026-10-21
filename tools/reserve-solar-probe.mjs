import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
let client;
try {
  loadEnvFile('.env');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('NOT_LOCAL');
  const limit = Number(process.env.UPSTAGE_DEVELOPMENT_BUDGET_MICRO_USD ?? '20000000');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20000000) throw new Error('INVALID_BUDGET');
  client = new pg.Client({ connectionString: url.toString() }); await client.connect();
  await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(90133702)');
  await client.query('INSERT INTO "BudgetCounter" (id, "spentMicroUsd") VALUES ($1, 0) ON CONFLICT (id) DO NOTHING', ['development-upstage']);
  const result = await client.query('UPDATE "BudgetCounter" SET "spentMicroUsd" = "spentMicroUsd" + 50000 WHERE id = $1 AND "spentMicroUsd" + 50000 <= $2 RETURNING "spentMicroUsd"', ['development-upstage', limit]);
  if (!result.rowCount) throw new Error('BUDGET_EXCEEDED');
  const grant = { id: randomUUID(), amountMicroUsd: 50000, used: false };
  await client.query('INSERT INTO "BudgetCounter" (id, "spentMicroUsd") VALUES ($1, $2)', [`solar-probe-${grant.id}`, 50000]);
  await client.query('COMMIT');
  await writeFile('work/harness/solar-migration/probe-grant.json', JSON.stringify(grant));
  console.log(JSON.stringify({ reservedMicroUsd: 50000, totalReservedMicroUsd: result.rows[0].spentMicroUsd }));
} catch { if (client) await client.query('ROLLBACK').catch(() => {}); console.error('SOLAR_PROBE_RESERVATION_FAILED'); process.exitCode = 1; }
finally { if (client) await client.end(); }
