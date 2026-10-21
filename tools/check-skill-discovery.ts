// Read-only public provider probe; synthetic needs only, no installs or user projects.
import { PublicSkillSource } from '../apps/api/src/skills/source';
import { writeFile } from 'node:fs/promises';
const source = new PublicSkillSource();
const reports: unknown[] = [];
for (const query of ['payment integration testing', 'retrieval augmented generation']) {
  const signal = AbortSignal.timeout(60000);
  try {
    const candidates = await source.search(query, signal);
    const packages: unknown[] = [];
    for (const candidate of candidates.slice(0, 3)) {
      try { const value = await source.inspect(candidate, signal); packages.push({ id: value.id, status: 'PACKAGE_CHECKED', license: value.license, files: value.files.map(x => x.path), hash: value.hash, commit: value.commit }); }
      catch (error) { packages.push({ id: candidate.id, status: 'BLOCKED', code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'SOURCE_ERROR' }); }
    }
    reports.push({ query, candidates: candidates.map(x => x.id), packages });
  } catch { reports.push({ query, status: 'SEARCH_FAILED' }); }
}
await writeFile('work/harness/recommendation-discovery/public-probe.json', JSON.stringify(reports, null, 2));
console.info(JSON.stringify(reports));
