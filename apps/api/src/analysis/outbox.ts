import type { PrismaClient } from '../generated/prisma/client';
import type { QueuePort, JobMessage } from './queue-port';
import type { AnalysisWorker } from './worker';
import type { AttemptRepository } from './ports';
import type { CleanupService } from '../storage/cleanup';
import { validateInternal } from '@agentfit/contracts';
import { AppError } from '../http/errors';
import type { JobOutbox } from '../generated/prisma/client';
export class OutboxDispatcher {
  constructor(private readonly db: PrismaClient, private readonly queue: QueuePort,
    private readonly worker: AnalysisWorker, private readonly attempts: AttemptRepository,
    private readonly cleanup: CleanupService, private readonly now = Date.now,
    private readonly retention?: { purge(id: string, now: Date): Promise<void>; deletion(id: string): Promise<void>; discover?(id: string): Promise<void>; discoverExpire?(id: string): Promise<void> }) {}
  async publishTarget(targetId: string): Promise<void> {
    for (const job of await this.db.jobOutbox.findMany({ where: { targetId, publishedAt: null, completedAt: null } })) await this.publish(job);
  }
  async publishPending(): Promise<void> {
    for (const job of await this.db.jobOutbox.findMany({ where: { publishedAt: null, completedAt: null }, take: 50, orderBy: { dueAt: 'asc' } })) await this.publish(job);
  }
  async process(input: JobMessage): Promise<void> {
    const message = validateInternal<JobMessage>('jobMessage', input);
    const job = await this.db.jobOutbox.findUnique({ where: { id: message.outboxId } });
    if (!job || job.kind !== message.kind || job.targetId !== message.targetId) throw new AppError('INVALID_QUEUE_MESSAGE', 403);
    if (job.completedAt) return;
    if (job.dueAt.getTime() > this.now()) throw new AppError('JOB_NOT_DUE', 503);
    if (job.kind === 'analyze') await this.worker.processAttempt(job.targetId);
    else if (job.kind === 'expire') await this.attempts.expire(job.targetId, new Date(this.now()));
    else if (job.kind === 'cleanup') await this.cleanup.cleanupUpload(job.targetId, true);
    else if (!this.retention) throw new AppError('RETENTION_NOT_CONFIGURED', 503);
    else if (job.kind === 'purge') await this.retention.purge(job.targetId, new Date(this.now()));
    else if (job.kind === 'delete') await this.retention.deletion(job.targetId);
    else if (job.kind === 'discover' && this.retention.discover) await this.retention.discover(job.targetId);
    else if (job.kind === 'discover_expire' && this.retention.discoverExpire) await this.retention.discoverExpire(job.targetId);
    else throw new AppError('DISCOVERY_NOT_CONFIGURED', 503);
    await this.db.jobOutbox.updateMany({ where: { id: job.id, completedAt: null }, data: { completedAt: new Date(this.now()) } });
  }
  async ready(): Promise<JobMessage[]> {
    return (await this.db.jobOutbox.findMany({ where: { completedAt: null, dueAt: { lte: new Date(this.now()) } }, orderBy: { dueAt: 'asc' }, take: 20 })).map(job => ({ outboxId: job.id, kind: job.kind, targetId: job.targetId }));
  }
  private async publish(job: JobOutbox) {
    await this.queue.publish({ outboxId: job.id, kind: job.kind, targetId: job.targetId }, { notBefore: job.dueAt.toISOString(), idempotencyKey: job.id });
    await this.db.jobOutbox.updateMany({ where: { id: job.id, publishedAt: null }, data: { publishedAt: new Date(this.now()) } });
  }
}
