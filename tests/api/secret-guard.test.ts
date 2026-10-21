import { expect, test } from 'vitest';
import { assertNoSecrets } from '../../packages/contracts/src/secret-guard';
test('rejects prepared credentials with safe codes and permits normal technical prose', () => {
  for (const text of ['nvapi-' + 'x'.repeat(40), 'ghp_' + 'a'.repeat(36), 'API_KEY=' + 'z'.repeat(32), 'postgresql://someone:private-password@db/app', '-----BEGIN PRIVATE KEY-----', 'Bearer ' + 'b'.repeat(40)]) {
    expect(() => assertNoSecrets(text)).toThrow('SECRET_DETECTED');
  }
  expect(() => assertNoSecrets('프로젝트에서 Express.js와 PostgreSQL을 사용합니다. API key는 환경 변수로 받습니다.')).not.toThrow();
  expect(() => assertNoSecrets('known-test-credential-abcdef', ['known-test-credential-abcdef'])).toThrow('SECRET_DETECTED');
});
