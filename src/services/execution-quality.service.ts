import { Prisma, type TradeDirection } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { bigintToDecimalString } from '../lib/amounts';
import { BPS, calcBuy, priceYesBps } from '../generated/fpmm';

export type LiquidityBucket = 'THIN' | 'MEDIUM' | 'DEEP' | 'UNKNOWN';

export interface ExecutionQuoteAttempt {
  attempt: number;
  quotedAt: string;
  quoteMidBps: number | null;
  quotedOutRaw: string;
  boundRaw: string;
  quotedPriceBps: number | null;
}

export interface ShortfallDecomposition {
  preReserveYes: bigint;
  preReserveNo: bigint;
  preMidBps: number;
  fillPriceBps: number;
  delayBps: number;
  impactBps: number;
  feeBps: number;
  residualBps: number;
  totalShortfallBps: number;
  liquidityBucket: LiquidityBucket;
}

/**
 * Classifies an FPMM pool by total reserves in 7-decimal USDC base units:
 *   < 500 USDC   -> THIN
 *   < 5,000 USDC -> MEDIUM
 *   >= 5,000 USDC -> DEEP
 */
export function classifyLiquidityBucket(reserveYes: bigint, reserveNo: bigint): LiquidityBucket {
  const total = reserveYes + reserveNo;
  if (total <= 0n) return 'UNKNOWN';
  if (total < 5_000_000_000n) return 'THIN';
  if (total < 50_000_000_000n) return 'MEDIUM';
  return 'DEEP';
}

function sidePriceBps(reserveYes: bigint, reserveNo: bigint, direction: 'YES' | 'NO'): bigint {
  const yesBps = priceYesBps(reserveYes, reserveNo);
  return direction === 'YES' ? yesBps : BPS - yesBps;
}

/**
 * Exact BigInt FPMM implementation-shortfall decomposition for a confirmed BUY.
 * Satisfies: delayBps + impactBps + feeBps + residualBps === totalShortfallBps.
 */
export function decomposeBuyShortfall(params: {
  direction: 'YES' | 'NO';
  collateral: bigint;
  shares: bigint;
  fee: bigint;
  postReserveYes: bigint;
  postReserveNo: bigint;
  decisionMidBps: number | null;
  quoteMidBps: number | null;
}): ShortfallDecomposition {
  const {
    direction,
    collateral,
    shares,
    fee,
    postReserveYes,
    postReserveNo,
    decisionMidBps,
    quoteMidBps,
  } = params;

  const net = collateral - fee;
  const boughtPost = direction === 'YES' ? postReserveYes : postReserveNo;
  const otherPost = direction === 'YES' ? postReserveNo : postReserveYes;

  // Invert calcBuy: other_post = other_pre + net, bought_post = bought_pre + net - shares
  const otherPre = otherPost - net;
  const boughtPre = boughtPost - net + shares;

  const preReserveYes = direction === 'YES' ? boughtPre : otherPre;
  const preReserveNo = direction === 'YES' ? otherPre : boughtPre;

  const preMidBps =
    preReserveYes > 0n && preReserveNo > 0n
      ? Number(sidePriceBps(preReserveYes, preReserveNo, direction))
      : 0;

  const fillPriceBps = shares > 0n ? Number((collateral * BPS) / shares) : 0;

  // Isolate curve impact from fee using a 0-fee FPMM buy at pre-trade reserves.
  let impactPriceBps = fillPriceBps;
  if (boughtPre > 0n && otherPre > 0n && net > 0n) {
    try {
      const noFee = calcBuy(boughtPre, otherPre, net, 0n);
      impactPriceBps = Number((net * BPS) / noFee.sharesOut);
    } catch {
      impactPriceBps = fillPriceBps;
    }
  }

  const refMid = decisionMidBps ?? preMidBps;
  const totalShortfallBps = fillPriceBps - refMid;
  const delayBps = quoteMidBps != null ? quoteMidBps - refMid : preMidBps - refMid;
  const impactBps = impactPriceBps - preMidBps;
  const feeBps = fillPriceBps - impactPriceBps;
  const residualBps = totalShortfallBps - delayBps - impactBps - feeBps;

  return {
    preReserveYes,
    preReserveNo,
    preMidBps,
    fillPriceBps,
    delayBps,
    impactBps,
    feeBps,
    residualBps,
    totalShortfallBps,
    liquidityBucket: classifyLiquidityBucket(preReserveYes, preReserveNo),
  };
}

/**
 * Exact BigInt FPMM implementation-shortfall decomposition for a confirmed SELL.
 * For sells, receiving less than decision mid is a positive shortfall.
 * Satisfies: delayBps + impactBps + feeBps + residualBps === totalShortfallBps.
 */
export function decomposeSellShortfall(params: {
  direction: 'YES' | 'NO';
  collateral: bigint;
  shares: bigint;
  fee: bigint;
  postReserveYes: bigint;
  postReserveNo: bigint;
  decisionMidBps: number | null;
  quoteMidBps: number | null;
}): ShortfallDecomposition {
  const {
    direction,
    collateral,
    shares,
    fee,
    postReserveYes,
    postReserveNo,
    decisionMidBps,
    quoteMidBps,
  } = params;

  const gross = collateral + fee;
  const soldPost = direction === 'YES' ? postReserveYes : postReserveNo;
  const otherPost = direction === 'YES' ? postReserveNo : postReserveYes;

  // Invert calcSell: other_post = other_pre - gross, sold_post = sold_pre + shares - gross
  const otherPre = otherPost + gross;
  const soldPre = soldPost + gross - shares;

  const preReserveYes = direction === 'YES' ? soldPre : otherPre;
  const preReserveNo = direction === 'YES' ? otherPre : soldPre;

  const preMidBps =
    preReserveYes > 0n && preReserveNo > 0n
      ? Number(sidePriceBps(preReserveYes, preReserveNo, direction))
      : 0;

  const fillPriceBps = shares > 0n ? Number((collateral * BPS) / shares) : 0;
  const noFeePriceBps = shares > 0n ? Number((gross * BPS) / shares) : fillPriceBps;

  const refMid = decisionMidBps ?? preMidBps;
  const totalShortfallBps = refMid - fillPriceBps;
  const delayBps = quoteMidBps != null ? refMid - quoteMidBps : refMid - preMidBps;
  const impactBps = preMidBps - noFeePriceBps;
  const feeBps = noFeePriceBps - fillPriceBps;
  const residualBps = totalShortfallBps - delayBps - impactBps - feeBps;

  return {
    preReserveYes,
    preReserveNo,
    preMidBps,
    fillPriceBps,
    delayBps,
    impactBps,
    feeBps,
    residualBps,
    totalShortfallBps,
    liquidityBucket: classifyLiquidityBucket(preReserveYes, preReserveNo),
  };
}

export async function recordExecutionQuoteAttempt(params: {
  kind: 'BUY' | 'SELL';
  tradeId?: string;
  positionExitId?: string;
  marketId: string;
  direction: TradeDirection;
  decisionLedger?: number | null;
  decisionMidBps?: number | null;
  slippageBoundBps: number;
  liquidityBucket?: LiquidityBucket;
  quote: ExecutionQuoteAttempt;
}): Promise<void> {
  try {
    const existing = params.tradeId
      ? await prisma.executionReport.findUnique({ where: { tradeId: params.tradeId } })
      : params.positionExitId
        ? await prisma.executionReport.findUnique({ where: { positionExitId: params.positionExitId } })
        : null;

    if (!existing) {
      await prisma.executionReport.create({
        data: {
          kind: params.kind,
          tradeId: params.tradeId ?? null,
          positionExitId: params.positionExitId ?? null,
          marketId: params.marketId,
          direction: params.direction,
          decisionLedger: params.decisionLedger ?? null,
          decisionMidBps: params.decisionMidBps ?? null,
          slippageBoundBps: params.slippageBoundBps,
          liquidityBucket: params.liquidityBucket ?? null,
          quotes: [params.quote] as unknown as Prisma.InputJsonValue,
          quoteCount: 1,
          status: 'PENDING',
        },
      });
      return;
    }

    const prevQuotes = Array.isArray(existing.quotes) ? (existing.quotes as unknown[]) : [];
    const nextQuotes = [...prevQuotes, params.quote];
    await prisma.executionReport.update({
      where: { id: existing.id },
      data: {
        quotes: nextQuotes as unknown as Prisma.InputJsonValue,
        quoteCount: nextQuotes.length,
        ...(params.liquidityBucket && !existing.liquidityBucket ? { liquidityBucket: params.liquidityBucket } : {}),
      },
    });
  } catch (err) {
    logger.warn({ err, tradeId: params.tradeId, positionExitId: params.positionExitId }, 'Failed to record execution quote attempt');
  }
}

export async function markExecutionReportOutcome(params: {
  tradeId?: string;
  positionExitId?: string;
  status: 'PENDING' | 'SLIPPAGE_EXCEEDED' | 'FAILED';
  landedTxHash?: string | null;
  failureCode?: string | null;
}): Promise<void> {
  try {
    const where = params.tradeId
      ? { tradeId: params.tradeId }
      : params.positionExitId
        ? { positionExitId: params.positionExitId }
        : null;
    if (!where) return;

    await prisma.executionReport.updateMany({
      where: { ...where, status: { not: 'CONFIRMED' } },
      data: {
        status: params.status,
        ...(params.landedTxHash !== undefined ? { landedTxHash: params.landedTxHash } : {}),
        ...(params.failureCode !== undefined ? { failureCode: params.failureCode } : {}),
      },
    });
  } catch (err) {
    logger.warn({ err, ...params }, 'Failed to update execution report outcome');
  }
}

/**
 * Populates an ExecutionReport from a confirmed on-chain `Trade` event (#295).
 * Never uses simulation values: fill collateral, shares, fee, ledger, and
 * post-trade reserves come strictly from the indexed chain event.
 */
export async function recordExecutionFillFromEvent(params: {
  txHash: string;
  ledger: number;
  isBuy: boolean;
  outcome: string;
  collateral: bigint;
  shares: bigint;
  fee: bigint;
  reserveYes: bigint;
  reserveNo: bigint;
}): Promise<boolean> {
  let report = await prisma.executionReport.findFirst({
    where: { landedTxHash: params.txHash },
  });

  if (!report) {
    // Fallback: match via ChainTransaction (landedHash, hash, or feeBumpHashes) -> refId
    const chainTx = await prisma.chainTransaction.findFirst({
      where: {
        operation: { in: ['trade.buy', 'trade.sell'] },
        OR: [
          { landedHash: params.txHash },
          { hash: params.txHash },
          { feeBumpHashes: { has: params.txHash } },
        ],
      },
      select: { operation: true, refId: true },
    });
    if (chainTx?.refId) {
      report = await prisma.executionReport.findFirst({
        where: chainTx.operation === 'trade.buy'
          ? { tradeId: chainTx.refId }
          : { positionExitId: chainTx.refId },
      });
    }
  }

  if (!report) return false;

  const quotes = Array.isArray(report.quotes) ? (report.quotes as unknown as ExecutionQuoteAttempt[]) : [];
  const lastQuote = quotes.length > 0 ? quotes[quotes.length - 1] : null;
  const direction = report.direction;

  const decomp = params.isBuy
    ? decomposeBuyShortfall({
        direction,
        collateral: params.collateral,
        shares: params.shares,
        fee: params.fee,
        postReserveYes: params.reserveYes,
        postReserveNo: params.reserveNo,
        decisionMidBps: report.decisionMidBps,
        quoteMidBps: lastQuote?.quoteMidBps ?? null,
      })
    : decomposeSellShortfall({
        direction,
        collateral: params.collateral,
        shares: params.shares,
        fee: params.fee,
        postReserveYes: params.reserveYes,
        postReserveNo: params.reserveNo,
        decisionMidBps: report.decisionMidBps,
        quoteMidBps: lastQuote?.quoteMidBps ?? null,
      });

  const ledgerDelay =
    report.decisionLedger != null ? Math.max(0, params.ledger - report.decisionLedger) : null;

  await prisma.executionReport.update({
    where: { id: report.id },
    data: {
      status: 'CONFIRMED',
      landedTxHash: params.txHash,
      fillLedger: params.ledger,
      ledgerDelay,
      fillCollateralRaw: bigintToDecimalString(params.collateral),
      fillSharesRaw: bigintToDecimalString(params.shares),
      fillFeeRaw: bigintToDecimalString(params.fee),
      fillPriceBps: decomp.fillPriceBps,
      postReserveYesRaw: bigintToDecimalString(params.reserveYes),
      postReserveNoRaw: bigintToDecimalString(params.reserveNo),
      liquidityBucket: decomp.liquidityBucket,
      delayBps: decomp.delayBps,
      impactBps: decomp.impactBps,
      feeBps: decomp.feeBps,
      residualBps: decomp.residualBps,
      totalShortfallBps: decomp.totalShortfallBps,
    },
  });

  return true;
}

export interface BucketExecutionStats {
  bucket: LiquidityBucket;
  totalCount: number;
  confirmedCount: number;
  slippageExceededCount: number;
  failedCount: number;
  slippageExceededByBound: Record<string, number>;
  avgDelayBps: number | null;
  avgImpactBps: number | null;
  avgFeeBps: number | null;
  avgResidualBps: number | null;
  avgTotalShortfallBps: number | null;
  p95ShortfallBps: number | null;
  recommendedSlippageBps: number | null;
}

function percentile95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx];
}

function avgOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

/**
 * Aggregates execution quality metrics from `ExecutionReport` rows by liquidity
 * bucket and recommends slippage bounds per bucket (#295).
 */
export function aggregateExecutionQuality(
  rows: Array<{
    status: string;
    liquidityBucket: string | null;
    slippageBoundBps: number;
    delayBps: number | null;
    impactBps: number | null;
    feeBps: number | null;
    residualBps: number | null;
    totalShortfallBps: number | null;
  }>,
): { buckets: BucketExecutionStats[]; totalReports: number } {
  const bucketOrder: LiquidityBucket[] = ['THIN', 'MEDIUM', 'DEEP', 'UNKNOWN'];
  const grouped = new Map<LiquidityBucket, typeof rows>();
  for (const b of bucketOrder) grouped.set(b, []);

  for (const r of rows) {
    const b: LiquidityBucket =
      r.liquidityBucket === 'THIN' || r.liquidityBucket === 'MEDIUM' || r.liquidityBucket === 'DEEP'
        ? r.liquidityBucket
        : 'UNKNOWN';
    grouped.get(b)!.push(r);
  }

  const buckets: BucketExecutionStats[] = [];
  for (const bucket of bucketOrder) {
    const items = grouped.get(bucket)!;
    const confirmed = items.filter((i) => i.status === 'CONFIRMED');
    const slippageExceeded = items.filter((i) => i.status === 'SLIPPAGE_EXCEEDED');
    const failed = items.filter((i) => i.status === 'FAILED');

    const slippageExceededByBound: Record<string, number> = {};
    for (const item of slippageExceeded) {
      const k = String(item.slippageBoundBps);
      slippageExceededByBound[k] = (slippageExceededByBound[k] ?? 0) + 1;
    }

    const delays = confirmed.map((c) => c.delayBps).filter((v): v is number => v !== null);
    const impacts = confirmed.map((c) => c.impactBps).filter((v): v is number => v !== null);
    const fees = confirmed.map((c) => c.feeBps).filter((v): v is number => v !== null);
    const residuals = confirmed.map((c) => c.residualBps).filter((v): v is number => v !== null);
    const totals = confirmed.map((c) => c.totalShortfallBps).filter((v): v is number => v !== null);

    // Recommended bound covers p95 of (impact + positive adverse residual) + 25 bps buffer,
    // rounded up to nearest 25 bps, clamped to [50, 500].
    const quoteToFillSlippages = confirmed
      .filter((c) => c.impactBps !== null && c.residualBps !== null)
      .map((c) => Math.max(0, (c.impactBps ?? 0) + (c.residualBps ?? 0)));
    const p95Slip = percentile95(quoteToFillSlippages);
    const recommendedSlippageBps =
      p95Slip !== null
        ? Math.max(50, Math.min(500, Math.ceil((p95Slip + 25) / 25) * 25))
        : null;

    buckets.push({
      bucket,
      totalCount: items.length,
      confirmedCount: confirmed.length,
      slippageExceededCount: slippageExceeded.length,
      failedCount: failed.length,
      slippageExceededByBound,
      avgDelayBps: avgOrNull(delays),
      avgImpactBps: avgOrNull(impacts),
      avgFeeBps: avgOrNull(fees),
      avgResidualBps: avgOrNull(residuals),
      avgTotalShortfallBps: avgOrNull(totals),
      p95ShortfallBps: percentile95(totals),
      recommendedSlippageBps,
    });
  }

  return { buckets, totalReports: rows.length };
}

export async function getExecutionQualitySummary(opts: { windowDays?: number } = {}) {
  const windowDays = opts.windowDays ?? 30;
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await prisma.executionReport.findMany({
    where: { createdAt: { gte: since } },
    select: {
      status: true,
      liquidityBucket: true,
      slippageBoundBps: true,
      delayBps: true,
      impactBps: true,
      feeBps: true,
      residualBps: true,
      totalShortfallBps: true,
    },
  });
  return {
    windowDays,
    since: since.toISOString(),
    ...aggregateExecutionQuality(rows),
  };
}
