import { randomUUID } from 'node:crypto';
import type { ProjectRecord, ProjectRepository } from '../../apps/api/src/projects/service';
import type { ProfilePatch } from '../../packages/contracts/src';
import { assertDraftMatch, resolveReview } from '../../apps/api/src/projects/profile';
import { AppError } from '../../apps/api/src/http/errors';
export class MemoryProjectRepository implements ProjectRepository {
  records = new Map<string, ProjectRecord>();
  async create(ownerId: string, name: string): Promise<ProjectRecord> {
    const value: ProjectRecord = { id: randomUUID(), ownerId, name, version: 1, createdAt: new Date(), updatedAt: new Date(), confirmedProfile: null };
    this.records.set(value.id, value); return value;
  }
  async list(ownerId: string): Promise<ProjectRecord[]> { return [...this.records.values()].filter(p => p.ownerId === ownerId); }
  async findOwned(ownerId: string, id: string): Promise<ProjectRecord | null> { const value = this.records.get(id); return value?.ownerId === ownerId ? value : null; }
  async saveProfile(ownerId: string, id: string, patch: ProfilePatch): Promise<ProjectRecord> {
    const value = this.records.get(id);
    if (!value || value.ownerId !== ownerId) throw new AppError('PROJECT_NOT_FOUND', 404);
    if (value.version !== patch.expectedVersion) throw new AppError('VERSION_CONFLICT', 409);
    assertDraftMatch(value.draft ?? null, patch);
    value.confirmedProfile = resolveReview(value.confirmedProfile, value.draft?.result ?? null, patch);
    value.version++; value.updatedAt = new Date();
    return value;
  }
}
