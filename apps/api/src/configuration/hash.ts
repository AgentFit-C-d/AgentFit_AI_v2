import { createHash } from 'node:crypto';
import type { PreviewFile, PreviewInput, RecommendationBasis } from '@agentfit/contracts';
export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export function fingerprintPreview(basis: RecommendationBasis, input: PreviewInput, files: PreviewFile[], generatorVersion: string) {
  const sortedPolicies = [...input.permissionPolicies].sort((a, b) => { const x = JSON.stringify([a.catalogItemId, a.key, a.resourceScope, a.mappingId]); const y = JSON.stringify([b.catalogItemId, b.key, b.resourceScope, b.mappingId]); return x < y ? -1 : x > y ? 1 : 0; });
  const selectionDigest = sha256(JSON.stringify({ basis: { projectVersion: basis.projectVersion, developerVersion: basis.developerVersion, environmentVersion: basis.environmentVersion, catalogRevision: basis.catalogRevision }, recommendationId: input.recommendationId, selectedToolIds: [...input.selectedToolIds].sort(), policies: sortedPolicies.map(p => ({ catalogItemId: p.catalogItemId, key: p.key, resourceScope: p.resourceScope, mappingId: p.mappingId, policy: p.policy })), existingState: input.existingState }));
  const contentDigest = sha256(JSON.stringify([...files].sort((a, b) => a.relativePath < b.relativePath ? -1 : 1).map(f => ({ targetKey: f.targetKey, relativePath: f.relativePath, action: f.action, beforeHash: f.beforeHash, afterHash: f.afterHash }))));
  return { selectionDigest, contentDigest, fingerprint: sha256(JSON.stringify({ selectionDigest, contentDigest, generatorVersion })) };
}
