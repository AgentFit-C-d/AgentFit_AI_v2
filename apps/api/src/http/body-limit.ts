import type { Request, RequestHandler } from 'express';
import { AppError } from './errors';
const sizes = new WeakMap<object, number>();
export function recordBodySize(req: object, size: number) { sizes.set(req, size); }
export function bodyLimit(bytes: number): RequestHandler { return (req: Request, _res, next) => { if ((sizes.get(req) ?? 0) > bytes) next(new AppError('INPUT_TOO_LARGE', 413)); else next(); }; }
