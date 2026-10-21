import type { AiPort, AttemptRepository } from './ports';
import { assertNoSecretsData, ContractError, validateAnalysisResult } from '@agentfit/contracts';
import { AppError } from '../http/errors';
const publicCodes = new Set(['ANALYSIS_TIMEOUT', 'AI_SERVICE_UNAVAILABLE', 'INPUT_UNAVAILABLE', 'SECRET_DETECTED', 'INVALID_AI_RESPONSE', 'INVALID_PDF', 'INVALID_UTF8', 'INVALID_TEXT', 'EMPTY_DOCUMENT', 'NO_TEXT_LAYER', 'LOCKED_PDF', 'TOO_MANY_PAGES', 'TEXT_TOO_LONG', 'FILE_TOO_LARGE', 'PROVIDER_NOT_CONFIGURED', 'PROVIDER_UNAUTHORIZED', 'PROVIDER_AUTH_FAILED', 'PROVIDER_BUDGET_EXHAUSTED', 'INVALID_PROVIDER_RESPONSE', 'INVALID_PROVIDER_OUTPUT', 'PROVIDER_RESPONSE_TOO_LARGE', 'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'BUDGET_EXCEEDED', 'PRICE_NOT_CONFIRMED', 'CANONICAL_FONT_UNAVAILABLE']);
export class AnalysisWorker {
  private static readonly requestCodes = new Set(['PROVIDER_BAD_REQUEST', 'PROVIDER_MODEL_UNAVAILABLE']);
  constructor(private readonly repository: AttemptRepository, private readonly ai: AiPort, private readonly cleanup: (uploadId: string) => Promise<void>, private readonly now = Date.now, private readonly knownSecrets: readonly string[] = []) {}
  async processAttempt(id: string): Promise<void> {
    await this.repository.expire(id, new Date(this.now()));
    const record = await this.repository.claim(id, new Date(this.now()));
    if (!record?.leaseId) return;
    const leaseId = record.leaseId; let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const remaining = record.deadline.getTime() - this.now();
      if (remaining <= 0) throw new AppError('ANALYSIS_TIMEOUT');
      const timeout = new Promise<never>((_done, reject) => { timer = setTimeout(() => reject(new AppError('ANALYSIS_TIMEOUT')), remaining); timer.unref(); });
      const output = await Promise.race([this.ai.analyze({ attemptId: id, leaseId, documentId: id, provider: record.provider, deadline: record.deadline.toISOString(), inputRef: record.inputRef, inputKind: record.metadata.kind }), timeout]);
      if (this.now() >= record.deadline.getTime()) throw new AppError('ANALYSIS_TIMEOUT');
      assertNoSecretsData(output, this.knownSecrets);
      let validated;
      try {
        validated = validateAnalysisResult(output);
        if (validated.modelMetadata.provider !== record.provider || validated.candidates.some(c => c.evidence.some(e => e.documentId !== id))) throw new Error('INVALID_GROUNDING');
      } catch { throw new AppError('INVALID_AI_RESPONSE'); }
      if (!await this.repository.finish(id, leaseId, validated, new Date(this.now()))) await this.repository.expire(id, new Date(this.now()));
    } catch (error) {
      const code = error instanceof ContractError && error.code === 'SECRET_DETECTED' ? 'SECRET_DETECTED' : error instanceof AppError && (publicCodes.has(error.code) || AnalysisWorker.requestCodes.has(error.code)) ? error.code : 'ANALYSIS_FAILED';
      await this.repository.fail(id, leaseId, code, new Date(this.now()));
    } finally {
      if (timer) clearTimeout(timer);
      // Every terminal DB transition has already scheduled a durable cleanup job.
      try { await this.cleanup(record.inputRef.uploadId); } catch { /* Durable outbox retries deletion. */ }
    }
  }
}
