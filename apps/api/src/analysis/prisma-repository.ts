import { validateAnalysisResult, type AnalysisResult, type ProviderId } from '@agentfit/contracts';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { randomUUID } from 'node:crypto';
import type { AttemptRepository, AttemptRecord } from './ports';
import { uploadRecord } from '../storage/prisma-uploads';
import { AppError } from '../http/errors';
const include = { upload: true, draft: true } as const;
export function attemptRecord(value: Prisma.AnalysisAttemptGetPayload<{ include: typeof include }>): AttemptRecord {
  const input = uploadRecord(value.upload);
  return { ...value, inputRef: input.ref, metadata: input.metadata, draft: value.draft ? { id: value.draft.id, version: value.draft.version, result: validateAnalysisResult(value.draft.result) } : null };
}
const record = attemptRecord;
async function scheduleCleanup(tx: Prisma.TransactionClient, uploadId: string, now: Date) { await tx.jobOutbox.create({ data: { kind: 'cleanup', targetId: uploadId, dueAt: now } }); }
export class PrismaAttemptRepository implements AttemptRepository {
  constructor(private readonly db: PrismaClient) {}
  async start(owner: string, project: string, upload: string, provider: ProviderId, now: Date): Promise<AttemptRecord> {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT true AS locked FROM pg_advisory_xact_lock(90133701)`);
      const owned = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${project} AND "ownerId" = ${owner} AND "deletingAt" IS NULL FOR UPDATE`);
      if (!owned.length) throw new AppError('PROJECT_NOT_FOUND', 404);
      const active = { status: { in: ['QUEUED', 'PROCESSING'] as ('QUEUED' | 'PROCESSING')[] }, deadline: { gt: now } };
      if (await tx.analysisAttempt.count({ where: { projectId: project, ...active } })) throw new AppError('ANALYSIS_ALREADY_RUNNING', 409);
      if (await tx.analysisAttempt.count({ where: { ownerId: owner, ...active } })) throw new AppError('USER_ANALYSIS_LIMIT', 429);
      if (await tx.analysisAttempt.count({ where: active }) >= 2) throw new AppError('GLOBAL_ANALYSIS_LIMIT', 429);
      const deadline = new Date(now.getTime() + 180_000);
      const available = await tx.upload.updateMany({ where: { id: upload, ownerId: owner, projectId: project, state: 'READY', expiresAt: { gt: deadline } }, data: { state: 'CLAIMED' } });
      if (available.count !== 1) throw new AppError('UPLOAD_NOT_READY', 409);
      const created = await tx.analysisAttempt.create({ data: { ownerId: owner, projectId: project, uploadId: upload, provider, createdAt: now, deadline }, include });
      await tx.jobOutbox.createMany({ data: [{ kind: 'analyze', targetId: created.id, dueAt: now }, { kind: 'expire', targetId: created.id, dueAt: deadline }] });
      return record(created);
    });
  }
  async getOwned(owner: string, project: string, id: string): Promise<AttemptRecord | null> {
    const value = await this.db.analysisAttempt.findFirst({ where: { id, projectId: project, ownerId: owner, project: { ownerId: owner, deletingAt: null } }, include }); return value ? record(value) : null;
  }
  async claim(id: string, now: Date): Promise<AttemptRecord | null> {
    return this.db.$transaction(async tx => {
      const leaseId = randomUUID();
      if ((await tx.analysisAttempt.updateMany({ where: { id, status: 'QUEUED', deadline: { gt: now }, project: { deletingAt: null } }, data: { status: 'PROCESSING', leaseId } })).count !== 1) return null;
      return record(await tx.analysisAttempt.findUniqueOrThrow({ where: { id }, include }));
    });
  }
  async expire(id: string, now: Date): Promise<void> {
    await this.db.$transaction(async tx => {
      const value = await tx.analysisAttempt.findUnique({ where: { id } }); if (!value) return;
      if ((await tx.analysisAttempt.updateMany({ where: { id, status: { in: ['QUEUED', 'PROCESSING'] }, deadline: { lte: now } }, data: { status: 'FAILED', finishedAt: now, errorCode: 'ANALYSIS_TIMEOUT' } })).count) await scheduleCleanup(tx, value.uploadId, now);
    });
  }
  async finish(id: string, lease: string, result: AnalysisResult, now: Date): Promise<boolean> {
    const validated = validateAnalysisResult(result);
    return this.db.$transaction(async tx => {
      const existing = await tx.analysisAttempt.findUnique({ where: { id } }); if (!existing) return false;
      const owned = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${existing.projectId} AND "deletingAt" IS NULL FOR UPDATE`);
      if (!owned.length) return false;
      if (validated.modelMetadata.provider !== existing.provider || validated.candidates.some(c => c.evidence.some(e => e.documentId !== id))) throw new AppError('INVALID_AI_RESPONSE');
      if ((await tx.analysisAttempt.updateMany({ where: { id, leaseId: lease, status: 'PROCESSING', deadline: { gt: now } }, data: { status: 'SUCCEEDED', finishedAt: now } })).count !== 1) return false;
      await tx.draft.create({ data: { projectId: existing.projectId, attemptId: id, result: validated as unknown as Prisma.InputJsonValue } });
      await scheduleCleanup(tx, existing.uploadId, now);
      return true;
    });
  }
  async fail(id: string, lease: string, code: string, now: Date): Promise<void> {
    await this.db.$transaction(async tx => {
      const value = await tx.analysisAttempt.findUnique({ where: { id } }); if (!value) return;
      if ((await tx.analysisAttempt.updateMany({ where: { id, leaseId: lease, status: 'PROCESSING' }, data: { status: 'FAILED', finishedAt: now, errorCode: code } })).count) await scheduleCleanup(tx, value.uploadId, now);
    });
  }
  async cancelOwned(owner: string, project: string, id: string, now: Date): Promise<AttemptRecord> {
    return this.db.$transaction(async tx => {
      const owned = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${project} AND "ownerId" = ${owner} AND "deletingAt" IS NULL FOR UPDATE`);
      if (!owned.length) throw new AppError('PROJECT_NOT_FOUND', 404);
      const value = await tx.analysisAttempt.findFirst({ where: { id, ownerId: owner, projectId: project }, include });
      if (!value) throw new AppError('ATTEMPT_NOT_FOUND', 404);
      if ((await tx.analysisAttempt.updateMany({ where: { id, status: { in: ['QUEUED', 'PROCESSING'] } }, data: { status: 'CANCELLED', finishedAt: now } })).count) await scheduleCleanup(tx, value.uploadId, now);
      return record(await tx.analysisAttempt.findUniqueOrThrow({ where: { id }, include }));
    });
  }
  async failQueued(id: string, code: string, now: Date): Promise<void> {
    await this.db.$transaction(async tx => {
      const value = await tx.analysisAttempt.findUnique({ where: { id } }); if (!value) return;
      if ((await tx.analysisAttempt.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'FAILED', finishedAt: now, errorCode: code } })).count) await scheduleCleanup(tx, value.uploadId, now);
    });
  }
}
