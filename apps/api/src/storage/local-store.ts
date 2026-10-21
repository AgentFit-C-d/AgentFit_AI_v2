import { validateUploadMetadata, type InputRef, type UploadMetadata } from '@agentfit/contracts';
import { randomUUID } from 'node:crypto';
import type { TemporaryInputStore } from './ports';
import { validateInputBytes } from '../analysis/input';
import { AppError } from '../http/errors';
export class LocalInputStore implements TemporaryInputStore {
  readonly storage = 'local' as const;
  private readonly entries = new Map<string, { ref: InputRef; metadata: UploadMetadata; bytes: Uint8Array | null }>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly now: () => number = Date.now) {
    this.timer = setInterval(() => { this.sweep(); }, 15_000); this.timer.unref();
  }
  allocate(input: UploadMetadata): InputRef {
    this.sweep();
    const metadata = validateUploadMetadata(input);
    const uploadId = randomUUID();
    const ref: InputRef = { uploadId, storage: 'local', objectKey: `inputs/${uploadId}`, expiresAt: new Date(this.now() + 9 * 60_000).toISOString() };
    this.entries.set(uploadId, { ref, metadata, bytes: null });
    return structuredClone(ref);
  }
  async write(ref: InputRef, data: Uint8Array, metadata: UploadMetadata) {
    const entry = this.entry(ref);
    if (entry.bytes) throw new AppError('UPLOAD_ALREADY_COMPLETED', 409);
    if (metadata.kind !== entry.metadata.kind || metadata.size !== entry.metadata.size || metadata.contentType !== entry.metadata.contentType) throw new AppError('UPLOAD_METADATA_MISMATCH');
    validateInputBytes(data, metadata);
    entry.bytes = new Uint8Array(data);
  }
  async put(data: Uint8Array, metadata: UploadMetadata) {
    const ref = this.allocate(metadata);
    try { await this.write(ref, data, metadata); return ref; } catch (error) { await this.delete(ref); throw error; }
  }
  async read(ref: InputRef): Promise<Uint8Array> {
    const entry = this.entry(ref);
    if (!entry.bytes) throw new AppError('INPUT_UNAVAILABLE', 410);
    return new Uint8Array(entry.bytes);
  }
  async delete(ref: InputRef) {
    const entry = this.entries.get(ref.uploadId);
    if (entry && entry.ref.objectKey === ref.objectKey) { entry.bytes?.fill(0); this.entries.delete(ref.uploadId); }
  }
  dispose() { clearInterval(this.timer); for (const entry of this.entries.values()) entry.bytes?.fill(0); this.entries.clear(); }
  private entry(ref: InputRef) {
    this.sweep();
    const entry = this.entries.get(ref.uploadId);
    if (!entry || ref.storage !== 'local' || entry.ref.objectKey !== ref.objectKey || entry.ref.expiresAt !== ref.expiresAt) throw new AppError('INPUT_UNAVAILABLE', 410);
    return entry;
  }
  private sweep() {
    for (const [id, entry] of this.entries) if (Date.parse(entry.ref.expiresAt) <= this.now()) { entry.bytes?.fill(0); this.entries.delete(id); }
  }
}
