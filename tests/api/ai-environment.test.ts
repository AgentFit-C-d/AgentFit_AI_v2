import { expect, test } from 'vitest';
import { aiEnvironment } from '../../tools/run-ai.mjs';
test('AI child process receives only runtime and AI credentials', () => {
  const result = aiEnvironment({ PATH: 'runtime', SystemRoot: 'windows', AI_SERVICE_TOKEN: 'internal', NVIDIA_API_KEY: 'nvidia', UPSTAGE_API_KEY: 'upstage', DATABASE_URL: 'db-secret', GITHUB_CLIENT_SECRET: 'oauth-secret', GITHUB_SKILLS_READ_TOKEN: 'source-secret', BETTER_AUTH_SECRET: 'auth-secret', UNRELATED_SECRET: 'hidden' });
  expect(result).toMatchObject({ PATH: 'runtime', SystemRoot: 'windows', AI_SERVICE_TOKEN: 'internal', UPSTAGE_API_KEY: 'upstage', PYTHONUTF8: '1' });
  expect(result).not.toHaveProperty('NVIDIA_API_KEY');
  for (const key of ['DATABASE_URL', 'GITHUB_CLIENT_SECRET', 'GITHUB_SKILLS_READ_TOKEN', 'BETTER_AUTH_SECRET', 'UNRELATED_SECRET']) expect(result).not.toHaveProperty(key);
});
