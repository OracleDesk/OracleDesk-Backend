import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { handleSep7Callback } from '../services/treasury-ops.service';
import { sendError, sendSuccess } from '../utils/response.util';
import { AppError } from '../middlewares/error.middleware';

/**
 * Unauthenticated SEP-7 wallet callback endpoint (#270).
 *
 * Accepts `application/x-www-form-urlencoded` with `xdr=<base64 envelope>`,
 * validates the single-use token bound to one operation and signer, verifies
 * signatures through the shared treasury accounting path, and never logs the
 * raw token.
 */
export function createSep7Router(): Router {
  const router = Router();

  const sep7CallbackLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post(
    '/callback/:token',
    sep7CallbackLimiter,
    express.urlencoded({ extended: false, limit: '64kb' }),
    async (req, res, next) => {
      try {
        const token = String(req.params.token ?? '').trim();
        const xdr = typeof req.body?.xdr === 'string' ? req.body.xdr.trim() : '';
        if (!token) {
          sendError(res, 410, 'SEP7_TOKEN_INVALID', 'Signing request is no longer valid');
          return;
        }
        if (!xdr) {
          sendError(res, 400, 'INVALID_SIGNED_XDR', 'xdr form field is required');
          return;
        }
        const io = req.app.get('io');
        const result = await handleSep7Callback(token, xdr, io);
        sendSuccess(res, {
          status: result.status,
          weightCollected: result.weightCollected,
          requiredSigners: result.requiredSigners,
        });
      } catch (err) {
        if (err instanceof AppError) {
          sendError(res, err.statusCode, err.code, err.message);
          return;
        }
        next(err);
      }
    },
  );

  return router;
}

export default createSep7Router();
