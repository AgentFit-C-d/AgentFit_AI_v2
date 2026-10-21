import type { ProjectProfile } from './profile.generated';
export type ProfileField = keyof ProjectProfile;
export type ProviderId = 'upstage' | 'nvidia' | 'solar';
export type EvidenceLocation = { documentId: string; start?: number; end?: number; page?: number };
export type FieldState = 'suggested' | 'unknown' | 'unresolved';
export interface TechnologyUsage { value: string; purpose: string; evidence: EvidenceLocation[] }
export interface AnalysisCandidate { id: string; version: number; field: ProfileField | null; proposedValue: string | string[] | null; status: FieldState; evidence: EvidenceLocation[]; usages?: TechnologyUsage[] }
export interface SecondaryReview { provider: 'nvidia' | 'solar'; model: string; status: 'COMPLETED' | 'FAILED' | 'SKIPPED_TIME' | 'SKIPPED_UNAVAILABLE' | 'SKIPPED_LIMIT'; targetCount: number; acceptedCount: number; latencyMs: number; errorCode?: string }
export interface AnalysisResult {
  schemaVersion: '1.0'; profile: ProjectProfile; fieldStates: Record<ProfileField, FieldState>; candidates: AnalysisCandidate[];
  questions: { id: string; field: ProfileField | null; message: string; itemIds: string[]; required: boolean }[];
  safeWarnings: string[]; modelMetadata: { provider: ProviderId; model: string; latencyMs: number; promptVersion: string; inputFormat: 'text' | 'canonical-pdf' | 'original-pdf'; secondaryReview?: SecondaryReview };
}
export type FieldSources = Record<ProfileField, { source: 'DOCUMENT' | 'USER' | 'UNKNOWN'; evidence: EvidenceLocation[] }>;
export interface ConfirmedProfile { profile: ProjectProfile; sources: FieldSources; confirmedAt: string }
export interface ReviewDecision { itemId: string; version: number; action: 'ACCEPT' | 'EDIT' | 'REJECT' | 'DEFER'; editedValue?: string | string[] | null }
export interface ProfilePatch { expectedVersion: number; profile: ProjectProfile; draftId?: string; draftVersion?: number; reviewDecisions?: ReviewDecision[] }
export interface ProjectDto { id: string; name: string; version: number; createdAt: string; updatedAt: string; confirmedProfile: ConfirmedProfile | null; draft: { id: string; version: number; result: AnalysisResult } | null; activeAttempt: AttemptDto | null }
export interface AttemptDto { id: string; projectId: string; status: 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; createdAt: string; deadline: string; finishedAt: string | null; errorCode: string | null; draft: { id: string; version: number; result: AnalysisResult } | null }
export interface SessionUser { id: string; name: string; image?: string | null }
export type AnalysisInput = { kind: 'text'; text: string } | { kind: 'upload'; uploadId: string };
export interface UploadMetadata { kind: 'pdf' | 'markdown' | 'text'; size: number; contentType: string }
export interface InputRef { uploadId: string; storage: 'local' | 'vercel'; objectKey: string; expiresAt: string }
export interface UploadGrant { uploadId: string; storage: 'local' | 'vercel'; objectKey: string; expiresAt: string; uploadUrl: string }
export interface AnalyzeRequest { attemptId: string; leaseId: string; inputRef: InputRef; provider: ProviderId; deadline: string; documentId: string; inputKind: UploadMetadata['kind'] }
