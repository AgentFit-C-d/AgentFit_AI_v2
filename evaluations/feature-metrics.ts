import type { AnalysisResult } from '../packages/contracts/src';
export interface FeatureCase { id: string; text: string; features: string[][]; integrations: string[][]; usages: { service: number; purpose: string }[]; prohibitedFeatures?: string[]; prohibitedIntegrations?: string[]; integrationState?: 'EMPTY' | 'UNKNOWN' }
const normalize = (value: string) => value.toLocaleLowerCase('en').replace(/\s+/g, '');
const matches = (value: string, names: string[]) => names.some(name => normalize(value).includes(normalize(name)));
export function assessFeatureExtraction(gold: FeatureCase, result: AnalysisResult) {
  const values = (field: 'features' | 'external_integrations') => [...new Set([...(result.profile[field] ?? []), ...result.candidates.filter(c => c.field === field).flatMap(c => Array.isArray(c.proposedValue) ? c.proposedValue : [])])];
  const features = values('features'); const integrations = values('external_integrations');
  const atomic = features.filter(value => gold.features.filter(names => matches(value, names)).length === 1);
  const foundFeatures = gold.features.map(names => atomic.some(value => matches(value, names)));
  const foundIntegrations = gold.integrations.map(names => integrations.some(value => matches(value, names)));
  const suggestedFeatures = gold.features.filter(names => (result.profile.features ?? []).some(value => atomic.includes(value) && matches(value, names))).length;
  const suggestedIntegrations = gold.integrations.filter(names => (result.profile.external_integrations ?? []).some(value => matches(value, names))).length;
  const usageFound = gold.usages.filter(expected => result.candidates.filter(c => c.field === 'external_integrations' && c.status === 'suggested').some(c => c.usages?.some(u => u.evidence.length && matches(u.value, gold.integrations[expected.service]!) && normalize(u.purpose).includes(normalize(expected.purpose))))).length;
  const prohibitedSuggested = (result.profile.features ?? []).filter(value => (gold.prohibitedFeatures ?? []).some(name => matches(value, [name]))).length + (result.profile.external_integrations ?? []).filter(value => (gold.prohibitedIntegrations ?? []).some(name => matches(value, [name]))).length;
  const unexpectedIntegrationSuggested = (result.profile.external_integrations ?? []).filter(value => !gold.integrations.some(names => matches(value, names))).length;
  const stateMatches = gold.integrationState === 'EMPTY' ? Array.isArray(result.profile.external_integrations) && result.profile.external_integrations.length === 0 : gold.integrationState === 'UNKNOWN' ? result.profile.external_integrations === null : true;
  return { featureFound: foundFeatures.filter(Boolean).length, featureSuggested: suggestedFeatures, featureExpected: gold.features.length, integrationFound: foundIntegrations.filter(Boolean).length, integrationSuggested: suggestedIntegrations, integrationExpected: gold.integrations.length, usageFound, usageExpected: gold.usages.length,
    missingFeatures: gold.features.filter((_, i) => !foundFeatures[i]).map(names => names[0]!), missingIntegrations: gold.integrations.filter((_, i) => !foundIntegrations[i]).map(names => names[0]!),
    packedFeatureCount: features.filter(value => gold.features.filter(names => matches(value, names)).length > 1).length, prohibitedSuggested, unexpectedIntegrationSuggested, stateMatches,
    passed: foundFeatures.every(Boolean) && foundIntegrations.every(Boolean) && usageFound === gold.usages.length && prohibitedSuggested === 0 && unexpectedIntegrationSuggested === 0 && stateMatches };
}
