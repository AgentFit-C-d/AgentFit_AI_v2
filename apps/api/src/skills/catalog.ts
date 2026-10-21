import type { Prisma } from '../generated/prisma/client';
import type { CatalogSnapshot, CatalogItem } from '../recommendations/catalog';
import { basisOf } from '../recommendations/profiles';
import { sameBasis } from '../recommendations/service';
import { checkPackage, hash, type SkillPackage } from './package';
import type { SkillNeed, SkillMatch, RecommendationBasis } from '@agentfit/contracts';
export interface DiscoveryResult { needs: SkillNeed[]; checks: { candidateId: string; name: string; status: 'PASS' | 'BLOCKED'; code: string }[]; artifactIds: string[]; matches: SkillMatch[] }
export interface ResolvedCatalog extends CatalogSnapshot { discoveryId?: string; discoveryResult?: DiscoveryResult }
export type CatalogResolver = (tx: Prisma.TransactionClient, project: { id: string; version: number; developerProfile: { version: number } | null; environmentProfile: { version: number } | null }, base: CatalogSnapshot, now: Date) => Promise<ResolvedCatalog>;
export const artifactItemId = (artifact: SkillPackage) => `discovered-${artifact.hash}`;
export const resolveProjectCatalog: CatalogResolver = async (tx, project, base, now) => {
  const basis = basisOf(project, base.revision);
  const recent = await tx.skillDiscovery.findMany({ where: { projectId: project.id, status: 'SUCCEEDED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
  const discovery = recent.find(x => sameBasis(x.basis as unknown as RecommendationBasis, basis));
  if (!discovery) return base;
  const result = discovery.result as unknown as DiscoveryResult;
  const rows = await tx.skillArtifact.findMany({ where: { id: { in: result.artifactIds } } });
  const items: CatalogItem[] = [];
  for (const row of rows) {
    if (row.expiresAt <= now || row.checkedAt > now) continue;
    const data = row.package as unknown as SkillPackage;
    try {
      const checked = checkPackage(data.id, data.commit, data.files.map(x => ({ path: x.path, content: x.content })), row.checkedAt);
      if (checked.hash !== row.id || data.hash !== row.id || data.files.some(x => x.sha256 !== hash(x.content))) continue;
      const match = result.matches.find(x => x.candidateId === data.id); if (!match) continue;
      items.push({ id: artifactItemId(checked), name: checked.name, kind: 'SKILL', version: checked.commit, capabilities: [], components: [], dependencies: [], conflicts: [], risk: 'MEDIUM', verificationStatus: 'PACKAGE_CHECKED', license: checked.license, skillsUrl: `https://skills.sh/${checked.id}`, repository: checked.repository, commit: checked.commit, snapshotSha256: checked.hash, supportMatrix: [], permissionOptions: [], package: { ...checked, expiresAt: row.expiresAt.toISOString() }, projectMatch: match });
    } catch { /* Invalid immutable snapshot never becomes selectable. */ }
  }
  const revision = hash(JSON.stringify({ base: base.revision, discovery: discovery.id, artifacts: items.map(x => x.snapshotSha256).sort(), matches: result.matches }));
  return { revision, items: [...base.items, ...items], discoveryId: discovery.id, discoveryResult: result };
};
