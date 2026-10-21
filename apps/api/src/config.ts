export interface ServerConfig { databaseUrl: string; authSecret: string; webOrigin: string; port: number; diagnosticKey?: string; githubSkillsReadToken?: string; github: { clientId: string; clientSecret: string } | null; analysis?: { token: string; url: string; budgetMicroUsd: number; priceMicroUsd: number | null } }
export function readConfig(env: NodeJS.ProcessEnv): ServerConfig {
  if (!env.DATABASE_URL || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error('SERVER_NOT_CONFIGURED');
  const webOrigin = env.WEB_ORIGIN ?? 'http://localhost:3000';
  let url: URL;
  try { url = new URL(webOrigin); } catch { throw new Error('INVALID_WEB_ORIGIN'); }
  if (url.origin !== webOrigin || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('INVALID_WEB_ORIGIN');
  const port = Number(env.API_PORT ?? '4000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_API_PORT');
  if (!!env.GITHUB_CLIENT_ID !== !!env.GITHUB_CLIENT_SECRET) throw new Error('AUTH_NOT_CONFIGURED');
  if (env.AI_SERVICE_TOKEN && env.AI_SERVICE_TOKEN.length < 32) throw new Error('AI_SERVICE_NOT_CONFIGURED');
  if (env.DIAGNOSTIC_ENCRYPTION_KEY && !/^[0-9a-f]{64}$/i.test(env.DIAGNOSTIC_ENCRYPTION_KEY)) throw new Error('DIAGNOSTICS_NOT_CONFIGURED');
  const budgetMicroUsd = Number(env.UPSTAGE_DEVELOPMENT_BUDGET_MICRO_USD ?? '20000000');
  const priceMicroUsd = env.UPSTAGE_PRICE_MICRO_USD_PER_PAGE ? Number(env.UPSTAGE_PRICE_MICRO_USD_PER_PAGE) : null;
  if (!Number.isInteger(budgetMicroUsd) || budgetMicroUsd < 1 || budgetMicroUsd > 20_000_000 || (priceMicroUsd !== null && (!Number.isSafeInteger(priceMicroUsd) || priceMicroUsd <= 0))) throw new Error('INVALID_BUDGET_CONFIGURATION');
  return { databaseUrl: env.DATABASE_URL, authSecret: env.BETTER_AUTH_SECRET, webOrigin, port, diagnosticKey: env.DIAGNOSTIC_ENCRYPTION_KEY, githubSkillsReadToken: env.GITHUB_SKILLS_READ_TOKEN || undefined, github: env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } : null,
    ...(env.AI_SERVICE_TOKEN ? { analysis: { token: env.AI_SERVICE_TOKEN, url: env.AI_SERVICE_URL ?? 'http://127.0.0.1:8000', budgetMicroUsd, priceMicroUsd } } : {}) };
}
