import type { QueuePort, JobMessage, QueueOptions } from './queue-port';
import type { OutboxDispatcher } from './outbox';
import { validateInternal } from '@agentfit/contracts';
export class LocalQueue implements QueuePort {
  async publish(message: JobMessage, options: QueueOptions): Promise<void> {
    validateInternal('jobMessage', message); validateInternal('queueOptions', options);
    // The durable DB outbox is the local queue; acknowledgement is not completion.
  }
}
export class LocalWorkerLoop {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = new Set<string>();
  constructor(private readonly outbox: OutboxDispatcher) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch(() => {}); }, 500); this.timer.unref();
    void this.tick().catch(() => {});
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  async tick() {
    await this.outbox.publishPending();
    await Promise.allSettled((await this.outbox.ready()).map(async message => {
      if (this.running.has(message.outboxId)) return;
      this.running.add(message.outboxId);
      try { await this.outbox.process(message); } finally { this.running.delete(message.outboxId); }
    }));
  }
}
