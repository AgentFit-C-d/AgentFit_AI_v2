import { describe, expect, test } from 'vitest';
import { validateProfile, validateProfilePatch, validateAnalysisResult, codePointLength } from '../../packages/contracts/src/index';
import { analysisResult } from '../support/analysis';
const unknownProfile = { project_name: null, project_type: null, domain: null, frontend: null, backend: null, ai: null, database: null, deployment: null, features: null, external_integrations: null };
describe('shared Project Profile contract', () => {
  test('only features allow up to 100 entries through profile, analysis and edited review patches', () => {
    const features = Array.from({ length: 100 }, (_, index) => `기능 ${index}`);
    expect(validateProfile({ ...unknownProfile, features }).features).toEqual(features);
    expect(() => validateProfile({ ...unknownProfile, features: [...features, '초과'] })).toThrow();
    const result = analysisResult(); result.candidates[0] = { ...result.candidates[0]!, field: 'features', proposedValue: features };
    expect(validateAnalysisResult(result).candidates[0]?.proposedValue).toEqual(features);
    expect(validateProfilePatch({ expectedVersion: 1, profile: { ...unknownProfile, features }, draftId: 'd1', draftVersion: 1, reviewDecisions: [{ itemId: 'f1', version: 1, action: 'EDIT', editedValue: features }] }).profile.features).toHaveLength(100);
    for (const field of ['frontend', 'backend', 'ai', 'external_integrations']) expect(() => validateProfile({ ...unknownProfile, [field]: features.slice(0, 31) })).toThrow();
  });
  test('accepts unknown separately from explicit none', () => {
    expect(() => validateProfile(unknownProfile)).not.toThrow();
    expect(validateProfile(unknownProfile).backend).toBeNull();
    expect(validateProfile({ ...unknownProfile, backend: [] }).backend).toEqual([]);
  });
  test('counts Unicode code points consistently', () => {
    expect(codePointLength('가😀e\u0301')).toBe(4);
    expect(() => validateProfile({ ...unknownProfile, backend: ['😀'.repeat(200)] })).not.toThrow();
    expect(() => validateProfile({ ...unknownProfile, backend: ['😀'.repeat(201)] })).toThrow();
  });
  test('rejects overly large arrays and scalar type confusion', () => {
    expect(() => validateProfile({ ...unknownProfile, backend: Array(31).fill('Node') })).toThrow();
    expect(() => validateProfile({ ...unknownProfile, database: [] })).toThrow();
  });
  test('rejects fields outside the shared extraction scope', () => {
    for (const field of ['purpose', 'target_users', 'constraints', 'ownerId']) {
      expect(() => validateProfile({ ...unknownProfile, [field]: 'injected' })).toThrow();
    }
    const missing: Record<string, unknown> = { ...unknownProfile };
    delete missing.domain;
    expect(() => validateProfile(missing)).toThrow();
  });
});
