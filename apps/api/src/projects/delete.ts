import { Prisma, type PrismaClient } from '../generated/prisma/client';
import type { CleanupService } from '../storage/cleanup';
import { validateDeleteProject } from '@agentfit/contracts';
import { AppError } from '../http/errors';
export class DeleteProjectService {
  constructor(private readonly db: PrismaClient, private readonly cleanup: CleanupService, private readonly publish: (id: string) => Promise<void>) {}
  async deleteProject(owner: string, projectId: string, body: unknown): Promise<void> {
    validateDeleteProject(body);
    await this.db.$transaction(async tx => {
      const owned = await tx.$queryRaw<{ id: string; deletingAt: Date | null }[]>(Prisma.sql`SELECT "id", "deletingAt" FROM "Project" WHERE "id" = ${projectId} AND "ownerId" = ${owner} FOR UPDATE`);
      if (!owned.length) throw new AppError('PROJECT_NOT_FOUND', 404);
      if (owned[0]!.deletingAt) return;
      const now = new Date();
      await tx.project.update({ where: { id: projectId }, data: { deletingAt: now } });
      await tx.analysisAttempt.updateMany({ where: { projectId, status: { in: ['QUEUED', 'PROCESSING'] } }, data: { status: 'CANCELLED', finishedAt: now } });
      await tx.jobOutbox.create({ data: { kind: 'delete', targetId: projectId, dueAt: now } });
    });
    try { await this.publish(projectId); } catch { /* Durable authorization and outbox exist. */ }
    await this.resumeDelete(projectId);
  }
  async resumeDelete(projectId: string): Promise<void> {
    const project = await this.db.project.findUnique({ where: { id: projectId } });
    if (!project) return;
    if (!project.deletingAt) throw new AppError('DELETE_NOT_AUTHORIZED', 403);
    const uploads = await this.db.upload.findMany({ where: { projectId } });
    try { for (const upload of uploads) if (!await this.cleanup.cleanupUpload(upload.id, true)) throw new Error('CLEANUP_FAILED'); }
    catch { throw new AppError('DELETE_INCOMPLETE', 503); }
    await this.db.$transaction(async tx => {
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${projectId} AND "deletingAt" IS NOT NULL FOR UPDATE`);
      if (!locked.length) return;
      await tx.project.delete({ where: { id: projectId } });
      await tx.upload.deleteMany({ where: { id: { in: uploads.map(upload => upload.id) } } });
    });
  }
}
