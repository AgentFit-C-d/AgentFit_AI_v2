import { expect, test, vi } from 'vitest';
import { CleanupService } from '../../apps/api/src/storage/cleanup';
import { LocalInputStore } from '../../apps/api/src/storage/local-store';
import { MemoryUploadRepository } from '../support/uploads';
test('cleans completed work immediately and expiry without a browser', async () => {
  const store = new LocalInputStore(() => 0); const repository = new MemoryUploadRepository();
  const metadata = { kind: 'text' as const, size: 5, contentType: 'text/plain' };
  const ref = await store.put(new TextEncoder().encode('Hello'), metadata);
  await repository.createAndSchedule({ ref, metadata, ownerId: 'alice', projectId: null, state: 'READY' });
  const service = new CleanupService(repository, store, () => 1000);
  expect(await service.cleanupUpload(ref.uploadId)).toBe(false);
  expect(await service.cleanupUpload(ref.uploadId, true)).toBe(true);
  await expect(store.read(ref)).rejects.toThrow('INPUT_UNAVAILABLE');
  expect(repository.records.get(ref.uploadId)?.state).toBe('DELETED');
});
test('retains retryable metadata on storage failure and retries deletion', async () => {
  const local = new LocalInputStore(() => 0); const repository = new MemoryUploadRepository();
  const metadata = { kind: 'text' as const, size: 5, contentType: 'text/plain' }; const ref = local.allocate(metadata);
  await repository.createAndSchedule({ ref, metadata, ownerId: 'alice', projectId: null, state: 'GRANTED' });
  const remove = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(undefined);
  const store = { storage: 'local' as const, allocate: local.allocate.bind(local), write: local.write.bind(local), put: local.put.bind(local), read: local.read.bind(local), delete: remove };
  const service = new CleanupService(repository, store, () => 600_000);
  await expect(service.cleanupUpload(ref.uploadId)).rejects.toThrow();
  expect(repository.records.get(ref.uploadId)?.state).toBe('GRANTED');
  await service.cleanupUpload(ref.uploadId); expect(repository.records.get(ref.uploadId)?.state).toBe('DELETED');
});

test('scheduled cleanup still deletes an opaque object after domain metadata is removed', async () => {
  const repository = new MemoryUploadRepository(); const local = new LocalInputStore();
  const remove = vi.fn(async () => {});
  const id = 'f414d04a-4684-471c-896a-58fc6a49c00d';
  const store = { ...local, storage: 'vercel' as const, allocate: local.allocate.bind(local), write: local.write.bind(local), put: local.put.bind(local), read: local.read.bind(local), delete: remove };
  await new CleanupService(repository, store).cleanupUpload(id, true);
  expect(remove).toHaveBeenCalledWith(expect.objectContaining({ uploadId: id, objectKey: `inputs/${id}`, storage: 'vercel' }));
});
