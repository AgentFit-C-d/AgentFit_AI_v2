import { expect, test } from 'vitest';
import { assessFeatureExtraction } from '../../evaluations/feature-metrics';
import { emptyProfile, type AnalysisResult } from '../../packages/contracts/src';
const result = (features: string[] | null, integrations: string[] | null, candidates: AnalysisResult['candidates'] = []): AnalysisResult => ({ schemaVersion: '1.0', profile: { ...emptyProfile(), features, external_integrations: integrations }, fieldStates: Object.fromEntries(Object.keys(emptyProfile()).map(field => [field, 'unknown'])) as AnalysisResult['fieldStates'], candidates, questions: [], safeWarnings: [], modelMetadata: { provider: 'solar', model: 'synthetic', latencyMs: 0, promptVersion: 'test', inputFormat: 'text' } });
const gold = { id: 'metric-fixture', text: '', features: [['파일 업로드'], ['파일 검색']], integrations: [['GitHub OAuth', 'GitHub']], usages: [{ service: 0, purpose: '로그인' }], prohibitedIntegrations: ['React'] };

test('unresolved source candidates count as found, never as accepted facts or grounded purposes', () => {
  const evidence = [{ documentId: 'synthetic', start: 0, end: 20 }];
  const observed = result(null, null, [{ id: 'c1', version: 1, field: 'external_integrations', proposedValue: ['GitHub OAuth'], status: 'unresolved', evidence, usages: [{ value: 'GitHub OAuth', purpose: '로그인', evidence }] }]);
  expect(assessFeatureExtraction(gold, observed)).toMatchObject({ integrationFound: 1, integrationSuggested: 0, usageFound: 0, missingFeatures: ['파일 업로드', '파일 검색'], passed: false });
});
test('atomic actions and service purposes with evidence satisfy the fixed expected facts', () => {
  const evidence = [{ documentId: 'synthetic', start: 0, end: 20 }];
  const observed = result(['파일 업로드', '파일 검색'], ['GitHub OAuth'], [{ id: 'c1', version: 1, field: 'external_integrations', proposedValue: ['GitHub OAuth'], status: 'suggested', evidence, usages: [{ value: 'GitHub OAuth', purpose: '로그인', evidence }] }]);
  expect(assessFeatureExtraction(gold, observed)).toMatchObject({ featureFound: 2, integrationSuggested: 1, usageFound: 1, passed: true });
});
test('one compound value cannot satisfy two atomic feature requirements', () => {
  expect(assessFeatureExtraction(gold, result(['파일 업로드와 파일 검색'], ['GitHub OAuth']))).toMatchObject({ featureFound: 0, packedFeatureCount: 1, passed: false });
});
test('library and future integration contamination fail evaluation even when all expected features are present', () => {
  expect(assessFeatureExtraction(gold, result(['파일 업로드', '파일 검색'], ['GitHub', 'React']))).toMatchObject({ featureFound: 2, prohibitedSuggested: 1, passed: false });
});
test('explicit none and unknown are distinct, so an omitted integration cannot pass an absence case', () => {
  const none = { ...gold, features: [], integrations: [], usages: [], integrationState: 'EMPTY' as const };
  expect(assessFeatureExtraction(none, result([], null))).toMatchObject({ stateMatches: false, passed: false });
  expect(assessFeatureExtraction(none, result([], []))).toMatchObject({ stateMatches: true, passed: true });
});
