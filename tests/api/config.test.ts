import { expect, test } from 'vitest';
import { readConfig } from '../../apps/api/src/config';
test('fails closed on incomplete server configuration without exposing secrets', () => {
  expect(() => readConfig({ DATABASE_URL: 'postgresql://secret@host/db' })).toThrow('SERVER_NOT_CONFIGURED');
});
test('accepts local configuration and rejects an unsafe public URL', () => {
  const env = { DATABASE_URL: 'postgresql://user:password@127.0.0.1:5433/agentfit', BETTER_AUTH_SECRET: 'x'.repeat(40), WEB_ORIGIN: 'http://localhost:3000' };
  expect(readConfig(env).webOrigin).toBe('http://localhost:3000');
  expect(readConfig(env).github).toBeNull();
  expect(() => readConfig({ ...env, WEB_ORIGIN: 'https://app.example/path' })).toThrow('INVALID_WEB_ORIGIN');
});

test('keeps optional skill-source credential separate from GitHub login configuration', () => {
  const env = { DATABASE_URL: 'postgresql://local/test', BETTER_AUTH_SECRET: 'x'.repeat(40), GITHUB_SKILLS_READ_TOKEN: 'synthetic-source-credential' };
  expect(readConfig(env).githubSkillsReadToken).toBe(env.GITHUB_SKILLS_READ_TOKEN);
  expect(readConfig(env).github).toBeNull();
});
