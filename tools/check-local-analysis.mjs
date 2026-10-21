// Read only the active-attempt count before restarting local development services.
import { loadEnvFile } from 'node:process';
import pg from 'pg';
let client;
try {
  loadEnvFile('.env');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('NOT_LOCAL');
  client = new pg.Client({ connectionString: url.toString(), options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 5000 });
  await client.connect();
  const result = await client.query('SELECT count(*)::int AS count FROM "AnalysisAttempt" WHERE status IN (\'QUEUED\', \'PROCESSING\') AND deadline > now()');
  console.log(JSON.stringify({ activeAnalysisCount: result.rows[0].count }));
} catch { console.error('LOCAL_ANALYSIS_CHECK_FAILED'); process.exitCode = 1; }
finally { if (client) await client.end(); }
