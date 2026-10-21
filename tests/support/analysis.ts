import { emptyProfile, type AnalysisResult } from '../../packages/contracts/src';
export function analysisResult(documentId = 'doc-1'): AnalysisResult {
  const profile = { ...emptyProfile(), backend: ['Express.js'] };
  return { schemaVersion: '1.0', profile, fieldStates: Object.fromEntries(Object.keys(profile).map(f => [f, f === 'backend' ? 'suggested' : 'unknown'])) as AnalysisResult['fieldStates'],
    candidates: [{ id: 'backend-1', version: 1, field: 'backend', proposedValue: ['Express.js'], status: 'suggested', evidence: [{ documentId, start: 0, end: 10 }] }],
    questions: [], safeWarnings: ['REVIEW_CONFIRMATION_REQUIRED'], modelMetadata: { provider: 'nvidia', model: 'deepseek-ai/deepseek-v4.1-flash', latencyMs: 10, promptVersion: 'v1', inputFormat: 'text' } };
}
