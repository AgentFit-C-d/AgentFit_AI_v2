import { expect, test } from 'vitest';
import { generateFiles } from '../../apps/api/src/configuration/generator';
import { checkSelection } from '../../apps/api/src/configuration/permissions';
import { mergeManaged, mergeToml } from '../../apps/api/src/configuration/merge';
import { sha256 } from '../../apps/api/src/configuration/hash';
import { configFixture } from '../support/configuration';
import debugSnapshot from '../../packages/catalog/snapshots/obra-systematic-debugging.json';
import planningSnapshot from '../../packages/catalog/snapshots/obra-writing-plans.json';

test('a source not identified as a library retains its pinned individual Skill and license', () => {
  const { input, recommendation, item } = configFixture();
  const planning = { ...item, id: planningSnapshot.id, name: planningSnapshot.name, commit: planningSnapshot.commit, version: planningSnapshot.commit, skillsUrl: 'https://example.invalid/planning' };
  const files = generateFiles({ items: [planning], recommendation }, { ...input, selectedToolIds: [planning.id] });
  expect(files.some(file => file.relativePath === '.agents/skills/writing-plans/SKILL.md' && file.content.includes('## Review Focus'))).toBe(true);
  expect(files.some(file => file.relativePath === '.agents/skills/writing-plans/LICENSE.txt')).toBe(true);
});

test('an unidentified individual source keeps pinned references and excludes executable scripts', () => {
  const { input, recommendation, item } = configFixture();
  const debug = { ...item, id: debugSnapshot.id, name: debugSnapshot.name, commit: debugSnapshot.commit, version: debugSnapshot.commit, skillsUrl: 'https://example.invalid/debugging' };
  const selected = { ...input, selectedToolIds: [debug.id] };
  const files = generateFiles({ items: [debug], recommendation }, selected);
  expect(files.some(file => file.relativePath === '.agents/skills/systematic-debugging/SKILL.md')).toBe(true);
  expect(files.some(file => file.relativePath === '.agents/skills/systematic-debugging/root-cause-tracing.md')).toBe(true);
  expect(files.some(file => file.relativePath === '.agents/skills/systematic-debugging/LICENSE.txt')).toBe(true);
  expect(files.every(file => !file.relativePath.endsWith('.sh'))).toBe(true);
});
test('library guides are proposals with no fabricated diff and unchanged metadata semantics', () => {
  const { input, recommendation, catalog } = configFixture();
  const files = generateFiles(checkSelection(recommendation, catalog, input), input);
  expect(files.map(file => file.relativePath)).toEqual(['AGENTFIT-APPLY.md', 'AGENTFIT-SOURCES.md']);
  expect(files.some(x => x.relativePath === 'AGENTFIT-APPLY.md')).toBe(true);
  for (const file of files) { expect(file).toMatchObject({ action: 'PROPOSAL', beforeHash: null, diff: null, comparisonScope: 'EXISTING_UNKNOWN' }); expect(file.afterHash).toBe(sha256(file.content)); }
  expect(generateFiles(checkSelection(recommendation, catalog, input), { ...input, existingState: 'USER_SAYS_EMPTY' })).toEqual(files);
});
test('merges only supplied managed file and preserves surrounding text; conflicts and unsupported paths fail', () => {
  const { input, recommendation, catalog } = configFixture(); const selection = checkSelection(recommendation, catalog, input);
  const file = generateFiles(selection, input).find(x => x.relativePath === 'AGENTFIT-APPLY.md')!;
  const existing = '개인 메모\r\n' + file.content + '\n보존';
  const next = generateFiles(selection, { ...input, existingState: 'PROVIDED', existingFiles: [{ targetKey: file.targetKey, relativePath: file.relativePath, content: existing }] });
  const updated = next.find(x => x.relativePath === file.relativePath)!;
  expect(updated.content).toBe(existing); expect(updated.diff).toContain('Index:'); expect(updated.beforeHash).toBe(sha256(existing));
  expect(next.filter(x => x.action === 'UPDATE')).toHaveLength(1);
  expect(() => generateFiles(selection, { ...input, existingState: 'PROVIDED', existingFiles: [{ targetKey: file.targetKey, relativePath: file.relativePath, content: '개인 원본' }] })).toThrow();
  expect(() => generateFiles(selection, { ...input, existingState: 'PROVIDED', existingFiles: [{ targetKey: 'unknown', relativePath: '.env', content: '원본' }] })).toThrow();
});
test('managed blocks and TOML refuse malformed/conflicting settings without dropping unrelated content', () => {
  const generated = '<!-- agentfit:a:start -->\n신규\n<!-- agentfit:a:end -->';
  expect(mergeManaged('앞\n<!-- agentfit:a:start -->\n이전\n<!-- agentfit:a:end -->\n뒤', generated, 'a')).toBe('앞\n' + generated + '\n뒤');
  expect(() => mergeManaged('앞\n<!-- agentfit:a:start -->', generated, 'a')).toThrow();
  const toml = '# 내 주석\nmodel = "x"\n\n[mcp_servers.other]\nurl = "https://example.invalid"\n';
  const addition = '[mcp_servers.readonly]\nenabled = false\n';
  expect(mergeToml(toml, 'readonly', addition).startsWith(toml)).toBe(true);
  expect(mergeToml(toml, 'readonly', addition)).toContain(addition);
  expect(() => mergeToml('[broken', 'readonly', addition)).toThrow();
  expect(() => mergeToml(toml + '[mcp_servers.readonly]\nenabled=true\n', 'readonly', addition)).toThrow();
});
