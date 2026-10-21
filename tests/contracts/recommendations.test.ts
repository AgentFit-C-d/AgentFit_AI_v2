import { expect, test } from 'vitest';
import { validateDeveloperPatch, validateEnvironmentPatch } from '../../packages/contracts/src/recommendations';
const developer = { expectedVersion: 0, data: { role: null, responsibilities: null, experienceLevel: null } };
const environment = { expectedVersion: 0, data: { os: null, client: null, runtimes: null, installedComponents: null, configurationKnowledge: 'UNKNOWN', authenticationReadiness: null } };
test('preserves unknown and explicit none independently', () => {
  expect(validateDeveloperPatch(developer).data.responsibilities).toBeNull();
  expect(validateDeveloperPatch({ ...developer, data: { ...developer.data, responsibilities: [] } }).data.responsibilities).toEqual([]);
  expect(validateEnvironmentPatch(environment).data.installedComponents).toBeNull();
});
test('rejects unknown keys, forged source and invalid nested enum', () => {
  expect(() => validateDeveloperPatch({ ...developer, source: 'INSPECTED' })).toThrow();
  expect(() => validateEnvironmentPatch({ ...environment, data: { ...environment.data, os: { family: 'PLAN9', version: null } } })).toThrow();
  expect(() => validateEnvironmentPatch({ ...environment, data: { ...environment.data, client: { id: 'codex', version: null, token: 'abc' } } })).toThrow();
});
test('accepts exactly 200 emoji code points and rejects 201, overflow arrays and stale version shape', () => {
  const patch = (name: string) => ({ ...developer, data: { ...developer.data, responsibilities: [name] } });
  expect(validateDeveloperPatch(patch('😀'.repeat(200))).data.responsibilities).toEqual(['😀'.repeat(200)]);
  expect(() => validateDeveloperPatch(patch('😀'.repeat(201)))).toThrow();
  expect(() => validateDeveloperPatch({ ...developer, data: { ...developer.data, responsibilities: Array(31).fill('작성') } })).toThrow();
  expect(() => validateDeveloperPatch({ ...developer, expectedVersion: -1 })).toThrow();
});
