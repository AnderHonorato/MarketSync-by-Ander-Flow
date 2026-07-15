import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const asyncHandler = (handler: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export const notFound: RequestHandler = (_req, _res, next) =>
  next(new AppError(404, 'ROUTE_NOT_FOUND', 'Rota não encontrada.'));

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details: error.flatten() },
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
    return;
  }
  console.error('[api] erro não tratado', error instanceof Error ? error.message : 'erro desconhecido');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno.' } });
};
