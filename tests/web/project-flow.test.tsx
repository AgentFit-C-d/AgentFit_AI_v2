// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeleteProjectDialog } from '../../apps/web/src/components/DeleteProjectDialog';
afterEach(cleanup);
test('requires explicit deletion confirmation and keeps the dialog after failure', async () => {
  const onDelete = vi.fn().mockRejectedValue(new Error('DELETE_INCOMPLETE'));
  render(<DeleteProjectDialog name="내 프로젝트" onDelete={onDelete} onCancel={vi.fn()} />);
  expect(screen.getByRole('dialog').textContent).toContain('내 프로젝트');
  fireEvent.click(screen.getByRole('button', { name: '프로젝트 삭제' }));
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('분석 결과와 확인 기록도 함께 삭제합니다'));
  fireEvent.click(screen.getByRole('button', { name: '프로젝트 삭제' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('삭제'));
  expect(screen.getByRole('dialog')).toBeTruthy();
});
