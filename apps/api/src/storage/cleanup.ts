import type { TemporaryInputStore } from './ports';
import type { UploadRepository } from './uploads';
export class CleanupService {
  constructor(private readonly repository: UploadRepository, private readonly store: TemporaryInputStore, private readonly now = Date.now) {}
  async cleanupUpload(id: string, force = false): Promise<boolean> {
    const record = await this.repository.find(id);
    if (!record) {
      // Original expiry jobs remain after project metadata is cascaded. A late
      // Blob write must still be removed without retaining an owner or document.
      if (force && this.store.storage === 'vercel' && /^[0-9a-f-]{36}$/.test(id)) await this.store.delete({ uploadId: id, storage: 'vercel', objectKey: `inputs/${id}`, expiresAt: new Date(this.now()).toISOString() });
      return true;
    }
    if (!force && Date.parse(record.ref.expiresAt) > this.now()) return false;
    await this.store.delete(record.ref);
    await this.repository.changeState(id, record.state, 'DELETED');
    return true;
  }
}
