import type { AnalysisResult, AnalyzeRequest, AttemptDto, ProviderId, InputRef, UploadMetadata } from '@agentfit/contracts';
export interface AttemptRecord {
  id: string; projectId: string; ownerId: string; provider: ProviderId; status: AttemptDto['status'];
  createdAt: Date; deadline: Date; finishedAt: Date | null; errorCode: string | null; leaseId: string | null;
  inputRef: InputRef; metadata: UploadMetadata; draft: AttemptDto['draft'];
}
export interface AttemptRepository {
  start(ownerId: string, projectId: string, uploadId: string, provider: ProviderId, now: Date): Promise<AttemptRecord>;
  getOwned(ownerId: string, projectId: string, id: string): Promise<AttemptRecord | null>;
  claim(id: string, now: Date): Promise<AttemptRecord | null>;
  expire(id: string, now: Date): Promise<void>;
  finish(id: string, leaseId: string, result: AnalysisResult, now: Date): Promise<boolean>;
  fail(id: string, leaseId: string, code: string, now: Date): Promise<void>;
  failQueued(id: string, code: string, now: Date): Promise<void>;
  cancelOwned(ownerId: string, projectId: string, id: string, now: Date): Promise<AttemptRecord>;
}
export interface AiPort { analyze(request: AnalyzeRequest): Promise<AnalysisResult> }
export function attemptDto(record: AttemptRecord): AttemptDto {
  return { id: record.id, projectId: record.projectId, status: record.status, createdAt: record.createdAt.toISOString(), deadline: record.deadline.toISOString(), finishedAt: record.finishedAt?.toISOString() ?? null, errorCode: record.errorCode, draft: record.draft };
}
