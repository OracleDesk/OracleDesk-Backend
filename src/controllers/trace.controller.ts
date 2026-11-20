import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendSuccess, sendError, parsePagination, buildPaginationMeta } from '../utils/response.util';
import { summarizeProvenance } from '../lib/llm/provenance';
import { verifyTraceOnChain } from '../services/trace-publish.service';
import { unwrapKey } from '../services/trace-crypto.service';
import { parseUsdc } from '../lib/amounts';
import {
  DAILY_PASS_PRICE_RAW,
  checkAccess,
  getTracWithAccessControl,
  getSpendingAllowance,
  listPaymentEvents,
  preauthorizeSpending,
  recordPayment,
  toAllowanceDto,
  toSubscriptionDto,
  upsertSpendingAllowance,
} from '../services/subscription.service';
import {
  createPaymentIntent,
  getPaymentIntent,
  submitPaymentIntent,
} from '../services/payment-intent.service';
import { getEntitlementJwks, verifyEntitlementToken, issueEntitlementToken } from '../services/entitlement/token.service';
import { ENTITLEMENT_HEADER } from '../services/entitlement/token.service';

const preauthorizeSchema = z.object({
  type: z.enum(['PER_TRACE', 'DAILY_PASS']).default('DAILY_PASS'),
  amountRaw: z.string().regex(/^\d+$/, 'must be an integer in 7-decimal base units').optional(),
});

const intentSubmitSchema = z.object({
  txHash: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be a 64-character hex transaction hash'),
});

const unlockSchema = z.object({
  txHash:    z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be a 64-character hex transaction hash'),
  type:      z.enum(['PER_TRACE', 'DAILY_PASS']),
  amountRaw: z.string().regex(/^\d+$/).optional(),
  amount:    z.number().positive().optional(),
});

/**
 * GET /traces
 * Returns paginated list of reasoning traces.
 * Preview data only (no full sources) unless authenticated with subscription.
 */
export async function listTraces(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req.query as any);
  const agentType = req.query.agentType;
  const marketId = req.query.marketId;
  if (agentType !== undefined && agentType !== 'MARKET_MAKER' && agentType !== 'TRADER') {
    sendError(res, 400, 'VALIDATION_ERROR', 'agentType must be MARKET_MAKER or TRADER');
    return;
  }

  const where = {
    ...(agentType ? { agentType: agentType as 'MARKET_MAKER' | 'TRADER' } : {}),
    ...(typeof marketId === 'string' && marketId ? { marketId } : {}),
  };

  const [traces, total] = await Promise.all([
    prisma.reasoningTrace.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id:                  true,
        marketId:            true,
        agentType:           true,
        decisionType:        true,
        edge:                true,
        probabilityEstimate: true,
        marketProbability:   true,
        confidenceInterval:  true,
        verified:            true,
        ipfsCid:             true,
        traceHash:           true,
        onChainTraceId:      true,
        publishTxHash:       true,
        previewSources:      true,
        provenance:          true,
        lastAuditStatus:     true,
        lastAuditedAt:       true,
        createdAt:           true,
        market: { select: { question: true, category: true, settlementCurrency: true, onChainMarketId: true } },
      },
    }),
    prisma.reasoningTrace.count({ where }),
  ]);

  const formattedTraces = traces.map(({ provenance, ...t }) => ({
    ...t,
    provenance: { summary: summarizeProvenance(provenance) },
    audit: t.lastAuditStatus ? { status: t.lastAuditStatus, checkedAt: t.lastAuditedAt } : null,
  }));

  sendSuccess(res, formattedTraces, 200, buildPaginationMeta(page, limit, total) as any);
}

/**
 * GET /traces/:id
 * Returns full trace detail with access control.
 * - No auth: preview (first 2 sources only)
 * - Subscribed: full trace
 */
export async function getTrace(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const userId = req.user?.userId;
  const entitlement = req.get(ENTITLEMENT_HEADER);
  let entitlementAccess = false;
  if (entitlement) {
    const verified = await verifyEntitlementToken({
      token: entitlement,
      jwks: getEntitlementJwks(),
      audience: config.X402_ENTITLEMENT_AUDIENCE,
      traceId: id,
    });
    entitlementAccess = verified.valid;
  }
  const trace = await getTracWithAccessControl(id, userId, entitlementAccess);
  sendSuccess(res, trace);
}

/**
 * POST /traces/verify
 * Fetches the content at the on-chain CID and compares sha256 of the exact
 * bytes with reasoning_registry.get_trace(...).trace_hash.
 *
 * Request body: { traceId: string }
 */
export async function verifyTrace(req: Request, res: Response): Promise<void> {
  const { traceId } = req.body as { traceId?: string };

  if (!traceId) {
    sendError(res, 400, 'MISSING_TRACE_ID', 'traceId is required');
    return;
  }

  const verification = await verifyTraceOnChain(traceId);
  sendSuccess(res, verification);
}

/**
 * POST /traces/:id/unlock
 * Daily pass: verifies an on-chain USDC transfer and grants 24h access.
 *
 * Request body: { txHash, type: 'DAILY_PASS', amountRaw? }
 * The amount is taken from the verified transaction, not from the body.
 */
export async function unlockTrace(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const parsed = unlockSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'txHash and type are required',
      parsed.error.flatten().fieldErrors as any);
    return;
  }

  const traceId = String(req.params.id);
  const subscription = await recordPayment({
    userId:        req.user.userId,
    walletAddress: req.user.walletAddress,
    traceId:       undefined,
    type:          parsed.data.type,
    txHash:        parsed.data.txHash,
    subId:         req.user.subId ?? null,
    subIdKind:     req.user.subIdKind ?? null,
  });

  const trace = await getTracWithAccessControl(traceId, req.user.userId).catch(() => null);
  const entitlement = trace
    ? issueEntitlementToken({
        subject: req.user.userId,
        traceId,
        onChainTraceId: trace.onChainTraceId ?? null,
        expiresAt: subscription.endsAt ?? subscription.expiresAt,
      })
    : null;
  sendSuccess(res, { subscription: toSubscriptionDto(subscription), trace, entitlement }, 201);
}

type AllowanceAmount = { ok: true; value: bigint; deprecated: boolean } | { ok: false; message: string };

/**
 * One allowance limit from the request body (#224): `<field>Raw` as integer
 * base units wins; otherwise `<field>` as a decimal USDC string. A JSON number
 * is still accepted for one release (flagged deprecated) and goes through
 * parseUsdc(String(n)), never through a float conversion.
 */
function allowanceAmount(field: string, raw: unknown, decimal: unknown): AllowanceAmount {
  if (raw !== undefined) {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
      return { ok: false, message: `${field}Raw must be an integer base-unit string` };
    }
    return { ok: true, value: BigInt(raw), deprecated: false };
  }
  if (typeof decimal === 'string' || typeof decimal === 'number') {
    try {
      return { ok: true, value: parseUsdc(String(decimal)), deprecated: typeof decimal === 'number' };
    } catch {
      return { ok: false, message: `${field} must be a decimal USDC string with at most 7 decimal places` };
    }
  }
  return { ok: false, message: `${field}Raw (base units) or ${field} (decimal string) is required` };
}

export async function setSpendingAllowance(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const daily = allowanceAmount('dailyLimit', body.dailyLimitRaw, body.dailyLimit);
  const perTrace = allowanceAmount('perTraceLimit', body.perTraceLimitRaw, body.perTraceLimit);
  if (!daily.ok || !perTrace.ok) {
    const messages = [daily, perTrace].flatMap((r) => (r.ok ? [] : [r.message]));
    sendError(res, 400, 'VALIDATION_ERROR', messages.join('; '));
    return;
  }
  const currency = typeof body.currency === 'string' ? body.currency : undefined;

  // Ensure the user record exists before creating the FK-linked spending
  // allowance. Key on the user id: walletAddress is no longer unique (#46),
  // several sub-users share one pooled base account.
  const identityKey = req.user.subId != null
    ? `${req.user.walletAddress}#${req.user.subIdKind === 'MUXED' ? 'muxed' : 'memo'}:${req.user.subId}`
    : req.user.walletAddress;
  await prisma.user.upsert({
    where:  { id: req.user.userId },
    create: {
      id:            req.user.userId,
      walletAddress: req.user.walletAddress,
      subId:         req.user.subId ?? null,
      subIdKind:     req.user.subIdKind ?? null,
      identityKey,
    },
    update: {},
  });

  const allowance = await upsertSpendingAllowance({
    userId: req.user.userId,
    dailyLimitRaw: daily.value,
    perTraceLimitRaw: perTrace.value,
    currency,
  });

  if (daily.deprecated || perTrace.deprecated) {
    // Numeric limits are accepted for one release only (#224); see docs/api.md.
    res.setHeader('Deprecation', 'true');
  }
  sendSuccess(res, toAllowanceDto(allowance), 200);
}

export async function getMySpendingAllowance(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const allowance = await getSpendingAllowance(req.user.userId);
  sendSuccess(res, allowance);
}

export async function getMyPaymentEvents(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const payments = await listPaymentEvents(req.user.userId);
  sendSuccess(res, payments);
}
/**
 * POST /traces/access/preauthorize
 * Advisory-only check against the user's exact spending approval (#53). It
 * never reserves budget or writes; the payment can still be accepted with an
 * overage flag, but the client should warn before asking the wallet to sign.
 */
export async function preauthorizeAccess(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  const parsed = preauthorizeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid preauthorization request', parsed.error.flatten().fieldErrors as any);
    return;
  }
  const amountRaw = parsed.data.amountRaw
    ? BigInt(parsed.data.amountRaw)
    : parsed.data.type === 'DAILY_PASS'
      ? DAILY_PASS_PRICE_RAW
      : null;
  if (amountRaw == null || amountRaw <= 0n) {
    sendError(res, 400, 'VALIDATION_ERROR', 'amountRaw is required for PER_TRACE preauthorization');
    return;
  }
  const decision = await preauthorizeSpending(req.user.userId, parsed.data.type, amountRaw);
  sendSuccess(res, { type: parsed.data.type, amountRaw: amountRaw.toString(), ...decision });
}

/** POST /traces/payment-intents — issue a server-priced daily-pass intent (#52). */
export async function createIntent(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  const created = await createPaymentIntent(req.user.userId, req.user.walletAddress);
  sendSuccess(res, created, 201);
}

/** GET /traces/payment-intents/:id — the caller's own intent. */
export async function getIntent(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  sendSuccess(res, await getPaymentIntent(req.user.userId, String(req.params.id)));
}

/**
 * POST /traces/payment-intents/:id/submit — attach a tx hash and settle or
 * move the intent to PENDING_PAYMENT. Safe to call again.
 */
export async function submitIntent(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  const parsed = intentSubmitSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'txHash is required', parsed.error.flatten().fieldErrors as any);
    return;
  }
  const result = await submitPaymentIntent({
    userId: req.user.userId,
    walletAddress: req.user.walletAddress,
    id: String(req.params.id),
    txHash: parsed.data.txHash,
  });
  sendSuccess(res, result, result.status === 'CONFIRMED' ? 201 : 202);
}

// Restored from #154 (0fbe386); dropped by the 3756171 merge.

const usedNonces = new Set<string>();

/**
 * GET /traces/:id/key
 * Returns decryption key for entitled users (daily pass / subscription).
 */
export async function getTraceKey(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const traceId = String(req.params.id);
  const access = await checkAccess(req.user.userId, traceId);
  if (!access.hasAccess) {
    sendError(res, 403, 'FORBIDDEN', 'Active pass or subscription required to access trace key');
    return;
  }

  const traceKey = await prisma.traceKey.findUnique({
    where: { traceId },
  });

  if (!traceKey) {
    sendError(res, 404, 'TRACE_KEY_NOT_FOUND', 'No encryption key found for this trace');
    return;
  }

  const dataKey = unwrapKey(Buffer.from(traceKey.wrappedKey), traceKey.kid);

  logger.info({ traceId, userId: req.user.userId, kid: traceKey.kid }, 'Trace key released');

  sendSuccess(res, {
    kid: traceKey.kid,
    dataKey: dataKey.toString('base64'),
    plaintextHash: traceKey.plaintextHash,
  });
}

/**
 * POST /internal/traces/:onChainTraceId/key
 * Secure x402 trace key release with shared HMAC and replay protection.
 */
export async function releaseTraceKeyInternal(req: Request, res: Response): Promise<void> {
  const secret = config.X402_KEY_RELEASE_SECRET;
  if (!secret) {
    sendError(res, 503, 'FEATURE_DISABLED', 'Internal key release is not configured');
    return;
  }

  const signature = req.get('x-signature');
  const timestamp = req.get('x-timestamp');
  const nonce = req.get('x-nonce');

  if (!signature || !timestamp || !nonce) {
    sendError(res, 401, 'UNAUTHORIZED', 'Missing authentication headers (x-signature, x-timestamp, x-nonce required)');
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) {
    sendError(res, 401, 'EXPIRED_REQUEST', 'Request timestamp is outside the allowed window');
    return;
  }

  if (usedNonces.has(nonce)) {
    sendError(res, 401, 'REPLAYED_NONCE', 'Nonce has already been used');
    return;
  }
  usedNonces.add(nonce);
  if (usedNonces.size > 10000) {
    usedNonces.clear();
  }

  const onChainTraceId = String(req.params.onChainTraceId);
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}:${nonce}:${onChainTraceId}`)
    .digest('hex');

  if (signature.toLowerCase() !== expectedSig.toLowerCase()) {
    sendError(res, 401, 'INVALID_SIGNATURE', 'HMAC signature verification failed');
    return;
  }

  let onChainBigInt: bigint;
  try {
    onChainBigInt = BigInt(onChainTraceId);
  } catch {
    sendError(res, 400, 'INVALID_TRACE_ID', 'Invalid onChainTraceId format');
    return;
  }

  const trace = await prisma.reasoningTrace.findFirst({
    where: { onChainTraceId: onChainBigInt },
    include: { traceKey: true },
  });

  if (!trace || !trace.traceKey) {
    sendError(res, 404, 'TRACE_NOT_FOUND', 'Trace or encryption key not found');
    return;
  }

  const traceKey = trace.traceKey;
  const dataKey = unwrapKey(Buffer.from(traceKey.wrappedKey), traceKey.kid);

  sendSuccess(res, {
    onChainTraceId,
    traceId: trace.id,
    kid: traceKey.kid,
    dataKey: dataKey.toString('base64'),
    plaintextHash: traceKey.plaintextHash,
  });
}
