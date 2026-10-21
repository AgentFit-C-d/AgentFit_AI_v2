import { validateAnalysisInput, assertNoSecrets, codePointLength, type AttemptDto, type ProviderId } from '@agentfit/contracts';
import { attemptDto, type AttemptRepository } from './ports';
import type { UploadService } from '../storage/uploads';
import type { CleanupService } from '../storage/cleanup';
import { AppError } from '../http/errors';
export class AnalysisService {
  constructor(private readonly attempts: AttemptRepository, private readonly uploads: UploadService,
    private readonly publish: (targetId: string) => Promise<void>, private readonly cleanup: CleanupService,
    private readonly knownSecrets: readonly string[] = [], private readonly now = Date.now) {}
  async startAnalysis(ownerId: string, projectId: string, body: unknown, provider: ProviderId): Promise<AttemptDto> {
    if (provider !== 'upstage' && provider !== 'solar') throw new AppError('INVALID_PROVIDER');
    if (body && typeof body === 'object' && 'text' in body && typeof body.text === 'string' && codePointLength(body.text) > 100_000) throw new AppError('TEXT_TOO_LONG', 413);
    const input = validateAnalysisInput(body);
    let uploadId: string; let createdText = false;
    if (input.kind === 'text') {
      assertNoSecrets(input.text, this.knownSecrets);
      if (!input.text.trim()) throw new AppError('EMPTY_DOCUMENT');
      const bytes = new TextEncoder().encode(input.text);
      const grant = await this.uploads.createUpload(ownerId, projectId, { kind: 'text', size: bytes.byteLength, contentType: 'text/plain' });
      uploadId = grant.uploadId; createdText = true;
      try { await this.uploads.completeServerUpload(ownerId, projectId, uploadId, bytes); } finally { bytes.fill(0); }
    } else { uploadId = (await this.uploads.getOwnedReady(ownerId, projectId, input.uploadId)).ref.uploadId; }
    let record;
    try { record = await this.attempts.start(ownerId, projectId, uploadId, provider, new Date(this.now())); }
    catch (error) { if (createdText) await this.cleanup.cleanupUpload(uploadId, true); throw error; }
    try { await this.publish(record.id); }
    catch {
      await this.attempts.failQueued(record.id, 'QUEUE_UNAVAILABLE', new Date(this.now()));
      try { await this.cleanup.cleanupUpload(uploadId, true); } catch { /* Durable cleanup remains scheduled. */ }
      return this.getAttempt(ownerId, projectId, record.id);
    }
    return attemptDto(record);
  }
  async getAttempt(ownerId: string, projectId: string, id: string): Promise<AttemptDto> {
    if (!await this.attempts.getOwned(ownerId, projectId, id)) throw new AppError('ATTEMPT_NOT_FOUND', 404);
    await this.attempts.expire(id, new Date(this.now()));
    const record = await this.attempts.getOwned(ownerId, projectId, id);
    if (!record) throw new AppError('ATTEMPT_NOT_FOUND', 404);
    return attemptDto(record);
  }
  async cancelAttempt(ownerId: string, projectId: string, id: string): Promise<AttemptDto> {
    const record = await this.attempts.cancelOwned(ownerId, projectId, id, new Date(this.now()));
    try { await this.publish(record.inputRef.uploadId); } catch { /* Durable cleanup remains scheduled. */ }
    return attemptDto(record);
  }
}
