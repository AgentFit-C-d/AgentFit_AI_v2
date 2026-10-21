import { expect, test, vi } from 'vitest';
import { HttpAiPort } from '../../apps/api/src/analysis/http-ai';
import type { AnalyzeRequest } from '../../packages/contracts/src';
import { analysisResult } from '../support/analysis';
const input: AnalyzeRequest = { attemptId: 'a1', leaseId: 'l1', documentId: 'a1', provider: 'nvidia', inputKind: 'text', deadline: new Date(60_000).toISOString(), inputRef: { uploadId: 'u1', objectKey: 'inputs/u1', storage: 'local', expiresAt: new Date(540_000).toISOString() } };
test('sends authenticated metadata only and does not retry failures', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(analysisResult('a1')), { status: 200 }));
  const port = new HttpAiPort('http://127.0.0.1:8000', 'test-only-internal-token'.repeat(2), send, () => 1000);
  expect((await port.analyze(input)).profile.backend).toEqual(['Express.js']);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0]).toBe('http://127.0.0.1:8000/internal/v1/analyze');
  expect(JSON.parse(String(send.mock.calls[0]![1]!.body))).toEqual(input);
  send.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'PROVIDER_RATE_LIMITED' } }), { status: 429 }));
  await expect(port.analyze(input)).rejects.toThrow('PROVIDER_RATE_LIMITED');
  expect(send).toHaveBeenCalledTimes(2);
});
test('rejects insecure remote URL and hides invalid failure details', async () => {
  expect(() => new HttpAiPort('http://remote.example', 'test-only-token')).toThrow('INVALID_AI_URL');
  const port = new HttpAiPort('https://ai.example', 'test-only-internal-token'.repeat(2), async () => new Response('private provider response', { status: 500 }), () => 1000);
  await expect(port.analyze(input)).rejects.toThrow('AI_SERVICE_UNAVAILABLE');
});

test('surfaces actionable provider authentication code without internal diagnostic body', async () => {
  const raw = 'received failure is internal only';
  const port = new HttpAiPort('https://ai.example', 'test-only-internal-token'.repeat(2), async () => new Response(JSON.stringify({ error: { code: 'PROVIDER_AUTH_FAILED' }, diagnosticRaw: raw }), { status: 503 }), () => 1000);
  await expect(port.analyze(input)).rejects.toThrow(/^PROVIDER_AUTH_FAILED$/);
});

test('failure diagnostic sink receives only actual received failure, not success or secret', async () => {
  const save = vi.fn(async () => {});
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'INVALID_PROVIDER_RESPONSE' }, diagnosticRaw: 'synthetic received failure' }), { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify(analysisResult('a1')), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'SECRET_DETECTED' }, diagnosticRaw: 'nvapi-' + 'a'.repeat(40) }), { status: 503 }));
  const port = new HttpAiPort('https://ai.example', 'test-only-internal-token'.repeat(2), send, () => 1000, save);
  await expect(port.analyze(input)).rejects.toThrow('INVALID_PROVIDER_RESPONSE');
  expect(save).toHaveBeenCalledWith(input, 'synthetic received failure', new Date(1000));
  await port.analyze(input);
  await expect(port.analyze(input)).rejects.toThrow('SECRET_DETECTED');
  expect(save).toHaveBeenCalledOnce();
});
