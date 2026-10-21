import { expect, test, vi } from 'vitest';
import { PrivateBlobStore, type BlobPort } from '../../apps/api/src/storage/private-blob';
function setup() {
  const get = vi.fn<BlobPort['get']>(); const put = vi.fn<BlobPort['put']>(); const del = vi.fn<BlobPort['del']>();
  const store = new PrivateBlobStore('server-only-test-token', { get, put, del }, () => 1000);
  const metadata = { kind: 'text' as const, size: 5, contentType: 'text/plain' };
  return { store, get, put, del, metadata };
}
test('only writes private opaque objects without overwrite and reads uncached private content', async () => {
  const { store, put, get, metadata } = setup();
  const ref = store.allocate(metadata);
  await store.write(ref, new TextEncoder().encode('Hello'), metadata);
  expect(put.mock.calls[0]![2]).toMatchObject({ access: 'private', allowOverwrite: false, addRandomSuffix: false, cacheControlMaxAge: 60 });
  get.mockResolvedValue({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('Hello')); controller.close(); } }), headers: new Headers(), blob: { pathname: ref.objectKey, size: 5, contentType: 'text/plain', url: '', downloadUrl: '', contentDisposition: '', cacheControl: '', uploadedAt: new Date(), etag: '' } });
  expect(new TextDecoder().decode(await store.read(ref))).toBe('Hello');
  expect(get.mock.calls[0]![1]).toMatchObject({ access: 'private', useCache: false });
  expect(JSON.stringify(ref)).not.toContain('server-only-test-token');
});
test('rejects arbitrary URLs and permits scoped cleanup after expiration', async () => {
  const { store, get, del, metadata } = setup();
  const ref = store.allocate(metadata);
  await expect(store.read({ ...ref, objectKey: 'https://evil.example/document' })).rejects.toThrow('INPUT_UNAVAILABLE');
  expect(get).not.toHaveBeenCalled();
  await store.delete({ ...ref, expiresAt: new Date(0).toISOString() });
  expect(del.mock.calls[0]![0]).toBe(ref.objectKey);
  await expect(store.delete({ ...ref, objectKey: '../../private' })).rejects.toThrow('INPUT_UNAVAILABLE');
});
