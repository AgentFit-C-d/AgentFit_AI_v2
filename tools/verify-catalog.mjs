import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sources = JSON.parse(await readFile('packages/catalog/sources.json', 'utf8'));
const catalog = JSON.parse(await readFile('packages/catalog/catalog.json', 'utf8'));
for (const source of sources.sources) {
  const bytes = await readFile(`packages/catalog/snapshots/${source.id}.json`);
  if (createHash('sha256').update(bytes).digest('hex') !== source.snapshotSha256) throw new Error('SNAPSHOT_HASH_MISMATCH');
  const snapshot = JSON.parse(bytes.toString());
  for (const file of snapshot.files) if (createHash('sha256').update(file.content).digest('hex') !== file.sha256) throw new Error('FILE_HASH_MISMATCH');
  const item = catalog.items.find(x => x.id === source.id);
  if (!item || item.commit !== source.commit || item.snapshotSha256 !== source.snapshotSha256 || !/^[a-f0-9]{40}$/.test(item.commit)) throw new Error('CATALOG_SOURCE_MISMATCH');
  if (item.verificationStatus === 'VERIFIED' && (item.license !== 'MIT' || !item.supportMatrix.length || item.supportMatrix.some(m => Object.values(m.checks).some(check => check !== 'PASS')))) throw new Error('UNVERIFIED_CATALOG_ENTRY');
}
console.log(JSON.stringify({ candidates: sources.sources.length, verified: catalog.items.filter(x => x.verificationStatus === 'VERIFIED').length, snapshotHashes: 'PASS', fileHashes: 'PASS' }));
