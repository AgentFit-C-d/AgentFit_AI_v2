import { del, get, put, BlobNotFoundError } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { validateUploadMetadata, type InputRef, type UploadMetadata } from '@agentfit/contracts';
import { AppError } from '../http/errors';
import { validateInputBytes } from '../analysis/input';
import { MAX_UPLOAD_BYTES, type TemporaryInputStore } from './ports';
export interface BlobPort { get: typeof get; put: typeof put; del: typeof del }
export class PrivateBlobStore implements TemporaryInputStore {
  readonly storage = 'vercel' as const;
  constructor(private readonly token: string, private readonly sdk: BlobPort = { get, put, del }, private readonly now = Date.now) { if (!token) throw new AppError('BLOB_NOT_CONFIGURED', 503); }
  allocate(metadata: UploadMetadata): InputRef {
    validateUploadMetadata(metadata); const uploadId = randomUUID();
    return { uploadId, storage: 'vercel', objectKey: `inputs/${uploadId}`, expiresAt: new Date(this.now() + 9 * 60_000).toISOString() };
  }
  async write(ref: InputRef, data: Uint8Array, metadata: UploadMetadata) {
    this.check(ref); validateInputBytes(data, metadata);
    await this.sdk.put(ref.objectKey, Buffer.from(data), { token: this.token, access: 'private', contentType: metadata.contentType, addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 });
  }
  async put(data: Uint8Array, metadata: UploadMetadata) {
    const ref = this.allocate(metadata);
    try { await this.write(ref, data, metadata); return ref; } catch (error) { await this.delete(ref); throw error; }
  }
  async read(ref: InputRef): Promise<Uint8Array> {
    this.check(ref);
    const result = await this.sdk.get(ref.objectKey, { access: 'private', useCache: false, token: this.token });
    if (!result || result.statusCode !== 200) throw new AppError('INPUT_UNAVAILABLE', 410);
    if (result.blob.pathname !== ref.objectKey || result.blob.size > MAX_UPLOAD_BYTES) { await result.stream.cancel(); throw new AppError('INVALID_BLOB'); }
    const reader = result.stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_UPLOAD_BYTES) { await reader.cancel(); throw new AppError('FILE_TOO_LARGE'); }
      chunks.push(next.value);
    }
    const output = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    if (size !== result.blob.size) throw new AppError('SIZE_MISMATCH');
    return output;
  }
  async delete(ref: InputRef) {
    this.check(ref, false);
    try { await this.sdk.del(ref.objectKey, { token: this.token }); } catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
  }
  private check(ref: InputRef, expiry = true) {
    if (ref.storage !== 'vercel' || !/^[0-9a-f-]{36}$/.test(ref.uploadId) || ref.objectKey !== `inputs/${ref.uploadId}` || !Number.isFinite(Date.parse(ref.expiresAt)) || (expiry && Date.parse(ref.expiresAt) <= this.now())) throw new AppError('INPUT_UNAVAILABLE', 410);
  }
}
