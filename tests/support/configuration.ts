import { loadCatalog } from '../../apps/api/src/recommendations/catalog';
import type { PreviewInput, RecommendationDto } from '../../packages/contracts/src';
export function configFixture() {
  const catalog = loadCatalog();
  const item = catalog.items.find(x => x.verificationStatus === 'VERIFIED')!;
  const basis = { projectVersion: 2, developerVersion: 1, environmentVersion: 1, catalogRevision: catalog.revision };
  const recommendation: RecommendationDto = { id: 'rec-1', basis, validity: 'CURRENT', createdAt: new Date().toISOString(), status: 'RECOMMENDED', capabilities: [], items: [{ catalogItemId: item.id, catalogVersion: item.version, supportMatrixId: item.supportMatrix[0]!.id, required: true, reason: '합성', permissionOptions: [], authenticationRequirements: [] }], questions: [], reasons: [], evidenceLevel: 'ENVIRONMENT_DECLARED' };
  const input: PreviewInput = { recommendationId: recommendation.id, expectedBasis: basis, selectedToolIds: [item.id], permissionPolicies: [], existingState: 'UNKNOWN', existingFiles: [] };
  return { catalog, item, recommendation, input };
}
