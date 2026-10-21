// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectDto } from '../../packages/contracts/src';
import { ProjectList } from '../../apps/web/src/components/ProjectList';
import { apiClient } from '../../apps/web/src/lib/api';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
test('a late initial list cannot erase a project created while loading', async () => {
  let finish!: (projects: ProjectDto[]) => void;
  vi.spyOn(apiClient, 'listProjects').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.spyOn(apiClient, 'createProject').mockResolvedValue({ id: 'p-new', name: '새 프로젝트', version: 1, createdAt: '', updatedAt: '', confirmedProfile: null, draft: null, activeAttempt: null });
  render(<ProjectList />);
  fireEvent.change(screen.getByLabelText('프로젝트 이름'), { target: { value: '새 프로젝트' } });
  fireEvent.click(screen.getByRole('button', { name: '프로젝트 만들기' }));
  await waitFor(() => expect(apiClient.createProject).toHaveBeenCalledOnce());
  await act(async () => { finish([]); });
  expect(screen.getByRole('link', { name: /새 프로젝트/ })).toBeTruthy();
});
