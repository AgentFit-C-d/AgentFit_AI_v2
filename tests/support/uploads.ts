import type { UploadRecord, UploadRepository } from '../../apps/api/src/storage/uploads';
export class MemoryUploadRepository implements UploadRepository {
  records = new Map<string, UploadRecord>();
  scheduled: string[] = [];
  async createAndSchedule(value: UploadRecord) { this.records.set(value.ref.uploadId, structuredClone(value)); this.scheduled.push(value.ref.uploadId); }
  async findOwned(ownerId: string, projectId: string, uploadId: string) { const record = this.records.get(uploadId); return record?.ownerId === ownerId && record.projectId === projectId ? record : null; }
  async find(uploadId: string) { return this.records.get(uploadId) ?? null; }
  async changeState(uploadId: string, previous: UploadRecord['state'], next: UploadRecord['state']) {
    const record = this.records.get(uploadId); if (!record || record.state !== previous) return false; record.state = next; return true;
  }
}
