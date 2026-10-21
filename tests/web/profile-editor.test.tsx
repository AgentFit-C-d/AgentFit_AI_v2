// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProfileEditor } from '../../apps/web/src/components/ProfileEditor';
import { type ProfilePatch, type ProjectDto } from '../../packages/contracts/src';
import { analysisResult } from '../support/analysis';
afterEach(cleanup);

test.each(['COMPLETED', 'FAILED', 'SKIPPED_TIME'] as const)('shows actual review state %s with original PDF metadata', status => {
  const result = analysisResult();
  result.modelMetadata = { ...result.modelMetadata, provider: 'upstage', inputFormat: 'original-pdf', secondaryReview: { provider: 'nvidia', model: 'test-model', status, targetCount: 2, acceptedCount: status === 'COMPLETED' ? 1 : 0, latencyMs: 10 } };
  render(<ProfileEditor project={{ ...project(), draft: { id: 'd1', version: 1, result } }} onSave={async () => project()} />);
  expect(screen.getByText(/원본 PDF의 표·제목 구조/)).toBeTruthy();
  expect(screen.getByText(status === 'COMPLETED' ? /추가 검토 2개 묶음 중 1개/ : /첫 분석 결과를 유지했습니다/)).toBeTruthy();
  expect(screen.getByLabelText('백엔드 묶음 검토')).toBeTruthy();
});

test('editing one model in the group keeps the second model and saves both', async () => {
  const result = analysisResult(); const base = result.candidates[0]!;
  result.candidates = [{ ...base, id: 'ai-solar', field: 'ai', proposedValue: ['Upstage Solar Pro 4'], status: 'unresolved' }, { ...base, id: 'ai-embed', field: 'ai', proposedValue: ['Upstage Embed 2'], status: 'unresolved' }];
  const value = { ...project(), draft: { id: 'd1', version: 1, result } }; let submitted: ProfilePatch | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { submitted = patch; return { ...value, version: 2 }; }} />);
  fireEvent.change(screen.getByLabelText('AI 묶음 검토'), { target: { value: 'EDIT' } });
  const input = screen.getByRole('textbox', { name: 'AI 수정' }) as HTMLTextAreaElement;
  expect(input.value).toBe('Upstage Solar Pro 4\nUpstage Embed 2');
  fireEvent.change(input, { target: { value: input.value.replace('Upstage Solar Pro 4', 'Solar Pro 4') } });
  expect(input.value).toBe('Solar Pro 4\nUpstage Embed 2');
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted?.profile.ai).toEqual(['Solar Pro 4', 'Upstage Embed 2']);
  expect(submitted?.reviewDecisions?.map(decision => decision.editedValue)).toEqual([['Solar Pro 4', 'Upstage Embed 2'], ['Solar Pro 4', 'Upstage Embed 2']]);
});

test('removing one value from a group preserves the remaining model through defer and edit', async () => {
  const result = analysisResult(); const base = result.candidates[0]!;
  result.candidates = [{ ...base, id: 'ai-1', field: 'ai', proposedValue: ['Solar'] }, { ...base, id: 'ai-2', field: 'ai', proposedValue: ['Embed'] }];
  const value = { ...project(), draft: { id: 'd1', version: 1, result } }; let submitted: ProfilePatch | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { submitted = patch; return { ...value, version: 2 }; }} />);
  fireEvent.change(screen.getByLabelText('AI 묶음 검토'), { target: { value: 'EDIT' } });
  fireEvent.change(screen.getByLabelText('AI 수정'), { target: { value: 'Embed' } });
  fireEvent.change(screen.getByLabelText('AI 묶음 검토'), { target: { value: 'DEFER' } });
  fireEvent.change(screen.getByLabelText('AI 묶음 검토'), { target: { value: 'EDIT' } });
  expect((screen.getByLabelText('AI 값') as HTMLInputElement).value).toBe('Embed');
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(submitted).toBeDefined()); expect(submitted?.profile.ai).toEqual(['Embed']);
  expect((screen.getByLabelText('AI 수정') as HTMLTextAreaElement).value).toBe('Embed');
});

test('combines independent deployment and integration edits without sharing their input values', async () => {
  const result = analysisResult(); const base = result.candidates[0]!;
  result.candidates = [{ ...base, id: 'deploy-1', field: 'deployment', proposedValue: 'Vercel' }, { ...base, id: 'deploy-2', field: 'deployment', proposedValue: 'GCP' }, { ...base, id: 'link-1', field: 'external_integrations', proposedValue: ['GitHub'] }, { ...base, id: 'link-2', field: 'external_integrations', proposedValue: ['Upstage'] }];
  const value = { ...project(), draft: { id: 'd1', version: 1, result } }; let submitted: ProfilePatch | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { submitted = patch; return { ...value, version: 2 }; }} />);
  fireEvent.change(screen.getByLabelText('배포 환경 묶음 검토'), { target: { value: 'EDIT' } });
  fireEvent.change(screen.getByLabelText('외부 연동 묶음 검토'), { target: { value: 'EDIT' } });
  expect((screen.getByLabelText('배포 환경 수정') as HTMLTextAreaElement).value).toBe('Vercel, GCP');
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted?.profile.deployment).toBe('Vercel, GCP'); expect(submitted?.profile.external_integrations).toEqual(['GitHub', 'Upstage']);
});

test('explicit absence cannot silently override another selected integration value', async () => {
  const result = analysisResult(); const base = result.candidates[0]!;
  result.candidates = [{ ...base, id: 'link-1', field: 'external_integrations', proposedValue: ['GitHub'] }, { ...base, id: 'link-2', field: 'external_integrations', proposedValue: [] }];
  const value = { ...project(), draft: { id: 'd1', version: 1, result } }; const onSave = vi.fn(async (_patch: ProfilePatch) => value);
  render(<ProfileEditor project={value} onSave={onSave} />);
  expect((screen.getByRole('option', { name: '문서 내용 반영' }) as HTMLOptionElement).disabled).toBe(true);
  expect(screen.getByText(/없음과 사용 항목이 함께/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('외부 연동 묶음 검토'), { target: { value: 'EDIT' } });
  expect((screen.getByLabelText('외부 연동 수정 상태') as HTMLSelectElement).value).toBe('unknown');
  fireEvent.change(screen.getByLabelText('외부 연동 수정 상태'), { target: { value: 'value' } });
  fireEvent.change(screen.getByLabelText('외부 연동 수정'), { target: { value: 'GitHub' } });
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]![0].profile.external_integrations).toEqual(['GitHub']);
});

test('direct final editing shares the group value and saves original decisions as user edits', async () => {
  const result = analysisResult(); const base = result.candidates[0]!; result.candidates = [{ ...base, id: 'ai-1', field: 'ai', proposedValue: ['Solar'] }, { ...base, id: 'ai-2', field: 'ai', proposedValue: ['Embed'] }];
  const value = { ...project(), draft: { id: 'd1', version: 1, result } }; let submitted: ProfilePatch | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { submitted = patch; return { ...value, version: 2 }; }} />);
  fireEvent.change(screen.getByLabelText('AI 묶음 검토'), { target: { value: 'EDIT' } });
  fireEvent.change(screen.getByLabelText('AI 값'), { target: { value: '사용자 최종 모델' } });
  expect((screen.getByLabelText('AI 수정') as HTMLTextAreaElement).value).toBe('사용자 최종 모델');
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(submitted).toBeDefined()); expect(submitted?.profile.ai).toEqual(['사용자 최종 모델']); expect(submitted?.reviewDecisions?.every(decision => decision.action === 'EDIT')).toBe(true);
});

test('blank independent edit is not silently discarded when another candidate has a value', async () => {
  const result = analysisResult(); const base = result.candidates[0]!; result.candidates = [{ ...base, id: 'ai-1', field: 'ai', proposedValue: ['Solar'] }, { ...base, id: 'ai-2', field: 'ai', proposedValue: ['Embed'] }];
  const value = { ...project(), draft: { id: 'd1', version: 1, result } }; const onSave = vi.fn(async () => value); render(<ProfileEditor project={value} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('AI 묶음 검토'), { target: { value: 'EDIT' } });
  fireEvent.change(screen.getAllByRole('textbox', { name: 'AI 수정' })[0]!, { target: { value: '' } }); fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy()); expect(onSave).not.toHaveBeenCalled();
});

test('candidate aggregation preserves prior manual input and clears old baselines on explicit draft replacement', async () => {
  const result = analysisResult(); const base = result.candidates[0]!; result.candidates = [{ ...base, id: 'ai-1', field: 'ai', proposedValue: ['Solar'] }, { ...base, id: 'ai-2', field: 'ai', proposedValue: ['Embed'] }];
  const value = { ...project(), draft: { id: 'd1', version: 1, result } }; const nextResult = { ...result, candidates: result.candidates.map(candidate => ({ ...candidate, id: candidate.id + '-new' })) }; const latest = { ...project(), version: 2, draft: { id: 'd2', version: 1, result: nextResult } };
  render(<ProfileEditor project={value} onSave={async () => value} onReload={async () => latest} />);
  fireEvent.change(screen.getByLabelText('AI 상태'), { target: { value: 'value' } }); fireEvent.change(screen.getByLabelText('AI 값'), { target: { value: '기존 직접 입력' } });
  fireEvent.change(screen.getByLabelText('AI 묶음 검토'), { target: { value: 'EDIT' } });
  expect((screen.getByLabelText('AI 값') as HTMLInputElement).value).toBe('기존 직접 입력');
  fireEvent.click(screen.getByRole('button', { name: '저장된 값 불러오기' })); await waitFor(() => expect(screen.getByRole('button', { name: '최신 저장값으로 교체' })).toBeTruthy()); fireEvent.click(screen.getByRole('button', { name: '최신 저장값으로 교체' }));
  fireEvent.change(screen.getByLabelText('AI 묶음 검토'), { target: { value: 'EDIT' } });
  expect((screen.getByLabelText('AI 값') as HTMLInputElement).value).toBe('Solar\nEmbed');
});

test('edits in the candidate card and preserves shared values without moving to the lower form', async () => {
  const result = analysisResult(); const value = { ...project(), draft: { id: 'd1', version: 1, result } }; let submitted: ProfilePatch | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { submitted = patch; return { ...value, version: 2 }; }} />);
  fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: 'EDIT' } });
  const card = screen.getByLabelText('백엔드 묶음 검토').closest('.review-group')!;
  const input = within(card as HTMLElement).getByRole('textbox', { name: '백엔드 수정' }) as HTMLInputElement;
  expect(input.value).toBe('Express.js'); await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.change(input, { target: { value: 'Express.js, Node.js' } });
  expect((screen.getByLabelText('백엔드 값') as HTMLInputElement).value).toBe('Express.js, Node.js');
  expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted?.reviewDecisions?.[0]).toMatchObject({ action: 'EDIT', editedValue: ['Express.js', 'Node.js'] });
});

test('unmentioned optional information is collapsed instead of demanding candidate review', () => {
  const value = { ...project(), draft: { id: 'd1', version: 1, result: analysisResult() } };
  render(<ProfileEditor project={value} onSave={async () => value} />);
  const details = screen.getByText(/문서에 없는 정보.*선택/, { selector: 'summary' }).closest('details')!;
  expect(details.open).toBe(false); expect(details.textContent).toContain('데이터베이스');
  expect((screen.getByRole('button', { name: '확인하고 저장' }) as HTMLButtonElement).disabled).toBe(false);
});

test('pending review count follows explicit decisions and does not ask again for a reviewed candidate', () => {
  const result = analysisResult(); result.candidates[0]!.status = 'unresolved';
  const value = { ...project(), draft: { id: 'd1', version: 1, result } };
  render(<ProfileEditor project={value} onSave={async () => value} />);
  expect(screen.getByText(/확인 필요한 묶음 1개/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: 'EDIT' } });
  expect(screen.getByText(/확인 필요한 묶음 0개/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: 'DEFER' } });
  expect(screen.getByText(/확인 필요한 묶음 1개/)).toBeTruthy();
});

test('bulk review fills only unique grounded empty fields and preserves edits and ambiguous candidates', async () => {
  const result = analysisResult(); const base = result.candidates[0]!;
  result.candidates.push({ ...base, id: 'frontend-1', field: 'frontend', proposedValue: ['React'] }, { ...base, id: 'features-1', field: 'features', proposedValue: ['코드 검토'] }, { ...base, id: 'domain-1', field: 'domain', proposedValue: '협업', status: 'unknown' }, { ...base, id: 'database-1', field: 'database', proposedValue: 'PostgreSQL' }, { ...base, id: 'database-2', field: 'database', proposedValue: 'MySQL' });
  const value = { ...project(), draft: { id: 'd1', version: 1, result } }; let submitted: ProfilePatch | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { submitted = patch; return { ...value, version: 2 }; }} />);
  fireEvent.change(screen.getByLabelText('프론트엔드 상태'), { target: { value: 'value' } }); fireEvent.change(screen.getByLabelText('프론트엔드 값'), { target: { value: 'Vue' } });
  fireEvent.click(screen.getByRole('button', { name: /명확한 묶음.*한 번에 반영/ }));
  expect((screen.getByLabelText('백엔드 값') as HTMLInputElement).value).toBe('Express.js'); expect((screen.getByLabelText('프론트엔드 값') as HTMLInputElement).value).toBe('Vue');
  expect((screen.getByLabelText('분야 상태') as HTMLSelectElement).value).toBe('unknown'); expect((screen.getByLabelText('데이터베이스 상태') as HTMLSelectElement).value).toBe('unknown');
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted?.profile.features).toEqual(['코드 검토']); expect(submitted?.reviewDecisions?.filter(x => x.action === 'ACCEPT').map(x => x.itemId)).toEqual(['backend-1', 'features-1']);
});

test('editing a candidate starts from its proposed value and focuses the input while preserving later edits', async () => {
  const result = analysisResult(); result.candidates[0]!.status = 'unknown'; const value = { ...project(), draft: { id: 'd1', version: 1, result } }; let submitted: ProfilePatch | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { submitted = patch; return { ...value, version: 2 }; }} />);
  fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: 'EDIT' } });
  const input = screen.getByLabelText('백엔드 수정') as HTMLInputElement; expect(input.value).toBe('Express.js'); await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.change(input, { target: { value: 'Express.js, Node.js' } }); fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: 'DEFER' } }); fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: 'EDIT' } });
  expect((screen.getByLabelText('백엔드 수정') as HTMLInputElement).value).toBe('Express.js, Node.js'); fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted?.reviewDecisions?.[0]).toMatchObject({ action: 'EDIT', editedValue: ['Express.js', 'Node.js'] });
});

test('all original candidates in a mixed-status group use the same edit action', async () => {
  const result = analysisResult(); result.candidates.push({ ...result.candidates[0]!, id: 'backend-2', proposedValue: ['Node.js'], status: 'unknown' });
  const value = { ...project(), draft: { id: 'd1', version: 1, result } }; let submitted: ProfilePatch | undefined;
  render(<ProfileEditor project={value} onSave={async patch => { submitted = patch; return { ...value, version: 2 }; }} />);
  fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: 'EDIT' } });
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted?.reviewDecisions?.find(x => x.itemId === 'backend-1')?.action).toBe('EDIT'); expect(submitted?.reviewDecisions?.find(x => x.itemId === 'backend-2')?.action).toBe('EDIT'); expect(submitted?.profile.backend).toEqual(['Express.js', 'Node.js']);
});
function project(): ProjectDto { return { id: 'p1', name: '테스트', version: 1, createdAt: '', updatedAt: '', confirmedProfile: null, draft: null, activeAttempt: null }; }

test.each(['VERSION_CONFLICT', 'REQUEST_FAILED'])('preserves edited text after %s and leaves successful confirmation to the server', async (code) => {
  const onSave = vi.fn().mockRejectedValue(new Error(code));
  const { rerender } = render(<ProfileEditor project={project()} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('프로젝트 이름 상태'), { target: { value: 'value' } });
  fireEvent.change(screen.getByLabelText('프로젝트 이름 값'), { target: { value: '내 편집' } });
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(code === 'VERSION_CONFLICT' ? '다른 변경' : '입력'));
  expect((screen.getByLabelText('프로젝트 이름 값') as HTMLInputElement).value).toBe('내 편집');
  rerender(<ProfileEditor project={{ ...project(), version: 2, draft: { id: 'd2', version: 1, result: analysisResult() } }} onSave={onSave} />);
  expect((screen.getByLabelText('프로젝트 이름 값') as HTMLInputElement).value).toBe('내 편집');
  expect(onSave.mock.calls[0]![0]).toMatchObject({ expectedVersion: 1, profile: { project_name: '내 편집' } });
});

test('keeps unknown and explicit none distinct; a deferred draft does not become confirmation', async () => {
  const value = { ...project(), draft: { id: 'd1', version: 1, result: analysisResult() } };
  const onSave = vi.fn(async (_patch: ProfilePatch) => ({ ...value, version: 2 }));
  render(<ProfileEditor project={value} onSave={onSave} />);
  expect((screen.getByLabelText('백엔드 상태') as HTMLSelectElement).value).toBe('unknown');
  fireEvent.change(screen.getByLabelText('외부 연동 상태'), { target: { value: 'none' } });
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]![0]).toMatchObject({ profile: { backend: null, external_integrations: [] }, draftId: 'd1', draftVersion: 1, reviewDecisions: [{ itemId: 'backend-1', version: 1, action: 'DEFER' }] });
});

test('applies a grounded candidate only through explicit user selection', async () => {
  const value = { ...project(), draft: { id: 'd1', version: 1, result: analysisResult() } };
  const onSave = vi.fn(async (_patch: ProfilePatch) => ({ ...value, version: 2 }));
  render(<ProfileEditor project={value} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: 'ACCEPT' } });
  expect((screen.getByLabelText('백엔드 값') as HTMLInputElement).value).toBe('Express.js');
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]![0].reviewDecisions![0]!.action).toBe('ACCEPT');
});
test.each(['REJECT', 'DEFER'])('restores the pre-candidate value on ACCEPT→%s', async action => {
  const value = { ...project(), draft: { id: 'd1', version: 1, result: analysisResult() } }; const onSave = vi.fn(async (_patch: ProfilePatch) => ({ ...value, version: 2 })); render(<ProfileEditor project={value} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: 'ACCEPT' } }); fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: action } }); expect((screen.getByLabelText('백엔드 상태') as HTMLSelectElement).value).toBe('unknown');
  fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(onSave).toHaveBeenCalledOnce()); expect(onSave.mock.calls[0]![0].profile.backend).toBeNull();
});
test('rejecting a candidate preserves subsequent direct edits', () => {
  const value = { ...project(), draft: { id: 'd1', version: 1, result: analysisResult() } }; render(<ProfileEditor project={value} onSave={async () => value} />); fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: 'ACCEPT' } }); fireEvent.change(screen.getByLabelText('백엔드 값'), { target: { value: '내 직접 수정' } }); fireEvent.change(screen.getByLabelText('백엔드 묶음 검토'), { target: { value: 'REJECT' } }); expect((screen.getByLabelText('백엔드 값') as HTMLInputElement).value).toBe('내 직접 수정');
});
test('fetches latest values without discarding edits and requires explicit conflict review before rebasing', async () => {
  const value = project(); const latest = { ...value, version: 2 }; const onReload = vi.fn(async () => latest); const onSave = vi.fn(async (_patch: ProfilePatch) => ({ ...latest, version: 3 })); render(<ProfileEditor project={value} onSave={onSave} {...{ onReload }} />);
  fireEvent.change(screen.getByLabelText('프로젝트 이름 상태'), { target: { value: 'value' } }); fireEvent.change(screen.getByLabelText('프로젝트 이름 값'), { target: { value: '보존할 편집' } }); fireEvent.click(screen.getByRole('button', { name: '저장된 값 불러오기' })); await waitFor(() => expect(onReload).toHaveBeenCalledOnce()); expect((screen.getByLabelText('프로젝트 이름 값') as HTMLInputElement).value).toBe('보존할 편집');
  const rebase = screen.getByRole('button', { name: '비교한 최신 기준에 내 편집 유지' }); expect((rebase as HTMLButtonElement).disabled).toBe(true); fireEvent.click(screen.getByLabelText('최신 결과와 현재 편집의 차이를 확인했습니다.')); fireEvent.click(rebase); fireEvent.click(screen.getByRole('button', { name: '확인하고 저장' })); await waitFor(() => expect(onSave).toHaveBeenCalledOnce()); expect(onSave.mock.calls[0]![0]).toMatchObject({ expectedVersion: 2, profile: { project_name: '보존할 편집' } });
});
