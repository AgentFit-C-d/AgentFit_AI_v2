import { validateRecommendationInput, validateProfile, SKILL_RECOMMENDATION_MIN_SCORE, SKILL_OPTIONAL_MIN_SCORE, type ConfirmedProfile, type DeveloperProfile, type EnvironmentProfile, type RecommendationBasis, type RecommendationDto, type RecommendationResult } from '@agentfit/contracts';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { AppError } from '../http/errors';
import { loadCatalog, compatible } from './catalog';
import type { CatalogResolver } from '../skills/catalog';
import { basisOf, lockOwnedProject, validatePublic } from './profiles';
import { recommend } from './engine';
export function sameBasis(a: RecommendationBasis, b: RecommendationBasis) { return a.projectVersion === b.projectVersion && a.developerVersion === b.developerVersion && a.environmentVersion === b.environmentVersion && a.catalogRevision === b.catalogRevision; }
function dto(row: { id: string; basis: Prisma.JsonValue; result: Prisma.JsonValue; createdAt: Date }, current: RecommendationBasis): RecommendationDto {
  const basis = row.basis as unknown as RecommendationBasis;
  return { ...(row.result as unknown as RecommendationResult), id: row.id, basis, validity: sameBasis(basis, current) ? 'CURRENT' : 'STALE', createdAt: row.createdAt.toISOString() };
}
export class RecommendationService {
  constructor(private readonly db: PrismaClient, private readonly catalog = loadCatalog, private readonly secrets: readonly string[] = [], private readonly resolveCatalog?: CatalogResolver) {}
  async create(owner: string, id: string, input: unknown): Promise<RecommendationDto> {
    const { expectedVersions } = validatePublic(validateRecommendationInput, input, this.secrets);
    return this.db.$transaction(async tx => {
      const project = await lockOwnedProject(tx, owner, id);
      if (!project.confirmedProfile) throw new AppError('PROFILE_CONFIRMATION_REQUIRED', 422);
      const now = new Date(); const base = this.catalog(); const catalog = this.resolveCatalog ? await this.resolveCatalog(tx, project, base, now) : base; const basis = basisOf(project, catalog.revision);
      if (basis.projectVersion !== expectedVersions.project || basis.developerVersion !== expectedVersions.developer || basis.environmentVersion !== expectedVersions.environment) throw new AppError('VERSION_CONFLICT', 409);
      const confirmed = project.confirmedProfile as unknown as ConfirmedProfile;
      const environment = (project.environmentProfile?.data ?? null) as EnvironmentProfile | null;
      const result: RecommendationResult & { discoveryId?: string } = recommend({ profile: validateProfile(confirmed.profile), developer: (project.developerProfile?.data ?? null) as DeveloperProfile | null, environment }, { ...catalog, items: catalog.items.filter(x => x.verificationStatus !== 'PACKAGE_CHECKED') });
      if ('discoveryResult' in catalog && catalog.discoveryResult && environment && environment.installedComponents !== null && !result.questions.length) {
        const discovery = catalog.discoveryResult; result.discoveryId = catalog.discoveryId;
        result.items.forEach(x => { x.category = x.required ? 'PROJECT' : 'COMMON'; });
        for (const match of discovery.matches) {
          if (match.score < SKILL_OPTIONAL_MIN_SCORE) continue;
          const item = catalog.items.find(x => x.id === match.candidateId || x.package?.id === match.candidateId);
          if (!item || environment.installedComponents.some(x => x.catalogItemId === item.id && x.version === item.version)) continue;
          const matrix = compatible(item, environment, now); if (!matrix) continue;
          const existing = result.items.find(x => x.catalogItemId === item.id);
          if (existing) { if (existing.required && match.score < SKILL_RECOMMENDATION_MIN_SCORE) continue; existing.category = 'PROJECT'; existing.reason = match.reason; existing.matchScore = match.score; continue; }
          result.items.push({ catalogItemId: item.id, catalogVersion: item.version, supportMatrixId: matrix.id, category: 'PROJECT', required: false, matchScore: match.score, reason: match.reason + ' 해당 기능을 개발할 때 선택할 수 있는 지침입니다.', permissionOptions: [], authenticationRequirements: [], ...(item.package ? { tool: { name: item.name, skillsUrl: item.skillsUrl, license: item.license, risk: item.risk, verification: 'PACKAGE_CHECKED' as const, actualUse: 'NOT_RUN' as const, checkedAt: item.package.checkedAt, expiresAt: item.package.expiresAt, artifactHash: item.package.hash } } : {}) });
        }
        for (const need of discovery.needs) if (!result.capabilities.some(x => x.id === `discovery-${need.id}`)) result.capabilities.push({ id: `discovery-${need.id}`, name: need.name, reason: '확인한 기능·업무에서 도출한 개발 필요입니다.', sourceFields: need.sourceFields });
        if (result.items.length) result.status = 'RECOMMENDED';
        result.reasons.push('기능별 후보는 원본 내용의 적합도와 패키지 검사로 선정했습니다. 패키지 검사 통과는 실제 Codex 사용·전체 조합 검증을 뜻하지 않습니다.');
      }
      const value = await tx.recommendation.create({ data: { projectId: id, basis: basis as unknown as Prisma.InputJsonValue, result: result as unknown as Prisma.InputJsonValue } });
      return dto(value, basis);
    }, { timeout: 5000 });
  }
  async latest(owner: string, id: string): Promise<RecommendationDto | null> {
    return this.db.$transaction(async tx => {
      const project = await lockOwnedProject(tx, owner, id);
      const value = await tx.recommendation.findFirst({ where: { projectId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
      const base = this.catalog(); const catalog = this.resolveCatalog ? await this.resolveCatalog(tx, project, base, new Date()) : base;
      return value ? dto(value, basisOf(project, catalog.revision)) : null;
    }, { timeout: 5000 });
  }
}
