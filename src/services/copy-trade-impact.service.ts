import { CopyTradeStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { BPS, MAX_SETS, calcBuy, priceYesBps } from '../generated/fpmm';
import { poolFromChain, defaultPoolDeps, type PoolView, type PoolDeps } from '../agents/trader-env';
import { latestReserves } from './valuation.service';

export interface CopyTradeFlowSummary {
  windowMinutes: number;
  traceConfirmedVolumeRaw: string;
  traceConfirmedCount: number;
  marketConfirmedVolumeRaw: string;
  marketConfirmedCount: number;
}

export interface CopyTradeImpactBlock {
  outcome: 'YES' | 'NO';
  collateralInRaw: string;
  expectedSharesRaw: string;
  feeRaw: string;
  midPriceBps: number;
  avgPriceBps: number;
  postPriceBps: number;
  impactBps: number;
  agentSideProbBps: number;
  remainingEdgeBps: number;
  avgRemainingEdgeBps: number;
  maxSizeRaw: string;
  maxSizeAvgEdgeRaw: string;
  pool: {
    asOfLedger: number;
    source: 'indexed' | 'rpc';
    lagLedgers: number;
    reserveYesRaw: string;
    reserveNoRaw: string;
    feeBps: string;
  };
  recentFlow: CopyTradeFlowSummary;
  maxImpactBps: number | null;
  exceedsMaxImpact: boolean;
}

function mulDivCeilBigint(a: bigint, b: bigint, c: bigint): bigint {
  const p = a * b;
  const q = p / c;
  return p % c !== 0n ? q + 1n : q;
}

/**
 * Computes exact BigInt post-trade price and average fill price (both in bps
 * of the bought side) for a buy of `collateralIn` on `direction`.
 */
function evaluateBuyPrices(
  rBought: bigint,
  rOther: bigint,
  feeBps: bigint,
  direction: 'YES' | 'NO',
  collateralIn: bigint,
) {
  const quote = calcBuy(rBought, rOther, collateralIn, feeBps);
  const avgPriceBps = mulDivCeilBigint(collateralIn, BPS, quote.sharesOut);
  const postYesBps =
    direction === 'YES'
      ? priceYesBps(quote.newReserveBought, quote.newReserveOther)
      : priceYesBps(quote.newReserveOther, quote.newReserveBought);
  const postPriceBps = direction === 'YES' ? postYesBps : BPS - postYesBps;
  return { quote, avgPriceBps, postPriceBps };
}

/**
 * Binary-searches the largest `collateralIn >= 1n` for which `pred(collateralIn)`
 * holds. Returns `0n` if even `1n` (or the smallest valid buy) fails `pred`.
 */
function maxSizeMatching(
  rBought: bigint,
  rOther: bigint,
  feeBps: bigint,
  pred: (collateralIn: bigint) => boolean,
): bigint {
  // Minimum collateral that produces >= 1 share after fee.
  const minIn = feeBps >= BPS ? 0n : 2n;
  if (minIn === 0n) return 0n;

  let lo = minIn;
  try {
    if (!pred(lo)) return 0n;
  } catch {
    return 0n;
  }

  let hi = lo;
  const cap = MAX_SETS;
  while (hi < cap) {
    const next = hi * 2n > cap ? cap : hi * 2n;
    let ok = false;
    try {
      ok = pred(next);
    } catch {
      ok = false;
    }
    if (!ok) {
      hi = next;
      break;
    }
    lo = next;
    if (next === cap) return cap;
    hi = next;
  }

  let best = lo;
  let left = lo + 1n;
  let right = hi;
  while (left <= right) {
    const mid = (left + right) / 2n;
    let ok = false;
    try {
      ok = pred(mid);
    } catch {
      ok = false;
    }
    if (ok) {
      best = mid;
      left = mid + 1n;
    } else {
      right = mid - 1n;
    }
  }
  return best;
}

/**
 * Pure BigInt FPMM price-impact computation for a copy trade.
 */
export function computeCopyTradeImpact(params: {
  direction: 'YES' | 'NO';
  collateralInRaw: bigint;
  agentProbBps: bigint;
  pool: PoolView;
  recentFlow: CopyTradeFlowSummary;
  maxImpactBps: number | null;
}): CopyTradeImpactBlock {
  const { direction, collateralInRaw, agentProbBps, pool, recentFlow, maxImpactBps } = params;

  const rBought = direction === 'YES' ? pool.reserveYes : pool.reserveNo;
  const rOther = direction === 'YES' ? pool.reserveNo : pool.reserveYes;

  const yesMidBps = priceYesBps(pool.reserveYes, pool.reserveNo);
  const midPriceBps = direction === 'YES' ? yesMidBps : BPS - yesMidBps;
  const agentSideProbBps = direction === 'YES' ? agentProbBps : BPS - agentProbBps;

  const { quote, avgPriceBps, postPriceBps } = evaluateBuyPrices(
    rBought,
    rOther,
    pool.feeBps,
    direction,
    collateralInRaw,
  );

  const impactBps = postPriceBps > midPriceBps ? postPriceBps - midPriceBps : 0n;
  const remainingEdgeBps = agentSideProbBps - postPriceBps;
  const avgRemainingEdgeBps = agentSideProbBps - avgPriceBps;

  const maxSizeRaw = maxSizeMatching(rBought, rOther, pool.feeBps, (c) => {
    const { postPriceBps: post } = evaluateBuyPrices(rBought, rOther, pool.feeBps, direction, c);
    return post <= agentSideProbBps;
  });

  const maxSizeAvgEdgeRaw = maxSizeMatching(rBought, rOther, pool.feeBps, (c) => {
    const { avgPriceBps: avg } = evaluateBuyPrices(rBought, rOther, pool.feeBps, direction, c);
    return avg < agentSideProbBps;
  });

  const impactNum = Number(impactBps);
  const exceedsMaxImpact = maxImpactBps !== null && impactNum > maxImpactBps;

  return {
    outcome: direction,
    collateralInRaw: collateralInRaw.toString(),
    expectedSharesRaw: quote.sharesOut.toString(),
    feeRaw: quote.fee.toString(),
    midPriceBps: Number(midPriceBps),
    avgPriceBps: Number(avgPriceBps),
    postPriceBps: Number(postPriceBps),
    impactBps: impactNum,
    agentSideProbBps: Number(agentSideProbBps),
    remainingEdgeBps: Number(remainingEdgeBps),
    avgRemainingEdgeBps: Number(avgRemainingEdgeBps),
    maxSizeRaw: maxSizeRaw.toString(),
    maxSizeAvgEdgeRaw: maxSizeAvgEdgeRaw.toString(),
    pool: {
      asOfLedger: pool.asOfLedger,
      source: pool.source,
      lagLedgers: pool.lagLedgers,
      reserveYesRaw: pool.reserveYes.toString(),
      reserveNoRaw: pool.reserveNo.toString(),
      feeBps: pool.feeBps.toString(),
    },
    recentFlow,
    maxImpactBps,
    exceedsMaxImpact,
  };
}

export async function getConfirmedCopyFlow(
  traceId: string,
  marketId: string,
  windowMinutes = config.COPY_TRADE_FLOW_WINDOW_MINUTES,
  now = new Date(),
): Promise<CopyTradeFlowSummary> {
  const windowStart = new Date(now.getTime() - windowMinutes * 60_000);
  const baseWhere = {
    status: CopyTradeStatus.EXECUTED,
    chainEventId: { not: null },
    confirmedAt: { gte: windowStart },
  };

  const [traceRows, marketRows] = await Promise.all([
    prisma.copyTrade.findMany({
      where: { ...baseWhere, traceId },
      select: { collateralRaw: true, amountRaw: true },
    }),
    prisma.copyTrade.findMany({
      where: { ...baseWhere, marketId },
      select: { collateralRaw: true, amountRaw: true },
    }),
  ]);

  const sumRaw = (rows: Array<{ collateralRaw: string | null; amountRaw: string | null }>) =>
    rows.reduce((acc, r) => acc + BigInt(r.collateralRaw ?? r.amountRaw ?? '0'), 0n);

  return {
    windowMinutes,
    traceConfirmedVolumeRaw: sumRaw(traceRows).toString(),
    traceConfirmedCount: traceRows.length,
    marketConfirmedVolumeRaw: sumRaw(marketRows).toString(),
    marketConfirmedCount: marketRows.length,
  };
}

export interface CopyTradeImpactDeps {
  pool(onChainMarketId: bigint): Promise<PoolView>;
  flow(traceId: string, marketId: string): Promise<CopyTradeFlowSummary>;
  maxImpactBps: number | null;
}

const copyPoolDeps: PoolDeps = {
  ...defaultPoolDeps,
  reserves: (id) => latestReserves(id, config.COPY_TRADE_POOL_MAX_AGE_LEDGERS),
};

export const defaultCopyTradeImpactDeps: CopyTradeImpactDeps = {
  pool: (onChainMarketId) => poolFromChain(onChainMarketId, copyPoolDeps),
  flow: (traceId, marketId) => getConfirmedCopyFlow(traceId, marketId),
  get maxImpactBps() {
    return config.COPY_TRADE_MAX_IMPACT_BPS;
  },
};

export async function estimateCopyTradeImpact(
  params: {
    traceId: string;
    marketId: string;
    onChainMarketId: bigint;
    direction: 'YES' | 'NO';
    collateralInRaw: bigint;
    probabilityEstimate: number;
  },
  deps: CopyTradeImpactDeps = defaultCopyTradeImpactDeps,
): Promise<CopyTradeImpactBlock> {
  const [pool, recentFlow] = await Promise.all([
    deps.pool(params.onChainMarketId),
    deps.flow(params.traceId, params.marketId),
  ]);
  const agentProbBps = BigInt(Math.round(params.probabilityEstimate * 10_000));

  return computeCopyTradeImpact({
    direction: params.direction,
    collateralInRaw: params.collateralInRaw,
    agentProbBps,
    pool,
    recentFlow,
    maxImpactBps: deps.maxImpactBps,
  });
}
