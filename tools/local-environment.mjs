import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function prepareEnvironment(text, generate = () => randomBytes(32).toString('hex')) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values.set(match[1], match[2].replace(/^(['"])(.*)\1$/, '$2'));
  }
  const defaults = {
    LOCAL_DB_PASSWORD: values.get('LOCAL_DB_PASSWORD') || generate(),
    BETTER_AUTH_SECRET: values.get('BETTER_AUTH_SECRET') || generate(),
    AI_SERVICE_TOKEN: values.get('AI_SERVICE_TOKEN') || generate(),
    DIAGNOSTIC_ENCRYPTION_KEY: values.get('DIAGNOSTIC_ENCRYPTION_KEY') || generate(),
    WEB_ORIGIN: 'http://localhost:3000', API_PORT: '4000', API_INTERNAL_URL: 'http://127.0.0.1:4000',
    AI_SERVICE_URL: 'http://127.0.0.1:8000', RUNTIME_MODE: 'local', ANALYSIS_PROVIDER: 'solar',
    UPSTAGE_DEVELOPMENT_BUDGET_MICRO_USD: '20000000', UPSTAGE_PRICE_MICRO_USD_PER_PAGE: '44000',
  };
  defaults.DATABASE_URL = `postgresql://agentfit:${encodeURIComponent(defaults.LOCAL_DB_PASSWORD)}@127.0.0.1:5433/agentfit`;
  let result = text;
  for (const [key, value] of Object.entries(defaults)) {
    if (values.get(key)) continue;
    if (values.has(key)) result = result.replace(new RegExp(`^(\\s*(?:export\\s+)?${key}\\s*=).*?$`, 'm'), (_match, prefix) => prefix + value);
    else result += `${result.endsWith('\n') || !result ? '' : '\n'}${key}=${value}\n`;
  }
  return result;
}
async function main() {
  const path = new URL('../.env', import.meta.url);
  const original = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  await writeFile(path, prepareEnvironment(original), { mode: 0o600 });
  console.info('Local environment prepared; existing credentials preserved. Values are not printed.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
