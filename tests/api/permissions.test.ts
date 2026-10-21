import { expect, test } from 'vitest';
import { checkSelection } from '../../apps/api/src/configuration/permissions';
import { configFixture } from '../support/configuration';
test('blocks forged selections, stale bases, revisions, missing dependencies and conflicts', () => {
  const { input, recommendation, catalog, item } = configFixture();
  expect(checkSelection(recommendation, catalog, input).items.map(x => x.id)).toEqual(input.selectedToolIds);
  for (const bad of [{ ...input, selectedToolIds: ['forged'] }, { ...input, recommendationId: 'other' }, { ...input, expectedBasis: { ...input.expectedBasis, projectVersion: 99 } }]) expect(() => checkSelection(recommendation, catalog, bad)).toThrow();
  expect(() => checkSelection({ ...recommendation, validity: 'STALE' }, catalog, input)).toThrow();
  expect(() => checkSelection(recommendation, { ...catalog, items: [{ ...item, version: 'different' }] }, input)).toThrow();
  expect(() => checkSelection(recommendation, { ...catalog, items: [{ ...item, dependencies: ['missing'] }] }, input)).toThrow();
  expect(() => checkSelection(recommendation, { ...catalog, items: [{ ...item, kind: 'HOOK' }] }, input)).toThrow();
});
test('requires exact key/scope/mapping and blocks unsupported policy and required DENY', () => {
  const { input, recommendation, catalog, item } = configFixture();
  const option = { key: 'write', resourceScope: 'project', supportedPolicies: ['ASK_EACH_TIME', 'DENY'] as const, defaultPolicy: 'ASK_EACH_TIME' as const, mapping: 'codex-prompt-v1' };
  const policy = { catalogItemId: item.id, key: option.key, resourceScope: option.resourceScope, mappingId: option.mapping, policy: 'ASK_EACH_TIME' as const };
  const next = { ...recommendation, items: [{ ...recommendation.items[0]!, permissionOptions: [{ ...option, supportedPolicies: [...option.supportedPolicies] }] }] };
  const mapped = { ...catalog, items: [{ ...item, permissionOptions: next.items[0]!.permissionOptions }] };
  expect(checkSelection(next, mapped, { ...input, permissionPolicies: [policy] })).toBeTruthy();
  for (const p of [{ ...policy, resourceScope: 'global' }, { ...policy, mappingId: 'fake' }, { ...policy, policy: 'DENY' as const }, { ...policy, policy: 'ALWAYS_ALLOW' as const }]) expect(() => checkSelection(next, mapped, { ...input, permissionPolicies: [p] })).toThrow();
  expect(() => checkSelection(next, mapped, input)).toThrow();
  expect(() => checkSelection(recommendation, catalog, { ...input, permissionPolicies: [policy] })).toThrow();
});
