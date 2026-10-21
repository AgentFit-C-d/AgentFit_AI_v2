import { expect, test } from 'vitest';
import { validateSkillData } from '../../packages/contracts/src/skills';
test('bounds generalized needs and rejects executable/model-invented fields', () => {
  const need = { id: 'n1', name: '결제 검증', query: 'payment integration testing', sourceFields: ['features:0'] };
  expect(validateSkillData('needs', { needs: [need] })).toEqual({ needs: [need] });
  expect(() => validateSkillData('needs', { needs: [{ ...need, query: 'https://evil.invalid' }] })).toThrow();
  expect(() => validateSkillData('needs', { needs: [{ ...need, skillId: 'invented' }] })).toThrow();
  expect(() => validateSkillData('needs', { needs: Array(7).fill(need) })).toThrow();
});
