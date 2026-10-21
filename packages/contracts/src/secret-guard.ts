import { ContractError } from './errors';
import patterns from '../schema/secret-patterns.json' with { type: 'json' };
const detectors = patterns.map(pattern => new RegExp(pattern, 'i'));
export function assertNoSecrets(text: string, knownSecrets: readonly string[] = []): void {
  if (detectors.some(detector => detector.test(text)) || knownSecrets.some(secret => secret.length >= 12 && text.includes(secret))) throw new ContractError('SECRET_DETECTED');
}
export function assertNoSecretsData(value: unknown, knownSecrets: readonly string[] = []): void {
  if (typeof value === 'string') assertNoSecrets(value, knownSecrets);
  else if (Array.isArray(value)) value.forEach(item => assertNoSecretsData(item, knownSecrets));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { assertNoSecrets(key, knownSecrets); assertNoSecretsData(item, knownSecrets); }
}
