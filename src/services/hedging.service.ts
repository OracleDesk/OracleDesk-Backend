import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAgentLog } from '../lib/agent-log';
import { AppError } from '../middlewares/error.middleware';
import type { HedgeRecommendation } from '../types';
import { decimalToBigint, priceToBps, toDisplayUsdc, usdcFromNumber } from '../lib/amounts';
import { pauseAgent } from './agent-controls.service';
import { twapMark, valuePositionAtPrice, type TwapMarkResult } from './valuation.service';

// ─── Hedging constants ───
const HEDGE_SIZE_BPS            = 5_000n; // Hedge 50% of original position
const MAX_DAILY_DRAWDOWN_BPS    = 300n;  // 3% daily drawdown → pause agent
const DRAWDOWN_PAUSE_HOURS      = 4;     // Pause for 4 hours on max drawdown
const STOP_LOSS_PCT_BPS         = 1_500n; // Exit once the liquidation value is 15% below cost
const HEDGE_LOSS_PCT_BPS        = 1_000n; // Hedge once the liquidation value is 10% below cost

/**
 * Start of the current day in UTC. The daily drawdown window used to be local
 * midnight, which moved with the server's time zone: replicas in different
 * zones disagreed about "today". UTC makes it the same everywhere (#79).
 */
export function utcStartOfDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** What the hedge scan needs to know about an open position. */
export interface HedgePositionInput {
  marketId:     string;
  category:     string;
  direction:    'YES' | 'NO';
  entryPrice:   number;
  currentPrice: number | null;
  size:         number;
  pnl:          number;
  entryPriceBps?: number | null;
  currentPriceBps?: number | null;
  sizeRaw?: bigint | null;
  edgeBps?: number;
  /** Raw cost and liquidation-based unrealised PnL (#78); the loss test prefers them over `pnl`. */
  costBasisRaw?:     bigint | null;
  unrealisedPnlRaw?: bigint | null;
  /** The edge detected when the position was opened. */
  edgeDetected: number;
}

/**
 * Pure core of the hedge scan: which positions need hedging and against which
 * market. `pickMarket` finds the hedge market (the database in production, the
 * replayed pools in a backtest).
 *
 * A position needs hedging when:
 * 1. The current market price has moved adversely by > 8%
 *    (edge from entry is now < 50% of original edge)
 * 2. OR the position is showing unrealised loss > 10% of size
 *
 * For each position needing a hedge, we search for:
 * - A market in the same category with OPPOSITE directional exposure
 * - Sufficient liquidity (>= $500) to accept a meaningful hedge
 */
export async function planHedges(
  positions: HedgePositionInput[],
  pickMarket: (category: string, excludeMarketId: string, direction: 'YES' | 'NO') => Promise<{ id: string } | null>,
): Promise<HedgeRecommendation[]> {
  const recommendations: HedgeRecommendation[] = [];

  for (const position of positions) {
    const entryPriceBps = position.entryPriceBps ?? priceToBps(position.entryPrice);
    const currentPriceBps = position.currentPriceBps ??
      (position.currentPrice === null ? entryPriceBps : priceToBps(position.currentPrice));
    const edgeBps = position.edgeBps ?? Math.round(position.edgeDetected * 10_000);

    // Calculate current edge degradation
    const entryEdgeBps = position.direction === 'YES' ? edgeBps : -edgeBps;
    const currentEdgeBps = entryEdgeBps - (currentPriceBps - entryPriceBps);

    const edgeDegraded = currentEdgeBps * 2 < entryEdgeBps;
    const hasLoss = position.costBasisRaw != null && position.unrealisedPnlRaw != null
      ? lossReaches(position.costBasisRaw, position.unrealisedPnlRaw, HEDGE_LOSS_PCT_BPS)
      : position.sizeRaw == null && position.pnl < -(position.size * 0.10);

    if (!edgeDegraded && !hasLoss) continue;

    // Find a hedge market: same category, enough liquidity
    const hedgeMarket = await pickMarket(position.category, position.marketId, position.direction);

    if (!hedgeMarket) continue;

    const baseSizeRaw = position.sizeRaw ?? usdcFromNumber(position.size);
    const hedgeSizeRaw = (baseSizeRaw * HEDGE_SIZE_BPS) / 10_000n;
    if (hedgeSizeRaw <= 0n) continue;
    const hedgeSize = toDisplayUsdc(hedgeSizeRaw);
    const hedgeDirection = position.direction === 'YES' ? 'NO' : 'YES';

    recommendations.push({
      originalMarketId: position.marketId,
      hedgeMarketId:    hedgeMarket.id,
      hedgeDirection,
      hedgeSize,
      hedgeSizeRaw,
      rationale: `Edge decayed from ${(entryEdgeBps / 10_000).toFixed(3)} to ${(currentEdgeBps / 10_000).toFixed(3)}. ` +
                 `Partial hedge of ${hedgeSize} USDC via ${hedgeMarket.id} reduces net exposure by ~50%.`,
    });
  }

  return recommendations;
}

/** Scans all open positions in the database and identifies which ones need hedging. */
export async function detectHedgeOpportunities(): Promise<HedgeRecommendation[]> {
  const openPositions = await prisma.position.findMany({
    where:   { status: 'OPEN' },
    include: { market: { select: { id: true, category: true, currentYesProb: true, totalLiquidity: true } }, trade: true },
  });

  const hedgeInputs: HedgePositionInput[] = [];
  for (const position of openPositions) {
    if (position.costBasisRaw == null) {
      logger.warn({ positionId: position.id }, 'Skipping hedge without exact position cost basis');
      continue;
    }
    hedgeInputs.push({
      marketId:     position.market.id,
      category:     position.market.category,
      direction:    position.direction,
      entryPrice:   position.entryPrice,
      currentPrice: position.currentPrice,
      size:         position.size,
      pnl:          position.pnl,
      entryPriceBps: position.entryPriceBps,
      currentPriceBps: position.markPriceBps,
      sizeRaw: decimalToBigint(position.costBasisRaw),
      costBasisRaw: decimalToBigint(position.costBasisRaw),
      unrealisedPnlRaw: position.unrealisedPnlRaw == null ? null : decimalToBigint(position.unrealisedPnlRaw),
      edgeBps: position.trade?.edgeBps ?? Math.round((position.trade?.edgeDetected ?? 0) * 10_000),
      edgeDetected: position.trade?.edgeDetected ?? 0,
    });
  }
  return planHedges(
    hedgeInputs,
    findHedgeMarket,
  );
}

/**
 * Executes a hedge position for a given recommendation.
 *
 * The hedge is sized at HEDGE_SIZE_FRACTION (50%) of the original position.
 * It takes the OPPOSITE direction to the original bet.
 *
 * All hedge trades and rationales are written to agent_logs for auditability.
 */
export async function autoHedge(recommendation: HedgeRecommendation): Promise<any> {
  const hedgeMarket = await prisma.market.findUnique({
    where: { id: recommendation.hedgeMarketId },
  });

  if (!hedgeMarket) {
    throw new AppError(404, 'HEDGE_MARKET_NOT_FOUND', 'Hedge market not found');
  }

  if ((hedgeMarket.totalLiquidity ?? 0) < 500) {
    throw new AppError(400, 'INSUFFICIENT_HEDGE_LIQUIDITY', 
      'Hedge market has insufficient liquidity');
  }

  const priceBps = priceToBps(
    recommendation.hedgeDirection === 'YES'
      ? hedgeMarket.currentYesProb ?? 0.5
      : 1 - (hedgeMarket.currentYesProb ?? 0.5),
  );

  // Create a hedge trade record
  const hedgeTrade = await prisma.trade.create({
    data: {
      marketId:      recommendation.hedgeMarketId,
      direction:     recommendation.hedgeDirection,
      status:        'PENDING',
      amount:        toDisplayUsdc(recommendation.hedgeSizeRaw),
      amountRaw:     recommendation.hedgeSizeRaw.toString(),
      priceBps,
      price:         priceBps / 10_000,
      edgeBps:       0,
      edgeDetected:  0, // Hedges don't require positive edge
      kellyFraction: 0,
    },
  });

  // Log the hedge rationale for auditability
  await writeAgentLog({
    agentType: 'TRADER',
    level:     'INFO',
    action:    'AUTO_HEDGE_EXECUTED',
    marketId:  recommendation.hedgeMarketId,
    data: {
      originalMarketId: recommendation.originalMarketId,
      hedgeTradeId:     hedgeTrade.id,
      hedgeDirection:   recommendation.hedgeDirection,
      hedgeSize:        recommendation.hedgeSize,
      rationale:        recommendation.rationale,
    },
  });

  logger.info(
    { hedgeTradeId: hedgeTrade.id, rationale: recommendation.rationale },
    'Auto-hedge executed',
  );

  return hedgeTrade;
}

/**
 * Implements hard stop-loss logic.
 *
 * Called by the position monitor every 15 minutes.
 * Closes positions where:
 *   - Market has moved 15%+ against the position
 *   - Daily drawdown of the entire portfolio exceeds 3%
 */
export async function enforceStopLoss(positionId: string): Promise<{
  shouldClose: boolean;
  reason?: string;
  deferred?: boolean;
  divergenceBps?: number;
}> {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
    include: { market: { select: { onChainMarketId: true } } },
  });

  if (!position || position.status !== 'OPEN') {
    return { shouldClose: false };
  }

  return evaluateStopLossWithTwap({
    id: position.id,
    marketId: position.marketId,
    direction: position.direction,
    sharesRaw: position.sharesRaw == null ? null : decimalToBigint(position.sharesRaw),
    costBasisRaw: position.costBasisRaw == null ? null : decimalToBigint(position.costBasisRaw),
    unrealisedPnlRaw: position.unrealisedPnlRaw == null ? null : decimalToBigint(position.unrealisedPnlRaw),
    markPriceBps: position.markPriceBps,
    entryPriceBps: position.entryPriceBps,
    entryPrice: position.entryPrice,
    currentPrice: position.currentPrice,
    onChainMarketId: position.market.onChainMarketId,
  });
}

export interface TwapStopLossInput {
  id: string;
  marketId: string;
  direction: 'YES' | 'NO';
  sharesRaw: bigint | null;
  costBasisRaw: bigint | null;
  unrealisedPnlRaw: bigint | null;
  markPriceBps: number | null;
  entryPriceBps: number | null;
  entryPrice: number;
  currentPrice: number | null;
  onChainMarketId: bigint | null;
}

/**
 * Evaluates stop-loss using market-core TWAP when available, falling back to
 * the spot mark (#292). When spot and TWAP diverge by more than
 * TWAP_DIVERGENCE_BPS and only the spot would trigger, defers the exit as
 * likely single-ledger manipulation.
 */
export async function evaluateStopLossWithTwap(
  position: TwapStopLossInput,
  deps: { readTwap?: (onChainMarketId: bigint) => Promise<TwapMarkResult>; divergenceBps?: number } = {},
): Promise<{
  shouldClose: boolean;
  reason?: string;
  deferred?: boolean;
  divergenceBps?: number;
}> {
  const spotResult =
    position.costBasisRaw != null && position.unrealisedPnlRaw != null
      ? evaluateLiquidationStopLoss(position.costBasisRaw, position.unrealisedPnlRaw)
      : evaluateStopLoss({
          entryPriceBps: position.entryPriceBps,
          currentPriceBps: position.markPriceBps,
          entryPrice: position.entryPrice,
          currentPrice: position.currentPrice,
        });

  if (position.onChainMarketId == null || position.sharesRaw == null || position.costBasisRaw == null) {
    return spotResult;
  }

  const readTwap = deps.readTwap ?? ((id: bigint) => twapMark(id));
  const twap = await readTwap(position.onChainMarketId);
  if (twap.source !== 'twap' || twap.yesBps === null) {
    return spotResult;
  }

  const twapVal = valuePositionAtPrice(position.direction, position.sharesRaw, position.costBasisRaw, BigInt(twap.yesBps));
  const twapOutcomeBps = Number(twapVal.priceBps);
  const spotOutcomeBps = position.markPriceBps ?? (position.currentPrice != null ? priceToBps(position.currentPrice) : null);
  const divergenceBps = spotOutcomeBps != null ? Math.abs(spotOutcomeBps - twapOutcomeBps) : 0;
  const maxDivergenceBps = deps.divergenceBps ?? config.TWAP_DIVERGENCE_BPS;

  const twapTriggered = lossReaches(position.costBasisRaw, twapVal.unrealisedPnlRaw, STOP_LOSS_PCT_BPS);
  if (twapTriggered) {
    const lossBps = (-twapVal.unrealisedPnlRaw * 10_000n) / position.costBasisRaw;
    return {
      shouldClose: true,
      reason: `STOP_LOSS: TWAP value ${(Number(lossBps) / 100).toFixed(1)}% below cost`,
      divergenceBps,
    };
  }

  if (spotResult.shouldClose && divergenceBps > maxDivergenceBps) {
    logger.warn(
      {
        positionId: position.id,
        marketId: position.marketId,
        spotOutcomeBps,
        twapOutcomeBps,
        divergenceBps,
        maxDivergenceBps,
      },
      'Stop-loss deferred: spot/TWAP divergence exceeds threshold (possible manipulation)',
    );
    return {
      shouldClose: false,
      deferred: true,
      divergenceBps,
      reason: `STOP_LOSS_DEFERRED: spot (${spotOutcomeBps} bps) vs TWAP (${twapOutcomeBps} bps) divergence ${divergenceBps} > ${maxDivergenceBps} bps`,
    };
  }

  // TWAP is healthy and did not trigger stop-loss.
  return { shouldClose: false, divergenceBps };
}

/** True when the unrealised loss is at least `pctBps` of the cost basis. */
export function lossReaches(costBasisRaw: bigint, unrealisedPnlRaw: bigint, pctBps: bigint): boolean {
  return costBasisRaw > 0n && unrealisedPnlRaw < 0n && -unrealisedPnlRaw * 10_000n >= costBasisRaw * pctBps;
}

/**
 * Stop-loss on liquidation value: close once unrealisedPnlRaw <= -15% of the
 * cost basis. It sees price impact and fees, which a price-move rule does not.
 */
export function evaluateLiquidationStopLoss(costBasisRaw: bigint, unrealisedPnlRaw: bigint): {
  shouldClose: boolean;
  reason?: string;
} {
  if (!lossReaches(costBasisRaw, unrealisedPnlRaw, STOP_LOSS_PCT_BPS)) return { shouldClose: false };
  const lossBps = (-unrealisedPnlRaw * 10_000n) / costBasisRaw;
  return { shouldClose: true, reason: `STOP_LOSS: Liquidation value ${(Number(lossBps) / 100).toFixed(1)}% below cost` };
}

/** Legacy stop-loss rule, evaluated in integer basis points. */
export function evaluateStopLoss(position: {
  entryPriceBps?: number | null;
  currentPriceBps?: number | null;
  entryPrice: number;
  currentPrice: number | null;
}): {
  shouldClose: boolean;
  reason?: string;
} {
  const entryBps = position.entryPriceBps ?? priceToBps(position.entryPrice);
  const currentBps = position.currentPriceBps ??
    (position.currentPrice === null ? entryBps : priceToBps(position.currentPrice));
  if (entryBps <= 0 || currentBps >= entryBps) return { shouldClose: false };
  const adverseBps = BigInt(entryBps - currentBps);
  if (adverseBps * 10_000n < BigInt(entryBps) * STOP_LOSS_PCT_BPS) return { shouldClose: false };
  const lossBps = (adverseBps * 10_000n) / BigInt(entryBps);
  return {
    shouldClose: true,
    reason: `STOP_LOSS: Adverse move of ${(Number(lossBps) / 100).toFixed(1)}%`,
  };
}

/**
 * Checks if the daily drawdown limit has been breached.
 * If yes, pauses new trade execution for DRAWDOWN_PAUSE_HOURS.
 */
export async function checkDailyDrawdown(bankrollRaw: bigint): Promise<{
  isPaused:      boolean;
  drawdownPct:   number;
  pauseUntil?:   Date;
}> {
  const todayStart = utcStartOfDay();

  const todayTrades = await prisma.position.findMany({
    where: {
      status:   { in: ['CLOSED', 'STOP_LOSS'] },
      closedAt: { gte: todayStart },
    },
    select: { realisedPnlRaw: true, unrealisedPnlRaw: true },
  });

  const result = evaluateDailyDrawdown(
    todayTrades.map((t) =>
      decimalToBigint(t.realisedPnlRaw) +
      (t.unrealisedPnlRaw == null ? 0n : decimalToBigint(t.unrealisedPnlRaw)),
    ),
    bankrollRaw,
    new Date(),
  );
  if (result.isPaused) await recordDrawdownPause(result);
  return { isPaused: result.isPaused, drawdownPct: result.drawdownPct, pauseUntil: result.pauseUntil };
}

export interface DrawdownEvaluation {
  isPaused:    boolean;
  drawdownPct: number;
  dailyLoss:   number;
  dailyLossRaw: bigint;
  pauseUntil?: Date;
}

/**
 * Pure drawdown rule over the P&L of positions closed today: the sum of the
 * losses (wins do not offset them) as a share of the bankroll.
 */
export function evaluateDailyDrawdown(closedPnlRaw: bigint[], bankrollRaw: bigint, now: Date): DrawdownEvaluation {
  const dailyLossRaw = closedPnlRaw
    .filter((pnl) => pnl < 0n)
    .reduce((acc, pnl) => acc - pnl, 0n);
  const dailyLoss = toDisplayUsdc(dailyLossRaw);
  const drawdownBps = bankrollRaw > 0n ? (dailyLossRaw * 10_000n) / bankrollRaw : 0n;
  const drawdownPct = bankrollRaw > 0n ? Number(drawdownBps) / 10_000 : (dailyLossRaw > 0n ? Infinity : 0);
  const isPaused = bankrollRaw > 0n
    ? dailyLossRaw * 10_000n >= bankrollRaw * MAX_DAILY_DRAWDOWN_BPS
    : dailyLossRaw > 0n;

  if (isPaused) {
    return {
      isPaused: true,
      drawdownPct,
      dailyLoss,
      dailyLossRaw,
      pauseUntil: new Date(now.getTime() + DRAWDOWN_PAUSE_HOURS * 60 * 60 * 1000),
    };
  }
  return { isPaused: false, drawdownPct, dailyLoss, dailyLossRaw };
}

/**
 * Logs and persists a drawdown pause. The pause lives in agent_controls, so
 * the next cycle, a restart and every other instance see it (#79).
 */
export async function recordDrawdownPause(result: DrawdownEvaluation): Promise<void> {
  logger.warn({
    drawdownPct: result.drawdownPct,
    dailyLossRaw: result.dailyLossRaw.toString(),
    pauseUntil: result.pauseUntil,
  }, 'Daily drawdown limit reached — pausing agent');

  await pauseAgent('TRADER', {
    source: 'drawdown',
    actor: 'system',
    until: result.pauseUntil,
    reason: `Daily drawdown ${(result.drawdownPct * 100).toFixed(2)}% reached the 3% limit`,
  });

  await writeAgentLog({
    agentType: 'TRADER',
    level:     'WARN',
    action:    'DRAWDOWN_PAUSE',
    data:      {
      drawdownPct: result.drawdownPct,
      dailyLoss: result.dailyLoss,
      dailyLossRaw: result.dailyLossRaw.toString(),
      pauseUntil: result.pauseUntil?.toISOString(),
    },
  });
}

// ─── Internal helper ───
async function findHedgeMarket(
  category: string,
  excludeMarketId: string,
  originalDirection: 'YES' | 'NO',
): Promise<any | null> {
  return prisma.market.findFirst({
    where: {
      category:      category as any,
      id:            { not: excludeMarketId },
      status:        'ACTIVE',
      totalLiquidity: { gte: 500 },
    },
    orderBy: { totalLiquidity: 'desc' },
  });
}