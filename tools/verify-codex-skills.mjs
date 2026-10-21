import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const selected = ['vercel-labs-vercel-react-best-practices', 'vercel-labs-vercel-composition-patterns', 'prisma-prisma-client-api', 'obra-systematic-debugging', 'obra-test-driven-development', 'obra-verification-before-completion', 'obra-writing-plans'];
const snapshots = await Promise.all(selected.map(async id => JSON.parse(await readFile(`packages/catalog/snapshots/${id}.json`, 'utf8'))));
const generated = process.argv.includes('--generated');
const fixtureRoot = resolve(generated ? 'work/harness/configuration/codex-discovery' : 'work/harness/review-and-general-skills/codex-discovery');
async function fixture(label, items) {
  const cwd = resolve(fixtureRoot, label);
  for (const item of items) for (const file of item.files) {
    if (!/^[a-zA-Z0-9_.\-/]+$/.test(file.path) || file.path.split('/').includes('..')) throw new Error('UNSAFE_SNAPSHOT_PATH');
    const path = resolve(cwd, '.agents/skills', item.name, file.path);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, file.content);
  }
  return { cwd, names: items.map(x => x.name) };
}
const fixtures = [];
if (generated) fixtures.push({ cwd: resolve(fixtureRoot, 'generated'), names: [...snapshots.map(x => x.name), 'agentfit-verification-guide'] });
else { for (const item of snapshots) fixtures.push(await fixture(item.id, [item])); fixtures.push(await fixture('combination', snapshots)); }
const child = spawn('rtk', ['proxy', 'codex', 'app-server'], { cwd: fixtureRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map(); let sequence = 0;
child.stderr.on('data', () => {});
child.on('error', () => { for (const promise of pending.values()) promise.reject(new Error('CLIENT_UNAVAILABLE')); });
createInterface({ input: child.stdout }).on('line', line => {
  let message; try { message = JSON.parse(line); } catch { return; }
  if (message.id && pending.has(message.id)) { const promise = pending.get(message.id); pending.delete(message.id); clearTimeout(promise.timer); if (message.error) promise.reject(new Error('CLIENT_RPC_REJECTED')); else promise.resolve(message.result); }
});
function request(method, params) { return new Promise((resolveResult, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error('CLIENT_RPC_TIMEOUT')); }, 30000); pending.set(id, { resolve: resolveResult, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); }); }
try {
  await request('initialize', { clientInfo: { name: 'agentfit_catalog_verification', version: '0.1.0' } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const records = [];
  for (const test of fixtures) {
    const result = await request('skills/list', { cwds: [test.cwd], forceReload: true });
    const entry = result.data.find(x => resolve(x.cwd) === test.cwd);
    const names = entry?.skills.filter(x => x.enabled && x.path.toLowerCase().startsWith(test.cwd.toLowerCase()) && test.names.includes(x.name)).map(x => x.name).sort() ?? [];
    records.push({ label: test.cwd.slice(fixtureRoot.length + 1), expectedNames: test.names.sort(), discoveredNames: names, discovered: JSON.stringify(names) === JSON.stringify(test.names.sort()), scopedErrors: entry?.errors.filter(x => x.path.toLowerCase().startsWith(test.cwd.toLowerCase())).length ?? 0 });
  }
  const report = { checkedAt: new Date().toISOString(), engineVersion: '0.160.0', discoveryMethod: 'app-server skills/list; no thread or model turn', records, standaloneUsage: 'NOT_RUN', combinationUsage: 'NOT_RUN' };
  await writeFile(resolve(fixtureRoot, '../discovery.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { child.stdin.end(); child.kill(); }
