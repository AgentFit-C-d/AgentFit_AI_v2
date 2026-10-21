// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectWorkspace } from '../../apps/web/src/components/ProjectWorkspace';
import { AnalysisStatus } from '../../apps/web/src/components/AnalysisStatus';
import { analysisResult } from '../support/analysis';
import type { AttemptDto, ProjectDto } from '../../packages/contracts/src';
const api = vi.hoisted(() => ({ project: vi.fn(), analyze: vi.fn(), attempt: vi.fn(), cancel: vi.fn(), saveProfile: vi.fn(), developer: vi.fn().mockResolvedValue({ profile: null }), environment: vi.fn().mockResolvedValue({ profile: null }), recommendation: vi.fn().mockResolvedValue({ recommendation: null }), catalog: vi.fn().mockResolvedValue({ revision: 'fixture', items: [] }) }));
vi.mock('../../apps/web/src/lib/api', () => ({ apiClient: api }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const project: ProjectDto = { id: 'p1', name: '통합 화면', version: 1, createdAt: '', updatedAt: '', confirmedProfile: null, draft: null, activeAttempt: null };
const attempt: AttemptDto = { id: 'a1', projectId: 'p1', status: 'QUEUED', createdAt: '', deadline: '', finishedAt: null, errorCode: null, draft: null };

test('provider failure explains external model recovery without automatically resubmitting', () => {
  const cancel = vi.fn();
  render(<AnalysisStatus attempt={{ ...attempt, status: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE' }} onCancel={cancel} />);
  expect(screen.getByRole('heading', { name: '분석 실패' })).toBeTruthy();
  expect(screen.getByText(/선택한 모델 서비스/).textContent).toContain('기존 확인 결과는 유지');
  expect(screen.getByText(/선택한 모델 서비스/).textContent).toContain('분석 모델을 바꿔');
  expect(screen.queryByRole('button')).toBeNull();
  expect(cancel).not.toHaveBeenCalled();
});
test('polling a new draft preserves manual edits and requires explicit new draft review', async () => {
  api.project.mockResolvedValueOnce(project).mockResolvedValue({ ...project, draft: { id: 'd1', version: 1, result: analysisResult() } });
  api.analyze.mockResolvedValue(attempt);
  api.attempt.mockResolvedValue({ ...attempt, status: 'SUCCEEDED' });
  render(<ProjectWorkspace id="p1" />);
  await screen.findByLabelText('프로젝트 이름 상태');
  fireEvent.change(screen.getByLabelText('프로젝트 이름 상태'), { target: { value: 'value' } });
  fireEvent.change(screen.getByLabelText('프로젝트 이름 값'), { target: { value: '보존할 편집' } });
  fireEvent.change(screen.getByLabelText('기획서 텍스트'), { target: { value: '분석 문서' } });
  fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '새 초안 검토' })).toBeTruthy(), { timeout: 3000 });
  expect((screen.getByLabelText('프로젝트 이름 값') as HTMLInputElement).value).toBe('보존할 편집');
  expect(api.saveProfile).not.toHaveBeenCalled();
});
test('cancel failure leaves analysis running and offers actionable recovery', async () => {
  api.project.mockResolvedValue({ ...project, activeAttempt: { ...attempt, status: 'PROCESSING' } });
  api.cancel.mockRejectedValue(new Error('NETWORK_ERROR'));
  render(<ProjectWorkspace id="p1" />);
  fireEvent.click(await screen.findByRole('button', { name: '분석 취소' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('다시'));
  expect(screen.getByRole('heading', { name: '문서를 분석하는 중' })).toBeTruthy();
});
