export interface JobMessage { outboxId: string; kind: 'analyze' | 'expire' | 'cleanup' | 'purge' | 'delete' | 'discover' | 'discover_expire'; targetId: string }
export interface QueueOptions { notBefore: string; idempotencyKey: string }
export interface QueuePort { publish(message: JobMessage, options: QueueOptions): Promise<void> }
