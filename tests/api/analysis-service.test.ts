import { expect, test, vi } from 'vitest';
import { AnalysisService } from '../../apps/api/src/analysis/service';
import { MemoryAttemptRepository } from '../support/attempts';
import { MemoryUploadRepository } from '../support/uploads';
import { LocalInputStore } from '../../apps/api/src/storage/local-store';
import { UploadService } from '../../apps/api/src/storage/uploads';
import { CleanupService } from '../../apps/api/src/storage/cleanup';
test('validates one input and blocks credential transfer before creating temporary content', async () => {
  const attempts = new MemoryAttemptRepository(); const repository = new MemoryUploadRepository(); const store = new LocalInputStore();
  const uploads = new UploadService(store, repository, async () => true, async () => {});
  const service = new AnalysisService(attempts, uploads, async () => {}, new CleanupService(repository, store));
  await expect(service.startAnalysis('alice', 'p', { kind: 'text', text: 'nvapi-' + 'x'.repeat(40) }, 'solar')).rejects.toThrow('SECRET_DETECTED');
  await expect(service.startAnalysis('alice', 'p', { kind: 'text', text: '😀'.repeat(100_001) }, 'solar')).rejects.toThrow('TEXT_TOO_LONG');
  await expect(service.startAnalysis('alice', 'p', { kind: 'upload', uploadId: 'stolen' }, 'solar')).rejects.toThrow('UPLOAD_NOT_FOUND');
  expect(repository.records.size).toBe(0); store.dispose();
});
test('persists queued status before publish and exposes status after queue deadline', async () => {
  const attempts = new MemoryAttemptRepository(); const repository = new MemoryUploadRepository(); const store = new LocalInputStore(() => 0);
  const uploads = new UploadService(store, repository, async () => true, async () => {}, () => 0);
  const publish = vi.fn(async () => { expect(attempts.record?.status).toBe('QUEUED'); });
  let now = 0;
  const service = new AnalysisService(attempts, uploads, publish, new CleanupService(repository, store), [], () => now);
  const dto = await service.startAnalysis('alice', 'p1', { kind: 'text', text: 'Backend: Express.js' }, 'solar');
  expect(dto.status).toBe('QUEUED'); expect(publish).toHaveBeenCalledWith(dto.id);
  now = 60_001;
  expect((await service.getAttempt('alice', 'p1', dto.id)).status).toBe('FAILED');
  await expect(service.getAttempt('bob', 'p1', dto.id)).rejects.toThrow('ATTEMPT_NOT_FOUND');
  store.dispose();
});
