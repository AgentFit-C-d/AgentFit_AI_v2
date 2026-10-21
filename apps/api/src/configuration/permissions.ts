import type { PreviewInput, RecommendationDto } from '@agentfit/contracts';
import type { CatalogItem, CatalogSnapshot } from '../recommendations/catalog';
import { AppError } from '../http/errors';
import { sameBasis } from '../recommendations/service';
import type { SkillPackage } from '../skills/package';
export interface ValidatedSelection { items: CatalogItem[]; recommendation: RecommendationDto; snapshots?: SkillPackage[] }
export function checkSelection(recommendation: RecommendationDto, catalog: CatalogSnapshot, input: PreviewInput): ValidatedSelection {
  if (recommendation.id !== input.recommendationId || recommendation.status !== 'RECOMMENDED' || recommendation.validity !== 'CURRENT' || !sameBasis(recommendation.basis, input.expectedBasis) || catalog.revision !== input.expectedBasis.catalogRevision) throw new AppError('CONFIGURATION_STALE', 409);
  const items = input.selectedToolIds.map(id => {
    const recommended = recommendation.items.find(x => x.catalogItemId === id); const item = catalog.items.find(x => x.id === id);
    const matrix = item?.supportMatrix.find(x => x.id === recommended?.supportMatrixId);
    const packageChecked = item?.verificationStatus === 'PACKAGE_CHECKED' && item.package && recommended?.tool?.artifactHash === item.package.hash && recommended.supportMatrixId === `package-${item.package.hash}` && Date.parse(item.package.expiresAt) > Date.now() && Date.parse(item.package.checkedAt) <= Date.now() && item.kind === 'SKILL' && !item.permissionOptions.length && !item.dependencies.length && !item.conflicts.length;
    if (!recommended || !item || item.version !== recommended.catalogVersion || item.license === 'UNKNOWN' || (!packageChecked && (item.verificationStatus !== 'VERIFIED' || !matrix || Date.parse(matrix.expiresAt) <= Date.now() || Object.values(matrix.checks).some(x => x !== 'PASS') || !matrix.permissionMappingVerified))) throw new AppError('UNSUPPORTED_SELECTION', 422);
    // No unverified executable adapters are available in the pinned MVP catalog.
    if (item.kind !== 'SKILL' && item.kind !== 'RULES') throw new AppError('UNSUPPORTED_CONFIGURATION', 422);
    if (JSON.stringify(item.permissionOptions) !== JSON.stringify(recommended.permissionOptions)) throw new AppError('CONFIGURATION_STALE', 409);
    return item;
  });
  for (const item of items) {
    if (item.dependencies.some(id => !items.some(x => x.id === id)) || item.conflicts.some(id => items.some(x => x.id === id)) || item.components.some(id => items.some(x => x.id === id))) throw new AppError('SELECTION_CONFLICT', 422);
    const matrix = item.supportMatrix.find(x => x.id === recommendation.items.find(x => x.catalogItemId === item.id)!.supportMatrixId);
    if (items.some(other => other.id !== item.id && !(item.package || other.package) && !matrix?.allowedCombinationIds.includes(other.id))) throw new AppError('UNSUPPORTED_COMBINATION', 422);
    if (items.some(other => other.id !== item.id && (item.package || other.package) && (item.kind !== 'SKILL' || other.kind !== 'SKILL' || item.permissionOptions.length || other.permissionOptions.length))) throw new AppError('UNSUPPORTED_COMBINATION', 422);
  }
  const expected = items.flatMap(item => item.permissionOptions.map(option => ({ item, option })));
  if (expected.length !== input.permissionPolicies.length) throw new AppError('PERMISSION_REQUIRED', 422);
  const keys = new Set<string>();
  for (const policy of input.permissionPolicies) {
    const match = expected.find(x => x.item.id === policy.catalogItemId && x.option.key === policy.key && x.option.resourceScope === policy.resourceScope && x.option.mapping === policy.mappingId);
    const key = JSON.stringify([policy.catalogItemId, policy.key, policy.resourceScope]);
    if (!match || keys.has(key) || !match.option.supportedPolicies.includes(policy.policy)) throw new AppError('UNSUPPORTED_PERMISSION', 422);
    keys.add(key);
    if (policy.policy === 'DENY' && recommendation.items.find(x => x.catalogItemId === policy.catalogItemId)!.required) throw new AppError('REQUIRED_PERMISSION_DENIED', 422);
  }
  return { items, recommendation, snapshots: items.flatMap(x => x.package ? [x.package] : []) };
}
