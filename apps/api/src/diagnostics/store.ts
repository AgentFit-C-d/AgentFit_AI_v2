import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { createCipheriv, randomBytes } from 'node:crypto';
import { assertNoSecrets } from '@agentfit/contracts';
import { AppError } from '../http/errors';
const TTL = 7 * 86400000; const EARLY = 600000;
export class DiagnosticStore {
  constructor(private readonly db: PrismaClient, private readonly key: string, private readonly publish: (id: string) => Promise<void>, private readonly knownSecrets: readonly string[] = []) {
    if (!/^[0-9a-f]{64}$/i.test(key)) throw new AppError('DIAGNOSTICS_NOT_CONFIGURED', 503);
  }
  async saveFailureDiagnostic(attemptId: string, leaseId: string, raw: string | null, receivedAt: Date): Promise<void> {
    if (!raw || Buffer.byteLength(raw) > 524288 || !Number.isFinite(receivedAt.getTime())) return;
    try { assertNoSecrets(raw, this.knownSecrets); } catch { return; }
    const target = await this.db.$transaction(async tx => {
      const attempt = await tx.analysisAttempt.findUnique({ where: { id: attemptId } });
      if (!attempt || attempt.status !== 'PROCESSING' || attempt.leaseId !== leaseId || attempt.deadline <= receivedAt) return null;
      const owned = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${attempt.projectId} AND "deletingAt" IS NULL FOR UPDATE`);
      if (!owned.length) return null;
      // Locking the project also serializes deletion and repeat receipt.
      const latest = await tx.analysisAttempt.findFirst({ where: { id: attemptId, status: 'PROCESSING', leaseId, deadline: { gt: receivedAt } } });
      if (!latest || await tx.failureDiagnostic.findUnique({ where: { attemptId } })) return null;
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(this.key, 'hex'), iv);
      cipher.setAAD(Buffer.from(attemptId));
      const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
      const diagnostic = await tx.failureDiagnostic.create({ data: { attemptId, ciphertext, iv, authTag: cipher.getAuthTag(), receivedAt, expiresAt: new Date(receivedAt.getTime() + TTL) } });
      await tx.jobOutbox.create({ data: { kind: 'purge', targetId: diagnostic.id, dueAt: new Date(receivedAt.getTime() + TTL - EARLY) } });
      return diagnostic.id;
    });
    if (target) try { await this.publish(target); } catch { /* Durable outbox recovery; never log raw. */ }
  }
  async expireDiagnostic(id: string, now: Date): Promise<void> {
    await this.db.failureDiagnostic.deleteMany({ where: { id, expiresAt: { lte: new Date(now.getTime() + EARLY) } } });
  }
  async purgeExpiredDiagnostics(now: Date): Promise<number> {
    return (await this.db.failureDiagnostic.deleteMany({ where: { expiresAt: { lte: now } } })).count;
  }
}
