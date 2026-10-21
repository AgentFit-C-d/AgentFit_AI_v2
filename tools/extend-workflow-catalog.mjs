// Append reviewed public source snapshots; preserve all previously pinned sources.
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const repository = 'obra/superpowers';
const names = ['writing-plans'];
const root = new URL('../packages/catalog/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('sources.json', root), 'utf8'));
if (names.some(name => manifest.sources.some(source => source.id === `obra-${name}`))) throw new Error('WORKFLOW_SOURCES_ALREADY_FROZEN');
async function get(url, json = false) {
  const response = await fetch(url, { headers: { 'User-Agent': 'AgentFit-Catalog-Review' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`PUBLIC_SOURCE_HTTP_${response.status}`);
  const content = await response.text();
  if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('SOURCE_TOO_LARGE');
  return json ? JSON.parse(content) : content;
}
const head = await get(`https://api.github.com/repos/${repository}/commits/main`, true);
const commit = head.sha;
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('INVALID_COMMIT');
const tree = await get(`https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`, true);
const license = await get(`https://raw.githubusercontent.com/${repository}/${commit}/LICENSE`);
if (!/^MIT License/.test(license)) throw new Error('UNREVIEWED_LICENSE');
const appended = [];
for (const name of names) {
  const id = `obra-${name}`, folder = `skills/${name}`;
  if (await access(new URL(`snapshots/${id}.json`, root)).then(() => true, () => false)) throw new Error('SNAPSHOT_ALREADY_EXISTS');
  const paths = tree.tree.filter(entry => entry.type === 'blob' && entry.path.startsWith(folder + '/') && /\.md$/i.test(entry.path));
  if (!paths.some(entry => entry.path === `${folder}/SKILL.md`) || paths.length > 30) throw new Error('INVALID_SOURCE_FILES');
  const files = await Promise.all(paths.map(async entry => {
    const content = await get(`https://raw.githubusercontent.com/${repository}/${commit}/${entry.path}`);
    return { path: entry.path.slice(folder.length + 1), content, sha256: createHash('sha256').update(content).digest('hex') };
  }));
  const main = files.find(file => file.path === 'SKILL.md').content;
  if (main.match(/^name:\s*(.+)$/m)?.[1].trim() !== name) throw new Error('SKILL_NAME_MISMATCH');
  files.push({ path: 'LICENSE.txt', content: license, sha256: createHash('sha256').update(license).digest('hex') });
  const snapshot = { id, name, repository, commit, sourcePath: folder, license: 'MIT', licenseEvidence: 'REPOSITORY_LICENSE', files };
  const data = JSON.stringify(snapshot, null, 2) + '\n';
  await writeFile(new URL(`snapshots/${id}.json`, root), data);
  appended.push({ id, name, repository, commit, sourcePath: folder, skillsUrl: `https://www.skills.sh/${repository}/${name}`, license: 'MIT', licenseEvidence: 'REPOSITORY_LICENSE', snapshotSha256: createHash('sha256').update(data).digest('hex'), fileCount: files.length, snapshotBytes: Buffer.byteLength(data) });
}
manifest.sources.push(...appended);
await writeFile(new URL('sources.json', root), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ repository, commit, appended: appended.map(source => ({ id: source.id, fileCount: source.fileCount, bytes: source.snapshotBytes })), activation: 'NOT_VERIFIED' }));
