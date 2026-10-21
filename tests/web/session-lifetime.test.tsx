// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen, act } from '@testing-library/react';
import { SessionBoundary } from '../../apps/web/src/components/SessionBoundary';
import { createApiClient } from '../../apps/web/src/lib/api';
import { notifySessionEnded } from '../../apps/web/src/lib/session-lifetime';
afterEach(cleanup);
test('unmounts sensitive workspace when session termination is announced', () => {
  render(<SessionBoundary><textarea defaultValue="private original" aria-label="original" /></SessionBoundary>); act(() => { window.dispatchEvent(new Event('agentfit-session-ended')); }); expect(screen.queryByLabelText('original')).toBeNull(); expect(screen.getByText(/로그인이 종료되었습니다/)).toBeTruthy();
});
test('protected API 401 announces termination and clears the protected boundary', async () => {
  render(<SessionBoundary><p>private preview</p></SessionBoundary>); const client = createApiClient(async () => Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 })); await act(async () => { await expect(client.project('p')).rejects.toThrow('AUTH_REQUIRED'); }); expect(screen.queryByText('private preview')).toBeNull();
});
test('session termination aborts an in-flight file upload without starting analysis', async () => {
  let aborted = false; const paths: string[] = [];
  const client = createApiClient(async (path, init) => {
    paths.push(String(path));
    if (String(path).endsWith('/uploads')) return Response.json({ uploadId: 'u', storage: 'local', objectKey: 'inputs/u', uploadUrl: '/api/projects/p/uploads/u/content' });
    return new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }); });
  });
  const pending = client.analyzeFile('p', new File(['synthetic original'], 'plan.md'), 'nvidia');
  const rejected = expect(pending).rejects.toThrow('REQUEST_ABORTED');
  await new Promise(done => setTimeout(done, 0)); notifySessionEnded(false);
  await rejected; expect(aborted).toBe(true); expect(paths.some(path => path.endsWith('/analysis'))).toBe(false);
});
test('protected rejection does not abort public login readiness discovery', async () => {
  let finish!: (response: Response) => void; let signal: AbortSignal | undefined;
  const client = createApiClient(async (path, init) => {
    if (path === '/api/runtime') { signal = init?.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); }
    return Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 });
  });
  const runtime = client.runtime(); await expect(client.listProjects()).rejects.toThrow('AUTH_REQUIRED');
  expect(signal?.aborted).toBe(false); finish(Response.json({ githubConfigured: true })); await expect(runtime).resolves.toMatchObject({ githubConfigured: true });
});
