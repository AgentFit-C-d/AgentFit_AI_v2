import { Ajv } from 'ajv';
import schema from '../schema/skills.json' with { type: 'json' };
import { ContractError } from './errors';
import type { RecommendationBasis } from './recommendations';
export const SKILL_RECOMMENDATION_MIN_SCORE = 75;
export const SKILL_OPTIONAL_MIN_SCORE = 70;
export interface SkillFact { id: string; field: string; value: string }
export interface SkillNeed { id: string; name: string; query: string; sourceFields: string[] }
export interface SkillCandidate { id: string; name: string; content: string }
export interface SkillMatch { candidateId: string; needIds: string[]; score: number; reason: string }
export interface SkillDiscoveryDto { id: string; basis: RecommendationBasis; status: 'QUEUED' | 'SEARCHING' | 'CHECKING' | 'SUCCEEDED' | 'FAILED' | 'STALE'; needs: SkillNeed[]; checks: { candidateId: string; name: string; status: 'PASS' | 'BLOCKED'; code: string }[]; errorCode: string | null; createdAt: string; deadline: string }
export interface SkillToolMetadata { name: string; skillsUrl: string; license: string; risk: string; verification: 'PACKAGE_CHECKED'; actualUse: 'NOT_RUN'; checkedAt: string; expiresAt: string; artifactHash: string }
const ajv = new Ajv({ strict: true }); ajv.addSchema(schema);
export function generalSkillQuery(query: string): boolean { return query.split(' ').every(word => (schema.definitions.queryWord.enum as readonly string[]).includes(word)); }
export function validateSkillData<T = unknown>(name: 'start' | 'needs' | 'needRequest' | 'rankRequest' | 'ranking', value: unknown): T {
  if (!ajv.getSchema(`${schema.$id}#/definitions/${name}`)?.(value)) throw new ContractError('INVALID_INPUT');
  return structuredClone(value) as T;
}
