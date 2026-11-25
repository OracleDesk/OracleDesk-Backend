/**
 * The trader's decision policy, free of Prisma, chain and wall-clock access:
 * everything it needs comes through a TraderEnv. Production runs it with
 * `prodTraderEnv()`; the backtester runs the same code against replayed
 * history (#81).
 *
 * Full flow:
 *   0. Read the treasury budget (capital and caps); skip the cycle if it
 *      cannot be read (#76)
 *   1. Check daily drawdown against the live bankroll — pause if limit hit
 *   2. Mark open positions to market, then stop-loss check (liquidation value)
 *   3. Check for hedge opportunities on deteriorating positions
 *   4. Scan active markets for +EV opportunities
 *   5. For each mispriced market: size against the FPMM curve within the
 *      treasury's headroom (#225), check correlation, then trace and execute
 */
import { compiledTraderParamsV1, type TraderParamsV1 } from '../lib/risk-params';
import { sizeAgainstPool, sizeAtMid, type ImpactSizing } from '../services/impact-kelly';
import { evaluateDailyDrawdown, type HedgingRiskParams } from '../services/hedging.service';
import type { CorrelationRiskParams } from '../services/correlation.service';
import {
  MIN_TRADE_RAW,
  budgetSnapshot,
  clampSize,
  spend,
  type SizingBinding,
  type TreasuryBudget,
} from '../services/treasury-budget.service';
import { toDisplayUsdc, usdcFromNumber } from '../lib/amounts';
import { config } from '../config';
import { logger } from '../lib/logger';
import type { MarketView, TraderEnv, DecisionPrice, PoolView } from './trader-env';
import { StalePriceError } from '../services/market-price.service';
import type { AggregatedSignals } from '../types';

export type TraderParams = TraderParamsV1 & {
  /**
   * 'impact' (default) sizes against the FPMM curve (#225); 'mid' is the
   * closed-form half-Kelly at the mid, kept for backtest comparison.
   */
  sizing?: 'impact' | 'mid';
  /** Active risk-param set at cycle start (#274). */
  paramsVersion?: { version: number; hash: string };
};

export const DEFAULT_PARAMS: TraderParams = { ...compiledTraderParamsV1(), sizing: 'impact' };

function hedgingFromParams(params: TraderParams): HedgingRiskParams {
  return {
    stopLossBps: params.stopLossBps,
    hedgeLossBps: params.hedgeLossBps,
    maxDailyDrawdownPct: params.maxDailyDrawdownPct,
    drawdownPauseHours: params.drawdownPauseHours,
  };
}

function correlationFromParams(params: TraderParams): CorrelationRiskParams {
  return {
    maxCorrelatedExposurePct: params.maxCorrelatedExposurePct,
    correlationThreshold: params.correlationThreshold,
  };
}

/** Ledger context recorded with every BuyOrder and SizingRecord (#266). */
export interface PriceAsOf {
  ledger: number;
  source: 'indexed' | 'rpc';
  lagLedgers: number;
  yesBps: string;
}

/**
 * What the FPMM fill costs at the final size (#225). Strings and integers
 * only, so the block is canonical-safe; prices are of the side bought.
 */
export interface ImpactRecord {
  /** 'impact': sized on the curve; 'mid': closed-form Kelly at the mid. */
  model: 'impact' | 'mid';
  midBps: number;
  avgPriceBps: number;
  postPriceBps: number;
  impactBps: number;
  feeRaw: string;
  expectedSharesRaw: string;
  /** p_conservative − average price, 6 decimals. */
  effectiveEdge: string;
  poolLedger: number;
  poolSource: PoolView['source'];
}

/** The sizing decision recorded in the trace: every intermediate size in base units (#76). */
export interface SizingRecord {
  /** Risk parameter set used for this decision (#274). */
  params?: { version: number; hash: string };
  /** The curve-optimal size within the caps, before correlation (#225). */
  kellyRaw: string;
  correlationRaw: string;
  marketExposureRaw: string;
  marketExposureEstimated: boolean;
  finalRaw: string;
  binding: SizingBinding;
  safetyBps: number;
  budget: Record<string, string>;
  /** Ledger view the decision was made against (#266). */
  priceAsOf: PriceAsOf;
  /** Fill cost at finalRaw (#225). */
  impact: ImpactRecord;
}

function impactRecord(model: ImpactRecord['model'], s: ImpactSizing, pool: PoolView): ImpactRecord {
  return {
    model,
    midBps: s.midBps,
    avgPriceBps: s.avgPriceBps,
    postPriceBps: s.postPriceBps,
    impactBps: s.impactBps,
    feeRaw: s.feeRaw.toString(),
    expectedSharesRaw: s.sharesOutRaw.toString(),
    effectiveEdge: s.effectiveEdge.toFixed(6),
    poolLedger: pool.asOfLedger,
    poolSource: pool.source,
  };
}

/** Budget state shared by the orders of one cycle. */
interface CycleBudget {
  current: TreasuryBudget;
}

export async function runTraderPolicy(
  env: TraderEnv,
  params: TraderParams,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const { signal } = opts;
  const cycleId = correlation().cycleId ?? newId('cyc');
  const recordDecision = (decision: Omit<DecisionRecord, 'cycleId'>) =>
    env.recordDecision({ ...decision, cycleId });
  signal?.throwIfAborted();

  // Step 0: The treasury is the source of truth for capital and caps (#76).
  // Without it there is no safe size: fail closed, never fall back to a constant.
  let budget: TreasuryBudget;
  try {
    budget = await env.budget();
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, 'Trader Agent: treasury budget read failed — skipping cycle');
    await recordDecision({
      kind: 'TREASURY_READ_FAILED',
      reasonCode: 'TREASURY_READ_FAILED',
      data: { error: String((err as Error)?.message ?? err).slice(0, 300) },
    });
    return;
  }
  const cycle: CycleBudget = { current: budget };
  const bankroll = toDisplayUsdc(budget.availableRaw);

  // Step 1: Check daily drawdown limit against the live bankroll
  const now = env.clock.now();
  const closedToday = await env.closedPnlSince(env.clock.startOfDay());
  const drawdown = evaluateDailyDrawdown(closedToday, budget.availableRaw, now, hedgingFromParams(params));
  if (drawdown.isPaused) {
    await recordDecision({
      kind: 'DRAWDOWN_PAUSE',
      reasonCode: 'DRAWDOWN_LIMIT',
      data: {
        drawdownPct: drawdown.drawdownPct,
        dailyLoss: drawdown.dailyLoss,
        dailyLossRaw: drawdown.dailyLossRaw.toString(),
        pauseUntil: drawdown.pauseUntil?.toISOString(),
      },
    });
    logger.warn({ drawdownPct: drawdown.drawdownPct }, 'Trader Agent: paused due to drawdown limit');
    return;
  }

  signal?.throwIfAborted();

  // Step 2: Mark to market, then check every open position
  await env.markToMarket?.();
  signal?.throwIfAborted();
  const openPositions = await env.openPositions();

  for (const position of openPositions) {
    signal?.throwIfAborted();
    const { shouldClose, reason } = await env.stopLoss(position);
    if (shouldClose && reason) {
      const exit = await env.exit(position.id, 'STOP_LOSS', position.currentPrice ?? position.entryPrice);
      await recordDecision({
        kind: 'STOP_LOSS', marketId: position.marketId,
        reasonCode: 'STOP_LOSS_TRIGGERED',
        positionId: position.id,
        outcome: { exited: exit.ok, ...(exit.reason ? { exitReason: exit.reason } : {}) },
        data: { positionId: position.id, reason, exited: exit.ok, ...(exit.reason ? { exitReason: exit.reason } : {}) },
      });
      logger.info({ positionId: position.id, reason, exited: exit.ok }, 'Stop-loss triggered');
    }
  }

  signal?.throwIfAborted();

  // Step 3: Hedge opportunities
  const hedgeRecs = await env.hedges();
  for (const rec of hedgeRecs) {
    signal?.throwIfAborted();
    try {
      await env.hedge(rec);
    } catch (err) {
      logger.warn({ err, rec }, 'Trader Agent: hedge failed');
      await recordDecision({
        kind: 'HEDGE',
        reasonCode: 'HEDGE_FAILED',
        marketId: rec.hedgeMarketId,
        data: { ...rec, error: String(err).slice(0, 300) },
        outcome: { status: 'FAILED' },
      });
      continue;
    }
    await recordDecision({
      kind: 'HEDGE',
      reasonCode: 'HEDGE_EXECUTED',
      marketId: rec.hedgeMarketId,
      data: { ...rec },
      outcome: { status: 'EXECUTED' },
    });
  }

  signal?.throwIfAborted();

  // Step 4: Scan markets for opportunities
  const signals = await env.signals(now, signal);
  const activeMarkets = await env.candidateMarkets(now, {
    minLiquidity: params.minLiquidity,
    horizonDays: params.horizonDays,
  });

  // Circuit breaker: abort the scan if too many consecutive stale-price markets (#266).
  let consecutiveStale = 0;
  for (const market of activeMarkets) {
    signal?.throwIfAborted();
    const stale = await analyzeAndTradeMarket(env, params, cycle, market, signals, recordDecision, signal);
    if (stale) {
      consecutiveStale++;
      if (consecutiveStale >= config.TRADER_STALE_ABORT_COUNT) {
        await recordDecision({
          kind: 'SKIP',
          reasonCode: 'PRICE_SOURCE_DOWN',
          data: { reason: 'PRICE_SOURCE_DOWN', consecutiveStale },
        });
        logger.warn({ consecutiveStale }, 'Trader Agent: price source down — aborting market scan');
        break;
      }
    } else {
      consecutiveStale = 0;
    }
  }

  logger.info('Trader Agent: cycle complete');
}

/** Returns true when the market was skipped due to a stale price (for circuit breaker tracking). */
async function analyzeAndTradeMarket(
  env: TraderEnv,
  params: TraderParams,
  cycle: CycleBudget,
  market: MarketView,
  signals: AggregatedSignals,
  recordDecision: (decision: Omit<DecisionRecord, 'cycleId'>) => Promise<void>,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    // Skip if we already have an open position in this market
    if (await env.hasOpenPosition(market.id)) {
      await recordDecision({
        kind: 'SKIP',
        reasonCode: 'POSITION_ALREADY_OPEN',
        marketId: market.id,
        data: { reason: 'POSITION_ALREADY_OPEN' },
      });
      return false;
    }

    // Guard: skip markets without an on-chain id — price() cannot serve them (#266).
    if (!market.onChainMarketId) {
      await recordDecision({
        kind: 'SKIP',
        reasonCode: 'MARKET_NOT_ON_CHAIN',
        marketId: market.id,
        data: { reason: 'NOT_ON_CHAIN' },
      });
      return false;
    }

    // Step 0 of pricing: get a ledger-tagged price BEFORE spending LLM budget on a forecast (#266).
    let decisionPriceResult: DecisionPrice;
    try {
      decisionPriceResult = await env.price(market);
    } catch (err) {
      if (err instanceof StalePriceError) {
        await recordDecision({
          kind: 'SKIP', marketId: market.id,
          reasonCode: 'PRICE_STALE',
          data: { reason: 'PRICE_STALE', detail: (err as StalePriceError).details },
        });
        return true; // signal stale to circuit breaker
      }
      throw err;
    }

    const marketProb = Number(decisionPriceResult.yesBps) / 10_000;
    const priceAsOf: PriceAsOf = {
      ledger: decisionPriceResult.asOfLedger,
      source: decisionPriceResult.source,
      lagLedgers: decisionPriceResult.lagLedgers,
      yesBps: decisionPriceResult.yesBps.toString(),
    };

    const forecast = await env.forecast(market, signals);
    if (!forecast) {
      await recordDecision({
        kind: 'SKIP',
        reasonCode: 'FORECAST_UNAVAILABLE',
        marketId: market.id,
        data: { reason: 'FORECAST_UNAVAILABLE', signalCount: signals.signalCount },
      });
      return false;
    }
    const forecastRef = sha256Hex(canonicalJson(forecast));
    const { p: agentProb, ci: confidenceInterval } = forecast;

    // Compute edge
    const edge = agentProb - marketProb;

    // Guard: insufficient edge
    if (Math.abs(edge) < params.minEdge) {
      await recordDecision({
        kind: 'SKIP',
        reasonCode: 'EDGE_BELOW_MIN',
        marketId: market.id,
        forecastRef,
        data: { edge, minEdge: params.minEdge, p: forecast.p, marketProb },
      });
      return false;
    }

    // Size from the conservative end of the CI. Everything is from the side
    // being bought: a NO bet compares P(NO) = 1 − ci.upper with the NO price
    // 1 − marketProb, never with the YES price.
    const conservativeProb = edge > 0 ? confidenceInterval.lower : 1 - confidenceInterval.upper;
    const sidePrice = edge > 0 ? marketProb : 1 - marketProb;
    const direction = edge > 0 ? 'YES' : 'NO';

    if (conservativeProb - sidePrice < params.minConservativeEdge) {
      logger.debug(
        { marketId: market.id, edge, conservativeProb, sidePrice, minConservativeEdge: params.minConservativeEdge },
        'Conservative edge below minimum',
      );
      await recordDecision({
        kind: 'SKIP',
        marketId: market.id,
        reasonCode: 'CONSERVATIVE_EDGE_BELOW_MIN',
        forecastRef,
        data: {
          reason: 'CONSERVATIVE_EDGE_BELOW_MIN',
          direction,
          edge,
          minConservativeEdge: params.minConservativeEdge,
          p: agentProb,
          ci: confidenceInterval,
        },
      });
      return false;
    }

    // Fresh, ledger-tagged reserves and the market's own fee_bps (#225).
    let pool: PoolView | null;
    try {
      pool = await env.pool(market.id);
    } catch (err) {
      await env.recordDecision({
        kind: 'SKIP', marketId: market.id,
        data: { reason: 'POOL_UNAVAILABLE', direction, edge, error: String((err as Error)?.message ?? err).slice(0, 300) },
      });
      return false;
    }
    if (!pool) {
      await env.recordDecision({ kind: 'SKIP', marketId: market.id, data: { reason: 'POOL_UNAVAILABLE', direction, edge } });
      return false;
    }
    if (pool.lagLedgers > config.TRADER_POOL_MAX_AGE_LEDGERS) {
      await env.recordDecision({
        kind: 'SKIP', marketId: market.id,
        data: {
          reason: 'POOL_STALE', direction, edge, poolLedger: pool.asOfLedger, poolSource: pool.source,
          lagLedgers: pool.lagLedgers, maxAgeLedgers: config.TRADER_POOL_MAX_AGE_LEDGERS,
        },
      });
      return false;
    }

    // A budget read more than budgetMaxAgeMs ago is re-read before sizing.
    if (env.clock.now().getTime() - cycle.current.readAt.getTime() > params.budgetMaxAgeMs) {
      cycle.current = await env.budget();
    }
    const budget = cycle.current;
    const bankroll = toDisplayUsdc(budget.availableRaw);

    // Treasury caps, in base units, bound the optimisation (#76): max_trade,
    // market and daily headroom, free cash, then the 2.5% single-position cap.
    const exposure = await env.marketExposure(market.id);
    const headroomRaw = budget.maxMarketRaw > exposure.totalRaw ? budget.maxMarketRaw - exposure.totalRaw : 0n;
    const caps = clampSize(budget.availableRaw, budget, headroomRaw, params.headroomSafetyBps);
    let capRaw = caps.sizeRaw;
    let capBinding: SizingBinding = caps.binding === 'KELLY' ? 'AVAILABLE' : caps.binding;
    const positionCapBps = BigInt(Math.round(params.maxSinglePositionPct * 10_000));
    const positionCapRaw = (budget.availableRaw * positionCapBps) / 10_000n;
    if (positionCapRaw < capRaw) {
      capRaw = positionCapRaw;
      capBinding = 'KELLY';
    }

    const model = params.sizing ?? 'impact';
    const reserves: PoolView = pool;
    const sizeWithin = (maxRaw: bigint) => (model === 'mid' ? sizeAtMid : sizeAgainstPool)({
      p: conservativeProb, side: direction, pool: reserves, wealthRaw: budget.availableRaw,
      maxRaw, kellyMultiplier: params.kellyMultiplier, minRaw: MIN_TRADE_RAW,
    });
    let sized = sizeWithin(capRaw);
    const kellyRaw = sized.collateralRaw;
    // A cap below the minimum order is what stopped it, not the curve.
    let binding: SizingBinding = sized.collateralRaw >= capRaw || capRaw < MIN_TRADE_RAW ? capBinding : 'IMPACT';

    // Correlation check on the curve-optimal size. A cut re-optimises within
    // the smaller bound rather than scaling, so the caps never compound. The
    // check rounds to cents, so only a cut below the rounded size counts.
    let correlationRaw = kellyRaw;
    let correlation: Awaited<ReturnType<TraderEnv['correlation']>> | null = null;
    if (kellyRaw > 0n) {
      const proposed = toDisplayUsdc(kellyRaw);
      correlation = await env.correlation(market.id, proposed, direction, bankroll, correlationFromParams(params));
      if (correlation.adjustedPositionSize < parseFloat(proposed.toFixed(2))) {
        correlationRaw = usdcFromNumber(Math.max(0, correlation.adjustedPositionSize));
        sized = sizeWithin(correlationRaw);
        binding = sized.collateralRaw >= correlationRaw ? 'CORRELATION' : 'IMPACT';
      }
    }

    const sizing: SizingRecord = {
      ...(params.paramsVersion ? { params: params.paramsVersion } : {}),
      kellyRaw: kellyRaw.toString(),
      correlationRaw: correlationRaw.toString(),
      marketExposureRaw: exposure.totalRaw.toString(),
      marketExposureEstimated: exposure.estimated,
      finalRaw: sized.collateralRaw.toString(),
      binding,
      safetyBps: params.headroomSafetyBps,
      budget: budgetSnapshot(budget),
      priceAsOf,
      impact: impactRecord(model, sized, reserves),
    };

    if (sized.reason === 'NO_EDGE_AT_MARGIN') {
      // Fee and impact eat the conservative edge on even the smallest order.
      await env.recordDecision({ kind: 'SKIP', marketId: market.id, data: { reason: 'NO_EDGE_AT_MARGIN', direction, edge, sizing } });
      return false;
    }
    if (sized.collateralRaw < MIN_TRADE_RAW || !correlation) {
      logger.debug({ marketId: market.id, binding, finalRaw: sizing.finalRaw }, 'Position size below minimum after caps — skipping');
      await recordDecision({
        kind: 'SKIP',
        reasonCode: 'SIZE_BELOW_MIN',
        marketId: market.id,
        forecastRef,
        sizingRecord: sizing as unknown as Record<string, unknown>,
        data: { reason: 'SIZE_BELOW_MIN', direction, edge, sizing },
      });
      return false;
    }

    const amountRaw = sized.collateralRaw;
    const amount = toDisplayUsdc(amountRaw);
    const price  = direction === 'YES' ? marketProb : 1 - marketProb;

    signal?.throwIfAborted();

    const result = await env.buy({
      marketId: market.id,
      direction,
      amount,
      amountRaw,
      price,
      marketProb,
      edge,
      // Fraction of free cash committed (the trace's betFraction).
      kelly: Number((amountRaw * 1_000_000n) / budget.availableRaw) / 1_000_000,
      conservativeProb,
      forecast,
      correlation,
      sizing,
      priceAsOf,
    });
    if (result.ok) cycle.current = spend(cycle.current, amountRaw);
    await env.recordDecision({
      kind: result.ok ? 'BUY' : 'SKIP',
      reasonCode: result.ok ? 'BUY_ACCEPTED' : 'BUY_REJECTED',
      marketId: market.id,
      traceId: result.traceId,
      tradeId: result.tradeId,
      positionId: result.positionId,
      forecastRef,
      sizingRecord: sizing as unknown as Record<string, unknown>,
      outcome: result.outcome ?? { accepted: result.ok, ...(result.reason ? { reason: result.reason } : {}) },
      data: { direction, amount, amountRaw: sizing.finalRaw, binding, edge, ...(result.reason ? { reason: result.reason } : {}) },
    });

    if (result.ok) logger.info({ marketId: market.id, direction, amount, binding, edge }, 'Trader Agent: trade executed');
    return false;
  } catch (err) {
    logger.warn({ err, marketId: market.id }, 'Trader Agent: market analysis failed');
    await recordDecision({
      kind: 'SKIP',
      reasonCode: 'MARKET_ANALYSIS_FAILED',
      marketId: market.id,
      data: { error: String(err).slice(0, 300) },
      outcome: { status: 'FAILED' },
    });
    return false;
  }
}
