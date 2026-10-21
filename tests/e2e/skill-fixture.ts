// Deterministic upstream ports used only by isolated browser test setup.
import type { SkillAi } from '../../apps/api/src/skills/ai';
import type { SkillSource } from '../../apps/api/src/skills/source';
import { checkPackage } from '../../apps/api/src/skills/package';
const packageValue = checkPackage('synthetic/payment/payment-checks', 'a'.repeat(40), [{ path: 'SKILL.md', content: '---\nname: payment-checks\ndescription: Payment integration tests\n---\nTest duplicate checkout, refunds and idempotency.\n' }, { path: 'LICENSE.txt', content: 'MIT License\nPermission is hereby granted, free of charge' }]);
export const browserSkillPorts: { ai: SkillAi; source: SkillSource } = {
  ai: { needs: async facts => {
    const fact = facts.find(x => x.field === 'features' && x.value.includes('결제 승인'));
    return fact ? [{ id: 'n1', name: '결제 검증', query: 'payment integration testing', sourceFields: [fact.id] }] : [];
  }, rank: async (_needs, candidates) => candidates.filter(x => x.name === 'payment-checks').map(x => ({ candidateId: x.id, needIds: ['n1'], score: 70, reason: '결제 승인·중복 주문 검증에 필요한 지침입니다.' })) },
  source: { search: async () => [{ id: packageValue.id, name: packageValue.name, repository: packageValue.repository, installs: 1 }], inspect: async () => packageValue },
};
