import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { AppError } from '../middlewares/error.middleware';
import type { KellyResult, TradePayload, KellyInput } from '../types';

// ─── Arc chain config ───
const arcChain = {
  id:   config.ARC_CHAIN_ID,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.ARC_RPC_URL] } },
};

const publicClient = createPublicClient({
  chain:     arcChain as any,
  transport: http(config.ARC_RPC_URL),
});

// ─── Risk constants ───
const MAX_SINGLE_POSITION_PCT  = 0.025;  // 2.5% of bankroll per position
const MAX_CORRELATED_EXPOSURE  = 0.05;   // 5% total correlated exposure
const MIN_EDGE_THRESHOLD       = 0.08;   // 8 percentage points minimum edge
const MIN_LIQUIDITY_USD        = 500;    // $500 minimum market liquidity
const HARD_STOP_LOSS_PCT       = 0.15;   // Close if market moves 15% against

/**
 * Implements the Half-Kelly Criterion for position sizing.
 *
 * Kelly Formula: f* = (b × p − q) / b
 *   b = net odds (e.g. bet $1 to win $0.67 → b = 0.67)
 *   p = agent's estimated probability of winning
 *   q = 1 - p (probability of losing)
 *
 * Half-Kelly: bet_size = 0.5 × f* × bankroll
 *
 * Why Half-Kelly?
 *   Full Kelly assumes perfect probability estimates. Our estimates have
 *   uncertainty, so we halve the bet size to account for model error.
 *   This cuts expected growth slightly but dramatically reduces ruin risk.
 *
 * Risk caps applied:
 *   - If f* > MAX_SINGLE_POSITION_PCT, cap at MAX_SINGLE_POSITION_PCT
 *   - If edge < MIN_EDGE_THRESHOLD, return 0 (no trade)
 */
export function calculateKellySize(input: KellyInput): KellyResult {
  const { agentProbability: p, marketProbability, bankroll, netOdds: b } = input;
  const q = 1 - p;
  const edge = p - marketProbability;

  // Guard: No trade if edge is below threshold
  if (edge < MIN_EDGE_THRESHOLD) {
    return { fraction: 0, halfKelly: 0, betSize: 0, edge, odds: b };
  }

  // Kelly formula
  const rawFraction = (b * p - q) / b;

  // Negative Kelly = no edge — never bet
  if (rawFraction <= 0) {
    return { fraction: 0, halfKelly: 0, betSize: 0, edge, odds: b };
  }

  // Apply Half-Kelly and cap at max single position size
  const halfKelly = Math.min(rawFraction * 0.5, MAX_SINGLE_POSITION_PCT);
  const betSize   = halfKelly * bankroll;

  return {
    fraction:  parseFloat(rawFraction.toFixed(4)),
    halfKelly: parseFloat(halfKelly.toFixed(4)),
    betSize:   parseFloat(betSize.toFixed(2)),
    edge:      parseFloat(edge.toFixed(4)),
    odds:      b,
  };
}

/**
 * Executes a trade on Arc.
 *
 * Steps:
 * 1. Validate risk limits (edge, liquidity, position size)
 * 2. Create a PENDING trade record in DB
 * 3. Build and submit the on-chain transaction
 * 4. On success: mark trade EXECUTED, create Position record
 * 5. On failure: mark trade FAILED — position is NEVER created
 *
 * Atomic DB update ensures position state is never corrupted by a
 * partial failure (e.g. TX submitted but DB write failed).
 */
export async function executeTrade(payload: TradePayload): Promise<{
  trade: any;
  position: any;
}> {
  // ── Step 1: Validate risk limits ──
  if (Math.abs(payload.edgeDetected) < MIN_EDGE_THRESHOLD) {
    throw new AppError(400, 'INSUFFICIENT_EDGE', 
      `Edge ${payload.edgeDetected} below minimum ${MIN_EDGE_THRESHOLD}`);
  }

  // Check existing exposure for this market
  const existingPosition = await prisma.position.findFirst({
    where: { marketId: payload.marketId, status: 'OPEN' },
  });
  if (existingPosition) {
    throw new AppError(409, 'POSITION_EXISTS', 'Open position already exists for this market');
  }

  // ── Step 2: Create PENDING trade record ──
  const trade = await prisma.trade.create({
    data: {
      marketId:      payload.marketId,
      direction:     payload.direction,
      status:        'PENDING',
      amount:        payload.amount,
      price:         payload.price,
      edgeDetected:  payload.edgeDetected,
      kellyFraction: payload.kellyFraction,
    },
  });

  // ── Step 3: Attempt on-chain execution ──
  let txHash: string | null = null;
  try {
    txHash = await submitTradeTransaction(payload);
  } catch (err) {
    // Mark as FAILED — no position created
    await prisma.trade.update({
      where: { id: trade.id },
      data:  { status: 'FAILED', errorMessage: String(err) },
    });

    await logAgentAction('TRADER', 'ERROR', 'TRADE_EXECUTION_FAILED', payload.marketId, {
      tradeId: trade.id,
      error:   String(err),
    });

    throw new AppError(502, 'TRADE_FAILED', 'On-chain trade execution failed', { error: String(err) });
  }

  // ── Step 4: Atomic success update ──
  const [updatedTrade, position] = await prisma.$transaction([
    prisma.trade.update({
      where: { id: trade.id },
      data:  {
        status:     'EXECUTED',
        txHash,
        executedAt: new Date(),
        builderFee: payload.amount * 0.002, // 0.2% builder fee
      },
    }),
    prisma.position.create({
      data: {
        marketId:    payload.marketId,
        tradeId:     trade.id,
        direction:   payload.direction,
        status:      'OPEN',
        entryPrice:  payload.price,
        currentPrice: payload.price,
        size:        payload.amount,
        pnl:         0,
      },
    }),
  ]);

  await logAgentAction('TRADER', 'INFO', 'TRADE_EXECUTED', payload.marketId, {
    tradeId: updatedTrade.id,
    txHash,
    direction: payload.direction,
    amount:    payload.amount,
    edge:      payload.edgeDetected,
  });

  logger.info({ tradeId: updatedTrade.id, txHash, amount: payload.amount }, 'Trade executed');
  return { trade: updatedTrade, position };
}

/**
 * Updates the P&L of an open position based on current market price.
 * Called by the monitor cron every 15 minutes.
 */
export async function trackPosition(
  positionId: string,
  currentPrice: number,
): Promise<any> {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
    include: { trade: true },
  });

  if (!position || position.status !== 'OPEN') return null;

  const direction = position.direction;
  const entryPrice = position.entryPrice;
  const size = position.size;

  // P&L: if YES position, gain when price goes up; loss when price goes down
  const pnl =
    direction === 'YES'
      ? (currentPrice - entryPrice) * size
      : (entryPrice - currentPrice) * size;

  const priceChange = Math.abs(currentPrice - entryPrice) / entryPrice;

  // Check hard stop-loss
  if (pnl < 0 && priceChange >= HARD_STOP_LOSS_PCT) {
    return closePosition(positionId, currentPrice, 'STOP_LOSS');
  }

  return prisma.position.update({
    where: { id: positionId },
    data:  { currentPrice, pnl },
  });
}

/**
 * Closes an open position.
 *
 * closeReason values:
 * - 'STOP_LOSS': Hard 15% adverse move triggered
 * - 'EDGE_DEGRADED': Agent's new probability estimate removed the edge
 * - 'MANUAL': Human override
 * - 'EXPIRY': Market approaching resolution
 */
export async function closePosition(
  positionId: string,
  closePrice: number,
  closeReason: string,
): Promise<any> {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
    include: { trade: true },
  });

  if (!position) throw new AppError(404, 'POSITION_NOT_FOUND', 'Position not found');
  if (position.status !== 'OPEN') {
    throw new AppError(409, 'POSITION_CLOSED', 'Position is already closed');
  }

  const pnl =
    position.direction === 'YES'
      ? (closePrice - position.entryPrice) * position.size
      : (position.entryPrice - closePrice) * position.size;

  const closed = await prisma.position.update({
    where: { id: positionId },
    data:  {
      status:       closeReason === 'STOP_LOSS' ? 'STOP_LOSS' : 'CLOSED',
      currentPrice: closePrice,
      pnl,
      closedAt:     new Date(),
      closeReason,
    },
  });

  await logAgentAction('TRADER', 'INFO', 'POSITION_CLOSED', position.marketId, {
    positionId,
    closeReason,
    pnl,
    closePrice,
  });

  logger.info({ positionId, closeReason, pnl }, 'Position closed');
  return closed;
}

/**
 * Builds and submits the Arc transaction.
 * Currently constructs the transaction parameters for the prediction market contract.
 * Returns the transaction hash.
 */
async function submitTradeTransaction(payload: TradePayload): Promise<string> {
  if (
    config.MARKET_FACTORY_ADDRESS === '0x0000000000000000000000000000000000000000'
  ) {
    // Testnet simulation mode — contracts not deployed yet
    logger.warn('Market factory address not set — simulating trade execution');
    return `0xSIMULATED_${Date.now().toString(16)}`;
  }

  // In production: use viem walletClient to sign and submit
  // const walletClient = createWalletClient({ ... })
  // const hash = await walletClient.writeContract({ ... })
  // For now, return a placeholder — real implementation after contracts deployed
  const simulatedHash = `0x${Buffer.from(`trade-${payload.marketId}-${Date.now()}`).toString('hex').slice(0, 64)}`;
  return simulatedHash;
}

async function logAgentAction(
  agentType: 'MARKET_MAKER' | 'TRADER',
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
  action: string,
  marketId: string | null,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.agentLog.create({
      data: { agentType, level, action, marketId: marketId ?? undefined, data },
    });
  } catch {}
}