export type DeveloperProfile = { role: 'FRONTEND' | 'BACKEND' | 'FULL_STACK' | 'AI' | 'DESIGNER' | null; responsibilities: string[] | null; experienceLevel: 'BEGINNER' | 'INTERMEDIATE' | 'EXPERIENCED' | null };
export type EnvironmentProfile = {
  os: { family: 'WINDOWS' | 'MACOS' | 'LINUX' | 'OTHER'; version: string | null } | null;
  client: { id: string; version: string | null } | null;
  runtimes: { name: string; version: string | null }[] | null;
  installedComponents: { catalogItemId: string | null; name: string; version: string | null }[] | null;
  configurationKnowledge: 'UNKNOWN' | 'USER_SAYS_EMPTY' | 'HAS_EXISTING';
  authenticationReadiness: { serviceId: string; state: 'READY' | 'NOT_READY' | 'UNKNOWN' }[] | null;
};
export interface StoredProfile<T> { data: T; version: number; updatedAt: string; source: 'USER_DECLARED' }
export interface RecommendationBasis { projectVersion: number; developerVersion: number; environmentVersion: number; catalogRevision: string }
export interface Capability { id: string; name: string; reason: string; sourceFields: string[] }
export type PermissionPolicy = 'ASK_EACH_TIME' | 'ALWAYS_ALLOW' | 'DENY';
export interface PermissionOption { key: string; resourceScope: string; supportedPolicies: PermissionPolicy[]; defaultPolicy: 'ASK_EACH_TIME'; mapping: string }
export interface RecommendationItem { catalogItemId: string; catalogVersion: string; supportMatrixId: string; required: boolean; reason: string; permissionOptions: PermissionOption[]; authenticationRequirements: { serviceId: string; state: 'READY' | 'NOT_READY' | 'UNKNOWN'; instructions: string }[]; category?: 'PROJECT' | 'COMMON'; matchScore?: number; tool?: import('./skills').SkillToolMetadata }
export interface RecommendationResult { status: 'RECOMMENDED' | 'NO_ADDITIONS_NEEDED' | 'NEEDS_INFORMATION' | 'NO_COMPATIBLE_TOOLS'; capabilities: Capability[]; items: RecommendationItem[]; questions: { id: string; field: string; message: string; required: boolean }[]; reasons: string[]; evidenceLevel: 'PLAN_ONLY' | 'ENVIRONMENT_DECLARED' }
export interface RecommendationDto extends RecommendationResult { id: string; basis: RecommendationBasis; validity: 'CURRENT' | 'STALE'; createdAt: string; discoveryId?: string }
export interface ProfilePut<T> { expectedVersion: number; data: T }
const ajv = new Ajv({ strict: true });
ajv.addSchema(schema);
function validate<T>(name: string, value: unknown): T {
  if (!ajv.getSchema(`${schema.$id}#/definitions/${name}`)?.(value)) throw new ContractError('INVALID_INPUT');
  return structuredClone(value) as T;
}
export function validateDeveloperPatch(value: unknown): ProfilePut<DeveloperProfile> { return validate('developerPatch', value); }
export function validateEnvironmentPatch(value: unknown): ProfilePut<EnvironmentProfile> { return validate('environmentPatch', value); }
export function validateRecommendationInput(value: unknown): { expectedVersions: { project: number; developer: number; environment: number } } { return validate('recommendationInput', value); }
import { Ajv } from 'ajv';
import schema from '../schema/recommendations.json' with { type: 'json' };
import { ContractError } from './errors';
