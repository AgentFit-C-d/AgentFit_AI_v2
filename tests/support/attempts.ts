import type { AnalysisResult, ProviderId } from '../../packages/contracts/src';
import type { AttemptRecord, AttemptRepository } from '../../apps/api/src/analysis/ports';
export function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return { id: 'a1', projectId: 'p1', ownerId: 'alice', provider: 'nvidia', status: 'QUEUED', createdAt: new Date(0), deadline: new Date(60_000), finishedAt: null, errorCode: null, leaseId: null, inputRef: { storage: 'local', uploadId: 'u1', objectKey: 'inputs/u1', expiresAt: new Date(9 * 60_000).toISOString() }, metadata: { kind: 'text', size: 5, contentType: 'text/plain' }, draft: null, ...overrides };
}
export class MemoryAttemptRepository implements AttemptRepository {
  record: AttemptRecord | null = attempt();
  async start(_owner: string, _project: string, _upload: string, _provider: ProviderId, _now: Date) { return this.record!; }
  async getOwned(owner: string, project: string, id: string) { const r = this.record; return r && r.ownerId === owner && r.projectId === project && r.id === id ? r : null; }
  async claim(id: string, now: Date) { const r = this.record; if (!r || r.id !== id || r.status !== 'QUEUED' || r.deadline <= now) return null; r.status = 'PROCESSING'; r.leaseId = 'l1'; return structuredClone(r); }
  async expire(id: string, now: Date) { const r = this.record; if (r && r.id === id && ['QUEUED', 'PROCESSING'].includes(r.status) && r.deadline <= now) { r.status = 'FAILED'; r.errorCode = 'ANALYSIS_TIMEOUT'; r.finishedAt = now; } }
  async finish(id: string, lease: string, result: AnalysisResult, now: Date) { const r = this.record; if (!r || r.id !== id || r.leaseId !== lease || r.status !== 'PROCESSING' || r.deadline <= now) return false; r.status = 'SUCCEEDED'; r.finishedAt = now; r.draft = { id: 'd1', version: 1, result }; return true; }
  async fail(id: string, lease: string, code: string, now: Date) { const r = this.record; if (r && r.id === id && r.leaseId === lease && r.status === 'PROCESSING') { r.status = 'FAILED'; r.errorCode = code; r.finishedAt = now; } }
  async failQueued(id: string, code: string, now: Date) { const r = this.record; if (r && r.id === id && r.status === 'QUEUED') { r.status = 'FAILED'; r.errorCode = code; r.finishedAt = now; } }
  async cancelOwned(_owner: string, _project: string, _id: string, now: Date) { const r = this.record!; r.status = 'CANCELLED'; r.finishedAt = now; return r; }
}
