import { expect, test, vi } from 'vitest';
import { QueueRecovery } from '../../apps/api/src/analysis/queue-recovery';
import type { PrismaClient } from '../../apps/api/src/generated/prisma/client';
import type { OutboxDispatcher } from '../../apps/api/src/analysis/outbox';
test('recovery rejects arbitrary payloads and schedules successor before durable pending work', async () => {
  const order: string[] = []; const send = vi.fn(async (_topic: string, _message: unknown, _options: unknown) => { order.push('schedule'); return {} as never; });
  const recovery = new QueueRecovery({ send }, 'recovery', () => 30000);
  const db = { jobOutbox: { count: async () => 1 } } as unknown as PrismaClient;
  const outbox = { publishPending: async () => { order.push('publish'); }, ready: async () => [] } as unknown as OutboxDispatcher;
  await expect(recovery.process({ recoveryId: 'x', raw: 'forbidden' }, db, outbox)).rejects.toMatchObject({ code: 'INVALID_QUEUE_MESSAGE' });
  expect(send).not.toHaveBeenCalled();
  await expect(recovery.process({ recoveryId: 'a'.repeat(36) }, db, outbox)).rejects.toMatchObject({ code: 'INVALID_QUEUE_MESSAGE' });
  await recovery.process({ recoveryId: '12345678-1234-4123-a123-123456789abc' }, db, outbox);
  expect(order).toEqual(['schedule', 'publish']);
  expect(send.mock.calls[0]?.[1]).toEqual({ recoveryId: expect.any(String) });
});
