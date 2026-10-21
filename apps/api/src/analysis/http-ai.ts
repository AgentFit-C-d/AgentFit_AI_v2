import { assertNoSecrets, validateInternal, validateAnalysisResult, type AnalyzeRequest, type AnalysisResult } from '@agentfit/contracts';
import type { AiPort } from './ports';
import { AppError } from '../http/errors';
const safeCodes = new Set(['ANALYSIS_TIMEOUT', 'INPUT_UNAVAILABLE', 'SECRET_DETECTED', 'INVALID_AI_RESPONSE', 'INVALID_PDF', 'INVALID_UTF8', 'INVALID_TEXT', 'EMPTY_DOCUMENT', 'NO_TEXT_LAYER', 'LOCKED_PDF', 'TOO_MANY_PAGES', 'TEXT_TOO_LONG', 'FILE_TOO_LARGE', 'PROVIDER_NOT_CONFIGURED', 'PROVIDER_UNAUTHORIZED', 'PROVIDER_AUTH_FAILED', 'PROVIDER_BUDGET_EXHAUSTED', 'INVALID_PROVIDER_RESPONSE', 'INVALID_PROVIDER_OUTPUT', 'PROVIDER_RESPONSE_TOO_LARGE', 'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'BUDGET_EXCEEDED', 'PRICE_NOT_CONFIRMED', 'CANONICAL_FONT_UNAVAILABLE']);
export class HttpAiPort implements AiPort {
  private static readonly requestCodes = new Set(['PROVIDER_BAD_REQUEST', 'PROVIDER_MODEL_UNAVAILABLE']);
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly send: typeof fetch = fetch, private readonly now = Date.now, private readonly diagnosticSink?: (request: AnalyzeRequest, raw: string, receivedAt: Date) => Promise<void>, private readonly knownSecrets: readonly string[] = []) {
    let url: URL; try { url = new URL(baseUrl); } catch { throw new AppError('INVALID_AI_URL'); }
    if (url.origin !== baseUrl || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new AppError('INVALID_AI_URL');
    if (token.length < 32) throw new AppError('AI_SERVICE_NOT_CONFIGURED', 503);
  }
  async analyze(request: AnalyzeRequest): Promise<AnalysisResult> {
    validateInternal('analyzeRequest', request);
    const remaining = Date.parse(request.deadline) - this.now() - 2000;
    if (remaining <= 0) throw new AppError('ANALYSIS_TIMEOUT');
    let response: Response;
    try { response = await this.send(`${this.baseUrl}/internal/v1/analyze`, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(remaining), redirect: 'error' }); }
    catch (error) { throw new AppError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'ANALYSIS_TIMEOUT' : 'AI_SERVICE_UNAVAILABLE', 503); }
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 524288) { await reader.cancel(); throw new AppError('INVALID_AI_RESPONSE', 503); } chunks.push(next.value); }
    let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError(response.ok ? 'INVALID_AI_RESPONSE' : 'AI_SERVICE_UNAVAILABLE', 503); }
    if (!response.ok) {
      if (body && typeof body === 'object' && 'diagnosticRaw' in body && typeof body.diagnosticRaw === 'string' && this.diagnosticSink) {
        try { assertNoSecrets(body.diagnosticRaw, [this.token, ...this.knownSecrets]); await this.diagnosticSink(request, body.diagnosticRaw, new Date(this.now())); } catch { /* Never expose or log diagnostics. */ }
      }
      const code = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'code' in body.error ? body.error.code : null;
      throw new AppError(typeof code === 'string' && (safeCodes.has(code) || HttpAiPort.requestCodes.has(code)) ? code : 'AI_SERVICE_UNAVAILABLE', 503);
    }
    try { return validateAnalysisResult(body); } catch { throw new AppError('INVALID_AI_RESPONSE', 503); }
  }
}
