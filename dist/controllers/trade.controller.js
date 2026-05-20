"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initiateCopyTrade = initiateCopyTrade;
exports.confirmCopyTrade = confirmCopyTrade;
exports.connectWallet = connectWallet;
const prisma_1 = require("../lib/prisma");
const response_util_1 = require("../utils/response.util");
const subscription_service_1 = require("../services/subscription.service");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const config_1 = require("../config");
const trade_validator_1 = require("../validators/trade.validator");
/**
 * POST /trade/copy
 * Prepares a copy-trade transaction for a subscriber.
 *
 * Flow:
 * 1. Verify the subscriber has access to the trace (subscription check)
 * 2. Look up the original trace and its bet parameters
 * 3. Build an identical transaction payload for the subscriber
 * 4. Return the payload — subscriber signs + submits from frontend
 * 5. Record the copy-trade in DB
 *
 * The builder code is included in the payload, so OracleDesk earns
 * a referral fee on every copy-trade fill via Polymarket's builder program.
 */
async function initiateCopyTrade(req, res) {
    if (!req.user) {
        (0, response_util_1.sendError)(res, 401, 'UNAUTHORIZED', 'Authentication required to copy-trade');
        return;
    }
    const parsed = trade_validator_1.copyTradeSchema.safeParse({ body: req.body });
    if (!parsed.success) {
        (0, response_util_1.sendError)(res, 400, 'VALIDATION_ERROR', 'Invalid copy-trade parameters', parsed.error.flatten().fieldErrors);
        return;
    }
    const { traceId, marketId, amount, userWallet } = parsed.data.body;
    // Check subscription access
    const access = await (0, subscription_service_1.checkAccess)(req.user.userId, traceId);
    if (!access.hasAccess) {
        (0, response_util_1.sendError)(res, 403, 'TRACE_LOCKED', 'Subscribe to copy-trade from this trace. Use POST /traces/:id/unlock');
        return;
    }
    // Look up the trace
    const trace = await prisma_1.prisma.reasoningTrace.findUnique({
        where: { id: traceId },
        include: { market: true },
    });
    if (!trace) {
        (0, response_util_1.sendError)(res, 404, 'TRACE_NOT_FOUND', 'Reasoning trace not found');
        return;
    }
    if (trace.marketId !== marketId) {
        (0, response_util_1.sendError)(res, 400, 'MARKET_MISMATCH', 'traceId and marketId do not match');
        return;
    }
    const market = trace.market;
    if (market.status !== 'ACTIVE') {
        (0, response_util_1.sendError)(res, 409, 'MARKET_NOT_ACTIVE', 'Market is not active for trading');
        return;
    }
    // Determine direction from trace edge
    const direction = trace.edge >= 0 ? 'YES' : 'NO';
    const price = direction === 'YES'
        ? (market.currentYesProb ?? market.initialYesProb)
        : 1 - (market.currentYesProb ?? market.initialYesProb);
    const builderFee = amount * 0.002; // 0.2% builder fee
    // Build the transaction payload the frontend will use to submit
    const transactionPayload = {
        marketAddress: market.onChainAddress,
        direction,
        amount,
        price,
        userWallet,
        builderCode: config_1.config.POLYMARKET_BUILDER_CODE,
        settlementToken: market.settlementCurrency === 'USDC'
            ? config_1.config.USDC_TOKEN_ADDRESS
            : config_1.config.EURC_TOKEN_ADDRESS,
        estimatedFee: builderFee,
        traceReference: trace.ipfsCid,
    };
    // Record the copy-trade in DB (status: PENDING until frontend confirms)
    const copyTrade = await prisma_1.prisma.copyTrade.create({
        data: {
            userId: req.user.userId,
            traceId,
            marketId,
            direction: direction,
            amount,
            status: 'PENDING',
            builderFee,
        },
    });
    (0, response_util_1.sendSuccess)(res, {
        copyTradeId: copyTrade.id,
        transactionPayload,
        instructions: 'Sign and submit the transactionPayload with your wallet. ' +
            'Then call PATCH /trade/copy/:id/confirm with the txHash.',
    }, 200);
}
/**
 * PATCH /trade/copy/:id/confirm
 * Confirms a copy-trade after the subscriber submits the on-chain transaction.
 * Updates status to EXECUTED and records the txHash.
 */
async function confirmCopyTrade(req, res) {
    if (!req.user) {
        (0, response_util_1.sendError)(res, 401, 'UNAUTHORIZED', 'Authentication required');
        return;
    }
    const id = String(req.params.id);
    const { txHash } = req.body;
    if (!txHash) {
        (0, response_util_1.sendError)(res, 400, 'MISSING_TX_HASH', 'txHash is required');
        return;
    }
    const copyTrade = await prisma_1.prisma.copyTrade.findUnique({ where: { id } });
    if (!copyTrade || copyTrade.userId !== req.user.userId) {
        (0, response_util_1.sendError)(res, 404, 'COPY_TRADE_NOT_FOUND', 'Copy trade not found');
        return;
    }
    const updated = await prisma_1.prisma.copyTrade.update({
        where: { id },
        data: { txHash, status: 'EXECUTED' },
    });
    (0, response_util_1.sendSuccess)(res, updated);
}
/**
 * POST /auth/connect
 * Wallet connection endpoint. Issues a JWT for the given wallet address.
 * In production, this would verify a signed message from the wallet.
 */
async function connectWallet(req, res) {
    const { walletAddress } = req.body;
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        (0, response_util_1.sendError)(res, 400, 'INVALID_WALLET', 'Valid Ethereum wallet address required');
        return;
    }
    const user = await prisma_1.prisma.user.upsert({
        where: { walletAddress },
        create: { walletAddress },
        update: {},
    });
    const token = (0, auth_middleware_1.signToken)(user.id, user.walletAddress);
    (0, response_util_1.sendSuccess)(res, { token, userId: user.id, walletAddress }, 200);
}
