import { mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sources = [
  { repo: 'vercel-labs/agent-skills', commit: '063bee94c3f4df8453406c830b0a7df0f2860278', folders: ['skills/react-best-practices', 'skills/composition-patterns', 'skills/web-design-guidelines', 'skills/react-native-skills'] },
  { repo: 'prisma/skills', commit: 'be16a8740d01363d13552b317042431ee8dfc581', folders: ['prisma-cli', 'prisma-client-api', 'prisma-compute', 'prisma-database-setup', 'prisma-driver-adapter-implementation', 'prisma-mongodb-upgrade', 'prisma-orm-setup', 'prisma-postgres-setup', 'prisma-postgres', 'prisma-upgrade-v7'] },
  { repo: 'better-auth/skills', commit: '20c9e88a5c007461a703f1c213572b073196113e', folders: ['better-auth/best-practices', 'security'] },
];
const root = new URL('../packages/catalog/', import.meta.url);
await mkdir(new URL('snapshots/', root), { recursive: true });
if (await access(new URL('sources.json', root)).then(() => true, () => false)) throw new Error('SNAPSHOT_ALREADY_FROZEN');
async function get(url, json = false) {
  const response = await fetch(url, { headers: { 'User-Agent': 'AgentFit-Catalog-Review' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`PUBLIC_SOURCE_HTTP_${response.status}`);
  const content = await response.text();
  if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('SOURCE_TOO_LARGE');
  return json ? JSON.parse(content) : content;
}
const manifest = [];
for (const source of sources) {
  const tree = await get(`https://api.github.com/repos/${source.repo}/git/trees/${source.commit}?recursive=1`, true);
  const licensePath = tree.tree.find(x => x.path === 'LICENSE');
  const licenseContent = licensePath ? await get(`https://raw.githubusercontent.com/${source.repo}/${source.commit}/LICENSE`) : null;
  for (const folder of source.folders) {
    const main = await get(`https://raw.githubusercontent.com/${source.repo}/${source.commit}/${folder}/SKILL.md`);
    const name = main.match(/^name:\s*["']?([^\r\n"']+)/m)?.[1].trim();
    if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error('INVALID_SKILL_NAME');
    const id = `${source.repo.split('/')[0]}-${name}`;
    const paths = tree.tree.filter(x => x.type === 'blob' && x.path.startsWith(folder + '/') && /\.md$/i.test(x.path));
    if (paths.length > 200) throw new Error('SOURCE_TOO_MANY_FILES');
    const files = [];
    for (const entry of paths) {
      const content = entry.path === `${folder}/SKILL.md` ? main : await get(`https://raw.githubusercontent.com/${source.repo}/${source.commit}/${entry.path}`);
      files.push({ path: entry.path.slice(folder.length + 1), content, sha256: createHash('sha256').update(content).digest('hex') });
    }
    if (licenseContent) files.push({ path: 'LICENSE.txt', content: licenseContent, sha256: createHash('sha256').update(licenseContent).digest('hex') });
    const snapshot = { id, name, repository: source.repo, commit: source.commit, sourcePath: folder, license: main.match(/^license:\s*(.+)$/m)?.[1].trim() ?? (licenseContent?.startsWith('MIT') ? 'MIT' : 'UNKNOWN'), licenseEvidence: licenseContent ? 'REPOSITORY_LICENSE' : 'SKILL_FRONTMATTER_ONLY', files };
    const data = JSON.stringify(snapshot, null, 2) + '\n';
    await writeFile(new URL(`snapshots/${id}.json`, root), data);
    manifest.push({ id, name, repository: source.repo, commit: source.commit, sourcePath: folder, skillsUrl: `https://www.skills.sh/${source.repo}/${name}`, license: snapshot.license, licenseEvidence: snapshot.licenseEvidence, snapshotSha256: createHash('sha256').update(data).digest('hex'), fileCount: files.length, snapshotBytes: Buffer.byteLength(data) });
    console.log(JSON.stringify({ id, files: files.length, bytes: Buffer.byteLength(data), license: snapshot.license, licenseEvidence: snapshot.licenseEvidence }));
  }
}
await writeFile(new URL('sources.json', root), JSON.stringify({ frozenAt: new Date().toISOString(), sources: manifest }, null, 2) + '\n');
