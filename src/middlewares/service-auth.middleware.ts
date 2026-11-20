import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config';
import { previousSecret, secret } from '../config/secrets';
import { logger } from '../lib/logger';
import { sendError } from '../utils/response.util';

/**
 * HMAC service authentication for backend-to-backend calls (#219), used by
 * the x402 trace service on /x402/allowance/*.
 *
 *   X-OracleDesk-Timestamp: <unix seconds>
 *   X-OracleDesk-Signature: hex(HMAC-SHA256(secret,
 *       METHOD + "\n" + path + "\n" + timestamp + "\n" + hex(SHA-256(raw body))))
 *
 * `path` is the request target as sent (`/api/v1/x402/allowance/reserve`,
 * including any query string). The body hash covers the exact bytes on the
 * wire, captured by captureRawBody before JSON parsing, so re-serialising
 * cannot change what was signed. Requests more than 60 s from server time are
 * rejected; within that window the Idempotency-Key on every route makes a
 * replay return the stored response instead of acting twice.
 */

export const SERVICE_TIMESTAMP_HEADER = 'X-OracleDesk-Timestamp';
export const SERVICE_SIGNATURE_HEADER = 'X-OracleDesk-Signature';
export const SERVICE_AUTH_MAX_SKEW_SECONDS = 60;

/** Paths whose raw request bytes are kept for signature checks. */
const RAW_BODY_PATHS = ['/x402/allowance/'];

type WithRawBody = IncomingMessage & { rawBody?: Buffer; originalUrl?: string; url?: string };

/** `express.json({ verify })` hook: keeps the raw bytes for signed routes only. */
export function captureRawBody(req: IncomingMessage, _res: unknown, buf: Buffer): void {
  const url = (req as WithRawBody).originalUrl ?? req.url ?? '';
  if (RAW_BODY_PATHS.some((p) => url.includes(p))) (req as WithRawBody).rawBody = Buffer.from(buf);
}

export function serviceSignature(
  key: string,
  method: string,
  path: string,
  timestamp: string,
  body: Buffer | string,
): string {
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  return crypto
    .createHmac('sha256', key)
    .update(`${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`)
    .digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function keys(): string[] {
  try {
    const current = secret('X402_ALLOWANCE_HMAC_SECRET') || config.X402_ALLOWANCE_HMAC_SECRET;
    const previous = previousSecret('X402_ALLOWANCE_HMAC_SECRET');
    return [current, previous].filter((k): k is string => Boolean(k));
  } catch {
    return config.X402_ALLOWANCE_HMAC_SECRET ? [config.X402_ALLOWANCE_HMAC_SECRET] : [];
  }
}

/** Rejects requests without a valid, fresh service signature (401). */
export function requireServiceAuth(opts: { now?: () => number } = {}): RequestHandler {
  const now = opts.now ?? Date.now;
  return (req: Request, res: Response, next: NextFunction): void => {
    const candidates = keys();
    if (candidates.length === 0) {
      sendError(res, 503, 'SERVICE_AUTH_NOT_CONFIGURED', 'Service authentication is not configured');
      return;
    }
    const timestamp = (req.get(SERVICE_TIMESTAMP_HEADER) ?? '').trim();
    const signature = (req.get(SERVICE_SIGNATURE_HEADER) ?? '').trim().toLowerCase();
    const reject = (reason: string) => {
      logger.warn({ reason, route: req.originalUrl.split('?')[0] }, 'Service authentication rejected');
      sendError(res, 401, 'SERVICE_AUTH_INVALID', 'Invalid service signature');
    };
    if (!/^\d{1,12}$/.test(timestamp) || !signature) {
      reject('missing');
      return;
    }
    if (Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > SERVICE_AUTH_MAX_SKEW_SECONDS) {
      reject('stale');
      return;
    }
    const body = (req as unknown as WithRawBody).rawBody ?? Buffer.alloc(0);
    const ok = candidates.some((key) =>
      safeEqualHex(serviceSignature(key, req.method, req.originalUrl, timestamp, body), signature),
    );
    if (!ok) {
      reject('signature');
      return;
    }
    next();
  };
}
