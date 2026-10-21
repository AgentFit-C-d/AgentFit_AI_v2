import { randomUUID } from 'node:crypto';
import type { QueueClient } from '@vercel/queue';
import type { PrismaClient } from '../generated/prisma/client';
import type { OutboxDispatcher } from './outbox';
import { AppError } from '../http/errors';
export class QueueRecovery {
  constructor(private readonly client: Pick<QueueClient, 'send'>, private readonly topic: string, private readonly now = Date.now) {}
  async schedule(): Promise<void> {
    await this.client.send(this.topic, { recoveryId: randomUUID() }, { delaySeconds: 30, retentionSeconds: 300, idempotencyKey: `recovery-${Math.floor(this.now() / 30000)}`, telemetry: { isEnabled: false } });
  }
  async process(input: unknown, db: PrismaClient, outbox: OutboxDispatcher): Promise<void> {
    if (!input || typeof input !== 'object' || Object.keys(input).length !== 1 || !('recoveryId' in input) || typeof input.recoveryId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.recoveryId)) throw new AppError('INVALID_QUEUE_MESSAGE', 403);
    const pending = await db.jobOutbox.count({ where: { completedAt: null, OR: [{ publishedAt: null }, { kind: { in: ['analyze', 'expire', 'delete', 'discover', 'discover_expire'] }, dueAt: { lte: new Date(this.now() + 90000) } }] } });
    // Schedule before recovery work so a crashed invocation has an independent successor.
    if (pending) await this.schedule();
    await outbox.publishPending();
    for (const message of await outbox.ready()) if (message.kind !== 'analyze' && message.kind !== 'discover') await outbox.process(message);
  }
}
