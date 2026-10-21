import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { Client } from 'pg';
import { createDatabase } from '../../apps/api/src/db';
function run(binary: string, args: string[]): Promise<void> {
  return new Promise((done, reject) => {
    // Windows background postgres inherits pipe handles from pg_ctl. Launch through
    // Hidden Start-Process so RTK does not wait for the server's inherited output.
    const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
    const command = `$pgChild = Start-Process -FilePath ${quote(binary)} -ArgumentList ${quote(args.map(s => `"${s}"`).join(' '))} -WindowStyle Hidden -PassThru; $pgChild.WaitForExit(); exit $pgChild.ExitCode`;
    const child = spawn('rtk', ['proxy', 'powershell', '-NoProfile', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostic = '';
    child.stdout.on('data', data => { diagnostic = (diagnostic + data.toString()).slice(-2000); });
    child.stderr.on('data', data => { diagnostic = (diagnostic + data.toString()).slice(-2000); });
    child.on('error', () => reject(new Error('POSTGRES_PROCESS_UNAVAILABLE')));
    child.on('exit', code => code === 0 ? done() : reject(new Error(`POSTGRES_PROCESS_FAILED_${code}: ${diagnostic}`)));
  });
}
export async function testDatabase() {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_PORT_UNAVAILABLE');
  const port = address.port;
  await new Promise<void>(done => server.close(() => done()));
  const password = randomBytes(32).toString('hex');
  const databaseDir = resolve(`work/harness/mvp-implementation/postgres-tests/${randomUUID()}`);
  if (process.platform !== 'win32') throw new Error('WINDOWS_TEST_DB_ONLY');
  const require = createRequire(import.meta.resolve('embedded-postgres'));
  const bin = resolve(dirname(require.resolve('@embedded-postgres/windows-x64')), '../native/bin');
  await mkdir(databaseDir, { recursive: true });
  const passwordFile = `${databaseDir}.initial-password`;
  await writeFile(passwordFile, password, { mode: 0o600 });
  try { await run(resolve(bin, 'initdb.exe'), ['-D', databaseDir, '-U', 'agentfit_test', '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', `--pwfile=${passwordFile}`]); }
  finally { await unlink(passwordFile); }
  await run(resolve(bin, 'pg_ctl.exe'), ['-D', databaseDir, '-l', resolve(databaseDir, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  const options = { user: 'agentfit_test', password, host: '127.0.0.1', port };
  const admin = new Client({ ...options, database: 'postgres' });
  await admin.connect();
  await admin.query('CREATE DATABASE agentfit_test');
  await admin.end();
  const sql = new Client({ ...options, database: 'agentfit_test' });
  await sql.connect();
  const migrationRoot = resolve('apps/api/prisma/migrations');
  for (const dir of (await readdir(migrationRoot, { withFileTypes: true })).filter(d => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await sql.query(await readFile(resolve(migrationRoot, dir.name, 'migration.sql'), 'utf8'));
  }
  await sql.end();
  const databaseUrl = `postgresql://agentfit_test:${password}@127.0.0.1:${port}/agentfit_test`;
  const db = createDatabase(databaseUrl);
  return { db, databaseUrl, stop: async () => { await db.$disconnect(); await run(resolve(bin, 'pg_ctl.exe'), ['-D', databaseDir, '-m', 'fast', '-w', 'stop']); } };
}
