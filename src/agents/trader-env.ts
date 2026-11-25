/**
 * What the trader's decision policy (trader-policy.ts) may touch: a clock,
 * reads of markets, positions and signals, execution, and a decision sink.
 * Production wraps Prisma and the chain service (`prodTraderEnv`); the
 * backtester (src/backtest/) supplies replayed history instead (#81).
 */
import type { AgentDecisionKind, AgentDecisionReason } from '@prisma/client';
import { aggregateSignals } from '../services/ingestion.service';
import { executeTrade } from '../services/trade.service';
import { decisionPrice, type DecisionPrice } from '../services/market-price.service';
import { config } from '../config';
import { ForecastSession, forecastMarket, rankForForecast, type ForecastMarket } from '../services/forecast.service';
import { exitPosition } from '../services/exit.service';
import { latestReserves, markOpenPositions, type MarketReserves } from '../services/valuation.service';
import { getOnChainMarketCached } from '../services/chain.service';
import { indexerLag, latestLedgerView, type IndexerLag } from '../services/chain-freshness.service';
import type { PoolState } from '../services/impact-kelly';
import { checkCorrelation, type CorrelationRiskParams } from '../services/correlation.service';
import { evidenceFromSignals, generateReasoningTrace } from '../services/reasoning.service';
import type { ProvenanceEntry } from '../lib/llm/provenance';
import { detectHedgeOpportunities, autoHedge, enforceStopLoss } from '../services/hedging.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAgentLog } from '../lib/agent-log';
import { recordAgentDecision } from '../services/agent-decision.service';
import { now as clockNow } from '../lib/clock';
import { decimalToBigint } from '../lib/amounts';
import {
  budgetSnapshot,
  marketExposureRaw,
  readTreasuryBudget,
  type MarketExposure,
  type TreasuryBudget,
} from '../services/treasury-budget.service';
import type { SizingRecord } from './trader-policy';
import { recordDrawdownPause, utcStartOfDay, type DrawdownEvaluation } from '../services/hedging.service';
import type {
  AggregatedSignals,
  ConfidenceInterval,
  CorrelationCheckResult,
  EnsembleForecast,
  HedgeRecommendation,
  SourceWeightSetRef,
  WeightedSignal,
} from '../types';

export type TradeDirection = 'YES' | 'NO';

export interface Clock {
  now(): Date;
  /** Start of the current day in UTC. */
  startOfDay(): Date;
}

export interface PositionView {
  id: string;
  marketId: string;
  /** Market category, when the env knows it (used by the correlation and hedge checks). */
  category?: string;
  direction: TradeDirection;
  entryPrice: number;
  currentPrice: number | null;
  size: number;
  pnl: number;
}

export interface MarketView {
  id: string;
  category: string;
  currentYesProb: number | null;
  initialYesProb: number;
  totalLiquidity: number;
  expiryTimestamp: Date;
  /** What the forecaster reads (#75); absent in a backtest replay. */
  question?: string;
  resolutionOracle?: string | null;
  metaUri?: string | null;
  questionHash?: string | null;
  /** On-chain market id for ledger-tagged price reads (#266); absent when the market has no chain id. */
  onChainMarketId?: bigint;
}

export { type DecisionPrice };

/** FPMM reserves the trader sizes against (#225), with how far they trail the RPC's latest ledger. */
export interface PoolView extends PoolState {
  lagLedgers: number;
}

export interface Forecast {
  p: number;
  ci: ConfidenceInterval;
  /** Signals behind the estimate, recorded in the reasoning trace. */
  sources: WeightedSignal[];
  /** Per-model forecasts, weights and input digests (#75), pinned in the trace. */
  ensemble?: EnsembleForecast;
  /** Weight set of the aggregation the forecast's signals came from (#223). */
  weightSet?: SourceWeightSetRef;
}

export interface BuyOrder {
  marketId: string;
  direction: TradeDirection;
  /** USDC display value of amountRaw. */
  amount: number;
  /** Final size in base units, after correlation and the treasury caps (#76). */
  amountRaw: bigint;
  /** Probability of the side being bought, at decision time. */
  price: number;
  marketProb: number;
  edge: number;
  kelly: number;
  /** Conservative probability of the side bought; execution refuses a fill whose average price reaches it (#225). */
  conservativeProb: number;
  forecast: Forecast;
  correlation: CorrelationCheckResult;
  /** Kelly → correlation → caps, with the binding constraint and budget snapshot (#76). */
  sizing: SizingRecord;
  /** Ledger context for the decision price (#266). */
  priceAsOf: import('./trader-policy').PriceAsOf;
}

export interface ExecResult {
  ok: boolean;
  /** Why an order was refused (a cap name in a backtest). */
  reason?: string;
  traceId?: string;
  tradeId?: string;
  positionId?: string;
  outcome?: Record<string, unknown>;
}

export interface DecisionRecord {
  cycleId: string;
  kind: AgentDecisionKind;
  reasonCode: AgentDecisionReason;
  marketId?: string;
  traceId?: string;
  tradeId?: string;
  positionId?: string;
  forecastRef?: string;
  sizingRecord?: Record<string, unknown>;
  outcome?: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface TraderEnv {
  clock: Clock;
  /** Treasury capital and caps (#76). Throws when they cannot be read; the cycle then trades nothing. */
  budget(): Promise<TreasuryBudget>;
  /** The treasury's cumulative spend on a market, as max_market counts it (#76). */
  marketExposure(marketId: string): Promise<MarketExposure>;
  openPositions(): Promise<PositionView[]>;
  hasOpenPosition(marketId: string): Promise<boolean>;
  candidateMarkets(now: Date, filter: { minLiquidity: number; horizonDays: number }): Promise<MarketView[]>;
  signals(now: Date, signal?: AbortSignal): Promise<AggregatedSignals>;
  /** P&L of positions closed since `t`, for the daily drawdown check. */
  closedPnlSince(t: Date): Promise<bigint[]>;
  forecast(m: MarketView, s: AggregatedSignals): Promise<Forecast | null>;
  /** Marks open positions to market from the latest reserves (#78); a backtest values its own pools. */
  markToMarket?(): Promise<void>;
  stopLoss(position: PositionView): Promise<{ shouldClose: boolean; reason?: string }>;
  /** `bankroll` is the cycle's free treasury cash in USDC; the correlated-exposure cap is a share of it. */
  correlation(
    marketId: string,
    size: number,
    direction: TradeDirection,
    bankroll: number,
    limits?: CorrelationRiskParams,
  ): Promise<CorrelationCheckResult>;
  hedges(): Promise<HedgeRecommendation[]>;
  hedge(rec: HedgeRecommendation): Promise<void>;
  buy(order: BuyOrder): Promise<ExecResult>;
  exit(positionId: string, reason: string, price: number): Promise<ExecResult>;
  /** Trace sink: every decision the policy makes that is worth keeping. */
  recordDecision(d: DecisionRecord): Promise<void>;
  /** Ledger-tagged decision price for a market (#266). Throws StalePriceError when no fresh source is available. */
  price(m: MarketView): Promise<DecisionPrice>;
  /** Ledger-tagged FPMM reserves and the market's own fee_bps for sizing (#225); null when the market has none. */
  pool(marketId: string): Promise<PoolView | null>;
}

/** Chain reads behind the production pool(); injectable for tests. */
export interface PoolDeps {
  reserves(onChainMarketId: bigint): Promise<MarketReserves>;
  /** get_market with the ledger its simulation ran against (readWithLedger). */
  marketWithLedger(onChainMarketId: bigint): Promise<{ reserveYes: bigint; reserveNo: bigint; feeBps: bigint; ledger: number }>;
  latestLedger(): Promise<number>;
  indexerLag(latestLedger: number): Promise<IndexerLag>;
}

export const defaultPoolDeps: PoolDeps = {
  reserves: (id) => latestReserves(id, config.TRADER_POOL_MAX_AGE_LEDGERS),
  async marketWithLedger(id) {
    const entry = await getOnChainMarketCached(id);
    return {
      reserveYes: BigInt(entry.value.reserve_yes),
      reserveNo: BigInt(entry.value.reserve_no),
      feeBps: BigInt(entry.value.fee_bps),
      ledger: entry.ledger,
    };
  },
  latestLedger: async () => (await latestLedgerView()).latestLedger,
  indexerLag: (latestLedger) => indexerLag({ latestLedger, latestCloseTime: 0, observedAt: 0 }),
};

/**
 * Reserves for sizing, tagged with the ledger they are valid at. Indexed
 * reserves are valid up to the indexer cursor (a quiet market's newest Trade
 * can be old and still current), so their lag is the cursor's. get_market
 * reserves come with the ledger its simulation ran against, never 0.
 */
export async function poolFromChain(onChainMarketId: bigint, deps: PoolDeps = defaultPoolDeps): Promise<PoolView> {
  const r = await deps.reserves(onChainMarketId);
  const latest = await deps.latestLedger();
  if (r.source === 'indexed') {
    const lag = await deps.indexerLag(latest);
    const asOfLedger = lag.cursorLedger ?? r.asOfLedger;
    return { ...r, asOfLedger, lagLedgers: Math.max(0, lag.lagLedgers ?? latest - asOfLedger) };
  }
  const m = await deps.marketWithLedger(onChainMarketId);
  return {
    reserveYes: m.reserveYes, reserveNo: m.reserveNo, feeBps: m.feeBps,
    asOfLedger: m.ledger, source: 'rpc', lagLedgers: Math.max(0, latest - m.ledger),
  };
}

/** Production env: Prisma, the chain service, the reasoning service and the wall clock. */
export function prodTraderEnv(params: import('./trader-policy').TraderParams): TraderEnv {
  const hedging = {
    stopLossBps: params.stopLossBps,
    hedgeLossBps: params.hedgeLossBps,
    maxDailyDrawdownPct: params.maxDailyDrawdownPct,
    drawdownPauseHours: params.drawdownPauseHours,
  };
  // One env per cycle, so one forecast budget per cycle (#75).
  const forecastSession = new ForecastSession();
  return {
    clock: {
      now: () => clockNow(),
      startOfDay: () => utcStartOfDay(clockNow()),
    },

    budget: () => readTreasuryBudget(),

    async marketExposure(marketId) {
      const market = await prisma.market.findUnique({ where: { id: marketId }, select: { onChainMarketId: true } });
      return marketExposureRaw(marketId, market?.onChainMarketId ?? null);
    },

    async openPositions() {
      const rows = await prisma.position.findMany({ where: { status: 'OPEN' } });
      return rows.map((p) => ({
        id: p.id, marketId: p.marketId, direction: p.direction, entryPrice: p.entryPrice,
        currentPrice: p.currentPrice, size: p.size, pnl: p.pnl,
      }));
    },

    async hasOpenPosition(marketId) {
      return Boolean(await prisma.position.findFirst({ where: { marketId, status: 'OPEN' } }));
    },

    async candidateMarkets(now, { minLiquidity, horizonDays }) {
      const markets = await prisma.market.findMany({
        where: {
          status:         'ACTIVE',
          totalLiquidity: { gte: minLiquidity },
          expiryTimestamp: {
            gt:  now,
            lte: new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000),
          },
        },
      });
      // The forecast cap (#75) goes to markets without a recent forecast, soonest close first.
      // onChainMarketId is included so the trader can gate on fresh ledger prices (#266).
      return rankForForecast(markets.map(m => ({
        ...m,
        onChainMarketId: m.onChainMarketId !== null ? BigInt(m.onChainMarketId) : undefined,
      })));
    },

    signals: (_now, signal) => aggregateSignals(signal),

    async closedPnlSince(t) {
      const rows = await prisma.position.findMany({
        where: { status: { in: ['CLOSED', 'STOP_LOSS'] }, closedAt: { gte: t } },
        select: { realisedPnlRaw: true, unrealisedPnlRaw: true },
      });
      return rows.map((r) =>
        decimalToBigint(r.realisedPnlRaw) +
        (r.unrealisedPnlRaw == null ? 0n : decimalToBigint(r.unrealisedPnlRaw)),
      );
    },

    // An independent estimate (#75): the forecaster never sees the price. The
    // old code echoed the price through calculateProbability, so edge was 0.
    async forecast(market, signals) {
      if (!market.question) return null;
      const result = await forecastMarket(market as ForecastMarket, signals, forecastSession);
      if (!result) return null;
      return {
        p: result.forecast.p,
        ci: result.forecast.ci,
        sources: evidenceFromSignals(result.relevant),
        ensemble: result.forecast,
        weightSet: signals.weightSet,
      };
    },

    async markToMarket() {
      await markOpenPositions();
    },

    stopLoss: (position) => enforceStopLoss(position.id, hedging),

    correlation: (marketId, size, direction, bankroll, limits) =>
      checkCorrelation(marketId, size, bankroll, { direction, limits }),

    hedges: () => detectHedgeOpportunities(hedging),

    async hedge(rec) {
      await autoHedge(rec);
    },

    async buy(order) {
      // #235: thread the forecaster's full LLM provenance through the trace,
      // ahead of the hedge-conditions call. Without this, every TRADER
      // trace's `provenance.llm` only lists the hedge-conditions prompt,
      // and attribution grouped by provider/model/promptVersion silently
      // reports the hedge model instead of the forecast one.
      const forecastProvenance = (order.forecast.ensemble?.members ?? [])
        .flatMap((m) => {
          const detail = m.detail as { provenance?: unknown } | undefined;
          return Array.isArray(detail?.provenance) ? (detail!.provenance as ProvenanceEntry[]) : [];
        });

      // Generate reasoning trace BEFORE executing
      const { trace, tracePayload } = await generateReasoningTrace({
        marketId:            order.marketId,
        agentType:           'TRADER',
        decisionType:        'OPEN_POSITION',
        sourcesUsed:         order.forecast.sources,
        probabilityEstimate: order.forecast.p,
        rawProbabilityEstimate: order.forecast.ensemble?.raw?.p ?? order.forecast.p,
        marketProbability:   order.marketProb,
        edge:                order.edge,
        confidenceInterval:  order.forecast.ci,
        forecast:            order.forecast.ensemble as unknown as Record<string, unknown> | undefined,
        betFraction:         order.kelly,
        betSizeUsdc:         order.amount,
        sizing:              order.sizing as unknown as Record<string, unknown>,
        sourceWeightSet:     order.forecast.weightSet,
        correlation: {
          pairs:      order.correlation.correlatedPairs,
          method:     order.correlation.method ?? 'matrix',
          snapshotId: order.correlation.snapshotId ?? null,
        },
        ...(params.paramsVersion
          ? { riskParams: { scope: 'TRADER', version: params.paramsVersion.version, hash: params.paramsVersion.hash } }
          : {}),
      }, undefined, { upstreamProvenance: forecastProvenance });

      // Execute trade (Never abort between chain write and DB update)
      const result = await executeTrade({
        marketId:      order.marketId,
        direction:     order.direction,
        amount:        order.amount,
        amountRaw:     order.amountRaw,
        budget:        order.sizing.budget,
        price:         order.price,
        kellyFraction: order.kelly,
        edgeDetected:  order.edge,
        conservativeProb: order.conservativeProb,
        traceId:       trace.id,
        tracePayload,
      });
      return {
        ok: true,
        traceId: trace.id,
        tradeId: result.trade.id,
        positionId: result.position?.id,
        outcome: {
          tradeStatus: result.trade.status,
          positionStatus: result.position?.status ?? null,
        },
      };
    },

    // A real exit: agent_sell on-chain, the position changes only once it confirms (#77).
    async exit(positionId, reason) {
      const result = await exitPosition(positionId, { reason });
      return { ok: result.status === 'CONFIRMED' || result.status === 'SIMULATED', ...(result.code ? { reason: result.code } : {}) };
    },

    async recordDecision(d) {
      await recordAgentDecision({
        cycleId: d.cycleId,
        agentType: 'TRADER',
        kind: d.kind,
        reasonCode: d.reasonCode,
        marketId: d.marketId,
        traceId: d.traceId,
        tradeId: d.tradeId,
        positionId: d.positionId,
        forecastRef: d.forecastRef,
        inputs: d.data,
        sizingRecord: d.sizingRecord ?? d.data.sizing,
        outcome: d.outcome,
      });
      if (d.kind === 'TREASURY_READ_FAILED') {
        await writeAgentLog({ agentType: 'TRADER', level: 'WARN', action: 'TREASURY_READ_FAILED', data: d.data }).catch(() => {});
        return;
      }
      if (d.kind === 'DRAWDOWN_PAUSE') {
        const { drawdownPct, dailyLoss, dailyLossRaw, pauseUntil } = d.data as {
          drawdownPct: number;
          dailyLoss: number;
          dailyLossRaw: string;
          pauseUntil?: string;
        };
        const evaluation: DrawdownEvaluation = {
          isPaused: true,
          drawdownPct,
          dailyLoss,
          dailyLossRaw: BigInt(dailyLossRaw),
          pauseUntil: pauseUntil ? new Date(pauseUntil) : undefined,
        };
        await recordDrawdownPause(evaluation);
        return;
      }
      logger.debug({ decision: d.kind, marketId: d.marketId, ...d.data }, 'Trader decision');
    },

    async price(m) {
      if (!m.onChainMarketId) throw new Error(`Market ${m.id} has no onChainMarketId`);
      return decisionPrice(m.onChainMarketId, { maxLagLedgers: config.TRADER_MAX_PRICE_LAG_LEDGERS });
    },

    async pool(marketId) {
      const row = await prisma.market.findUnique({ where: { id: marketId }, select: { onChainMarketId: true } });
      if (row?.onChainMarketId == null) return null;
      return poolFromChain(BigInt(row.onChainMarketId));
    },
  };
}

