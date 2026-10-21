import { expect, test, vi } from 'vitest';
import { AnalysisWorker } from '../../apps/api/src/analysis/worker';
import { MemoryAttemptRepository } from '../support/attempts';
import { analysisResult } from '../support/analysis';
import { AppError } from '../../apps/api/src/http/errors';
test('keeps actionable provider request/model codes through the worker boundary', async () => {
  for (const code of ['PROVIDER_BAD_REQUEST', 'PROVIDER_MODEL_UNAVAILABLE']) {
    const repository = new MemoryAttemptRepository();
    await new AnalysisWorker(repository, { analyze: async () => { throw new AppError(code, 503); } }, async () => {}, () => 1000).processAttempt('a1');
    expect(repository.record?.errorCode).toBe(code);
  }
});
test('claims only once under duplicate delivery and stores only validated draft', async () => {
  const repository = new MemoryAttemptRepository(); const analyze = vi.fn(async () => analysisResult('a1')); const cleanup = vi.fn(async () => {});
  const worker = new AnalysisWorker(repository, { analyze }, cleanup, () => 1000);
  await Promise.all([worker.processAttempt('a1'), worker.processAttempt('a1')]);
  expect(analyze).toHaveBeenCalledTimes(1);
  expect(repository.record?.status).toBe('SUCCEEDED');
  expect(cleanup).toHaveBeenCalledWith('u1');
  await worker.processAttempt('a1'); expect(analyze).toHaveBeenCalledTimes(1);
});
test('does not call provider for running/cancelled/deleted/expired work', async () => {
  for (const status of ['PROCESSING', 'CANCELLED', 'SUCCEEDED', 'FAILED'] as const) {
    const repository = new MemoryAttemptRepository(); repository.record!.status = status;
    const analyze = vi.fn(async () => analysisResult());
    await new AnalysisWorker(repository, { analyze }, async () => {}, () => 1000).processAttempt('a1');
    expect(analyze).not.toHaveBeenCalled();
  }
  const repository = new MemoryAttemptRepository(); const analyze = vi.fn(async () => analysisResult());
  await new AnalysisWorker(repository, { analyze }, async () => {}, () => 60_001).processAttempt('a1');
  expect(repository.record?.errorCode).toBe('ANALYSIS_TIMEOUT'); expect(analyze).not.toHaveBeenCalled();
  repository.record = null;
  await new AnalysisWorker(repository, { analyze }, async () => {}, () => 1000).processAttempt('a1'); expect(analyze).not.toHaveBeenCalled();
});
test('late/deleted responses cannot resurrect or store a draft', async () => {
  let now = 1000; const repository = new MemoryAttemptRepository();
  await new AnalysisWorker(repository, { analyze: async () => { now = 60_001; return analysisResult('a1'); } }, async () => {}, () => now).processAttempt('a1');
  expect(repository.record?.draft).toBeNull(); expect(repository.record?.status).toBe('FAILED');
  repository.record = (await import('../support/attempts')).attempt(); now = 1000;
  await new AnalysisWorker(repository, { analyze: async () => { repository.record = null; return analysisResult('a1'); } }, async () => {}, () => now).processAttempt('a1');
  expect(repository.record).toBeNull();
});
test('invalid provider response and unsafe exception never become success', async () => {
  const repository = new MemoryAttemptRepository();
  const invalid = analysisResult(); invalid.profile.database = 'x'.repeat(201);
  await new AnalysisWorker(repository, { analyze: async () => invalid }, async () => {}, () => 1000).processAttempt('a1');
  expect(repository.record?.status).toBe('FAILED'); expect(repository.record?.draft).toBeNull();
  expect(repository.record?.errorCode).toBe('INVALID_AI_RESPONSE');
});

test('blocks secrets in otherwise valid results before creating a draft', async () => {
  const repository = new MemoryAttemptRepository();
  const result = analysisResult('a1'); result.profile.database = 'nvapi-' + 'a'.repeat(40);
  await new AnalysisWorker(repository, { analyze: async () => result }, async () => {}, () => 1000).processAttempt('a1');
  expect(repository.record?.status).toBe('FAILED');
  expect(repository.record?.errorCode).toBe('SECRET_DETECTED');
  expect(repository.record?.draft).toBeNull();
});
test('blocks known secrets with escaped JSON characters in otherwise valid model results', async () => {
  const secret = 'synthetic-sensitive-"quoted"-value'; const repository = new MemoryAttemptRepository();
  const result = analysisResult('a1'); result.profile.database = secret;
  await new AnalysisWorker(repository, { analyze: async () => result }, async () => {}, () => 1000, [secret]).processAttempt('a1');
  expect(repository.record?.status).toBe('FAILED');
  expect(repository.record?.errorCode).toBe('SECRET_DETECTED');
  expect(repository.record?.draft).toBeNull();
});
