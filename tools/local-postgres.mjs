import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Client } from 'pg';
const workspace = fileURLToPath(new URL('../', import.meta.url));
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
requireApi('dotenv').config({ path: resolve(workspace, '.env'), quiet: true });
const requirePg = createRequire(import.meta.resolve('embedded-postgres'));
const bin = resolve(dirname(requirePg.resolve('@embedded-postgres/windows-x64')), '../native/bin');
const data = resolve(workspace, 'work/harness/mvp-implementation/postgres-local');
const quote = value => `'${value.replaceAll("'", "''")}'`;
function run(binary, args) {
  return new Promise((done, reject) => {
    const command = `$pgChild = Start-Process -FilePath ${quote(binary)} -ArgumentList ${quote(args.map(arg => `"${arg}"`).join(' '))} -WindowStyle Hidden -PassThru; $pgChild.WaitForExit(); exit $pgChild.ExitCode`;
    const child = spawn('rtk', ['proxy', 'powershell', '-NoProfile', '-Command', command], { windowsHide: true, stdio: 'ignore' });
    child.on('error', () => reject(new Error('LOCAL_POSTGRES_START_FAILED')));
    child.on('exit', code => code === 0 ? done() : reject(new Error('LOCAL_POSTGRES_START_FAILED')));
  });
}
async function main() {
  if (process.platform !== 'win32') throw new Error('USE_DOCKER_ON_THIS_PLATFORM');
  if (!process.env.LOCAL_DB_PASSWORD || !process.env.DATABASE_URL) throw new Error('RUN_SETUP_LOCAL_FIRST');
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/agentfit' || url.username !== 'agentfit') throw new Error('LOCAL_DATABASE_ONLY');
  const action = process.argv[2] ?? 'start';
  if (action === 'stop') { await run(resolve(bin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop']); console.info('Local PostgreSQL stopped; files preserved.'); return; }
  if (action !== 'start') throw new Error('SUPPORTED_ACTIONS_START_STOP');
  const exists = await access(resolve(data, 'PG_VERSION')).then(() => true, () => false);
  if (!exists) {
    await mkdir(data, { recursive: true });
    const passwordFile = `${data}.initial-password`;
    await writeFile(passwordFile, process.env.LOCAL_DB_PASSWORD, { mode: 0o600 });
    try { await run(resolve(bin, 'initdb.exe'), ['-D', data, '-U', 'agentfit', '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', `--pwfile=${passwordFile}`]); }
    finally { await unlink(passwordFile); }
  }
  const running = await run(resolve(bin, 'pg_ctl.exe'), ['-D', data, 'status']).then(() => true, () => false);
  if (!running) await run(resolve(bin, 'pg_ctl.exe'), ['-D', data, '-l', resolve(data, 'server.log'), '-o', '-h 127.0.0.1 -p 5433', '-w', 'start']);
  const client = new Client({ host: '127.0.0.1', port: 5433, user: 'agentfit', password: process.env.LOCAL_DB_PASSWORD, database: 'postgres' });
  await client.connect();
  try { if (!(await client.query('SELECT 1 FROM pg_database WHERE datname = $1', ['agentfit'])).rowCount) await client.query('CREATE DATABASE agentfit'); }
  finally { await client.end(); }
  console.info('PostgreSQL 17.10 ready on 127.0.0.1:5433; run API migrations next.');
}
try { await main(); } catch (error) {
  console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'LOCAL_DATABASE_NOT_READY');
  process.exitCode = 1;
}
