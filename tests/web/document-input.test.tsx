// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocumentInput } from '../../apps/web/src/components/DocumentInput';
afterEach(cleanup);
test('validates code points without truncating and retains input on failure', async () => {
  const onText = vi.fn().mockRejectedValue(new Error('AUTH_REQUIRED'));
  render(<DocumentInput onText={onText} onFile={vi.fn()} />);
  const field = screen.getByLabelText('기획서 텍스트');
  fireEvent.change(field, { target: { value: '😀'.repeat(100001) } });
  fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));
  expect(onText).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('100,000');
  fireEvent.change(field, { target: { value: '문서 내용' } });
  fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('로그인'));
  expect((field as HTMLTextAreaElement).value).toBe('문서 내용');
});
test('sends only the chosen input and rejects oversized files before upload', async () => {
  const onFile = vi.fn(async () => {}); const onText = vi.fn();
  render(<DocumentInput onText={onText} onFile={onFile} />);
  fireEvent.change(screen.getByLabelText('입력 방식'), { target: { value: 'file' } });
  const oversized = new File(['too large'], 'large.pdf', { type: 'application/pdf' });
  Object.defineProperty(oversized, 'size', { value: 10485761 });
  fireEvent.change(screen.getByLabelText('PDF 또는 Markdown 파일'), { target: { files: [oversized] } });
  fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));
  expect(onFile).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('10MiB');
  const file = new File(['# 기획'], 'plan.md', { type: 'text/markdown' });
  fireEvent.change(screen.getByLabelText('PDF 또는 Markdown 파일'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));
  await waitFor(() => expect(onFile).toHaveBeenCalledWith(file, 'solar'));
  expect(screen.queryByRole('option', { name: /NVIDIA/ })).toBeNull();
  await waitFor(() => expect((screen.getByLabelText('PDF 또는 Markdown 파일') as HTMLInputElement).value).toBe(''));
  fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));
  expect(onFile).toHaveBeenCalledOnce();
  expect(onText).not.toHaveBeenCalled();
});
test('releases original text after server accepts the analysis and requires fresh input', async () => {
  const onText = vi.fn(async () => {}); render(<DocumentInput onText={onText} onFile={vi.fn()} />); const field = screen.getByLabelText('기획서 텍스트'); fireEvent.change(field, { target: { value: '해제할 원문' } }); fireEvent.click(screen.getByRole('button', { name: '분석 시작' })); await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe('')); fireEvent.click(screen.getByRole('button', { name: '분석 시작' })); expect(onText).toHaveBeenCalledOnce();
});
