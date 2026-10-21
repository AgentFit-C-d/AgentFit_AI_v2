import { validateAnalysisResult, type ConfirmedProfile, type ProfilePatch } from '@agentfit/contracts';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import type { ProjectRecord, ProjectRepository } from './service';
import { AppError } from '../http/errors';
import { assertDraftMatch, resolveReview } from './profile';
import { attemptRecord } from '../analysis/prisma-repository';
import { attemptDto } from '../analysis/ports';
const include = { drafts: { orderBy: { createdAt: 'desc' as const }, take: 1 }, attempts: { orderBy: { createdAt: 'desc' as const }, take: 1, include: { upload: true, draft: true } } };
function record(value: Prisma.ProjectGetPayload<{ include: typeof include }>): ProjectRecord {
  const draft = value.drafts[0];
  return { ...value, confirmedProfile: value.confirmedProfile as unknown as ConfirmedProfile | null, draft: draft ? { id: draft.id, version: draft.version, result: validateAnalysisResult(draft.result) } : null, activeAttempt: value.attempts[0] ? attemptDto(attemptRecord(value.attempts[0])) : null };
}
export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(ownerId: string, name: string) { return record(await this.db.project.create({ data: { ownerId, name }, include })); }
  async list(ownerId: string) { return (await this.db.project.findMany({ where: { ownerId, deletingAt: null }, orderBy: { createdAt: 'desc' }, include })).map(record); }
  async findOwned(ownerId: string, id: string): Promise<ProjectRecord | null> { const value = await this.db.project.findFirst({ where: { id, ownerId, deletingAt: null }, include }); return value ? record(value) : null; }
  async saveProfile(ownerId: string, id: string, patch: ProfilePatch): Promise<ProjectRecord> {
    return this.db.$transaction(async tx => {
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${id} AND "ownerId" = ${ownerId} AND "deletingAt" IS NULL FOR UPDATE`);
      if (!locked.length) throw new AppError('PROJECT_NOT_FOUND', 404);
      const value = await tx.project.findFirst({ where: { id, ownerId }, include });
      if (!value) throw new AppError('PROJECT_NOT_FOUND', 404);
      if (value.version !== patch.expectedVersion) throw new AppError('VERSION_CONFLICT', 409);
      const current = record(value);
      assertDraftMatch(current.draft ?? null, patch);
      const confirmed = resolveReview(current.confirmedProfile, current.draft?.result ?? null, patch);
      const updated = await tx.project.updateMany({ where: { id, ownerId, version: patch.expectedVersion }, data: { confirmedProfile: confirmed as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      if (updated.count !== 1) throw new AppError('VERSION_CONFLICT', 409);
      await tx.profileAudit.create({ data: { projectId: id, version: patch.expectedVersion + 1, draftId: patch.draftId, confirmedAt: new Date(confirmed.confirmedAt), decisions: (patch.reviewDecisions ?? []).map(({ itemId, version, action }) => ({ itemId, version, action })) } });
      return record(await tx.project.findUniqueOrThrow({ where: { id }, include }));
    });
  }
}
