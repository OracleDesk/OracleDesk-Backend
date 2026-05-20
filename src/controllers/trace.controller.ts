import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendSuccess, sendError, parsePagination, buildPaginationMeta } from '../utils/response.util';
import { verifyCID } from '../services/ipfs.service';
import {
  getTracWithAccessControl,
  getSpendingAllowance,
  listPaymentEvents,
  recordPayment,
  upsertSpendingAllowance,
} from '../services/subscription.service';

/**
 * GET /traces
 * Returns paginated list of reasoning traces.
 * Preview data only (no full sources) unless authenticated with subscription.
 */
export async function listTraces(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req.query as any);
  const agentType = req.query.agentType as string | undefined;

  const where = {
    ...(agentType ? { agentType: agentType as any } : {}),
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
        previewSources:      true,
        createdAt:           true,
        market: { select: { question: true, category: true, settlementCurrency: true } },
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
 * Verifies a trace's integrity by comparing IPFS content hash to stored hash.
 *
 * Request body: { traceId: string }
 * Returns: { verified: boolean, storedHash, computedHash, ipfsCid }
 */
export async function verifyTrace(req: Request, res: Response): Promise<void> {
  const { traceId } = req.body as { traceId?: string };

  if (!traceId) {
    sendError(res, 400, 'MISSING_TRACE_ID', 'traceId is required');
    return;
  }

  const verification = await verifyCID(traceId);
  sendSuccess(res, verification);
}

/**
 * POST /traces/:id/unlock
 * Pay to unlock a trace's full content via USDC nanopayment.
 *
 * Request body: { txHash, amount, type: 'PER_TRACE' | 'DAILY_PASS' }
 * Requires auth.
 */
export async function unlockTrace(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const traceId = String(req.params.id);
  const { txHash, amount, type } = req.body as {
    txHash: string;
    amount: number;
    type: 'PER_TRACE' | 'DAILY_PASS';
  };

  if (!txHash || !amount || !type) {
    sendError(res, 400, 'MISSING_FIELDS', 'txHash, amount, and type are required');
    return;
  }

  const subscription = await recordPayment({
    userId:  req.user.userId,
    traceId: type === 'PER_TRACE' ? traceId : undefined,
    type,
    txHash,
    amount,
  });

  // Return the full trace now that it's unlocked
  const trace = await getTracWithAccessControl(traceId, req.user.userId);
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
