/**
 * A TraderEnv with in-memory answers, for driving runTraderPolicy without
 * Prisma, the chain or the wall clock. Every call is recorded.
 */
import type { BuyOrder, DecisionRecord, Forecast, MarketView, PoolView, TraderEnv } from '../../src/agents/trader-env';
import { priceYesBps, seedReserves } from '../../src/generated/fpmm';
import type { TreasuryBudget } from '../../src/services/treasury-budget.service';
import type { AggregatedSignals } from '../../src/types';

export const USDC = 10_000_000n;
export const T0 = new Date('2026-10-18T12:00:00Z');

export function budget(over: Partial<TreasuryBudget> = {}): TreasuryBudget {
  const maxDailyRaw = over.maxDailyRaw ?? 5_000n * USDC;
  const dailyUsedRaw = over.dailyUsedRaw ?? 0n;
  return {
    availableRaw: 10_000n * USDC,
    maxTradeRaw: 1_000n * USDC,
    maxMarketRaw: 2_000n * USDC,
    maxDailyRaw,
    dailyUsedRaw,
    dailyRemainingRaw: maxDailyRaw > dailyUsedRaw ? maxDailyRaw - dailyUsedRaw : 0n,
    dailyWindowStart: new Date(T0.getTime() - 3_600_000),
    dailyResetsAt: new Date(T0.getTime() + 23 * 3_600_000),
    readAt: T0,
    ...over,
  };
}

export function market(over: Partial<MarketView> = {}): MarketView {
  return {
    id: 'm1',
    category: 'FED',
    currentYesProb: 0.55,
    initialYesProb: 0.5,
    totalLiquidity: 5_000,
    expiryTimestamp: new Date(T0.getTime() + 7 * 86_400_000),
    onChainMarketId: 7n,
    ...over,
  };
}

/**
 * A pool priced at `yesProb`, seeded with `seedUsdc` per side's larger
 * reserve. The default is deep (10M USDC): its impact on a few hundred
 * USDC is negligible, so sizes match the closed-form Kelly.
 */
export function pool(yesProb = 0.55, opts: { seedUsdc?: bigint; feeBps?: bigint; lagLedgers?: number; source?: PoolView['source'] } = {}): PoolView {
  const r = seedReserves((opts.seedUsdc ?? 10_000_000n) * USDC, BigInt(Math.round(yesProb * 10_000)));
  return {
    reserveYes: r.reserveYes, reserveNo: r.reserveNo, feeBps: opts.feeBps ?? 100n,
    asOfLedger: 1_000, source: opts.source ?? 'indexed', lagLedgers: opts.lagLedgers ?? 0,
  };
}

export interface FakeEnv extends TraderEnv {
  buys: BuyOrder[];
  decisions: DecisionRecord[];
  calls: string[];
  correlationBankrolls: number[];
  /** Sizes passed to the correlation check, in USDC. */
  correlationSizes: number[];
  budgetReads: number;
  poolOf(m: MarketView): PoolView | null;
}

export function fakeTraderEnv(opts: {
  budget?: () => Promise<TreasuryBudget>;
  markets?: MarketView[];
  forecast?: (m: MarketView) => Forecast | null;
  exposureRaw?: bigint;
  closedPnl?: bigint[];
  /** Fraction of the proposed size the correlation check keeps. */
  correlationKeep?: number;
  /** Sizing reserves per market (#225); defaults to a deep pool at the market's price. */
  pool?: (m: MarketView) => PoolView | null;
  now?: () => Date;
  /** Decision price (#266); defaults to a fresh indexed price at the market's currentYesProb. */
  price?: (m: MarketView) => Promise<DecisionPrice>;
} = {}): FakeEnv {
  const env: FakeEnv = {
    buys: [],
    decisions: [],
    calls: [],
    correlationBankrolls: [],
    correlationSizes: [],
    budgetReads: 0,
    clock: { now: opts.now ?? (() => T0), startOfDay: () => new Date('2026-10-18T00:00:00Z') },
    async budget() {
      env.budgetReads++;
      env.calls.push('budget');
      return (opts.budget ?? (async () => budget()))();
    },
    async marketExposure() {
      return { totalRaw: opts.exposureRaw ?? 0n, estimated: false };
    },
    async openPositions() { env.calls.push('openPositions'); return []; },
    async hasOpenPosition() { return false; },
    async candidateMarkets() { env.calls.push('candidateMarkets'); return opts.markets ?? [market()]; },
    async signals(): Promise<AggregatedSignals> {
      env.calls.push('signals');
      return { news: [], fed: [], macro: [], aggregatedAt: T0, signalCount: 0 };
    },
    async closedPnlSince() { env.calls.push('closedPnlSince'); return opts.closedPnl ?? []; },
    async forecast(m) {
      return (opts.forecast ?? (() => ({ p: 0.75, ci: { lower: 0.7, upper: 0.8 }, sources: [] })))(m);
    },
    async stopLoss() { return { shouldClose: false }; },
    async correlation(marketId, size, _direction, bankroll) {
      env.correlationBankrolls.push(bankroll);
      env.correlationSizes.push(size);
      const keep = opts.correlationKeep ?? 1;
      return {
        hasCorrelatedPositions: keep < 1,
        correlatedPairs: [],
        adjustedPositionSize: parseFloat((size * keep).toFixed(2)),
        totalCorrelatedExposure: 0,
        method: 'matrix',
        snapshotId: null,
      };
    },
    async hedges() { return []; },
    async hedge() {},
    async buy(order) { env.buys.push(order); return { ok: true }; },
    async exit() { return { ok: true }; },
    async recordDecision(d) { env.decisions.push(d); },
    async price(m) {
      const p = env.poolOf(m);
      if (!p) throw new Error(`no pool for ${m.id}`);
      return {
        yesBps: priceYesBps(p.reserveYes, p.reserveNo), reserveYes: p.reserveYes, reserveNo: p.reserveNo, feeBps: p.feeBps,
        asOfLedger: p.asOfLedger, source: 'indexed', lagLedgers: 0,
      };
    },
    async pool(marketId) {
      env.calls.push('pool');
      const m = (opts.markets ?? [market()]).find((x) => x.id === marketId) ?? market({ id: marketId });
      return env.poolOf(m);
    },
    poolOf(m) {
      return opts.pool ? opts.pool(m) : pool(m.currentYesProb ?? 0.55);
    },
  };
  return env;
}
