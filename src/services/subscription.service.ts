import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { AppError } from '../middlewares/error.middleware';
import type { SubscriptionAccess } from '../types';
import dayjs from 'dayjs';
import { findCircleTransactionByHash } from './circle.service';

const PER_TRACE_PRICE_USDC = 0.005;  // $0.005 per trace
const DAILY_PASS_PRICE_USDC = 0.50;  // $0.50 daily pass

/**
 * Checks whether a user has access to a specific reasoning trace.
 *
 * Access tiers:
 * 1. FREE_PREVIEW: Always granted — returns previewSources (first 2 sources)
 * 2. DAILY_PASS: User has an active daily pass → full access
 * 3. PER_TRACE: User paid for this specific trace → full access
 * 4. NO_ACCESS: Must pay
 */
export async function checkAccess(
  userId: string,
  traceId: string,
): Promise<SubscriptionAccess> {
  // Check for active daily pass (covers all traces)
  const dailyPass = await prisma.subscription.findFirst({
    where: {
      userId,
      type:   'DAILY_PASS',
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
    },
  });

  if (dailyPass) {
    return { hasAccess: true, accessType: 'DAILY_PASS', expiresAt: dailyPass.expiresAt ?? undefined };
  }

  // Check for a per-trace subscription for this trace
  const perTrace = await prisma.subscription.findFirst({
    where: {
      userId,
      traceId,
      type:   'PER_TRACE',
      status: 'ACTIVE',
    },
  });

  if (perTrace) {
    return { hasAccess: true, accessType: 'PER_TRACE' };
  }

  return { hasAccess: false, accessType: 'NO_ACCESS' };
}

/**
 * Records a nanopayment and grants access.
 *
 * Flow:
 * 1. Verify the payment transaction on-chain (or simulate for testnet)
 * 2. Create a Subscription record with correct expiry
 * 3. Return the subscription details
 *
 * Daily pass expires 24 hours from purchase.
 * Per-trace access is permanent.
 */
export async function recordPayment(params: {
  userId:   string;
  traceId?: string;
  type:     'PER_TRACE' | 'DAILY_PASS';
  txHash:   string;
  amount:   number;
}): Promise<any> {
  const { userId, traceId, type, txHash, amount } = params;

  // Validate payment amount
  const expectedAmount = type === 'DAILY_PASS' ? DAILY_PASS_PRICE_USDC : PER_TRACE_PRICE_USDC;
  if (amount < expectedAmount) {
    throw new AppError(400, 'INSUFFICIENT_PAYMENT', 
      `Expected ${expectedAmount} USDC but received ${amount}`);
  }

  // Idempotency: check if txHash already processed
  const existing = await prisma.subscription.findFirst({ where: { txHash } });
  if (existing) {
    logger.warn({ txHash }, 'Duplicate subscription payment — returning existing');
    return existing;
  }

  // Verify on-chain payment (simplified for testnet)
  const paymentVerified = await verifyPaymentTransaction(txHash, amount);
  if (!paymentVerified) {
    throw new AppError(402, 'PAYMENT_UNVERIFIED', 'Could not verify payment on-chain');
  }

  await enforceSpendingAllowance(userId, amount, type);

  const expiresAt = type === 'DAILY_PASS'
    ? dayjs().add(24, 'hour').toDate()
    : null;

  const subscription = await prisma.$transaction(async (tx) => {
    const created = await tx.subscription.create({
      data: {
        userId,
        traceId:   traceId ?? null,
        type,
        status:    'ACTIVE',
        amountPaid: amount,
        currency:  'USDC',
        txHash,
        expiresAt,
      },
    });

    await tx.paymentEvent.upsert({
      where: { txHash },
      create: {
        userId,
        traceId: traceId ?? null,
        txHash,
        type,
        amount,
        currency: 'USDC',
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        metadata: { subscriptionId: created.id } as any,
      },
      update: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        metadata: { subscriptionId: created.id } as any,
      },
    });

    await tx.spendingAllowance.updateMany({
      where: { userId, isActive: true },
      data: { spentToday: { increment: amount } },
    });

    return created;
  });

  logger.info({ subscriptionId: subscription.id, type, userId }, 'Subscription created');
  return subscription;
}

/**
 * Retrieves a trace, applying the correct access tier.
 *
 * - Free preview: returns previewSources only (first 2 sources)
 * - Full access: returns complete trace including all sourcesUsed
 */
export async function getTracWithAccessControl(
  traceId: string,
  userId?: string,
): Promise<any> {
  const trace = await prisma.reasoningTrace.findUnique({
    where: { id: traceId },
    include: { market: { select: { question: true, category: true } } },
  });

  if (!trace) throw new AppError(404, 'TRACE_NOT_FOUND', 'Reasoning trace not found');

  // Determine access level
  let access: SubscriptionAccess = { hasAccess: false, accessType: 'FREE_PREVIEW' };
  if (userId) {
    const fullAccess = await checkAccess(userId, traceId);
    access = fullAccess;
  }

  if (access.hasAccess) {
    return { ...trace, accessLevel: access.accessType };
  }

  // Return free preview — strip full sources
  return {
    id:                  trace.id,
    marketId:            trace.marketId,
    market:              trace.market,
    agentType:           trace.agentType,
    decisionType:        trace.decisionType,
    probabilityEstimate: trace.probabilityEstimate,
    marketProbability:   trace.marketProbability,
    edge:                trace.edge,
    confidenceInterval:  trace.confidenceInterval,
    sourcesUsed:         trace.previewSources,  // Preview: only first 2 sources
    verified:            trace.verified,
    ipfsCid:             trace.ipfsCid,
    createdAt:           trace.createdAt,
    accessLevel:         'FREE_PREVIEW',
    lockedFields:        ['fullSources', 'hedgeConditions', 'betFraction', 'betSizeUsdc'],
    unlockPrice:         PER_TRACE_PRICE_USDC,
    dailyPassPrice:      DAILY_PASS_PRICE_USDC,
  };
}

/**
 * Expires overdue subscriptions.
 * Called by a scheduled cron job.
 */
export async function expireStaleSubscriptions(): Promise<number> {
  const { count } = await prisma.subscription.updateMany({
    where: {
      status:    'ACTIVE',
      expiresAt: { lt: new Date() },
    },
    data: { status: 'EXPIRED' },
  });

  if (count > 0) logger.info({ count }, 'Expired stale subscriptions');
  return count;
}

export async function upsertSpendingAllowance(params: {
  userId: string;
  dailyLimit: number;
  perTraceLimit: number;
  currency?: string;
}): Promise<any> {
  const { userId, dailyLimit, perTraceLimit, currency = 'USDC' } = params;

  if (dailyLimit <= 0 || perTraceLimit <= 0 || perTraceLimit > dailyLimit) {
    throw new AppError(400, 'INVALID_ALLOWANCE', 'perTraceLimit and dailyLimit must be positive, and perTraceLimit cannot exceed dailyLimit');
  }

  return prisma.spendingAllowance.upsert({
    where: { userId },
    create: { userId, dailyLimit, perTraceLimit, currency },
    update: { dailyLimit, perTraceLimit, currency, isActive: true },
  });
}

export async function getSpendingAllowance(userId: string): Promise<any> {
  return prisma.spendingAllowance.findUnique({ where: { userId } });
}

async function enforceSpendingAllowance(
  userId: string,
  amount: number,
  type: 'PER_TRACE' | 'DAILY_PASS',
): Promise<void> {
  const allowance = await prisma.spendingAllowance.findUnique({ where: { userId } });
  if (!allowance?.isActive) return;

  const resetNeeded = dayjs(allowance.lastResetAt).isBefore(dayjs().startOf('day'));
  const effectiveSpentToday = resetNeeded ? 0 : allowance.spentToday;

  if (resetNeeded) {
    await prisma.spendingAllowance.update({
      where: { userId },
      data: { spentToday: 0, lastResetAt: new Date() },
    });
  }

  if (type === 'PER_TRACE' && amount > allowance.perTraceLimit) {
    throw new AppError(402, 'ALLOWANCE_PER_TRACE_LIMIT', 'Payment exceeds per-trace spending approval');
  }

  if (effectiveSpentToday + amount > allowance.dailyLimit) {
    await prisma.subscription.create({
      data: {
        userId,
        type,
        status: 'LIMIT_REACHED',
        amountPaid: amount,
        currency: allowance.currency,
      },
    });
    throw new AppError(402, 'ALLOWANCE_DAILY_LIMIT', 'Payment exceeds daily spending approval');
  }
}

export async function listPaymentEvents(userId: string): Promise<any[]> {
  return prisma.paymentEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/**
 * Verifies that a USDC payment transaction occurred on-chain.
 * For testnet: always returns true (Circle testnet transactions).
 * For production: would verify USDC Transfer event on Arc.
 */
async function verifyPaymentTransaction(
  txHash: string,
  expectedAmount: number,
): Promise<boolean> {
  const transaction = await findCircleTransactionByHash(txHash);
  if (!transaction) {
    if (config.NODE_ENV !== 'production' && !config.CIRCLE_STRICT_PAYMENT_VERIFICATION) {
      logger.debug({ txHash }, 'Development mode: Circle transaction not found; accepting payment for local testing');
      return true;
    }
    return false;
  }

  const state = String(transaction.state ?? transaction.status ?? '').toUpperCase();
  const successful = ['COMPLETE', 'CONFIRMED', 'FINALIZED', 'SUCCESS', 'COMPLETED'].includes(state);
  const paidAmount = Number(transaction.amounts?.[0] ?? transaction.amount ?? transaction.amountInUSD ?? 0);

  return successful && paidAmount + 1e-9 >= expectedAmount;
}
