import type { PermissionPolicy, RecommendationBasis } from './recommendations';
import { Ajv } from 'ajv';
import schema from '../schema/configuration.json' with { type: 'json' };
import { ContractError } from './errors';
import { assertNoSecretsData } from './secret-guard';
export interface ConfigurationPolicy { catalogItemId: string; key: string; resourceScope: string; policy: PermissionPolicy; mappingId: string }
export interface PreviewInput { recommendationId: string; expectedBasis: RecommendationBasis; selectedToolIds: string[]; permissionPolicies: ConfigurationPolicy[]; existingState: 'UNKNOWN' | 'USER_SAYS_EMPTY' | 'PROVIDED'; existingFiles: { targetKey: string; relativePath: string; content: string }[]; customSkill?: { name: string; description: string; instructions: string } }
export interface ApprovalInput { previewId: string; previewFingerprint: string; confirmation: true }
export interface ExportInput { approvalId: string; previewId: string; previewFingerprint: string; input: PreviewInput }
export interface PreviewFile { targetKey: string; relativePath: string; action: 'PROPOSAL' | 'UPDATE'; beforeHash: string | null; afterHash: string; content: string; diff: string | null; comparisonScope: 'EXISTING_UNKNOWN' | 'PROVIDED_FILE' }
export interface Preview { id: string; createdAt: string; expiresAt: string; status: 'READY'; generatorVersion: string; basis: RecommendationBasis; recommendationId: string; selectedToolIds: string[]; selectionDigest: string; contentDigest: string; fingerprint: string; evidence: { environment: 'USER_DECLARED'; existingFiles: 'UNKNOWN' | 'USER_DECLARED' | 'PROVIDED_CONTENT'; effectivePermissions: 'UNVERIFIED' }; files: PreviewFile[]; policies: ConfigurationPolicy[]; warnings: { code: string; message: string; targetKey: string | null }[] }
export interface ConfigurationApproval { id: string; previewId: string; fingerprint: string; approvedAt: string; expiresAt: string }
export interface UserConfigurationReport { reportedState: 'APPLIED' | 'FAILED'; reasonCode: 'COPY_FAILED' | 'AUTH_REQUIRED' | 'DEPENDENCY_MISSING' | 'UNKNOWN' | null; source: 'USER'; reportedAt: string }
export interface ConfigurationHistoryEntry { id: string; createdAt: string; status: 'GENERATED'; basis: RecommendationBasis; fingerprint: string; validity: 'CURRENT' | 'STALE'; files: Pick<PreviewFile, 'relativePath' | 'action' | 'afterHash'>[]; verification: { status: 'NOT_RUN'; source: 'NONE' }; latestUserReport: UserConfigurationReport | null }
const ajv = new Ajv({ strict: true }); ajv.addSchema(schema);
function validate<T>(name: string, value: unknown): T {
  if (!ajv.getSchema(`${schema.$id}#/definitions/${name}`)?.(value)) throw new ContractError('INVALID_INPUT');
  assertNoSecretsData(value);
  return structuredClone(value) as T;
}
export function validatePreviewInput(value: unknown): PreviewInput {
  const input = validate<PreviewInput>('preview', value);
  if ((input.existingState === 'PROVIDED') !== (input.existingFiles.length > 0)) throw new ContractError('INVALID_INPUT');
  for (const file of input.existingFiles) if (!/^[A-Za-z0-9_.\/-]+$/.test(file.relativePath) || file.relativePath.startsWith('/') || file.relativePath.split('/').some(part => !part || part === '..' || part === '.')) throw new ContractError('INVALID_PATH');
  if (JSON.stringify(input).includes('\\u0000')) throw new ContractError('INVALID_INPUT');
  if (input.customSkill && (/\b[a-z_$][\w.$]*\s*\([^\n)]*\)|(?:^|\n)\s*[\w.-]+\s+-[\w-]+|\b(?:const|let|function)\s+[a-z_$]|\b[a-z_$][\w.]*\s*=\s*[^=]|[{}]|`/i.test(input.customSkill.description + '\n' + input.customSkill.instructions) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(input.customSkill.name))) throw new ContractError('NATURAL_LANGUAGE_REQUIRED');
  if (input.customSkill && /```|(?:https?|file|ftp):\/\/|\bwww\.|\b(?:curl|wget|powershell|pwsh|cmd\.exe|bash|npm|npx|pnpm|exec|eval|sudo)\b|\b(?:node|python\d*)\s+-|\b(?:process|os|subprocess)\.[a-z_]+\s*\(|\b(?:import|require)\s*(?:\(|[a-z_*{])|=>|(?:^|\n)\s*[$>]\s|<script|#!/i.test(input.customSkill.description + '\n' + input.customSkill.instructions)) throw new ContractError('NATURAL_LANGUAGE_REQUIRED');
  return input;
}
export function validateApprovalInput(value: unknown): ApprovalInput { return validate('approval', value); }
export function validateExportInput(value: unknown): ExportInput { const input = validate<ExportInput>('export', value); input.input = validatePreviewInput(input.input); return input; }
export function validateReportInput(value: unknown): Pick<UserConfigurationReport, 'reportedState' | 'reasonCode'> {
  const report = validate<Pick<UserConfigurationReport, 'reportedState' | 'reasonCode'>>('report', value);
  if ((report.reportedState === 'APPLIED') !== (report.reasonCode === null)) throw new ContractError('INVALID_INPUT');
  return report;
}
