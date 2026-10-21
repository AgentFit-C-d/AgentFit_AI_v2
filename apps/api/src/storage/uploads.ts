import { validateUploadMetadata, type InputRef, type UploadGrant, type UploadMetadata } from '@agentfit/contracts';
import type { TemporaryInputStore } from './ports';
import { AppError } from '../http/errors';
import { validateInputBytes } from '../analysis/input';
export interface UploadRecord { ref: InputRef; metadata: UploadMetadata; ownerId: string; projectId: string | null; state: 'GRANTED' | 'UPLOADING' | 'READY' | 'CLAIMED' | 'DELETED' }
export interface UploadRepository {
  createAndSchedule(record: UploadRecord): Promise<void>;
  findOwned(ownerId: string, projectId: string, uploadId: string): Promise<UploadRecord | null>;
  find(uploadId: string): Promise<UploadRecord | null>;
  changeState(uploadId: string, previous: UploadRecord['state'], next: UploadRecord['state']): Promise<boolean>;
}
export class UploadService {
  constructor(private readonly store: TemporaryInputStore, private readonly repository: UploadRepository,
    private readonly ownsProject: (ownerId: string, projectId: string) => Promise<boolean>,
    private readonly publishCleanup: (uploadId: string) => Promise<void>, private readonly now = Date.now) {}
  async createUpload(ownerId: string, projectId: string, input: unknown): Promise<UploadGrant> {
    if (!await this.ownsProject(ownerId, projectId)) throw new AppError('PROJECT_NOT_FOUND', 404);
    const metadata = validateUploadMetadata(input);
    const ref = this.store.allocate(metadata);
    try {
      await this.repository.createAndSchedule({ ref, metadata, ownerId, projectId, state: 'GRANTED' });
      await this.publishCleanup(ref.uploadId);
      return { ...ref, uploadUrl: `/api/projects/${encodeURIComponent(projectId)}/uploads/${ref.uploadId}/${ref.storage === 'local' ? 'content' : 'blob'}` };
    } catch (error) { await this.store.delete(ref); throw error; }
  }
  async completeLocalUpload(ownerId: string, projectId: string, id: string, data: Uint8Array): Promise<void> {
    const record = await this.owned(ownerId, projectId, id);
    if (record.ref.storage !== 'local') throw new AppError('INVALID_UPLOAD_METHOD');
    await this.completeServerUpload(ownerId, projectId, id, data);
  }
  async completeServerUpload(ownerId: string, projectId: string, id: string, data: Uint8Array): Promise<void> {
    const record = await this.owned(ownerId, projectId, id);
    if (!await this.repository.changeState(id, 'GRANTED', 'UPLOADING')) throw new AppError('UPLOAD_ALREADY_COMPLETED', 409);
    try {
      await this.store.write(record.ref, data, record.metadata);
      if (!await this.repository.changeState(id, 'UPLOADING', 'READY')) throw new AppError('UPLOAD_UNAVAILABLE', 410);
    } catch (error) { await this.store.delete(record.ref); await this.repository.changeState(id, 'UPLOADING', 'DELETED'); throw error; }
  }
  async getOwnedReady(ownerId: string, projectId: string, id: string): Promise<UploadRecord> {
    const record = await this.owned(ownerId, projectId, id);
    if (record.state !== 'READY') throw new AppError('UPLOAD_NOT_READY', 409);
    return record;
  }
  async issueBlobOptions(ownerId: string, projectId: string, id: string, pathname: string, multipart: boolean) {
    const record = await this.owned(ownerId, projectId, id);
    if (record.ref.storage !== 'vercel' || pathname !== record.ref.objectKey || multipart) throw new AppError('INVALID_UPLOAD_PATH');
    if (!await this.repository.changeState(id, 'GRANTED', 'UPLOADING')) throw new AppError('UPLOAD_ALREADY_COMPLETED', 409);
    return { maximumSizeInBytes: record.metadata.size, allowedContentTypes: [record.metadata.contentType], validUntil: Date.parse(record.ref.expiresAt), allowOverwrite: false, addRandomSuffix: false, cacheControlMaxAge: 60, tokenPayload: id };
  }
  async completeBlob(id: string, pathname: string): Promise<void> {
    const record = await this.repository.find(id);
    if (!record && this.store.storage === 'vercel' && /^[0-9a-f-]{36}$/.test(id) && pathname === `inputs/${id}`) {
      await this.store.delete({ uploadId: id, storage: 'vercel', objectKey: pathname, expiresAt: new Date(this.now()).toISOString() }); return;
    }
    if (!record || record.ref.storage !== 'vercel' || record.ref.objectKey !== pathname) throw new AppError('INVALID_UPLOAD_PATH');
    if (record.state === 'READY' || record.state === 'CLAIMED') return;
    if (record.state === 'DELETED' || !record.projectId || Date.parse(record.ref.expiresAt) <= this.now() || !await this.ownsProject(record.ownerId, record.projectId)) {
      await this.store.delete(record.ref); await this.repository.changeState(id, record.state, 'DELETED'); return;
    }
    if (record.state !== 'UPLOADING') throw new AppError('INVALID_UPLOAD_STATE');
    try {
      const bytes = await this.store.read(record.ref);
      try { validateInputBytes(bytes, record.metadata); } finally { bytes.fill(0); }
      if (!await this.repository.changeState(id, 'UPLOADING', 'READY')) throw new AppError('UPLOAD_UNAVAILABLE', 410);
    } catch (error) { await this.store.delete(record.ref); await this.repository.changeState(id, 'UPLOADING', 'DELETED'); throw error; }
  }
  private async owned(ownerId: string, projectId: string, id: string) {
    const record = await this.repository.findOwned(ownerId, projectId, id);
    if (!record || !await this.ownsProject(ownerId, projectId)) throw new AppError('UPLOAD_NOT_FOUND', 404);
    if (Date.parse(record.ref.expiresAt) <= this.now() || record.state === 'DELETED') throw new AppError('UPLOAD_EXPIRED', 410);
    return record;
  }
}
