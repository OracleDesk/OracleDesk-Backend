/**
 * Portfolio risk service (#280).
 *
 * Computes VaR, ES, worst-case and cluster losses for all open agent positions
 * via a Gaussian copula Monte Carlo with PSD correlation snapshots.
 */
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import {
  loadLatestSnapshot,
  pairCorrelation,
  nearestPsdCorrelation,
  CORRELATION_THRESHOLD,
} from './correlation.service';
import { settleValue } from '../generated/fpmm';
import { P_MIN, P_MAX } from '../services/forecast.service';
import { hashSeed, gaussian, mulberry32 } from '../backtest/rng';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RISK_MC_PATHS        = config.RISK_MC_PATHS;
const RISK_MAX_MARKETS     = config.RISK_MAX_MARKETS;
const RISK_RHO_SHRINK      = config.RISK_RHO_SHRINK;
const RISK_MAX_DURATION_MS = config.RISK_MAX_DURATION_MS;

export const RISK_GATE_ENABLED = config.RISK_GATE_ENABLED;
export const RISK_MAX_ES_BPS   = config.RISK_MAX_ES_BPS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskPosition {
  positionId: string;
  marketId: string;
  category: string;
  closeTime: Date;
  side: 'YES' | 'NO';
  sharesRaw: bigint;
  markRaw: bigint;
  settlementYesRaw: bigint;
  settlementNoRaw: bigint;
  settlementVoidRaw: bigint;
  pYes: number;
  pVoid: number;
}

export interface RiskMetrics {
  expectedPnlRaw: string;
  var95Raw: string;
  es95Raw: string;
  var99Raw: string;
  es99Raw: string;
  worstCaseRaw: string;
  worstClusterLossRaw: string;
  exposureByCategory: Record<string, string>;
  exposureByWeek: Record<string, string>;
  hhiByMarket: number;
  hhiByCategory: number;
}

export interface RiskFlags {
  truncated: boolean;
  psdFallback: boolean;
  staleForecasts: boolean;
  unvalued: number;
}

export interface PortfolioRiskResult {
  inputsHash: string;
  paths: number;
  metrics: RiskMetrics;
  flags: RiskFlags;
  durationMs: number;
  correlationSnapshotId: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (p: number) => Math.min(P_MAX, Math.max(P_MIN, p));

/** Normal CDF via Horner approximation (Abramowitz & Stegun 26.2.17). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - 0.3989422804014327 * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? p : 1 - p;
}

/** ISO year-week key e.g. "2026-W47". */
function isoWeek(d: Date): string {
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d.getTime() - startOfWeek1.getTime();
  const week = Math.floor(diff / (7 * 86400000)) + 1;
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Cholesky decomposition of a PSD matrix; returns L such that L·Lᵀ = M. */
function cholesky(M: number[][]): number[][] | null {
  const n = M.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = M[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s < 0) return null;
        L[i][j] = Math.sqrt(s);
      } else {
        if (L[j][j] === 0) return null;
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

/** Cholesky with up to 3 jitter retries; returns null + sets flag on failure. */
function robustCholesky(M: number[][]): { L: number[][] | null; psdFallback: boolean } {
  const n = M.length;
  for (let attempt = 0; attempt <= 3; attempt++) {
    const jitter = attempt === 0 ? 0 : Math.pow(10, attempt - 11);
    const jittered = M.map((row, i) => row.map((v, j) => (i === j ? v + jitter : v)));
    const L = cholesky(jittered);
    if (L) return { L, psdFallback: attempt > 0 };
  }
  // Fall back to independence
  const L = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  return { L, psdFallback: true };
}

/** Canonical JSON hash of risk inputs for deduplication. */
function inputsHash(positions: RiskPosition[], snapshotId: string | null): string {
  const data = JSON.stringify({
    snapshotId,
    positions: positions.map((p) => ({
      id: p.positionId,
      m: p.marketId,
      s: p.side,
      sr: p.sharesRaw.toString(),
      pY: p.pYes,
      pV: p.pVoid,
    })),
  });
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ---------------------------------------------------------------------------
// Core simulation
// ---------------------------------------------------------------------------

export async function computePortfolioRisk(seed?: number): Promise<PortfolioRiskResult> {
  const startedAt = Date.now();

  // 1. Load open positions with valuation data.
  const rawPositions = await prisma.$queryRaw<
    Array<{
      positionId: string;
      marketId: string;
      category: string;
      closeTime: Date;
      side: string;
      sharesRaw: bigint | null;
      liquidationValueRaw: bigint;
      settlementYesRaw: bigint;
      settlementNoRaw: bigint;
      settlementVoidRaw: bigint;
      probabilityEstimate: number | null;
      currentYesProb: number;
    }>
  >`
    SELECT
      p.id               AS "positionId",
      p."marketId",
      m.category,
      m."closeTime",
      p.side,
      p."sharesRaw",
      p."liquidationValueRaw",
      p."settlementValueRaw"->>'yes'   AS "settlementYesRaw",
      p."settlementValueRaw"->>'no'    AS "settlementNoRaw",
      p."settlementValueRaw"->>'void'  AS "settlementVoidRaw",
      (SELECT rt."probabilityEstimate"
       FROM reasoning_traces rt
       WHERE rt."marketId" = p."marketId"
         AND rt.kind = 'TRADER'
       ORDER BY rt."createdAt" DESC
       LIMIT 1
      )                                AS "probabilityEstimate",
      m."currentYesProb"
    FROM positions p
    JOIN markets m ON m.id = p."marketId"
    WHERE p.status = 'OPEN'
      AND m.status = 'ACTIVE'
      AND p."sharesRaw" IS NOT NULL
  `;

  const flags: RiskFlags = { truncated: false, psdFallback: false, staleForecasts: false, unvalued: 0 };
  const positions: RiskPosition[] = [];

  for (const row of rawPositions) {
    if (row.sharesRaw == null) { flags.unvalued++; continue; }
    const pRaw = row.probabilityEstimate;
    if (pRaw == null) flags.staleForecasts = true;
    const pYes = clamp(pRaw ?? row.currentYesProb);
    const pVoid = 0; // pVoid from settleValue logic; use 0 for markets without void
    positions.push({
      positionId: row.positionId,
      marketId: row.marketId,
      category: row.category,
      closeTime: row.closeTime,
      side: row.side as 'YES' | 'NO',
      sharesRaw: row.sharesRaw,
      markRaw: row.liquidationValueRaw,
      settlementYesRaw: BigInt(row.settlementYesRaw ?? 0),
      settlementNoRaw: BigInt(row.settlementNoRaw ?? 0),
      settlementVoidRaw: BigInt(row.settlementVoidRaw ?? 0),
      pYes,
      pVoid,
    });
  }

  // Sort by markRaw descending; cap at RISK_MAX_MARKETS.
  positions.sort((a, b) => Number(b.markRaw - a.markRaw));
  if (positions.length > RISK_MAX_MARKETS) {
    flags.truncated = true;
    positions.splice(RISK_MAX_MARKETS);
  }

  // 2. Build correlation matrix.
  const snapshot = await loadLatestSnapshot();
  const snapshotId = (snapshot as any)?.id ?? null;
  const n = positions.length;

  let L: number[][];
  if (n === 0) {
    L = [];
  } else {
    const rawMatrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (__, j) => {
        if (i === j) return 1;
        const rho = pairCorrelation(
          { category: positions[i].category } as any,
          { category: positions[j].category } as any,
          snapshot,
        ).rho;
        return rho * RISK_RHO_SHRINK;
      }),
    );
    const psd = nearestPsdCorrelation(rawMatrix);
    const { L: chol, psdFallback } = robustCholesky(psd);
    flags.psdFallback = psdFallback;
    L = chol ?? Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  }

  // 3. Monte Carlo simulation.
  const hash = inputsHash(positions, snapshotId);
  const rngSeed = seed ?? hashSeed(hash);
  const rand = mulberry32(rngSeed);
  const pnls: number[] = new Array(RISK_MC_PATHS).fill(0);

  // Deduplicate markets (same market → same copula variable).
  const marketIndex = new Map<string, number>();
  const uniqueMarkets: string[] = [];
  for (const pos of positions) {
    if (!marketIndex.has(pos.marketId)) {
      marketIndex.set(pos.marketId, uniqueMarkets.length);
      uniqueMarkets.push(pos.marketId);
    }
  }
  const m = uniqueMarkets.length;

  // Recompute L for unique markets.
  let Lm: number[][];
  if (m === 0) {
    Lm = [];
  } else {
    const rawM = Array.from({ length: m }, (_, i) =>
      Array.from({ length: m }, (__, j) => {
        if (i === j) return 1;
        const ci = positions.find((p) => p.marketId === uniqueMarkets[i])!.category;
        const cj = positions.find((p) => p.marketId === uniqueMarkets[j])!.category;
        const rho = pairCorrelation({ category: ci } as any, { category: cj } as any, snapshot).rho;
        return rho * RISK_RHO_SHRINK;
      }),
    );
    const psdM = nearestPsdCorrelation(rawM);
    const { L: cholM } = robustCholesky(psdM);
    Lm = cholM ?? Array.from({ length: m }, (_, i) => Array.from({ length: m }, (__, j) => (i === j ? 1 : 0)));
  }

  for (let path = 0; path < RISK_MC_PATHS; path++) {
    // Draw correlated normals via Cholesky.
    const g = Array.from({ length: m }, () => gaussian(rand));
    const z = Array.from({ length: m }, (_, i) => {
      let s = 0;
      for (let k = 0; k <= i; k++) s += Lm[i][k] * g[k];
      return s;
    });

    let pathPnl = 0;
    for (const pos of positions) {
      const mi = marketIndex.get(pos.marketId)!;
      const u = normalCdf(z[mi]);
      const pVoid = pos.pVoid;
      const pYesAdj = (1 - pVoid) * pos.pYes;
      let payoff: bigint;
      if (u < pVoid) {
        payoff = pos.settlementVoidRaw;
      } else if (u < pVoid + pYesAdj) {
        payoff = pos.side === 'YES' ? pos.settlementYesRaw : pos.settlementNoRaw;
      } else {
        payoff = pos.side === 'YES' ? pos.settlementNoRaw : pos.settlementYesRaw;
      }
      pathPnl += Number(payoff - pos.markRaw);
    }
    pnls[path] = pathPnl;
  }

  // Sort ascending for quantile reads.
  pnls.sort((a, b) => a - b);

  const idx95 = Math.floor(RISK_MC_PATHS * 0.05);
  const idx99 = Math.floor(RISK_MC_PATHS * 0.01);
  const var95 = pnls[idx95];
  const var99 = pnls[idx99];
  const es95 = pnls.slice(0, idx95 + 1).reduce((s, v) => s + v, 0) / (idx95 + 1);
  const es99 = pnls.slice(0, idx99 + 1).reduce((s, v) => s + v, 0) / (idx99 + 1);
  const expectedPnl = pnls.reduce((s, v) => s + v, 0) / RISK_MC_PATHS;

  // 4. Deterministic metrics.
  let worstCase = 0n;
  for (const pos of positions) {
    const worstPayoff = pos.side === 'YES' ? pos.settlementNoRaw : pos.settlementYesRaw;
    worstCase += worstPayoff - pos.markRaw;
  }

  // Clusters via connected components (rho ≥ CORRELATION_THRESHOLD).
  const adj: boolean[][] = Array.from({ length: m }, (_, i) =>
    Array.from({ length: m }, (__, j) => {
      if (i === j) return false;
      const ci = positions.find((p) => p.marketId === uniqueMarkets[i])!.category;
      const cj = positions.find((p) => p.marketId === uniqueMarkets[j])!.category;
      return pairCorrelation({ category: ci } as any, { category: cj } as any, snapshot).rho >= CORRELATION_THRESHOLD;
    }),
  );
  const visited = new Array(m).fill(false);
  let worstClusterLoss = 0n;
  for (let start = 0; start < m; start++) {
    if (visited[start]) continue;
    const component: number[] = [];
    const queue = [start];
    while (queue.length) {
      const cur = queue.pop()!;
      if (visited[cur]) continue;
      visited[cur] = true;
      component.push(cur);
      for (let j = 0; j < m; j++) if (!visited[j] && adj[cur][j]) queue.push(j);
    }
    let clusterLoss = 0n;
    for (const mi of component) {
      for (const pos of positions.filter((p) => p.marketId === uniqueMarkets[mi])) {
        const worstPayoff = pos.side === 'YES' ? pos.settlementNoRaw : pos.settlementYesRaw;
        clusterLoss += worstPayoff - pos.markRaw;
      }
    }
    if (clusterLoss < worstClusterLoss) worstClusterLoss = clusterLoss;
  }

  // Exposure buckets.
  const exposureByCategory: Record<string, bigint> = {};
  const exposureByWeek: Record<string, bigint> = {};
  let totalMarkRaw = 0n;
  for (const pos of positions) {
    exposureByCategory[pos.category] = (exposureByCategory[pos.category] ?? 0n) + pos.markRaw;
    exposureByWeek[isoWeek(pos.closeTime)] = (exposureByWeek[isoWeek(pos.closeTime)] ?? 0n) + pos.markRaw;
    totalMarkRaw += pos.markRaw;
  }

  // HHI concentration.
  const hhiByMarket = uniqueMarkets.reduce((hhi, mid) => {
    const mark = positions.filter((p) => p.marketId === mid).reduce((s, p) => s + p.markRaw, 0n);
    const share = totalMarkRaw > 0n ? Number(mark * 10_000n / totalMarkRaw) / 10_000 : 0;
    return hhi + share * share;
  }, 0);
  const hhiByCategory = Object.values(exposureByCategory).reduce((hhi, mark) => {
    const share = totalMarkRaw > 0n ? Number(mark * 10_000n / totalMarkRaw) / 10_000 : 0;
    return hhi + share * share;
  }, 0);

  const durationMs = Date.now() - startedAt;

  return {
    inputsHash: hash,
    paths: RISK_MC_PATHS,
    metrics: {
      expectedPnlRaw: Math.round(expectedPnl).toString(),
      var95Raw: Math.round(var95).toString(),
      es95Raw: Math.round(es95).toString(),
      var99Raw: Math.round(var99).toString(),
      es99Raw: Math.round(es99).toString(),
      worstCaseRaw: worstCase.toString(),
      worstClusterLossRaw: worstClusterLoss.toString(),
      exposureByCategory: Object.fromEntries(Object.entries(exposureByCategory).map(([k, v]) => [k, v.toString()])),
      exposureByWeek: Object.fromEntries(Object.entries(exposureByWeek).map(([k, v]) => [k, v.toString()])),
      hhiByMarket: parseFloat(hhiByMarket.toFixed(4)),
      hhiByCategory: parseFloat(hhiByCategory.toFixed(4)),
    },
    flags,
    durationMs,
    correlationSnapshotId: snapshotId,
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const SNAPSHOT_FULL_DAYS = 7;
const SNAPSHOT_DAILY_DAYS = 90;

export async function computeAndStoreRiskSnapshot(): Promise<void> {
  const previous = await prisma.portfolioRiskSnapshot.findFirst({
    orderBy: { computedAt: 'desc' },
    select: { inputsHash: true },
  });

  const result = await computePortfolioRisk();

  if (previous?.inputsHash === result.inputsHash) {
    logger.debug('portfolio-risk: inputs unchanged — skipping snapshot');
    return;
  }

  await prisma.portfolioRiskSnapshot.create({
    data: {
      correlationSnapshotId: result.correlationSnapshotId,
      inputsHash: result.inputsHash,
      paths: result.paths,
      metrics: result.metrics as any,
      flags: result.flags as any,
      durationMs: result.durationMs,
    },
  });

  // Retention: keep all snapshots from the last 7 days, plus one per day for 90 days.
  const cutoffFull = new Date(Date.now() - SNAPSHOT_FULL_DAYS * 86400000);
  const cutoffHistory = new Date(Date.now() - SNAPSHOT_DAILY_DAYS * 86400000);

  // Delete old fine-grained snapshots (older than 7 days, keep one per day).
  const old = await prisma.portfolioRiskSnapshot.findMany({
    where: { computedAt: { lt: cutoffFull, gte: cutoffHistory } },
    orderBy: { computedAt: 'asc' },
  });
  const keepByDay = new Map<string, string>();
  for (const snap of old) {
    const day = snap.computedAt.toISOString().slice(0, 10);
    if (!keepByDay.has(day)) keepByDay.set(day, snap.id);
  }
  const keepIds = new Set(keepByDay.values());
  const deleteIds = old.filter((s) => !keepIds.has(s.id)).map((s) => s.id);
  if (deleteIds.length) await prisma.portfolioRiskSnapshot.deleteMany({ where: { id: { in: deleteIds } } });

  // Delete anything older than 90 days.
  await prisma.portfolioRiskSnapshot.deleteMany({ where: { computedAt: { lt: cutoffHistory } } });

  logger.info({ durationMs: result.durationMs, psdFallback: result.flags.psdFallback }, 'portfolio-risk: snapshot stored');
}

// ---------------------------------------------------------------------------
// Latest snapshot retrieval
// ---------------------------------------------------------------------------

export async function getLatestRiskSnapshot() {
  return prisma.portfolioRiskSnapshot.findFirst({ orderBy: { computedAt: 'desc' } });
}

export async function getRiskSnapshotHistory(from: Date, to: Date) {
  return prisma.portfolioRiskSnapshot.findMany({
    where: { computedAt: { gte: from, lte: to } },
    orderBy: { computedAt: 'desc' },
    select: { id: true, computedAt: true, inputsHash: true, durationMs: true, flags: true, metrics: true },
  });
}
