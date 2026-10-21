import { expect, test } from 'vitest';
import { prepareEnvironment } from '../../tools/local-environment.mjs';
test('preserves existing credentials/settings and generates only missing local values', () => {
  const existing = 'UPSTAGE_API_KEY=test-only-upstage\nNVIDIA_API_KEY=test-only-nvidia\nGITHUB_CLIENT_SECRET=test-only-github\nDATABASE_URL=postgresql://existing-host/project\nWEB_ORIGIN=https://myapp.example\nAI_SERVICE_TOKEN=\n';
  const result = prepareEnvironment(existing, () => 'test-only-generated-value');
  for (const line of existing.trim().split('\n').slice(0, -1)) expect(result).toContain(line + '\n');
  expect(result).toContain('AI_SERVICE_TOKEN=test-only-generated-value');
  expect(prepareEnvironment(result, () => { throw new Error('must not regenerate'); })).toBe(result);
});
