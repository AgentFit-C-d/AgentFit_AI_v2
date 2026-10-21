import { QueueClient } from '@vercel/queue';
import type { QueuePort, JobMessage, QueueOptions } from './queue-port';
import { validateInternal } from '@agentfit/contracts';
import { AppError } from '../http/errors';
export class VercelQueue implements QueuePort {
  constructor(private readonly topic: string, private readonly client: Pick<QueueClient, 'send'> = new QueueClient(), private readonly now = Date.now) {}
  async publish(message: JobMessage, options: QueueOptions): Promise<void> {
    validateInternal('jobMessage', message); validateInternal('queueOptions', options);
    const delay = Math.max(0, Math.ceil((Date.parse(options.notBefore) - this.now()) / 1000));
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(this.topic) || delay > 604200) throw new AppError('INVALID_QUEUE_CONFIGURATION', 503);
    await this.client.send(this.topic, message, { delaySeconds: delay, retentionSeconds: 604800, idempotencyKey: options.idempotencyKey, telemetry: { isEnabled: false } });
  }
}
