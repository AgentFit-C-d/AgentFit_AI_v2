import { assertNoSecretsData, validateSkillData, type SkillFact, type SkillNeed, type SkillCandidate, type SkillMatch } from '@agentfit/contracts';
import { boundedText } from './source';
export interface SkillBudgetContext { targetId: string; leaseId: string }
export interface SkillAi { needs(facts: SkillFact[], deadline: string, signal: AbortSignal, budget?: SkillBudgetContext): Promise<SkillNeed[]>; rank(needs: SkillNeed[], candidates: SkillCandidate[], deadline: string, signal: AbortSignal, budget?: SkillBudgetContext): Promise<SkillMatch[]> }
export class HttpSkillAi implements SkillAi {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly send: typeof fetch = fetch, private readonly secrets: readonly string[] = []) {
    const url = new URL(baseUrl);
    if (url.origin !== baseUrl || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || token.length < 32) throw new Error('INVALID_AI_CONFIG');
  }
  private async call<T>(operation: 'needs' | 'rank', body: unknown, signal: AbortSignal): Promise<T> {
    validateSkillData(operation === 'needs' ? 'needRequest' : 'rankRequest', body); assertNoSecretsData(body, [this.token, ...this.secrets]);
    const send: typeof fetch = (url, options) => this.send(url, { ...options, method: 'POST', body: JSON.stringify(body), headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(92000)]) });
    // Public sources have a separate 12s bound; the model is capped at 90s and the shared 180s deadline.
    const response = await send(`${this.baseUrl}/internal/v1/skills/${operation}`, { signal, redirect: 'error' });
    const raw = await boundedText(async () => new Response(response.body, { headers: response.headers }), `${this.baseUrl}/internal/v1/skills/${operation}`, signal, 65536);
    if (!response.ok) {
      let code: unknown; try { code = JSON.parse(raw)?.error?.code; } catch { /* Never include raw provider errors. */ }
      const codes: Record<string, string> = { ANALYSIS_TIMEOUT: 'SKILL_AI_TIMEOUT', INVALID_PROVIDER_RESPONSE: 'SKILL_AI_INVALID_RESPONSE', PROVIDER_AUTH_FAILED: 'SKILL_AI_AUTH_FAILED', PROVIDER_RATE_LIMITED: 'SKILL_AI_RATE_LIMITED', BUDGET_EXCEEDED: 'SKILL_BUDGET_EXCEEDED' };
      throw new Error(typeof code === 'string' ? codes[code] ?? 'SKILL_AI_UNAVAILABLE' : 'SKILL_AI_UNAVAILABLE');
    }
    try {
      const data = JSON.parse(raw); assertNoSecretsData(data, [this.token, ...this.secrets]);
      return validateSkillData<T>(operation === 'needs' ? 'needs' : 'ranking', data);
    } catch { throw new Error('SKILL_AI_INVALID_RESPONSE'); }
  }
  async needs(facts: SkillFact[], deadline: string, signal: AbortSignal, budget?: SkillBudgetContext) { return (await this.call<{ needs: SkillNeed[] }>('needs', { facts, deadline, ...(budget ? { budget } : {}) }, signal)).needs; }
  async rank(needs: SkillNeed[], candidates: SkillCandidate[], deadline: string, signal: AbortSignal, budget?: SkillBudgetContext) { return (await this.call<{ matches: SkillMatch[] }>('rank', { needs, candidates, deadline, ...(budget ? { budget } : {}) }, signal)).matches; }
}
