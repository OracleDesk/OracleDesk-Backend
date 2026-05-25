"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listTraces = listTraces;
exports.getTrace = getTrace;
exports.verifyTrace = verifyTrace;
exports.unlockTrace = unlockTrace;
exports.setSpendingAllowance = setSpendingAllowance;
exports.getMySpendingAllowance = getMySpendingAllowance;
exports.getMyPaymentEvents = getMyPaymentEvents;
const prisma_1 = require("../lib/prisma");
const response_util_1 = require("../utils/response.util");
const ipfs_service_1 = require("../services/ipfs.service");
const subscription_service_1 = require("../services/subscription.service");
/**
 * GET /traces
 * Returns paginated list of reasoning traces.
 * Preview data only (no full sources) unless authenticated with subscription.
 */
async function listTraces(req, res) {
    const { page, limit, skip } = (0, response_util_1.parsePagination)(req.query);
    const agentType = req.query.agentType;
    const where = {
        ...(agentType ? { agentType: agentType } : {}),
    };
    const [traces, total] = await Promise.all([
        prisma_1.prisma.reasoningTrace.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                marketId: true,
                agentType: true,
                decisionType: true,
                edge: true,
                probabilityEstimate: true,
                marketProbability: true,
                confidenceInterval: true,
                verified: true,
                ipfsCid: true,
                previewSources: true,
                createdAt: true,
                market: { select: { question: true, category: true, settlementCurrency: true } },
            },
        }),
        prisma_1.prisma.reasoningTrace.count({ where }),
    ]);
    (0, response_util_1.sendSuccess)(res, traces, 200, (0, response_util_1.buildPaginationMeta)(page, limit, total));
}
/**
 * GET /traces/:id
 * Returns full trace detail with access control.
 * - No auth: preview (first 2 sources only)
 * - Subscribed: full trace
 */
async function getTrace(req, res) {
    const id = String(req.params.id);
    const userId = req.user?.userId;
    const trace = await (0, subscription_service_1.getTracWithAccessControl)(id, userId);
    (0, response_util_1.sendSuccess)(res, trace);
}
/**
 * POST /traces/verify
 * Verifies a trace's integrity by comparing IPFS content hash to stored hash.
 *
 * Request body: { traceId: string }
 * Returns: { verified: boolean, storedHash, computedHash, ipfsCid }
 */
async function verifyTrace(req, res) {
    const { traceId } = req.body;
    if (!traceId) {
        (0, response_util_1.sendError)(res, 400, 'MISSING_TRACE_ID', 'traceId is required');
        return;
    }
    const verification = await (0, ipfs_service_1.verifyCID)(traceId);
    (0, response_util_1.sendSuccess)(res, verification);
}
/**
 * POST /traces/:id/unlock
 * Pay to unlock a trace's full content via USDC nanopayment.
 *
 * Request body: { txHash, amount, type: 'PER_TRACE' | 'DAILY_PASS' }
 * Requires auth.
 */
async function unlockTrace(req, res) {
    if (!req.user) {
        (0, response_util_1.sendError)(res, 401, 'UNAUTHORIZED', 'Authentication required');
        return;
    }
    const traceId = String(req.params.id);
    const { txHash, amount, type } = req.body;
    if (!txHash || !amount || !type) {
        (0, response_util_1.sendError)(res, 400, 'MISSING_FIELDS', 'txHash, amount, and type are required');
        return;
    }
    // Ensure the user record exists — a valid JWT may pre-date DB seeding
    // or come from a Postman test before /auth/connect was called.
    await prisma_1.prisma.user.upsert({
        where: { walletAddress: req.user.walletAddress },
        create: { id: req.user.userId, walletAddress: req.user.walletAddress },
        update: {},
    });
    const subscription = await (0, subscription_service_1.recordPayment)({
        userId: req.user.userId,
        traceId: type === 'PER_TRACE' ? traceId : undefined,
        type,
        txHash,
        amount,
    });
    // Return the full trace now that it's unlocked
    const trace = await (0, subscription_service_1.getTracWithAccessControl)(traceId, req.user.userId);
    (0, response_util_1.sendSuccess)(res, { subscription, trace }, 201);
}
async function setSpendingAllowance(req, res) {
    if (!req.user) {
        (0, response_util_1.sendError)(res, 401, 'UNAUTHORIZED', 'Authentication required');
        return;
    }
    const { dailyLimit, perTraceLimit, currency } = req.body;
    if (typeof dailyLimit !== 'number' || typeof perTraceLimit !== 'number') {
        (0, response_util_1.sendError)(res, 400, 'MISSING_ALLOWANCE_FIELDS', 'dailyLimit and perTraceLimit are required numbers');
        return;
    }
    // Ensure the user record exists before creating the FK-linked spending allowance
    await prisma_1.prisma.user.upsert({
        where: { walletAddress: req.user.walletAddress },
        create: { id: req.user.userId, walletAddress: req.user.walletAddress },
        update: {},
    });
    const allowance = await (0, subscription_service_1.upsertSpendingAllowance)({
        userId: req.user.userId,
        dailyLimit,
        perTraceLimit,
        currency,
    });
    (0, response_util_1.sendSuccess)(res, allowance, 200);
}
async function getMySpendingAllowance(req, res) {
    if (!req.user) {
        (0, response_util_1.sendError)(res, 401, 'UNAUTHORIZED', 'Authentication required');
        return;
    }
    const allowance = await (0, subscription_service_1.getSpendingAllowance)(req.user.userId);
    (0, response_util_1.sendSuccess)(res, allowance);
}
async function getMyPaymentEvents(req, res) {
    if (!req.user) {
        (0, response_util_1.sendError)(res, 401, 'UNAUTHORIZED', 'Authentication required');
        return;
    }
    const payments = await (0, subscription_service_1.listPaymentEvents)(req.user.userId);
    (0, response_util_1.sendSuccess)(res, payments);
}
