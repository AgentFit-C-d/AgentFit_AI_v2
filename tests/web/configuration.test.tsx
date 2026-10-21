// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createApiClient } from '../../apps/web/src/lib/api';
import { ConfigurationPanel } from '../../apps/web/src/components/ConfigurationPanel';
import { configFixture } from '../support/configuration';
afterEach(cleanup);
test('requires separate final approval, exports submitted input and clears content after completion', async () => {
  const user = userEvent.setup(); const { recommendation } = configFixture(); const requests: string[] = []; let received: Blob | undefined;
  const preview = { id: 'preview', createdAt: '2026-10-06', expiresAt: '2026-10-07', fingerprint: 'a'.repeat(64), files: [{ targetKey: 'guide', relativePath: 'AGENTFIT-APPLY.md', action: 'PROPOSAL', comparisonScope: 'EXISTING_UNKNOWN', beforeHash: null, afterHash: 'b'.repeat(64), content: '합성 설정 본문', diff: null }], warnings: [{ code: 'EXISTING_UNKNOWN', message: '기존 파일 미확인', targetKey: null }] };
  const client = createApiClient(async (path, init) => { requests.push(String(path)); if (String(path).endsWith('/config-previews')) return Response.json({ preview }); if (String(path).endsWith('/config-approvals')) return Response.json({ approval: { id: 'approved', previewId: preview.id, fingerprint: preview.fingerprint } }); if (String(path).endsWith('/config-exports')) { const body = JSON.parse(String(init?.body)); expect(body.input.selectedToolIds).toEqual(recommendation.items.map(x => x.catalogItemId)); expect(body.previewFingerprint).toBe(preview.fingerprint); return new Response(new Uint8Array([80, 75, 3, 4]), { headers: { 'Content-Type': 'application/zip', 'X-Configuration-Id': 'generated' } }); } return Response.json({ entries: [], nextCursor: null }); });
  render(<ConfigurationPanel projectId="p" recommendation={recommendation} selectedIds={recommendation.items.map(x => x.catalogItemId)} client={client} onDownload={blob => { received = blob; }} />);
  await user.click(screen.getByRole('button', { name: '설정 미리보기 만들기' }));
  expect(await screen.findByText('합성 설정 본문')).toBeTruthy();
  expect(screen.getByText('기존 파일 미확인', { selector: 'p' })).toBeTruthy();
  const download = screen.getByRole('button', { name: '최종 승인하고 ZIP 다운로드' }); expect((download as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByLabelText('표시된 파일과 확인 범위를 검토했고 이 내용의 생성을 승인합니다.'));
  await user.click(download);
  expect(await screen.findByText(/다운로드를 시작했습니다/)).toBeTruthy(); expect(received?.type).toBe('application/zip'); expect(screen.queryByText('합성 설정 본문')).toBeNull();
  expect(requests.filter(x => x.endsWith('/config-exports'))).toHaveLength(1);
});
test('cancel ignores late Preview response and failures preserve natural-language edits', async () => {
  const user = userEvent.setup(); const { recommendation } = configFixture();
  const client = createApiClient(async path => { if (String(path).endsWith('/config-previews')) return Response.json({ error: { code: 'CONFIGURATION_STALE' } }, { status: 409 }); return Response.json({ entries: [], nextCursor: null }); });
  render(<ConfigurationPanel projectId="p" recommendation={recommendation} selectedIds={recommendation.items.map(x => x.catalogItemId)} client={client} />);
  await user.click(screen.getByLabelText('내 작업 규칙 Skill 추가'));
  await user.type(screen.getByLabelText('Skill 이름'), 'my-guide'); await user.type(screen.getByLabelText('Skill 설명'), '설명'); await user.type(screen.getByLabelText('자연어 작업 규칙'), '작게 검토한다.');
  await user.click(screen.getByRole('button', { name: '설정 미리보기 만들기' }));
  expect(await screen.findByRole('alert')).toBeTruthy(); expect((screen.getByLabelText('자연어 작업 규칙') as HTMLTextAreaElement).value).toBe('작게 검토한다.');
  await user.click(screen.getByRole('button', { name: '설정 검토 취소' }));
  expect(screen.queryByLabelText('자연어 작업 규칙')).toBeNull();
});
test('cancel aborts a pending request holding submitted original bytes', async () => {
  const user = userEvent.setup(); const { recommendation } = configFixture(); let aborted = false;
  const client = createApiClient(async (path, init) => { if (!String(path).endsWith('/config-previews')) return Response.json({ entries: [], nextCursor: null }); return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }); }); }); render(<ConfigurationPanel projectId="p" recommendation={recommendation} selectedIds={recommendation.items.map(x => x.catalogItemId)} client={client} />); await user.click(screen.getByRole('button', { name: '설정 미리보기 만들기' })); await user.click(screen.getByRole('button', { name: '설정 검토 취소' })); expect(aborted).toBe(true);
});

test('empty enabled custom rule opens the fields and explains how to proceed before submitting', async () => {
  const user = userEvent.setup(); const { recommendation } = configFixture(); let submitted = 0;
  const client = createApiClient(async path => { if (String(path).endsWith('/config-previews')) { submitted++; return Response.json({ error: { code: 'INVALID_INPUT' } }, { status: 422 }); } return Response.json({ entries: [], nextCursor: null }); });
  render(<ConfigurationPanel projectId="p" recommendation={recommendation} selectedIds={recommendation.items.map(x => x.catalogItemId)} client={client} />);
  await user.click(screen.getByText('내 작업 규칙 추가', { exact: true })); await user.click(screen.getByLabelText('내 작업 규칙 Skill 추가'));
  await user.click(screen.getByText('내 작업 규칙 추가', { exact: true }));
  await user.click(screen.getByRole('button', { name: '설정 미리보기 만들기' }));
  expect((await screen.findByRole('alert')).textContent).toContain('이름·설명·작업 규칙');
  expect((screen.getByText('내 작업 규칙 추가', { exact: true }).closest('details') as HTMLDetailsElement).open).toBe(true);
  expect(document.activeElement).toBe(screen.getByLabelText('Skill 이름')); expect(submitted).toBe(0);
  await user.click(screen.getByLabelText('내 작업 규칙 Skill 추가')); await user.click(screen.getByRole('button', { name: '설정 미리보기 만들기' })); expect(submitted).toBe(1);
});

test('custom description exceeding server code-point limit stays editable and is not submitted', async () => {
  const user = userEvent.setup(); const { recommendation } = configFixture(); let submitted = 0;
  const client = createApiClient(async path => { if (String(path).endsWith('/config-previews')) submitted++; return Response.json({ entries: [], nextCursor: null }); });
  render(<ConfigurationPanel projectId="p" recommendation={recommendation} selectedIds={recommendation.items.map(x => x.catalogItemId)} client={client} />);
  await user.click(screen.getByLabelText('내 작업 규칙 Skill 추가')); await user.type(screen.getByLabelText('Skill 이름'), 'guide'); await user.type(screen.getByLabelText('Skill 설명'), '가'.repeat(201)); await user.type(screen.getByLabelText('자연어 작업 규칙'), '작게 검토한다.'); await user.click(screen.getByRole('button', { name: '설정 미리보기 만들기' }));
  expect((await screen.findByRole('alert')).textContent).toContain('200자'); expect(document.activeElement).toBe(screen.getByLabelText('Skill 설명')); expect((screen.getByLabelText('Skill 설명') as HTMLInputElement).value.length).toBe(201); expect(submitted).toBe(0);
});
