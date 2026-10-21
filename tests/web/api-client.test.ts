import { expect, test, vi } from 'vitest';
import { createApiClient } from '../../apps/web/src/lib/api';
test('uses same-origin API only, credentials, no cache and safe errors without raw detail', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', raw: 'must stay private' } }), { status: 401 }));
  const api = createApiClient(send);
  await expect(api.listProjects()).rejects.toThrow(/^AUTH_REQUIRED$/);
  expect(send.mock.calls[0]![0]).toBe('/api/projects');
  expect(send.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
});
test('local file flow awaits upload completion before scheduling analysis', async () => {
  const steps: string[] = [];
  const send = vi.fn<typeof fetch>(async (url) => {
    steps.push(String(url));
    if (String(url).endsWith('/uploads')) return Response.json({ uploadId: 'u1', storage: 'local', objectKey: 'inputs/u1', expiresAt: '', uploadUrl: '/api/projects/p1/uploads/u1/content' });
    if (String(url).endsWith('/content')) return new Response(null, { status: 204 });
    return Response.json({ id: 'a1', status: 'QUEUED' });
  });
  const api = createApiClient(send);
  await api.analyzeFile('p1', new File(['# plan'], 'plan.md', { type: 'text/markdown' }), 'nvidia');
  expect(steps).toEqual(['/api/projects/p1/uploads', '/api/projects/p1/uploads/u1/content', '/api/projects/p1/analysis']);
  expect(JSON.parse(String(send.mock.calls[2]![1]!.body))).toEqual({ input: { kind: 'upload', uploadId: 'u1' }, provider: 'nvidia' });
});
