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
 *   5. For each mispriced market: compute Kelly size, check correlation,
 *      clamp to the treasury's headroom in base units, then trace and execute
 */
import { calculateKellySize } from '../services/kelly';
import { evaluateDailyDrawdown } from '../services/hedging.service';
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
import { correlation, newId } from '../lib/context';
import { canonicalJson, sha256Hex } from '../utils/hash.util';
import type { BuyOrder, DecisionRecord, MarketView, TraderEnv, DecisionPrice } from './trader-env';
import { StalePriceError } from '../services/market-price.service';
import type { AggregatedSignals, ConfidenceInterval, KellyResult } from '../types';

export interface TraderParams {
  minEdge: number;
  minLiquidity: number;
  horizonDays: number;
  /** Share of daily and per-market headroom left unused, in basis points (#76). */
  headroomSafetyBps: number;
  /** A budget older than this is re-read before the next order (#76). */
  budgetMaxAgeMs: number;
}

export const DEFAULT_PARAMS: TraderParams = {
  minEdge: 0.08,
  minLiquidity: 500,
  horizonDays: 14,   // markets expiring within 14 days
  headroomSafetyBps: config.TREASURY_HEADROOM_SAFETY_BPS,
  budgetMaxAgeMs: 60_000,
};

/** Ledger context recorded with every BuyOrder and SizingRecord (#266). */
export interface PriceAsOf {
  ledger: number;
  source: 'indexed' | 'rpc';
  lagLedgers: number;
  yesBps: string;
}

/** The sizing decision recorded in the trace: every intermediate size in base units (#76). */
export interface SizingRecord {
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
}

export type ExplainStep =
  | { step: 'FORECAST'; p: number; ci: ConfidenceInterval; available: boolean }
  | { step: 'EDGE'; edge: number; minEdge: number; pass: boolean }
  | { step: 'KELLY'; conservativeProb: number; sidePrice: number; result: KellyResult }
  | { step: 'CAPS'; sizing: SizingRecord }
  | { step: 'ORDER'; order: BuyOrder }
  | { step: 'OUTCOME'; branch: string };

export interface Explainer { step(step: ExplainStep): void }

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
  const drawdown = evaluateDailyDrawdown(closedToday, budget.availableRaw, now);
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
    const stale = await analyzeMarket(env, params, cycle, market, signals, recordDecision, signal);
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
export async function analyzeMarket(
  env: TraderEnv,
  params: TraderParams,
  cycle: CycleBudget,
  market: MarketView,
  signals: AggregatedSignals,
  recordDecision: (decision: Omit<DecisionRecord, 'cycleId'>) => Promise<void>,
  signal?: AbortSignal,
  opts: { explain?: Explainer } = {},
): Promise<boolean> {
  const finish = async (branch: string, stale = false) => {
    opts.explain?.step({ step: 'OUTCOME', branch });
    return stale;
  };
  try {
    // Skip if we already have an open position in this market
    if (await env.hasOpenPosition(market.id)) {
      await recordDecision({
        kind: 'SKIP',
        reasonCode: 'POSITION_ALREADY_OPEN',
        marketId: market.id,
        data: { reason: 'POSITION_ALREADY_OPEN' },
      });
      return finish('POSITION_ALREADY_OPEN');
    }

    // Guard: skip markets without an on-chain id — price() cannot serve them (#266).
    if (!market.onChainMarketId) {
      await recordDecision({
        kind: 'SKIP',
        reasonCode: 'MARKET_NOT_ON_CHAIN',
        marketId: market.id,
        data: { reason: 'NOT_ON_CHAIN' },
      });
      return finish('MARKET_NOT_ON_CHAIN');
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
        return finish('PRICE_STALE', true); // signal stale to circuit breaker
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
    opts.explain?.step({ step: 'FORECAST', p: forecast?.p ?? 0, ci: forecast?.ci ?? { lower: 0, upper: 0 }, available: Boolean(forecast) });
    if (!forecast) {
      await recordDecision({
        kind: 'SKIP',
        reasonCode: 'FORECAST_UNAVAILABLE',
        marketId: market.id,
        data: { reason: 'FORECAST_UNAVAILABLE', signalCount: signals.signalCount },
      });
      return finish('FORECAST_UNAVAILABLE');
    }
    const forecastRef = sha256Hex(canonicalJson(forecast));
    const { p: agentProb, ci: confidenceInterval } = forecast;

    // Compute edge
    const edge = agentProb - marketProb;
    opts.explain?.step({ step: 'EDGE', edge, minEdge: params.minEdge, pass: Math.abs(edge) >= params.minEdge });

    // Guard: insufficient edge
    if (Math.abs(edge) < params.minEdge) {
      await recordDecision({
        kind: 'SKIP',
        reasonCode: 'EDGE_BELOW_MIN',
        marketId: market.id,
        forecastRef,
        data: { edge, minEdge: params.minEdge, p: forecast.p, marketProb },
      });
      return finish('EDGE_BELOW_MIN');
    }

    // Kelly sizing — use conservative end of CI. Everything is from the side
    // being bought: a NO bet compares P(NO) = 1 − ci.upper with the NO price
    // 1 − marketProb, never with the YES price.
    const conservativeProb = edge > 0 ? confidenceInterval.lower : 1 - confidenceInterval.upper;
    const sidePrice = edge > 0 ? marketProb : 1 - marketProb;
    // A budget read more than budgetMaxAgeMs ago is re-read before sizing.
    if (env.clock.now().getTime() - cycle.current.readAt.getTime() > params.budgetMaxAgeMs) {
      cycle.current = await env.budget();
    }
    const budget = cycle.current;
    const bankroll = toDisplayUsdc(budget.availableRaw);

    const kellyResult = calculateKellySize({
      agentProbability:  Math.max(0.01, conservativeProb),
      marketProbability: sidePrice,
      bankroll,
      netOdds:           (1 - sidePrice) / sidePrice,
    });
    opts.explain?.step({ step: 'KELLY', conservativeProb, sidePrice, result: kellyResult });

    // Correlation check — may reduce position size
    const direction = edge > 0 ? 'YES' : 'NO';

    if (kellyResult.betSize <= 0) {
      // The point edge clears minEdge but the conservative end of the interval
      // does not: intended, the forecast is too uncertain to size (#75).
      logger.debug({ marketId: market.id, edge, conservativeProb, sidePrice }, 'SIZE_ZERO_WIDE_CI: interval too wide to size');
      await recordDecision({
        kind: 'SKIP', marketId: market.id,
        reasonCode: 'SIZE_ZERO_WIDE_CI',
        forecastRef,
        data: { reason: 'SIZE_ZERO_WIDE_CI', direction, edge, p: agentProb, ci: confidenceInterval },
      });
      return finish('SIZE_ZERO_WIDE_CI');
    }
    const correlation = await env.correlation(market.id, kellyResult.betSize, direction, bankroll);

    // Treasury caps, in base units, before any trace exists (#76). Floats stop
    // here: Kelly and correlation are display-USDC inputs, the order is raw.
    const kellyRaw = usdcFromNumber(kellyResult.betSize);
    const correlationRaw = usdcFromNumber(Math.max(0, correlation.adjustedPositionSize));
    const exposure = await env.marketExposure(market.id);
    const headroomRaw = budget.maxMarketRaw > exposure.totalRaw ? budget.maxMarketRaw - exposure.totalRaw : 0n;
    const clamped = clampSize(correlationRaw, budget, headroomRaw, params.headroomSafetyBps);
    const binding: SizingBinding = clamped.binding === 'KELLY' && correlationRaw < kellyRaw ? 'CORRELATION' : clamped.binding;
    const sizing: SizingRecord = {
      kellyRaw: kellyRaw.toString(),
      correlationRaw: correlationRaw.toString(),
      marketExposureRaw: exposure.totalRaw.toString(),
      marketExposureEstimated: exposure.estimated,
      finalRaw: clamped.sizeRaw.toString(),
      binding,
      safetyBps: params.headroomSafetyBps,
      budget: budgetSnapshot(budget),
      priceAsOf,
    };
    opts.explain?.step({ step: 'CAPS', sizing });

    if (clamped.sizeRaw < MIN_TRADE_RAW) {
      logger.debug({ marketId: market.id, binding, finalRaw: sizing.finalRaw }, 'Position size below minimum after caps — skipping');
      await recordDecision({
        kind: 'SKIP',
        reasonCode: 'SIZE_BELOW_MIN',
        marketId: market.id,
        forecastRef,
        sizingRecord: sizing as unknown as Record<string, unknown>,
        data: { reason: 'SIZE_BELOW_MIN', direction, edge, sizing },
      });
      return finish('SIZE_BELOW_MIN');
    }

    const amount = toDisplayUsdc(clamped.sizeRaw);
    const price  = direction === 'YES' ? marketProb : 1 - marketProb;

    signal?.throwIfAborted();

    const order: BuyOrder = {
      marketId: market.id,
      direction,
      amount,
      amountRaw: clamped.sizeRaw,
      price,
      marketProb,
      edge,
      kelly: kellyResult.halfKelly,
      forecast,
      correlation,
      sizing,
      priceAsOf,
    };
    opts.explain?.step({ step: 'ORDER', order });
    const result = await env.buy(order);
    if (result.ok) cycle.current = spend(cycle.current, clamped.sizeRaw);
    await recordDecision({
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
    return finish(result.ok ? 'BUY_ACCEPTED' : 'BUY_REJECTED');
  } catch (err) {
    logger.warn({ err, marketId: market.id }, 'Trader Agent: market analysis failed');
    await recordDecision({
      kind: 'SKIP',
      reasonCode: 'MARKET_ANALYSIS_FAILED',
      marketId: market.id,
      data: { error: String(err).slice(0, 300) },
      outcome: { status: 'FAILED' },
    });
    return finish('MARKET_ANALYSIS_FAILED');
  }
}
