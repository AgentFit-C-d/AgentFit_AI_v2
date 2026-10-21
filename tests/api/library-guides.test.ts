import { expect, test } from 'vitest';
import { loadCatalog } from '../../apps/api/src/recommendations/catalog';
import { buildPreview } from '../../apps/api/src/configuration/preview';
import { checkSelection } from '../../apps/api/src/configuration/permissions';
import { configFixture } from '../support/configuration';
import { zipFiles } from '../../apps/api/src/configuration/zip';
import { unzipSync, strFromU8 } from '../../apps/api/node_modules/fflate';
import { generateFiles } from '../../apps/api/src/configuration/generator';
import { checkPackage } from '../../apps/api/src/skills/package';

test.each(['obra-test-driven-development', 'vercel-labs-vercel-react-best-practices', 'prisma-prisma-client-api'])('one matching member of %s exports a library installation guide without skill files', id => {
  const { input, recommendation } = configFixture();
  const catalog = loadCatalog(); const item = catalog.items.find(item => item.id === id)!;
  recommendation.items = [{ catalogItemId: item.id, catalogVersion: item.version, supportMatrixId: item.supportMatrix[0]!.id, required: false, reason: '프로젝트 구현을 돕습니다.', permissionOptions: [], authenticationRequirements: [] }];
  const selectedInput = { ...input, selectedToolIds: [id] };
  const preview = buildPreview(input.expectedBasis, selectedInput, checkSelection(recommendation, catalog, selectedInput));
  const archive = unzipSync(zipFiles(preview.files));
  expect(Object.keys(archive).sort()).toEqual(['AGENTFIT-APPLY.md', 'AGENTFIT-SOURCES.md']);
  const guide = strFromU8(archive['AGENTFIT-APPLY.md']!);
  expect(guide).toContain(`https://github.com/${item.repository}`);
  expect(guide).toContain('공식 설치 안내');
});

test('several matches from the same library export one source entry and preserve a custom local skill', () => {
  const { input, recommendation } = configFixture(); const catalog = loadCatalog();
  const items = catalog.items.filter(item => item.repository === 'obra/superpowers' && item.verificationStatus === 'VERIFIED');
  recommendation.items = items.map(item => ({ catalogItemId: item.id, catalogVersion: item.version, supportMatrixId: item.supportMatrix[0]!.id, required: false, reason: '개발 과정 지원', permissionOptions: [], authenticationRequirements: [] }));
  const selectedInput = { ...input, selectedToolIds: items.map(item => item.id), customSkill: { name: 'my-guide', description: '내 규칙', instructions: '결과를 확인한다.' } };
  const preview = buildPreview(input.expectedBasis, selectedInput, checkSelection(recommendation, catalog, selectedInput));
  const archive = unzipSync(zipFiles(preview.files));
  expect(Object.keys(archive).sort()).toEqual(['.agents/skills/my-guide/SKILL.md', 'AGENTFIT-APPLY.md', 'AGENTFIT-SOURCES.md']);
  expect(strFromU8(archive['AGENTFIT-SOURCES.md']!).match(/^- Superpowers:/gm)).toHaveLength(1);
  expect(strFromU8(archive['.agents/skills/my-guide/SKILL.md']!)).toContain('결과를 확인한다.');
});

test('a custom skill can reuse the name of a library member that is no longer bundled', () => {
  const { input, recommendation, catalog } = configFixture();
  const selectedInput = { ...input, customSkill: { name: 'vercel-react-best-practices', description: '내 검토 규칙', instructions: '변경 이유를 확인한다.' } };
  const files = generateFiles(checkSelection(recommendation, catalog, selectedInput), selectedInput);
  expect(files.map(file => file.relativePath)).toEqual(['.agents/skills/vercel-react-best-practices/SKILL.md', 'AGENTFIT-APPLY.md', 'AGENTFIT-SOURCES.md']);
  expect(files[0]!.content).toContain('변경 이유를 확인한다.');
});

test('different libraries with the same member name can both export installation guidance', () => {
  const { input, recommendation, item } = configFixture();
  const packages = ['alpha/tools', 'beta/tools'].map(repository => checkPackage(`${repository}/testing`, 'a'.repeat(40), [{ path: 'SKILL.md', content: '---\nname: testing\ndescription: Test the project\n---\nReview test coverage.' }, { path: 'LICENSE.txt', content: 'MIT License' }]));
  const items = packages.map(pkg => ({ ...item, id: `discovered-${pkg.hash}`, name: pkg.name, skillsUrl: `https://skills.sh/${pkg.id}`, repository: pkg.repository, version: pkg.commit, commit: pkg.commit, package: pkg }));
  const files = generateFiles({ items, recommendation, snapshots: packages }, { ...input, selectedToolIds: items.map(item => item.id) });
  expect(files.map(file => file.relativePath)).toEqual(['AGENTFIT-APPLY.md', 'AGENTFIT-SOURCES.md']);
  expect(files[0]!.content).toContain('https://github.com/alpha/tools#readme');
  expect(files[0]!.content).toContain('https://github.com/beta/tools#readme');
});
