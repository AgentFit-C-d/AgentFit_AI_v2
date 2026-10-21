import type { ProfileField } from '@agentfit/contracts';

const oauthProviders = new Map(['Google', 'Discord', 'GitHub', 'Apple', 'Microsoft', 'Kakao', 'Naver', 'Facebook', 'Twitter'].map(name => [name.toLowerCase(), name]));
export const profileValueKey = (value: string): string => value.trim().replace(/\s+/g, ' ').normalize('NFC').toLowerCase();

function compactFeature(value: string): string {
  // Keep negation and obligations intact; only remove positive sentence wrappers.
  if (/않|없|금지|불가|안\s|해야|필수/.test(value)) return value;
  return value.replace(/[을를]\s+(?:제공|수행|지원)(?:한다|합니다)[.!。]?$/, '')
    .replace(/(?:하도록\s+(?:한다|합니다)|한다|합니다|하고)[.!。]?$/, '').trim() || value;
}

export function normalizeProfileValues(field: ProfileField | null, values: string[], compactFeatures = false): string[] {
  const seen = new Set<string>();
  return values.flatMap(value => value.split(/[,\r\n]/)).flatMap(raw => {
    const value = raw.trim().replace(/\s+/g, ' ');
    const match = field === 'external_integrations' && value.match(/^(.+?)\s+OAuth$/i);
    const providers = match ? match[1]!.split(/\s*[-·&/]\s*/).map(name => oauthProviders.get(name.toLowerCase())) : [];
    return providers.length > 1 && providers.every(Boolean) ? providers.map(name => `${name} OAuth`) : [value];
  }).map(value => field === 'features' && compactFeatures ? compactFeature(value) : value).filter(value => {
    const key = profileValueKey(value);
    if (!value || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
