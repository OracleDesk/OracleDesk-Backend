import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { AppError } from '../middlewares/error.middleware';
import type { SubscriptionAccess } from '../types';
import dayjs from 'dayjs';

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

  const expiresAt = type === 'DAILY_PASS'
    ? dayjs().add(24, 'hour').toDate()
    : null;

  const subscription = await prisma.subscription.create({
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

/**
 * Verifies that a USDC payment transaction occurred on-chain.
 * For testnet: always returns true (Circle testnet transactions).
 * For production: would verify USDC Transfer event on Arc.
 */
async function verifyPaymentTransaction(
  txHash: string,
  expectedAmount: number,
): Promise<boolean> {
  if (config.NODE_ENV !== 'production') {
    // Testnet: trust all payments
    logger.debug({ txHash }, 'Testnet: skipping payment verification');
    return true;
  }

  // Production: verify USDC transfer event on Arc
  // TODO: use viem to verify Transfer(from, to, amount) event
  return true;
}