import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

export const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: config.NODE_ENV === 'test' ? 10_000 : config.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.appSession?.id ?? req.ip ?? 'unknown',
  handler: (_req, res) => res.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Muitas solicitações. Tente novamente em instantes.' },
  }),
});

export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
};
