import { expect, test, vi } from 'vitest';
import { VercelQueue } from '../../apps/api/src/analysis/vercel-queue';
test('publishes only validated IDs with due delay and enough retention for diagnostic expiry', async () => {
  const send = vi.fn(async () => ({ messageId: 'sdk-message' }));
  const queue = new VercelQueue('agentfit-jobs', { send }, () => 1000);
  const message = { outboxId: 'outbox-1', kind: 'purge' as const, targetId: 'diagnostic-1' };
  await queue.publish(message, { notBefore: new Date(1000 + 604200000).toISOString(), idempotencyKey: 'outbox-1' });
  expect(send).toHaveBeenCalledWith('agentfit-jobs', message, expect.objectContaining({ delaySeconds: 604200, retentionSeconds: 604800, idempotencyKey: 'outbox-1', telemetry: { isEnabled: false } }));
  await expect(queue.publish({ ...message, raw: 'no original content' } as typeof message, { notBefore: new Date(1000).toISOString(), idempotencyKey: 'outbox-1' })).rejects.toThrow('INVALID_INTERNAL_INPUT');
  expect(send).toHaveBeenCalledOnce();
});
