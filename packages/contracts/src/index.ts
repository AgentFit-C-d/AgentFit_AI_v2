import { Ajv } from 'ajv';
import profileSchema from '../schema/profile.json' with { type: 'json' };
import analysisSchema from '../schema/analysis.json' with { type: 'json' };
import apiSchema from '../schema/api.json' with { type: 'json' };
import internalSchema from '../schema/internal.json' with { type: 'json' };
import type { ProjectProfile } from './profile.generated';
import type { AnalysisInput, AnalysisResult, ProfilePatch, UploadMetadata } from './types';
import { ContractError } from './errors';
export { ContractError } from './errors';
export { assertNoSecrets, assertNoSecretsData } from './secret-guard';
export type * from './types';
export * from './recommendations';
export * from './configuration';
export * from './skills';
export * from './skill-libraries';
export type { ProjectProfile } from './profile.generated';
export type ProfileField = keyof ProjectProfile;
export const PROFILE_FIELDS = Object.keys(profileSchema.properties) as ProfileField[];
export function profileArrayLimit(field: ProfileField): number {
  return (field === 'features' ? profileSchema.definitions.features : profileSchema.definitions.array).anyOf[0]!.maxItems!;
}
const ajv = new Ajv({ allErrors: false, strict: true });
const profileValidator = ajv.compile<ProjectProfile>(profileSchema);
const analysisValidator = ajv.compile<AnalysisResult>(analysisSchema);
ajv.addSchema(apiSchema);
ajv.addSchema(internalSchema);
export function validateProfile(value: unknown): ProjectProfile {
  if (!profileValidator(value)) throw new ContractError('INVALID_PROFILE');
  return structuredClone(value);
}
export function codePointLength(value: string): number {
  return [...value].length;
}
export function emptyProfile(): ProjectProfile {
  return Object.fromEntries(PROFILE_FIELDS.map(field => [field, null])) as unknown as ProjectProfile;
}
function validateApi<T>(name: string, value: unknown): T {
  const validator = ajv.getSchema(`${apiSchema.$id}#/definitions/${name}`);
  if (!validator?.(value)) throw new ContractError('INVALID_INPUT');
  return structuredClone(value) as T;
}
export function validateAnalysisInput(value: unknown): AnalysisInput { return validateApi('analysisInput', value); }
export function validateProfilePatch(value: unknown): ProfilePatch { return validateApi('profilePatch', value); }
export function validateUploadMetadata(value: unknown): UploadMetadata { return validateApi('uploadMetadata', value); }
export function validateCreateProject(value: unknown): { name: string } { return validateApi('createProject', value); }
export function validateDeleteProject(value: unknown): { confirmation: true } { return validateApi('deleteProject', value); }
export function validateInternal<T>(name: 'jobMessage' | 'queueOptions' | 'analyzeRequest' | 'budgetRequest' | 'budgetGrant' | 'solarBudgetRequest' | 'solarBudgetGrant', value: unknown): T {
  const validator = ajv.getSchema(`${internalSchema.$id}#/definitions/${name}`);
  if (!validator?.(value)) throw new ContractError('INVALID_INTERNAL_INPUT');
  return structuredClone(value) as T;
}
export function validateAnalysisResult(value: unknown): AnalysisResult {
  if (!analysisValidator(value)) throw new ContractError('INVALID_ANALYSIS_RESULT');
  const review = value.modelMetadata.secondaryReview;
  if ((value.modelMetadata.inputFormat === 'original-pdf' || review) && value.modelMetadata.provider !== 'upstage') throw new ContractError('INVALID_ANALYSIS_RESULT');
  if (review && (review.acceptedCount > review.targetCount || (review.status !== 'COMPLETED' && review.acceptedCount !== 0))) throw new ContractError('INVALID_ANALYSIS_RESULT');
  if (new Set(value.candidates.map(c => c.id)).size !== value.candidates.length) throw new ContractError('INVALID_ANALYSIS_RESULT');
  for (const candidate of value.candidates) {
    if (candidate.field) validateProfile({ ...emptyProfile(), [candidate.field]: candidate.proposedValue });
    for (const location of candidate.evidence) {
      if (location.start !== undefined && location.end !== undefined && location.start >= location.end) throw new ContractError('INVALID_ANALYSIS_RESULT');
    }
    const names = Array.isArray(candidate.proposedValue) ? candidate.proposedValue : candidate.proposedValue?.split(',').map(name => name.trim()) ?? [];
    for (const usage of candidate.usages ?? []) {
      if (!names.includes(usage.value)) throw new ContractError('INVALID_ANALYSIS_RESULT');
      for (const location of usage.evidence) {
        if (location.start === undefined || location.end === undefined || location.start >= location.end || !candidate.evidence.some(source => source.documentId === location.documentId && source.start !== undefined && source.end !== undefined && source.start <= location.start! && location.end! <= source.end)) throw new ContractError('INVALID_ANALYSIS_RESULT');
      }
    }
  }
  return structuredClone(value);
}
