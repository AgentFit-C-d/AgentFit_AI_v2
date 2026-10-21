import { expect, test } from 'vitest';
import { validatePreviewInput, validateApprovalInput, validateExportInput, validateReportInput } from '../../packages/contracts/src';
import { configFixture } from '../support/configuration';
test('accepts strict natural-language input, rejects extra fields, bad paths and executable custom skills', () => {
  const { input } = configFixture();
  expect(validatePreviewInput(input)).toEqual(input);
  for (const bad of [{ ...input, forged: true }, { ...input, selectedToolIds: [...input.selectedToolIds, ...input.selectedToolIds] }, { ...input, existingState: 'PROVIDED', existingFiles: [] }, { ...input, existingState: 'PROVIDED', existingFiles: [{ targetKey: 'skill', relativePath: '../.env', content: 'hello' }] }, { ...input, customSkill: { name: 'custom', description: '설명', instructions: 'curl https://evil.invalid' } }, { ...input, customSkill: { name: 'custom', description: '설명', instructions: '```bash\necho secret\n```' } }]) expect(() => validatePreviewInput(bad)).toThrow();
  expect(validatePreviewInput({ ...input, customSkill: { name: 'team-guide', description: '리뷰', instructions: '변경 이유를 먼저 설명하고 작은 단위로 검토한다.' } }).customSkill?.name).toBe('team-guide');
});
test('custom natural-language boundary also blocks JavaScript/Python execution and non-HTTP URLs', () => {
  const { input } = configFixture();
  for (const instructions of ['node -e "process.exit(0)"', 'python -c "print(1)"', 'process.exit(0)', 'file:///C:/Users/example/.env', 'import os; os.system("echo hi")', '() => fetch("https://example.invalid")']) expect(() => validatePreviewInput({ ...input, customSkill: { name: 'a', description: '설명', instructions } })).toThrow();
});
test.each(['Remove-Item -Recurse -Force .', 'rm -rf ./build', 'print(1)'])('rejects executable custom rule %s', instructions => { const { input } = configFixture(); expect(() => validatePreviewInput({ ...input, customSkill: { name: 'guide', description: '설명', instructions } })).toThrow(); });
test.each(['con', 'nul', 'aux', 'com1', 'lpt9'])('rejects Windows reserved Skill name %s', name => { const { input } = configFixture(); expect(() => validatePreviewInput({ ...input, customSkill: { name, description: '설명', instructions: '작게 검토한다.' } })).toThrow(); });
test('checks exact code-point boundaries, secrets, approval/export and truthful reports', () => {
  const { input } = configFixture();
  expect(validatePreviewInput({ ...input, customSkill: { name: 'a', description: '😀'.repeat(200), instructions: '가'.repeat(10000) } })).toBeTruthy();
  expect(() => validatePreviewInput({ ...input, customSkill: { name: 'a', description: '😀'.repeat(201), instructions: '가' } })).toThrow();
  expect(() => validatePreviewInput({ ...input, existingState: 'PROVIDED', existingFiles: [{ targetKey: 'a', relativePath: 'AGENTS.md', content: 'password=synthetic-password-value' }] })).toThrow();
  const approval = { previewId: 'a', previewFingerprint: 'a'.repeat(64), confirmation: true };
  expect(validateApprovalInput(approval)).toEqual(approval);
  expect(() => validateApprovalInput({ ...approval, confirmation: false })).toThrow();
  expect(() => validateExportInput({ approvalId: 'b', previewId: 'a', previewFingerprint: 'a'.repeat(64), input, installed: true })).toThrow();
  expect(() => validateReportInput({ reportedState: 'FAILED', reasonCode: null })).toThrow();
  expect(() => validateReportInput({ reportedState: 'APPLIED', reasonCode: null, verified: true })).toThrow();
});
