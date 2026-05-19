import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';
import { sendError } from '../utils/response.util';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Global Express error handler.
 * Catches AppError instances and any unhandled errors.
 */
export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    logger.warn(
      { code: err.code, path: req.path, details: err.details },
      err.message,
    );
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  // Unexpected errors — log the full stack
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}