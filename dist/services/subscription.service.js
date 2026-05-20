"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAccess = checkAccess;
exports.recordPayment = recordPayment;
exports.getTracWithAccessControl = getTracWithAccessControl;
exports.expireStaleSubscriptions = expireStaleSubscriptions;
exports.upsertSpendingAllowance = upsertSpendingAllowance;
exports.getSpendingAllowance = getSpendingAllowance;
exports.listPaymentEvents = listPaymentEvents;
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
const config_1 = require("../config");
const error_middleware_1 = require("../middlewares/error.middleware");
const dayjs_1 = __importDefault(require("dayjs"));
const circle_service_1 = require("./circle.service");
const PER_TRACE_PRICE_USDC = 0.005; // $0.005 per trace
const DAILY_PASS_PRICE_USDC = 0.50; // $0.50 daily pass
/**
 * Checks whether a user has access to a specific reasoning trace.
 *
 * Access tiers:
 * 1. FREE_PREVIEW: Always granted — returns previewSources (first 2 sources)
 * 2. DAILY_PASS: User has an active daily pass → full access
 * 3. PER_TRACE: User paid for this specific trace → full access
 * 4. NO_ACCESS: Must pay
 */
async function checkAccess(userId, traceId) {
    // Check for active daily pass (covers all traces)
    const dailyPass = await prisma_1.prisma.subscription.findFirst({
        where: {
            userId,
            type: 'DAILY_PASS',
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
        },
    });
    if (dailyPass) {
        return { hasAccess: true, accessType: 'DAILY_PASS', expiresAt: dailyPass.expiresAt ?? undefined };
    }
    // Check for a per-trace subscription for this trace
    const perTrace = await prisma_1.prisma.subscription.findFirst({
        where: {
            userId,
            traceId,
            type: 'PER_TRACE',
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
async function recordPayment(params) {
    const { userId, traceId, type, txHash, amount } = params;
    // Validate payment amount
    const expectedAmount = type === 'DAILY_PASS' ? DAILY_PASS_PRICE_USDC : PER_TRACE_PRICE_USDC;
    if (amount < expectedAmount) {
        throw new error_middleware_1.AppError(400, 'INSUFFICIENT_PAYMENT', `Expected ${expectedAmount} USDC but received ${amount}`);
    }
    // Idempotency: check if txHash already processed
    const existing = await prisma_1.prisma.subscription.findFirst({ where: { txHash } });
    if (existing) {
        logger_1.logger.warn({ txHash }, 'Duplicate subscription payment — returning existing');
        return existing;
    }
    // Verify on-chain payment (simplified for testnet)
    const paymentVerified = await verifyPaymentTransaction(txHash, amount);
    if (!paymentVerified) {
        throw new error_middleware_1.AppError(402, 'PAYMENT_UNVERIFIED', 'Could not verify payment on-chain');
    }
    await enforceSpendingAllowance(userId, amount, type);
    const expiresAt = type === 'DAILY_PASS'
        ? (0, dayjs_1.default)().add(24, 'hour').toDate()
        : null;
    const subscription = await prisma_1.prisma.$transaction(async (tx) => {
        const created = await tx.subscription.create({
            data: {
                userId,
                traceId: traceId ?? null,
                type,
                status: 'ACTIVE',
                amountPaid: amount,
                currency: 'USDC',
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
                metadata: { subscriptionId: created.id },
            },
            update: {
                status: 'CONFIRMED',
                confirmedAt: new Date(),
                metadata: { subscriptionId: created.id },
            },
        });
        await tx.spendingAllowance.updateMany({
            where: { userId, isActive: true },
            data: { spentToday: { increment: amount } },
        });
        return created;
    });
    logger_1.logger.info({ subscriptionId: subscription.id, type, userId }, 'Subscription created');
    return subscription;
}
/**
 * Retrieves a trace, applying the correct access tier.
 *
 * - Free preview: returns previewSources only (first 2 sources)
 * - Full access: returns complete trace including all sourcesUsed
 */
async function getTracWithAccessControl(traceId, userId) {
    const trace = await prisma_1.prisma.reasoningTrace.findUnique({
        where: { id: traceId },
        include: { market: { select: { question: true, category: true } } },
    });
    if (!trace)
        throw new error_middleware_1.AppError(404, 'TRACE_NOT_FOUND', 'Reasoning trace not found');
    // Determine access level
    let access = { hasAccess: false, accessType: 'FREE_PREVIEW' };
    if (userId) {
        const fullAccess = await checkAccess(userId, traceId);
        access = fullAccess;
    }
    if (access.hasAccess) {
        return { ...trace, accessLevel: access.accessType };
    }
    // Return free preview — strip full sources
    return {
        id: trace.id,
        marketId: trace.marketId,
        market: trace.market,
        agentType: trace.agentType,
        decisionType: trace.decisionType,
        probabilityEstimate: trace.probabilityEstimate,
        marketProbability: trace.marketProbability,
        edge: trace.edge,
        confidenceInterval: trace.confidenceInterval,
        sourcesUsed: trace.previewSources, // Preview: only first 2 sources
        verified: trace.verified,
        ipfsCid: trace.ipfsCid,
        createdAt: trace.createdAt,
        accessLevel: 'FREE_PREVIEW',
        lockedFields: ['fullSources', 'hedgeConditions', 'betFraction', 'betSizeUsdc'],
        unlockPrice: PER_TRACE_PRICE_USDC,
        dailyPassPrice: DAILY_PASS_PRICE_USDC,
    };
}
/**
 * Expires overdue subscriptions.
 * Called by a scheduled cron job.
 */
async function expireStaleSubscriptions() {
    const { count } = await prisma_1.prisma.subscription.updateMany({
        where: {
            status: 'ACTIVE',
            expiresAt: { lt: new Date() },
        },
        data: { status: 'EXPIRED' },
    });
    if (count > 0)
        logger_1.logger.info({ count }, 'Expired stale subscriptions');
    return count;
}
async function upsertSpendingAllowance(params) {
    const { userId, dailyLimit, perTraceLimit, currency = 'USDC' } = params;
    if (dailyLimit <= 0 || perTraceLimit <= 0 || perTraceLimit > dailyLimit) {
        throw new error_middleware_1.AppError(400, 'INVALID_ALLOWANCE', 'perTraceLimit and dailyLimit must be positive, and perTraceLimit cannot exceed dailyLimit');
    }
    return prisma_1.prisma.spendingAllowance.upsert({
        where: { userId },
        create: { userId, dailyLimit, perTraceLimit, currency },
        update: { dailyLimit, perTraceLimit, currency, isActive: true },
    });
}
async function getSpendingAllowance(userId) {
    return prisma_1.prisma.spendingAllowance.findUnique({ where: { userId } });
}
async function enforceSpendingAllowance(userId, amount, type) {
    const allowance = await prisma_1.prisma.spendingAllowance.findUnique({ where: { userId } });
    if (!allowance?.isActive)
        return;
    const resetNeeded = (0, dayjs_1.default)(allowance.lastResetAt).isBefore((0, dayjs_1.default)().startOf('day'));
    const effectiveSpentToday = resetNeeded ? 0 : allowance.spentToday;
    if (resetNeeded) {
        await prisma_1.prisma.spendingAllowance.update({
            where: { userId },
            data: { spentToday: 0, lastResetAt: new Date() },
        });
    }
    if (type === 'PER_TRACE' && amount > allowance.perTraceLimit) {
        throw new error_middleware_1.AppError(402, 'ALLOWANCE_PER_TRACE_LIMIT', 'Payment exceeds per-trace spending approval');
    }
    if (effectiveSpentToday + amount > allowance.dailyLimit) {
        await prisma_1.prisma.subscription.create({
            data: {
                userId,
                type,
                status: 'LIMIT_REACHED',
                amountPaid: amount,
                currency: allowance.currency,
            },
        });
        throw new error_middleware_1.AppError(402, 'ALLOWANCE_DAILY_LIMIT', 'Payment exceeds daily spending approval');
    }
}
async function listPaymentEvents(userId) {
    return prisma_1.prisma.paymentEvent.findMany({
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
async function verifyPaymentTransaction(txHash, expectedAmount) {
    const transaction = await (0, circle_service_1.findCircleTransactionByHash)(txHash);
    if (!transaction) {
        if (config_1.config.NODE_ENV !== 'production' && !config_1.config.CIRCLE_STRICT_PAYMENT_VERIFICATION) {
            logger_1.logger.debug({ txHash }, 'Development mode: Circle transaction not found; accepting payment for local testing');
            return true;
        }
        return false;
    }
    const state = String(transaction.state ?? transaction.status ?? '').toUpperCase();
    const successful = ['COMPLETE', 'CONFIRMED', 'FINALIZED', 'SUCCESS', 'COMPLETED'].includes(state);
    const paidAmount = Number(transaction.amounts?.[0] ?? transaction.amount ?? transaction.amountInUSD ?? 0);
    return successful && paidAmount + 1e-9 >= expectedAmount;
}
