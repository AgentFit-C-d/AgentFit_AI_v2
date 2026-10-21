import { Prisma, type PrismaClient, type Upload } from '../generated/prisma/client';
import type { UploadRecord, UploadRepository } from './uploads';
import { AppError } from '../http/errors';
export function uploadRecord(value: Upload): UploadRecord {
  return { ownerId: value.ownerId, projectId: value.projectId, state: value.state, ref: { uploadId: value.id, storage: value.storage, objectKey: value.objectKey, expiresAt: value.expiresAt.toISOString() }, metadata: { kind: value.kind, size: value.size, contentType: value.contentType } };
}
export class PrismaUploadRepository implements UploadRepository {
  constructor(private readonly db: PrismaClient) {}
  async createAndSchedule(record: UploadRecord): Promise<void> {
    await this.db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${record.ownerId} FOR UPDATE`);
      const owned = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${record.projectId} AND "ownerId" = ${record.ownerId} AND "deletingAt" IS NULL FOR UPDATE`);
      if (!owned.length) throw new AppError('PROJECT_NOT_FOUND', 404);
      const pending = await tx.upload.count({ where: { ownerId: record.ownerId, state: { in: ['GRANTED', 'UPLOADING', 'READY', 'CLAIMED'] }, expiresAt: { gt: new Date() } } });
      if (pending >= 5) throw new AppError('UPLOAD_LIMIT', 429);
      await tx.upload.create({ data: { id: record.ref.uploadId, ownerId: record.ownerId, projectId: record.projectId, objectKey: record.ref.objectKey, storage: record.ref.storage, expiresAt: new Date(record.ref.expiresAt), ...record.metadata, state: record.state } });
      await tx.jobOutbox.create({ data: { kind: 'cleanup', targetId: record.ref.uploadId, dueAt: new Date(record.ref.expiresAt) } });
    });
  }
  async findOwned(owner: string, project: string, id: string): Promise<UploadRecord | null> { const value = await this.db.upload.findFirst({ where: { id, ownerId: owner, projectId: project } }); return value ? uploadRecord(value) : null; }
  async find(id: string): Promise<UploadRecord | null> { const value = await this.db.upload.findUnique({ where: { id } }); return value ? uploadRecord(value) : null; }
  async changeState(id: string, previous: UploadRecord['state'], next: UploadRecord['state']): Promise<boolean> {
    return (await this.db.upload.updateMany({ where: { id, state: previous, ...(next === 'READY' ? { project: { deletingAt: null }, projectId: { not: null }, expiresAt: { gt: new Date() } } : {}) }, data: { state: next } })).count === 1;
  }
}
