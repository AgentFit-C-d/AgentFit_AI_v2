import { expect, test } from 'vitest';
import { validateAnalysisInput, validateAnalysisResult, emptyProfile, PROFILE_FIELDS } from '../../packages/contracts/src/index';
const result = {
  schemaVersion: '1.0', profile: emptyProfile(),
  fieldStates: Object.fromEntries(PROFILE_FIELDS.map(f => [f, 'unknown'])),
  candidates: [], questions: [], safeWarnings: ['REVIEW_CONFIRMATION_REQUIRED'],
  modelMetadata: { provider: 'nvidia', model: 'deepseek-ai/deepseek-v4.1-flash', latencyMs: 50, promptVersion: '1.0', inputFormat: 'text' },
};
test('accepts structured unknown draft without pretending user confirmation', () => {
  expect(() => validateAnalysisResult(result)).not.toThrow();
  expect(() => validateAnalysisResult({ ...result, userConfirmed: true })).toThrow();
});

test('accepts Solar primary and scoped secondary review while retaining historical NVIDIA results', () => {
  expect(() => validateAnalysisResult({ ...result, modelMetadata: { ...result.modelMetadata, provider: 'solar', model: 'solar-pro4' } })).not.toThrow();
  expect(() => validateAnalysisResult({ ...result, modelMetadata: { ...result.modelMetadata, provider: 'upstage', secondaryReview: { provider: 'solar', model: 'solar-pro4', status: 'FAILED', targetCount: 1, acceptedCount: 0, latencyMs: 10, errorCode: 'BUDGET_EXCEEDED' } } })).not.toThrow();
});

test('accepts original PDF and bounded secondary review metadata while keeping legacy drafts valid', () => {
  const metadata = { ...result.modelMetadata, provider: 'upstage', inputFormat: 'original-pdf', secondaryReview: { provider: 'nvidia', model: 'test-reviewer', status: 'COMPLETED', targetCount: 2, acceptedCount: 1, latencyMs: 20 } };
  expect(() => validateAnalysisResult({ ...result, modelMetadata: metadata })).not.toThrow();
  expect(() => validateAnalysisResult({ ...result, modelMetadata: { ...metadata, secondaryReview: { ...metadata.secondaryReview, acceptedCount: 3 } } })).toThrow();
  expect(() => validateAnalysisResult({ ...result, modelMetadata: { ...metadata, provider: 'nvidia' } })).toThrow();
  expect(() => validateAnalysisResult(result)).not.toThrow();
});
test('requires distinct candidate identities and valid evidence spans', () => {
  const candidate = { id: 'c1', version: 1, field: 'backend', proposedValue: ['Node.js'], status: 'suggested', evidence: [{ documentId: 'd1', start: 0, end: 7 }] };
  expect(() => validateAnalysisResult({ ...result, candidates: [candidate] })).not.toThrow();
  expect(() => validateAnalysisResult({ ...result, candidates: [candidate, candidate] })).toThrow();
  expect(() => validateAnalysisResult({ ...result, candidates: [{ ...candidate, evidence: [{ documentId: 'd1', start: 7, end: 0 }] }] })).toThrow();
});
test('permits exactly one input at the Unicode text boundary', () => {
  expect(() => validateAnalysisInput({ kind: 'text', text: '😀'.repeat(100000) })).not.toThrow();
  expect(() => validateAnalysisInput({ kind: 'text', text: '😀'.repeat(100001) })).toThrow();
  expect(() => validateAnalysisInput({ kind: 'text', text: 'content', uploadId: 'other' })).toThrow();
  expect(() => validateAnalysisInput({ kind: 'upload', uploadId: 'id', url: 'https://internal.example' })).toThrow();
});

test('validates purpose membership and provenance without breaking old drafts', () => {
  const evidence = { documentId: 'd1', start: 0, end: 25, page: 1 };
  const candidate = { id: 'c1', version: 1, field: 'ai', proposedValue: ['Solar'], status: 'suggested', evidence: [evidence], usages: [{ value: 'Solar', purpose: '답변 생성', evidence: [{ ...evidence, start: 2, end: 20 }] }] };
  expect(validateAnalysisResult({ ...result, candidates: [candidate] }).candidates[0]?.usages?.[0]?.purpose).toBe('답변 생성');
  for (const invalid of [
    { ...candidate.usages[0]!, value: 'GPT' },
    { ...candidate.usages[0]!, evidence: [{ ...evidence, documentId: 'foreign' }] },
    { ...candidate.usages[0]!, evidence: [{ ...evidence, end: 26 }] },
    { ...candidate.usages[0]!, evidence: [{ ...evidence, start: 20, end: 2 }] },
  ]) expect(() => validateAnalysisResult({ ...result, candidates: [{ ...candidate, usages: [invalid] }] })).toThrow();
  expect(() => validateAnalysisResult({ ...result, candidates: [{ ...candidate, usages: undefined }] })).not.toThrow();
});
