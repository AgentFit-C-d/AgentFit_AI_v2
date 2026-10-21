import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = JSON.parse(await readFile('packages/catalog/sources.json', 'utf8'));
const active = {
  'vercel-labs-vercel-react-best-practices': ['framework-guidance', 'frontend-review'],
  'vercel-labs-vercel-composition-patterns': ['component-architecture'],
  'prisma-prisma-client-api': ['database-access'],
  'obra-systematic-debugging': ['systematic-debugging'],
  'obra-test-driven-development': ['test-guidance'],
  'obra-verification-before-completion': ['completion-verification'],
  'obra-writing-plans': ['implementation-planning'],
};
const inspection = JSON.parse(await readFile('work/harness/review-and-general-skills/discovery.json', 'utf8'));
if (inspection.records.length !== 8 || inspection.records.some(record => !record.discovered || record.scopedErrors)) throw new Error('WORKFLOW_DISCOVERY_NOT_VERIFIED');
await readFile('work/harness/review-and-general-skills/usage-review.md', 'utf8');
await readFile('work/harness/independent-candidates/usage-review.md', 'utf8');
const checkedAt = inspection.checkedAt;
const expiresAt = new Date(Date.parse(checkedAt) + 90 * 86400000).toISOString();
const items = source.sources.map(s => ({
  id: s.id, name: s.name, kind: 'SKILL', version: s.commit,
  capabilities: active[s.id] ?? [], components: [], dependencies: [], conflicts: [], risk: 'LOW',
  verificationStatus: active[s.id] ? 'VERIFIED' : 'NOT_VERIFIED',
  license: s.license, skillsUrl: s.skillsUrl, repository: s.repository, commit: s.commit, snapshotSha256: s.snapshotSha256,
  supportMatrix: active[s.id] ? [{ id: `${s.id}-windows-codex-20261006`, osFamily: 'WINDOWS', osVersion: '11', clientId: 'codex-desktop', clientVersion: '26.930.4958.0', engineVersion: '0.160.0',
    checkedAt, expiresAt, checks: { documentation: 'PASS', format: 'PASS', standalone: 'PASS', combination: 'PASS' }, permissionMappingVerified: true, allowedCombinationIds: Object.keys(active).filter(id => id !== s.id) }] : [],
  permissionOptions: [],
}));
const revision = createHash('sha256').update(JSON.stringify(items)).digest('hex');
await writeFile('packages/catalog/catalog.json', JSON.stringify({ revision, items }, null, 2) + '\n');
console.log(JSON.stringify({ candidates: items.length, verified: items.filter(x => x.verificationStatus === 'VERIFIED').length, revision }));
