import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const allow = new Set(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'AI_SERVICE_TOKEN', 'API_INTERNAL_URL', 'UPSTAGE_API_KEY', 'BLOB_PRIVATE_ORIGIN', 'BLOB_READ_WRITE_TOKEN']);
export function aiEnvironment(environment) {
  return { ...Object.fromEntries(Object.entries(environment).filter(([key, value]) => allow.has(key) && typeof value === 'string')), PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
  require('dotenv').config({ path: new URL('../.env', import.meta.url), quiet: true });
  const child = spawn('rtk', ['proxy', 'uv', '--cache-dir', 'work/harness/mvp-implementation/uv-cache', 'run', '--project', 'apps/ai', 'uvicorn', 'agentfit_ai.main:app_factory', '--factory', '--app-dir', 'apps/ai', '--host', '127.0.0.1', '--port', '8000', '--no-access-log'], { env: aiEnvironment(process.env), stdio: 'inherit', shell: false, windowsHide: true });
  child.on('error', () => { process.stderr.write('AI_RUNTIME_NOT_READY\n'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}
