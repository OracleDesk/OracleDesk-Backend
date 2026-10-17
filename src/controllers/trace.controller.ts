import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { sendSuccess, sendError, parsePagination, buildPaginationMeta } from '../utils/response.util';
import { verifyTraceOnChain } from '../services/trace-publish.service';
import { unwrapKey } from '../services/trace-crypto.service';
import {
  checkAccess,
  getTracWithAccessControl,
  getSpendingAllowance,
  listPaymentEvents,
  recordPayment,
  upsertSpendingAllowance,
} from '../services/subscription.service';

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
        createdAt:           true,
        market: { select: { question: true, category: true, settlementCurrency: true, onChainMarketId: true } },
      },
    }),
    prisma.reasoningTrace.count({ where }),
  ]);

  sendSuccess(res, traces, 200, buildPaginationMeta(page, limit, total) as any);
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

  const trace = await getTracWithAccessControl(id, userId);
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
  });

  const trace = await getTracWithAccessControl(traceId, req.user.userId).catch(() => null);
  sendSuccess(res, { subscription, trace }, 201);
}

export async function setSpendingAllowance(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const { dailyLimit, perTraceLimit, currency } = req.body as {
    dailyLimit?: number;
    perTraceLimit?: number;
    currency?: string;
  };

  if (typeof dailyLimit !== 'number' || typeof perTraceLimit !== 'number') {
    sendError(res, 400, 'MISSING_ALLOWANCE_FIELDS', 'dailyLimit and perTraceLimit are required numbers');
    return;
  }

  // Ensure the user record exists before creating the FK-linked spending allowance
  await prisma.user.upsert({
    where:  { walletAddress: req.user.walletAddress },
    create: { id: req.user.userId, walletAddress: req.user.walletAddress },
    update: {},
  });

  const allowance = await upsertSpendingAllowance({
    userId: req.user.userId,
    dailyLimit,
    perTraceLimit,
    currency,
  });

  sendSuccess(res, allowance, 200);
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

  const dataKey = unwrapKey(traceKey.wrappedKey, traceKey.kid);

  await prisma.agentLog.create({
    data: {
      agentType: 'SUBSCRIPTION',
      action: 'TRACE_KEY_RELEASED',
      details: { traceId, userId: req.user.userId, kid: traceKey.kid },
    },
  });

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

  const signature = req.headers['x-signature'] as string;
  const timestamp = req.headers['x-timestamp'] as string;
  const nonce = req.headers['x-nonce'] as string;

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
    include: { traceKeys: true },
  });

  if (!trace || !trace.traceKeys) {
    sendError(res, 404, 'TRACE_NOT_FOUND', 'Trace or encryption key not found');
    return;
  }

  const traceKey = trace.traceKeys;
  const dataKey = unwrapKey(traceKey.wrappedKey, traceKey.kid);

  sendSuccess(res, {
    onChainTraceId,
    traceId: trace.id,
    kid: traceKey.kid,
    dataKey: dataKey.toString('base64'),
    plaintextHash: traceKey.plaintextHash,
  });
}