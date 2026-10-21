import { validatePreviewInput, validateApprovalInput, validateExportInput, validateReportInput, type Preview, type PreviewInput, type RecommendationDto, type RecommendationBasis, type ConfigurationHistoryEntry, type EnvironmentProfile, type UserConfigurationReport } from '@agentfit/contracts';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { AppError } from '../http/errors';
import { loadCatalog, compatible } from '../recommendations/catalog';
import { basisOf, lockOwnedProject, validatePublic } from '../recommendations/profiles';
import { sameBasis } from '../recommendations/service';
import { checkSelection } from './permissions';
import { buildPreview, GENERATOR_VERSION } from './preview';
import { zipFiles } from './zip';
import type { CatalogResolver } from '../skills/catalog';
type Metadata = Omit<Preview, 'files'> & { files: Omit<Preview['files'][number], 'content' | 'diff'>[] };
function metadata(preview: Preview): Metadata { return { ...preview, files: preview.files.map(({ content: _content, diff: _diff, ...file }) => file) }; }
const json = (value: unknown) => value as Prisma.InputJsonValue;
export class ConfigurationService {
  constructor(private readonly db: PrismaClient, private readonly catalog = loadCatalog, private readonly secrets: readonly string[] = [], private readonly now = () => new Date(), private readonly resolveCatalog?: CatalogResolver) {}
  private async projectCatalog(tx: Prisma.TransactionClient, project: Awaited<ReturnType<typeof lockOwnedProject>>) { const base = this.catalog(this.now()); return this.resolveCatalog ? this.resolveCatalog(tx, project, base, this.now()) : base; }
  private async selection(tx: Prisma.TransactionClient, owner: string, id: string, input: PreviewInput) {
    const project = await lockOwnedProject(tx, owner, id); const catalog = await this.projectCatalog(tx, project); const basis = basisOf(project, catalog.revision);
    if (!sameBasis(basis, input.expectedBasis)) throw new AppError('CONFIGURATION_STALE', 409);
    const rec = await tx.recommendation.findFirst({ where: { id: input.recommendationId, projectId: id } });
    if (!rec) throw new AppError('RECOMMENDATION_NOT_FOUND', 404);
    const recommendation = { ...(rec.result as unknown as RecommendationDto), id: rec.id, basis: rec.basis as unknown as RecommendationBasis, validity: 'CURRENT' as const, createdAt: rec.createdAt.toISOString() };
    const selection = checkSelection(recommendation, catalog, input);
    const environment = project.environmentProfile?.data as EnvironmentProfile | undefined;
    if (!environment || selection.items.some(item => compatible(item, environment, this.now())?.id !== recommendation.items.find(x => x.catalogItemId === item.id)!.supportMatrixId)) throw new AppError('UNSUPPORTED_SELECTION', 422);
    return { basis, selection };
  }
  private async livePreview(tx: Prisma.TransactionClient, owner: string, id: string, previewId: string, fingerprint: string) {
    const project = await lockOwnedProject(tx, owner, id);
    const row = await tx.configPreview.findFirst({ where: { id: previewId, projectId: id } });
    if (!row) throw new AppError('PREVIEW_NOT_FOUND', 404);
    if (row.expiresAt.getTime() <= this.now().getTime()) throw new AppError('PREVIEW_EXPIRED', 410);
    const value = row.metadata as unknown as Metadata;
    if (value.fingerprint !== fingerprint || value.generatorVersion !== GENERATOR_VERSION || !sameBasis(value.basis, basisOf(project, (await this.projectCatalog(tx, project)).revision))) throw new AppError('CONFIGURATION_STALE', 409);
    return { row, value };
  }
  async preview(owner: string, projectId: string, raw: unknown): Promise<Preview> {
    const input = validatePublic(validatePreviewInput, raw, this.secrets);
    return this.db.$transaction(async tx => {
      const { basis, selection } = await this.selection(tx, owner, projectId, input);
      const preview = buildPreview(basis, input, selection, this.now());
      validatePublic(value => value, preview.files, this.secrets);
      await tx.configPreview.create({ data: { id: preview.id, projectId, metadata: json(metadata(preview)), createdAt: new Date(preview.createdAt), expiresAt: new Date(preview.expiresAt) } });
      return preview;
    }, { timeout: 5000 });
  }
  async approve(owner: string, projectId: string, raw: unknown) {
    const input = validatePublic(validateApprovalInput, raw, this.secrets);
    return this.db.$transaction(async tx => {
      const { row } = await this.livePreview(tx, owner, projectId, input.previewId, input.previewFingerprint);
      const approval = await tx.configApproval.create({ data: { projectId, previewId: row.id, fingerprint: input.previewFingerprint, expiresAt: row.expiresAt, approvedAt: this.now() } });
      return { id: approval.id, previewId: approval.previewId, fingerprint: approval.fingerprint, approvedAt: approval.approvedAt.toISOString(), expiresAt: approval.expiresAt.toISOString() };
    }, { timeout: 5000 });
  }
  async export(owner: string, projectId: string, raw: unknown) {
    const input = validatePublic(validateExportInput, raw, this.secrets);
    const regenerated = await this.db.$transaction(async tx => {
      await this.livePreview(tx, owner, projectId, input.previewId, input.previewFingerprint);
      const { basis, selection } = await this.selection(tx, owner, projectId, input.input);
      const preview = buildPreview(basis, input.input, selection, this.now());
      if (preview.fingerprint !== input.previewFingerprint) throw new AppError('CONFIGURATION_CHANGED', 409);
      validatePublic(value => value, preview.files, this.secrets);
      return preview;
    }, { timeout: 5000 });
    const bytes = zipFiles(regenerated.files);
    const configuration = await this.db.$transaction(async tx => {
      const { value } = await this.livePreview(tx, owner, projectId, input.previewId, input.previewFingerprint);
      const approval = await tx.configApproval.findFirst({ where: { id: input.approvalId, projectId, previewId: input.previewId } });
      if (!approval) throw new AppError('APPROVAL_NOT_FOUND', 404);
      if (approval.expiresAt.getTime() <= this.now().getTime()) throw new AppError('PREVIEW_EXPIRED', 410);
      if (approval.fingerprint !== regenerated.fingerprint || value.fingerprint !== regenerated.fingerprint) throw new AppError('CONFIGURATION_CHANGED', 409);
      return tx.configuration.create({ data: { projectId, metadata: json({ basis: value.basis, fingerprint: value.fingerprint, generatorVersion: value.generatorVersion, approvalId: approval.id, previewId: input.previewId, files: value.files.map(({ relativePath, action, afterHash }) => ({ relativePath, action, afterHash })) }), createdAt: this.now() } });
    }, { timeout: 5000 });
    return { bytes, configurationId: configuration.id };
  }
  async history(owner: string, projectId: string, query: unknown): Promise<{ entries: ConfigurationHistoryEntry[]; nextCursor: string | null }> {
    const { limit, cursor } = historyQuery(query);
    return this.db.$transaction(async tx => {
      const project = await lockOwnedProject(tx, owner, projectId); const basis = basisOf(project, (await this.projectCatalog(tx, project)).revision);
      const rows = await tx.configuration.findMany({ where: { projectId, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}) }, take: limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], include: { reports: { take: 1, orderBy: [{ reportedAt: 'desc' }, { id: 'desc' }] } } });
      const page = rows.slice(0, limit); const last = page.at(-1);
      return { entries: page.map(row => {
        const value = row.metadata as unknown as { basis: RecommendationBasis; fingerprint: string; generatorVersion: string; files: ConfigurationHistoryEntry['files'] }; const report = row.reports[0];
        return { id: row.id, createdAt: row.createdAt.toISOString(), status: 'GENERATED', basis: value.basis, fingerprint: value.fingerprint, validity: sameBasis(value.basis, basis) && value.generatorVersion === GENERATOR_VERSION ? 'CURRENT' : 'STALE', files: value.files, verification: { status: 'NOT_RUN', source: 'NONE' }, latestUserReport: report ? { reportedState: report.reportedState as UserConfigurationReport['reportedState'], reasonCode: report.reasonCode as UserConfigurationReport['reasonCode'], source: 'USER', reportedAt: report.reportedAt.toISOString() } : null };
      }), nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null };
    }, { timeout: 5000 });
  }
  async report(owner: string, projectId: string, configurationId: string, raw: unknown) {
    const input = validatePublic(validateReportInput, raw, this.secrets);
    return this.db.$transaction(async tx => {
      await lockOwnedProject(tx, owner, projectId);
      if (!await tx.configuration.findFirst({ where: { id: configurationId, projectId } })) throw new AppError('CONFIGURATION_NOT_FOUND', 404);
      const report = await tx.configurationReport.create({ data: { projectId, configurationId, ...input, reportedAt: this.now() } });
      return { ...input, source: 'USER' as const, reportedAt: report.reportedAt.toISOString() };
    }, { timeout: 5000 });
  }
}
function historyQuery(value: unknown): { limit: number; cursor: { createdAt: Date; id: string } | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_INPUT', 422);
  const query = value as Record<string, unknown>;
  if (Object.keys(query).some(x => x !== 'limit' && x !== 'cursor') || (query.limit !== undefined && (typeof query.limit !== 'string' || !/^(?:[1-9][0-9]?|100)$/.test(query.limit)))) throw new AppError('INVALID_INPUT', 422);
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (query.cursor === undefined) return { limit, cursor: null };
  try {
    if (typeof query.cursor !== 'string' || query.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
    const cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
    if (!cursor || Object.keys(cursor).sort().join(',') !== 'createdAt,id' || typeof cursor.id !== 'string' || !/^[a-f0-9-]{36}$/.test(cursor.id) || typeof cursor.createdAt !== 'string' || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error();
    return { limit, cursor: { id: cursor.id, createdAt: new Date(cursor.createdAt) } };
  } catch { throw new AppError('INVALID_INPUT', 422); }
}
