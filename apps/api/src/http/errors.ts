import type { ErrorRequestHandler } from 'express';
import { ContractError } from '@agentfit/contracts';
export class AppError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const known = error instanceof AppError || error instanceof ContractError;
  const status = error instanceof AppError ? error.status : error instanceof ContractError ? 400 : typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 503;
  const code = known ? error.code : status === 413 ? 'INPUT_TOO_LARGE' : status === 400 ? 'INVALID_INPUT' : 'SERVICE_UNAVAILABLE';
  res.status(status).json({ error: { code }, requestId: res.getHeader('X-Request-Id') });
};
