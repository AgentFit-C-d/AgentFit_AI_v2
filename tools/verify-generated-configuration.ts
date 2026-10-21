import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { loadCatalog } from '../apps/api/src/recommendations/catalog';
import { generateFiles } from '../apps/api/src/configuration/generator';
import { checkSelection } from '../apps/api/src/configuration/permissions';
import type { PreviewInput, RecommendationDto } from '../packages/contracts/src';
const catalog = loadCatalog(); const items = catalog.items.filter(x => x.verificationStatus === 'VERIFIED');
const basis = { projectVersion: 2, developerVersion: 1, environmentVersion: 1, catalogRevision: catalog.revision };
const recommendation: RecommendationDto = { id: 'verification', basis, validity: 'CURRENT', createdAt: new Date().toISOString(), status: 'RECOMMENDED', capabilities: [], questions: [], reasons: [], evidenceLevel: 'ENVIRONMENT_DECLARED', items: items.map(item => ({ catalogItemId: item.id, catalogVersion: item.version, supportMatrixId: item.supportMatrix[0]!.id, required: true, reason: '합성 검증', permissionOptions: [], authenticationRequirements: [] })) };
const input: PreviewInput = { recommendationId: recommendation.id, expectedBasis: basis, selectedToolIds: items.map(x => x.id), permissionPolicies: [], existingState: 'UNKNOWN', existingFiles: [], customSkill: { name: 'agentfit-verification-guide', description: '합성 작업 규칙 발견 검사', instructions: '변경 이유를 먼저 설명한다.' } };
const root = resolve('work/harness/configuration/codex-discovery/generated');
const files = generateFiles(checkSelection(recommendation, catalog, input), input);
for (const file of files) { const path = resolve(root, file.relativePath); if (!path.startsWith(root + '\\')) throw new Error('INVALID_TARGET'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.content); }
console.log(JSON.stringify({ files: files.length, fixture: 'public pinned files and synthetic custom rule only' }));
