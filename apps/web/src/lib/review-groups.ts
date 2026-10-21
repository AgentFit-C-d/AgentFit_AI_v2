import { type AnalysisCandidate, type ProfileField } from '@agentfit/contracts';
import { arrayFields, type FieldForm } from './profile-form';
import { normalizeProfileValues } from './profile-values';
import { coreFeatureLabel, selectCoreFeatures } from './core-features';

export interface ReviewGroup {
  key: string;
  field: ProfileField | null;
  candidates: AnalysisCandidate[];
  values: string[];
  details: string[];
  pages: number[];
  hasNone: boolean;
  hasUnknown: boolean;
  conflict: boolean;
  canAccept: boolean;
  proposed: FieldForm;
}

export function candidateValues(candidate: AnalysisCandidate): string[] {
  const values = Array.isArray(candidate.proposedValue) ? normalizeProfileValues(candidate.field, candidate.proposedValue, true) : candidate.proposedValue === null ? [] : [candidate.proposedValue];
  return candidate.field === 'features' ? normalizeProfileValues('features', values.flatMap(value => coreFeatureLabel(value) ?? [])) : values;
}

export function groupCandidates(candidates: AnalysisCandidate[]): ReviewGroup[] {
  const groups = new Map<string, AnalysisCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.field ?? 'additional';
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups].map(([key, items]) => {
    const field = items[0]!.field;
    const groupedValues = field && arrayFields.has(field) ? normalizeProfileValues(field, items.flatMap(candidateValues), true) : [...new Set(items.flatMap(candidateValues))];
    const values = field === 'features' ? selectCoreFeatures(groupedValues) : groupedValues;
    const originalValues = [...new Set(items.flatMap(item => Array.isArray(item.proposedValue) ? item.proposedValue : []))];
    const details = field === 'features' ? normalizeProfileValues(field, originalValues).filter(value => !values.includes(value)) : [];
    const hasNone = items.some(item => Array.isArray(item.proposedValue) && !item.proposedValue.length);
    const hasUnknown = items.some(item => item.proposedValue === null);
    const conflict = (hasNone && values.length > 0) || (!!field && !arrayFields.has(field) && values.length > 1);
    const canAccept = !!field && !conflict && !hasUnknown && (!arrayFields.has(field) || JSON.stringify(values) === JSON.stringify(originalValues)) && items.every(item => item.status === 'suggested' && item.evidence.length > 0 && (!Array.isArray(item.proposedValue) || item.proposedValue.every(value => value === value.trim() && !/[,\n]/.test(value))));
    const proposed: FieldForm = conflict && hasNone ? { mode: 'unknown', value: '' } : values.length ? { mode: 'value', value: values.join(field && arrayFields.has(field) ? '\n' : ', ') } : hasNone ? { mode: 'none', value: '' } : { mode: 'unknown', value: '' };
    return { key, field, candidates: items, values, details, pages: [...new Set(items.flatMap(item => item.evidence.flatMap(evidence => evidence.page ? [evidence.page] : [])))].sort((a, b) => a - b), hasNone, hasUnknown, conflict, canAccept, proposed };
  });
}
