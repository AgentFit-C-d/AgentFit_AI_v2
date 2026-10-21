import { expect, test } from 'vitest';
import { HttpSkillAi } from '../../apps/api/src/skills/ai';

test.each([
  ['ANALYSIS_TIMEOUT', 'SKILL_AI_TIMEOUT'],
  ['INVALID_PROVIDER_RESPONSE', 'SKILL_AI_INVALID_RESPONSE'],
  ['PROVIDER_AUTH_FAILED', 'SKILL_AI_AUTH_FAILED'],
  ['PROVIDER_RATE_LIMITED', 'SKILL_AI_RATE_LIMITED'],
  ['BUDGET_EXCEEDED', 'SKILL_BUDGET_EXCEEDED'],
  ['private provider exception', 'SKILL_AI_UNAVAILABLE'],
])('retains only the safe AI failure category %s', async (upstream, expected) => {
  const ai = new HttpSkillAi('http://localhost:8000', 'test-token-'.repeat(4), async () => Response.json({ error: { code: upstream, raw: 'private details' } }, { status: 503 }));
  await expect(ai.needs([{ id: 'features:0', field: 'features', value: '결제 승인' }], new Date(Date.now() + 180000).toISOString(), AbortSignal.timeout(1000))).rejects.toThrow(expected);
});
