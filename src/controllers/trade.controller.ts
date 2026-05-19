import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendSuccess, sendError } from '../utils/response.util';
import { checkAccess } from '../services/subscription.service';
import { signToken } from '../middlewares/auth.middleware';
import { config } from '../config';
import { copyTradeSchema } from '../validators/trade.validator';
import { AppError } from '../middlewares/error.middleware';

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
export async function initiateCopyTrade(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required to copy-trade');
    return;
  }

  const parsed = copyTradeSchema.safeParse({ body: req.body });
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid copy-trade parameters',
      parsed.error.flatten().fieldErrors as any);
    return;
  }

  const { traceId, marketId, amount, userWallet } = parsed.data.body;

  // Check subscription access
  const access = await checkAccess(req.user.userId, traceId);
  if (!access.hasAccess) {
    sendError(res, 403, 'TRACE_LOCKED', 
      'Subscribe to copy-trade from this trace. Use POST /traces/:id/unlock');
    return;
  }

  // Look up the trace
  const trace = await prisma.reasoningTrace.findUnique({
    where: { id: traceId },
    include: { market: true },
  });

  if (!trace) {
    sendError(res, 404, 'TRACE_NOT_FOUND', 'Reasoning trace not found');
    return;
  }

  if (trace.marketId !== marketId) {
    sendError(res, 400, 'MARKET_MISMATCH', 'traceId and marketId do not match');
    return;
  }

  const market = trace.market;
  if (market.status !== 'ACTIVE') {
    sendError(res, 409, 'MARKET_NOT_ACTIVE', 'Market is not active for trading');
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
    marketAddress:  market.onChainAddress,
    direction,
    amount,
    price,
    userWallet,
    builderCode:    config.POLYMARKET_BUILDER_CODE,
    settlementToken: market.settlementCurrency === 'USDC'
      ? config.USDC_TOKEN_ADDRESS
      : config.EURC_TOKEN_ADDRESS,
    estimatedFee:   builderFee,
    traceReference: trace.ipfsCid,
  };

  // Record the copy-trade in DB (status: PENDING until frontend confirms)
  const copyTrade = await prisma.copyTrade.create({
    data: {
      userId:    req.user.userId,
      traceId,
      marketId,
      direction: direction as any,
      amount,
      status:    'PENDING',
      builderFee,
    },
  });

  sendSuccess(res, {
    copyTradeId:        copyTrade.id,
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
export async function confirmCopyTrade(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    sendError(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  const { id } = req.params;
  const { txHash } = req.body as { txHash?: string };

  if (!txHash) {
    sendError(res, 400, 'MISSING_TX_HASH', 'txHash is required');
    return;
  }

  const copyTrade = await prisma.copyTrade.findUnique({ where: { id } });
  if (!copyTrade || copyTrade.userId !== req.user.userId) {
    sendError(res, 404, 'COPY_TRADE_NOT_FOUND', 'Copy trade not found');
    return;
  }

  const updated = await prisma.copyTrade.update({
    where: { id },
    data:  { txHash, status: 'EXECUTED' },
  });

  sendSuccess(res, updated);
}

/**
 * POST /auth/connect
 * Wallet connection endpoint. Issues a JWT for the given wallet address.
 * In production, this would verify a signed message from the wallet.
 */
export async function connectWallet(req: Request, res: Response): Promise<void> {
  const { walletAddress } = req.body as { walletAddress?: string };

  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    sendError(res, 400, 'INVALID_WALLET', 'Valid Ethereum wallet address required');
    return;
  }

  const user = await prisma.user.upsert({
    where:  { walletAddress },
    create: { walletAddress },
    update: {},
  });

  const token = signToken(user.id, user.walletAddress);
  sendSuccess(res, { token, userId: user.id, walletAddress }, 200);
}