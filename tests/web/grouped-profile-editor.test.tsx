// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProfileEditor } from '../../apps/web/src/components/ProfileEditor';
import { emptyProfile, type ProfilePatch, type ProjectDto } from '../../packages/contracts/src';
import { analysisResult } from '../support/analysis';
import { resolveReview } from '../../apps/api/src/projects/profile';
afterEach(cleanup);
const project: ProjectDto = { id: 'p1', name: '그룹', version: 1, createdAt: '', updatedAt: '', confirmedProfile: null, draft: null, activeAttempt: null };

test('core feature cleanup is one explicit action, preserves manual edits until clicked and saves only capabilities', async () => {
  const result = analysisResult(); const base = result.candidates[0]!;
  result.candidates = [{ ...base, field: 'features', proposedValue: ['Google-Discord 로그인', '로그인', '승인 회원의 프로젝트 생성', '1:1 요청 전송·재전송', '1:1 요청 전송', '밝은 배경', 'PC 왼쪽 메뉴 · 넓은 본문', '모바일 메뉴', '승인 대기', '본문은 송신자·수신자에게만 공개'] }];
  const original = resolveReview(null, null, { expectedVersion: 1, profile: { ...emptyProfile(), features: ['직접 추가한 기능', '밝은 배경'] } });
  const value = { ...project, confirmedProfile: original, draft: { id: 'd1', version: 1, result } }; let confirmed: ReturnType<typeof resolveReview> | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { confirmed = resolveReview(original, result, patch); return { ...value, version: 2, confirmedProfile: confirmed }; }} />);
  const group = screen.getByLabelText('기능 묶음 검토').closest('.review-group') as HTMLElement;
  const chips = group.querySelector('.review-values') as HTMLElement;
  expect(within(chips).queryByText('밝은 배경')).toBeNull(); expect(within(chips).getAllByText('로그인')).toHaveLength(1);
  const details = within(group).getByText(/세부 요구사항 \d+개 보기/).closest('details') as HTMLDetailsElement;
  expect(details.open).toBe(false); expect(within(details).getByText('모바일 메뉴')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('기능 묶음 검토'), { target: { value: 'EDIT' } });
  expect((screen.getByLabelText('기능 수정') as HTMLTextAreaElement).value).toContain('직접 추가한 기능');
  fireEvent.click(screen.getByRole('button', { name: '핵심 기능 3개로 정리' }));
  expect((screen.getByLabelText('기능 수정') as HTMLTextAreaElement).value).toBe('로그인\n프로젝트 생성\n1:1 요청 전송');
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(confirmed).toBeDefined());
  expect(confirmed?.profile.features).toEqual(['로그인', '프로젝트 생성', '1:1 요청 전송']); expect(confirmed?.sources.features.source).toBe('USER');
  expect(result.candidates[0]?.proposedValue).toContain('밝은 배경');
});

test('cleanup explicitly chooses displayed capabilities when absence conflicts with a core feature', async () => {
  const result = analysisResult(); const base = result.candidates[0]!; let confirmed: ReturnType<typeof resolveReview> | undefined;
  result.candidates = [{ ...base, field: 'features', proposedValue: ['로그인'] }, { ...base, id: 'none', field: 'features', proposedValue: [] }];
  const value = { ...project, draft: { id: 'd1', version: 1, result } };
  render(<ProfileEditor project={value} onSave={async patch => { confirmed = resolveReview(null, result, patch); return { ...value, version: 2, confirmedProfile: confirmed }; }} />);
  fireEvent.click(screen.getByRole('button', { name: '핵심 기능 1개로 정리' }));
  expect((screen.getByLabelText('기능 수정') as HTMLTextAreaElement).value).toBe('로그인');
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(confirmed).toBeDefined());
  expect(confirmed?.profile.features).toEqual(['로그인']); expect(confirmed?.sources.features.source).toBe('USER');
});

test('55 multiline features and composite integration duplicates save through actual review validation', async () => {
  const result = analysisResult(); const base = result.candidates[0]!;
  const features = Array.from({ length: 55 }, (_, index) => `기능 ${index}`);
  result.candidates = [{ ...base, id: 'f1', field: 'features', proposedValue: features.slice(0, 30), status: 'unresolved' }, { ...base, id: 'f2', field: 'features', proposedValue: features.slice(30), status: 'unresolved' }, { ...base, id: 'oauth', field: 'external_integrations', proposedValue: ['Google-Discord OAuth', 'Google OAuth', 'Discord OAuth'] }];
  const value = { ...project, draft: { id: 'd1', version: 1, result } }; let confirmed: ReturnType<typeof resolveReview> | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { confirmed = resolveReview(null, result, patch); return { ...value, version: 2, confirmedProfile: confirmed }; }} />);
  fireEvent.change(screen.getByLabelText('기능 묶음 검토'), { target: { value: 'EDIT' } });
  expect(screen.getByText('55개 / 최대 100개 · 각 항목 최대 200자')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('외부 연동 묶음 검토'), { target: { value: 'EDIT' } });
  expect((screen.getByLabelText('외부 연동 수정') as HTMLTextAreaElement).value).toBe('Google OAuth\nDiscord OAuth');
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }));
  await waitFor(() => expect(confirmed).toBeDefined());
  expect(confirmed?.profile.features).toEqual(features); expect(confirmed?.profile.external_integrations).toEqual(['Google OAuth', 'Discord OAuth']);
  expect(confirmed?.sources.features.source).toBe('USER');
});

test('same React on two pages is one visible group and preserves both document sources when accepted', async () => {
  const result = analysisResult(); const base = result.candidates[0]!;
  result.candidates = [{ ...base, id: 'react-3', field: 'frontend', proposedValue: ['React'], evidence: [{ ...base.evidence[0]!, page: 3 }] }, { ...base, id: 'react-7', field: 'frontend', proposedValue: ['React'], evidence: [{ ...base.evidence[0]!, page: 7 }] }];
  const value = { ...project, draft: { id: 'd1', version: 1, result } }; let submitted: ProfilePatch | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { submitted = patch; return { ...value, version: 2 }; }} />);
  expect(screen.getAllByRole('combobox', { name: '프론트엔드 묶음 검토' })).toHaveLength(1);
  const group = screen.getByRole('combobox', { name: '프론트엔드 묶음 검토' }).closest('.review-group') as HTMLElement;
  expect(within(group).getAllByText('React', { exact: true })).toHaveLength(1); expect(within(group).getByText('근거 3, 7쪽')).toBeTruthy();
  expect((within(group).getByText('근거·확인 사항 보기', { selector: 'summary' }).closest('details') as HTMLDetailsElement).open).toBe(false);
  fireEvent.change(screen.getByLabelText('프론트엔드 묶음 검토'), { target: { value: 'ACCEPT' } }); fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(submitted).toBeDefined());
  const confirmed = resolveReview(null, result, submitted!); expect(confirmed.profile.frontend).toEqual(['React']); expect(confirmed.sources.frontend.source).toBe('DOCUMENT'); expect(confirmed.sources.frontend.evidence.map(evidence => evidence.page)).toEqual([3, 7]);
});

test('AI superset and subset candidates use a single multiline editor and preserve original decisions', async () => {
  const result = analysisResult(); const base = result.candidates[0]!;
  result.candidates = [{ ...base, id: 'ai-all', field: 'ai', proposedValue: ['Solar, Embed, LangGraph'], status: 'unresolved' }, { ...base, id: 'ai-solar', field: 'ai', proposedValue: ['Solar'], status: 'unresolved' }, { ...base, id: 'ai-embed', field: 'ai', proposedValue: ['Embed'], status: 'unresolved' }];
  const value = { ...project, draft: { id: 'd1', version: 1, result } }; let submitted: ProfilePatch | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { submitted = patch; return { ...value, version: 2 }; }} />);
  fireEvent.change(screen.getByLabelText('AI 묶음 검토'), { target: { value: 'EDIT' } });
  const input = screen.getByRole('textbox', { name: 'AI 수정' }) as HTMLTextAreaElement; expect(input.tagName).toBe('TEXTAREA'); expect(input.value).toBe('Solar\nEmbed\nLangGraph');
  const finalInput = screen.getByLabelText('AI 값') as HTMLTextAreaElement;
  expect(finalInput.tagName).toBe('TEXTAREA'); expect(finalInput.value).toBe('Solar\nEmbed\nLangGraph');
  fireEvent.change(input, { target: { value: 'Solar Pro 4\nEmbed 2\nLangGraph' } }); fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(submitted).toBeDefined());
  const profile = submitted!.profile;
  expect(profile.ai).toEqual(['Solar Pro 4', 'Embed 2', 'LangGraph']); expect(submitted?.reviewDecisions?.map(decision => decision.itemId)).toEqual(['ai-all', 'ai-solar', 'ai-embed']); expect(submitted?.reviewDecisions?.every(decision => decision.action === 'EDIT' && JSON.stringify(decision.editedValue) === JSON.stringify(profile.ai))).toBe(true);
});

test('shows grounded technology purposes without adding them to the saved names', async () => {
  const result = analysisResult(); const base = result.candidates[0]!; let submitted: ProfilePatch | undefined;
  result.candidates = [{ ...base, field: 'ai', proposedValue: ['Solar', 'Embed'], usages: [{ value: 'Solar', purpose: '답변 생성', evidence: base.evidence }, { value: 'Embed', purpose: '임베딩', evidence: base.evidence }] }];
  const value = { ...project, draft: { id: 'd1', version: 1, result } };
  render(<ProfileEditor project={value} onSave={async patch => { submitted = patch; return { ...value, version: 2 }; }} />);
  expect(screen.getByText('답변 생성')).toBeTruthy(); expect(screen.getByText('임베딩')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('AI 묶음 검토'), { target: { value: 'ACCEPT' } }); fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted?.profile.ai).toEqual(['Solar', 'Embed']);
});

test('case-normalized duplicates keep purposes and evidence from both original candidates', () => {
  const result = analysisResult(); const base = result.candidates[0]!;
  result.candidates = [{ ...base, id: 'react3', field: 'frontend', proposedValue: ['React'], evidence: [{ ...base.evidence[0]!, page: 3 }], usages: [{ value: 'React', purpose: '화면 구현', evidence: base.evidence }] }, { ...base, id: 'react7', field: 'frontend', proposedValue: [' react '], evidence: [{ ...base.evidence[0]!, page: 7 }], usages: [{ value: ' react ', purpose: '상태 관리', evidence: base.evidence }] }];
  render(<ProfileEditor project={{ ...project, draft: { id: 'd1', version: 1, result } }} onSave={async () => project} />);
  expect(screen.getByText('화면 구현 · 상태 관리')).toBeTruthy();
  expect(screen.getByText('React · 근거 3, 7쪽')).toBeTruthy();
});
