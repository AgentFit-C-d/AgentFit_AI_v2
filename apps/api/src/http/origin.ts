import type { RequestHandler } from 'express';
import { AppError } from './errors';
export function requireTrustedOrigin(webOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== webOrigin) return next(new AppError('UNTRUSTED_ORIGIN', 403));
    next();
  };
}
