/**
 * Learned signal source weights (#223).
 *
 * SOURCE_WEIGHTS (market-policy.ts) is a hand-written credibility table. This
 * module estimates versioned replacements from resolved markets, gates them
 * behind a second admin's approval, and serves the ACTIVE set to the
 * aggregator (falling back to the compiled table as version 0).
 *
 * Samples. extractRows()'s filters (resolved, non-void, on-chain markets;
 * traces strictly before resolution) joined to the pinned trace payload
 * (trace_publications.payload.forecast.members[llm].detail: baseRate and the
 * signed per-signal adjustments) and to signals (source, publisher,
 * clusterId). Traces without adjustments (pre-#75, MARKET_CREATION) are
 * skipped and counted; so are adjustments whose signalId no longer resolves.
 * Each market has total weight 1, split with buildSamples()'s 'time' scheme.
 *
 * Model. Penalised logistic regression with hierarchical shrinkage:
 *
 *   logit P(oⱼ = 1) = α_category(j) [+ γ_version(j)] + logit(baseRateⱼ) + Σ_k β_k · x_jk
 *   x_jk = Σ_{i ∈ adj(j), key(i) = k} [logit(clampP(base + δᵢ)) − logit(base)]
 *
 *   β_source ~ N(1, τ_s²),  β_publisher = β_source + u,  u ~ N(0, τ_p²),
 *   α ~ N(0, 1),  γ ~ N(0, 1)
 *
 * α_category absorbs topic base rates (FRED only ever cites FED/MACRO, so a
 * naive hit rate would credit FRED with the category's base rate). γ_version
 * is a fixed effect per weight-set version the traces were scored with: data
 * after an activation is not exchangeable with data before it. β = 1 means
 * "as used", 0 noise, > 1 under-weighted. MAP by Newton/IRLS with a fixed
 * iteration cap and tolerance; 90 % intervals from the inverse Hessian
 * (Laplace). Proposed weight w_k = clamp(w_parent_k · β̂_k, 0.05, 1); keys
 * with nEff < WEIGHTS_MIN_NEFF keep the parent weight and are flagged.
 *
 * estimateWeightSet() is pure (samples in, weight set out); loading, saving,
 * the CLI (scripts/estimate-source-weights.ts) and the admin API are wrappers.
 */
import { Prisma, type SourceWeightSet as WeightSetRow } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { AppError } from '../middlewares/error.middleware';
import { canonicalJson, sha256Hex } from '../utils/hash.util';
import { SOURCE_WEIGHTS } from './market-policy';
import { publisherKey, sourceWeight, type SourceWeightTable } from './signal-normalize';
import { brier, logLoss, marketTraceWeights, type Sample } from './calibration.service';

// ─── Weight tables ────────────────────────────────────────────────────────────

export const WEIGHT_SET_STATUSES = ['DRAFT', 'APPROVED', 'ACTIVE', 'RETIRED'] as const;
export type WeightSetStatus = (typeof WEIGHT_SET_STATUSES)[number];

/** Bounds of a proposed weight. */
export const WEIGHT_MIN = 0.05;
export const WEIGHT_MAX = 1;

/** The compiled SOURCE_WEIGHTS as a table: `{ id: null, version: 0 }`. */
export const COMPILED_WEIGHT_TABLE: SourceWeightTable = Object.freeze({
  id: null,
  version: 0,
  weights: Object.freeze(Object.fromEntries(Object.entries(SOURCE_WEIGHTS).map(([k, v]) => [`source:${k}`, v]))),
});

/** Keeps finite numeric entries of a stored `weights` JSON value. */
export function parseWeights(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

// ─── Runtime: the ACTIVE set, cached ─────────────────────────────────────────

const CACHE_MS = 60_000;
let memo: { at: number; table: SourceWeightTable } | null = null;

export type ActiveWeightLoader = () => Promise<{ id: string; version: number; weights: unknown } | null>;

const loadActiveRow: ActiveWeightLoader = () =>
  prisma.sourceWeightSet.findFirst({ where: { status: 'ACTIVE' }, select: { id: true, version: true, weights: true } });

/**
 * The ACTIVE weight set, cached for 60 s; the compiled table when there is
 * none or the lookup fails. aggregateSignals() calls this once per cycle and
 * stamps the result, so an activation never changes a running cycle. A test
 * `load` bypasses the cache.
 */
export async function getActiveWeightTable(opts: { now?: number; load?: ActiveWeightLoader } = {}): Promise<SourceWeightTable> {
  const now = opts.now ?? Date.now();
  if (!opts.load && memo && now - memo.at < CACHE_MS) return memo.table;
  let table = COMPILED_WEIGHT_TABLE;
  try {
    const row = await (opts.load ?? loadActiveRow)();
    if (row) table = { id: row.id, version: row.version, weights: parseWeights(row.weights) };
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, 'Source weight set lookup failed; using compiled SOURCE_WEIGHTS');
  }
  if (!opts.load) memo = { at: now, table };
  return table;
}

/** Drops the cached table (after an activation on this instance, and in tests). */
export function resetWeightTableCache(): void {
  memo = null;
}

// ─── Samples ──────────────────────────────────────────────────────────────────

export interface WeightAdjustment {
  signalId: string;
  /** The LLM forecaster's signed probability adjustment for this signal. */
  delta: number;
  source: string;
  publisher: string | null;
  clusterId: string | null;
}

export interface WeightSample {
  marketId: string;
  traceId: string;
  category: string;
  /** 1 = YES. */
  o: 0 | 1;
  /** The 'time' weight; each market's samples sum to 1. */
  w: number;
  /** The LLM member's base rate (detail.baseRate). */
  baseRate: number;
  /** ISO timestamp; splits fit from held-out samples. */
  resolvedAt: string;
  /** reasoning_traces.sourceWeightSetVersion; null (before #223) is 0. */
  weightSetVersion: number;
  adjustments: WeightAdjustment[];
}

/** What the extraction saw and skipped. */
export interface ExtractionCounts {
  traces: number;
  /** Pre-#75 and MARKET_CREATION traces: no LLM adjustments recorded. */
  tracesWithoutAdjustments: number;
  adjustments: number;
  /** Adjustments whose signalId is null or no longer in the signal store. */
  unresolvedAdjustments: number;
}

/** Same clamp as forecast.service.ts, so logits are finite. */
export const P_MIN = 0.02;
export const P_MAX = 0.98;
const clampP = (p: number) => Math.min(P_MAX, Math.max(P_MIN, p));
const logit = (p: number) => {
  const q = clampP(p);
  return Math.log(q / (1 - q));
};
const sigmoid = (x: number) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
const round = (x: number, d = 6) => Math.round(x * 10 ** d) / 10 ** d;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const sourceKeyOf = (source: string) => `source:${source.toUpperCase()}`;

/** `publisher:<name>`, or null when there is no publisher or it just names the source (FRED). */
export function publisherKeyOf(source: string, publisher: string | null): string | null {
  if (!publisher || !publisher.trim()) return null;
  const p = publisherKey(publisher);
  return p === source.toLowerCase() ? null : `publisher:${p}`;
}

/** Canonical order: samples by (marketId, traceId), adjustments by signalId. */
export function sortSamples(samples: WeightSample[]): WeightSample[] {
  return [...samples]
    .map((s) => ({ ...s, adjustments: [...s.adjustments].sort((a, b) => cmp(a.signalId, b.signalId) || a.delta - b.delta) }))
    .sort((a, b) => cmp(a.marketId, b.marketId) || cmp(a.traceId, b.traceId));
}

/** sha256(canonicalJson(samples in canonical order)). */
export function samplesDigest(samples: WeightSample[]): string {
  return sha256Hex(canonicalJson(sortSamples(samples)));
}

interface Contribution {
  sourceKey: string;
  publisherKey: string | null;
  source: string;
  publisher: string | null;
  /** logit(clampP(base + δ)) − logit(base). */
  x: number;
}

/**
 * One contribution per near-duplicate cluster: adjustments sharing a
 * clusterId (or the same signal cited twice) are averaged, and attributed to
 * the member with the smallest signalId. Input must be sorted.
 */
export function contributions(sample: WeightSample): Contribution[] {
  const groups = new Map<string, WeightAdjustment[]>();
  for (const a of sample.adjustments) {
    const key = a.clusterId ?? a.signalId;
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }
  const base = logit(sample.baseRate);
  return [...groups.keys()].sort(cmp).map((k) => {
    const members = groups.get(k)!;
    const head = members[0];
    const delta = members.reduce((acc, m) => acc + m.delta, 0) / members.length;
    return {
      sourceKey: sourceKeyOf(head.source),
      publisherKey: publisherKeyOf(head.source, head.publisher),
      source: head.source.toUpperCase(),
      publisher: head.publisher,
      x: logit(clampP(clampP(sample.baseRate) + delta)) - base,
    };
  });
}

/**
 * Turns joined trace rows into weighted samples: rows must precede
 * resolution and carry adjustments; each market's weight of 1 is split over
 * its rows with the 'time' scheme.
 */
export function weightSamplesFromRows(
  rows: Array<Omit<WeightSample, 'w' | 'resolvedAt'> & { createdAt: Date; resolvedAt: Date }>,
): WeightSample[] {
  const byMarket = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.createdAt.getTime() >= r.resolvedAt.getTime()) continue;
    const list = byMarket.get(r.marketId);
    if (list) list.push(r);
    else byMarket.set(r.marketId, [r]);
  }
  const out: WeightSample[] = [];
  for (const list of byMarket.values()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || cmp(a.traceId, b.traceId));
    const weights = marketTraceWeights(list, 'time');
    list.forEach((r, i) => {
      if (weights[i] <= 0) return;
      const { createdAt: _c, resolvedAt, ...rest } = r;
      out.push({ ...rest, w: weights[i], resolvedAt: resolvedAt.toISOString() });
    });
  }
  return out;
}

// ─── Penalised logistic regression (MAP, Newton/IRLS) ────────────────────────

export const IRLS_MAX_ITER = 50;
export const IRLS_TOL = 1e-10;
/** z for a two-sided 90 % interval. */
export const Z90 = 1.6448536269514722;

interface SparseRow {
  idx: number[];
  val: number[];
  offset: number;
  o: 0 | 1;
  w: number;
}

/** In-place Cholesky of a symmetric positive-definite matrix (row-major, n×n); returns L. */
function cholesky(a: Float64Array, n: number): Float64Array {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i * n + j];
      for (let k = 0; k < j; k++) sum -= l[i * n + k] * l[j * n + k];
      if (i === j) {
        if (sum <= 0) throw new Error('Hessian is not positive definite');
        l[i * n + i] = Math.sqrt(sum);
      } else {
        l[i * n + j] = sum / l[j * n + j];
      }
    }
  }
  return l;
}

function cholSolve(l: Float64Array, n: number, b: Float64Array): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= l[i * n + k] * y[k];
    y[i] = sum / l[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= l[k * n + i] * x[k];
    x[i] = sum / l[i * n + i];
  }
  return x;
}

export interface MapFit {
  theta: Float64Array;
  /** Inverse Hessian at the MAP (Laplace covariance), row-major. */
  cov: Float64Array;
  iterations: number;
  converged: boolean;
}

function negLogPosterior(rows: SparseRow[], theta: Float64Array, mean: Float64Array, prec: Float64Array): number {
  let f = 0;
  for (const r of rows) {
    let eta = r.offset;
    for (let k = 0; k < r.idx.length; k++) eta += r.val[k] * theta[r.idx[k]];
    // −[o·η − log(1 + e^η)], computed stably
    f += r.w * ((eta > 0 ? eta + Math.log1p(Math.exp(-eta)) : Math.log1p(Math.exp(eta))) - r.o * eta);
  }
  for (let i = 0; i < theta.length; i++) f += 0.5 * prec[i] * (theta[i] - mean[i]) ** 2;
  return f;
}

/** Weighted Gaussian-prior logistic MAP by Newton–Raphson with step halving. */
export function fitPenalisedLogit(rows: SparseRow[], mean: Float64Array, prec: Float64Array): MapFit {
  const n = mean.length;
  const theta = Float64Array.from(mean);
  const hessian = (): { h: Float64Array; g: Float64Array } => {
    const h = new Float64Array(n * n);
    const g = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      h[i * n + i] = prec[i];
      g[i] = prec[i] * (theta[i] - mean[i]);
    }
    for (const r of rows) {
      let eta = r.offset;
      for (let k = 0; k < r.idx.length; k++) eta += r.val[k] * theta[r.idx[k]];
      const mu = sigmoid(eta);
      const resid = r.w * (r.o - mu);
      const curv = r.w * mu * (1 - mu);
      for (let a = 0; a < r.idx.length; a++) {
        const ia = r.idx[a];
        g[ia] -= resid * r.val[a];
        for (let b = 0; b < r.idx.length; b++) h[ia * n + r.idx[b]] += curv * r.val[a] * r.val[b];
      }
    }
    return { h, g };
  };

  let iterations = 0;
  let converged = n === 0;
  let f = negLogPosterior(rows, theta, mean, prec);
  while (!converged && iterations < IRLS_MAX_ITER) {
    iterations++;
    const { h, g } = hessian();
    const step = cholSolve(cholesky(h, n), n, g.map((x) => -x));
    let t = 1;
    let next = theta.map((x, i) => x + step[i]);
    let fNext = negLogPosterior(rows, next, mean, prec);
    for (let halvings = 0; fNext > f && halvings < 30; halvings++) {
      t /= 2;
      next = theta.map((x, i) => x + t * step[i]);
      fNext = negLogPosterior(rows, next, mean, prec);
    }
    let maxStep = 0;
    for (let i = 0; i < n; i++) maxStep = Math.max(maxStep, Math.abs(next[i] - theta[i]));
    theta.set(next);
    f = fNext;
    if (maxStep < IRLS_TOL) converged = true;
  }

  const { h } = hessian();
  const cov = new Float64Array(n * n);
  if (n > 0) {
    const l = cholesky(h, n);
    for (let j = 0; j < n; j++) {
      const e = new Float64Array(n);
      e[j] = 1;
      const col = cholSolve(l, n, e);
      for (let i = 0; i < n; i++) cov[i * n + j] = col[i];
    }
  }
  return { theta, cov, iterations, converged };
}

// ─── Estimator ────────────────────────────────────────────────────────────────

export interface KeyInterval {
  /** 90 % interval of the proposed weight. */
  lower: number;
  upper: number;
  nEff: number;
  nMarkets: number;
  /** nEff < minNEff: the parent weight is kept. */
  insufficient: boolean;
  /** Weight in the parent set (what was used). */
  current: number;
  /** β̂ and its Laplace standard deviation. */
  beta: number;
  betaSd: number;
  /** For publisher keys: the source it is shrunk toward. */
  parentKey?: string;
}

export interface WeightSetMethod {
  estimator: 'penalised-logit-irls';
  priorSd: { source: number; publisher: number; category: number; version: number };
  window: string;
  cutoff: string;
  inputDigest: string;
  minNEff: number;
  intervalLevel: 0.9;
  heldOutDeltaLogLoss: number | null;
  regression: boolean;
  heldOut: {
    samples: number;
    markets: number;
    logLossParent: number | null;
    logLossProposed: number | null;
    deltaBrier: number | null;
  };
  fit: { samples: number; markets: number; iterations: number; converged: boolean; maxIter: number; tol: number };
  categoryEffects: Record<string, number>;
  versionEffects: Record<string, number>;
  counts?: ExtractionCounts;
  parentVersion: number;
  notes: string[];
}

export interface EstimatedWeightSet {
  parentId: string | null;
  weights: Record<string, number>;
  intervals: Record<string, KeyInterval>;
  method: WeightSetMethod;
}

export interface EstimateOptions {
  parent: SourceWeightTable;
  /** Fit on markets resolved before this; score held-out log loss on the rest. */
  cutoff: Date;
  /** Label of the extraction window, e.g. "180d" (recorded only). */
  window: string;
  priorSd?: { source?: number; publisher?: number };
  minNEff?: number;
  counts?: ExtractionCounts;
}

export const DEFAULT_PRIOR_SD = { source: 0.5, publisher: 0.5 } as const;

const clampWeight = (w: number) => round(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w)), 4);
const keyFamily = (k: string) => (k.startsWith('publisher:') ? 1 : 0);

/** Weighted effective sample size (Σw)² / Σw². */
function nEffOf(ws: number[]): number {
  const s = ws.reduce((a, b) => a + b, 0);
  const s2 = ws.reduce((a, b) => a + b * b, 0);
  return s2 === 0 ? 0 : (s * s) / s2;
}

/**
 * Fits a proposed weight set. Deterministic: inputs are put in canonical
 * order first, so any permutation of `samples` (and of their adjustments)
 * yields the same set and inputDigest.
 */
export function estimateWeightSet(samples: WeightSample[], opts: EstimateOptions): EstimatedWeightSet {
  const priorSd = {
    source: opts.priorSd?.source ?? DEFAULT_PRIOR_SD.source,
    publisher: opts.priorSd?.publisher ?? DEFAULT_PRIOR_SD.publisher,
    category: 1,
    version: 1,
  };
  const minNEff = opts.minNEff ?? config.WEIGHTS_MIN_NEFF;
  const sorted = sortSamples(samples);
  const cutoffMs = opts.cutoff.getTime();
  const fitSet = sorted.filter((s) => Date.parse(s.resolvedAt) < cutoffMs);
  const heldOutSet = sorted.filter((s) => Date.parse(s.resolvedAt) >= cutoffMs);
  const contrib = new Map<WeightSample, Contribution[]>(sorted.map((s) => [s, contributions(s)]));

  // ── Design: category and version effects, source β, publisher deviations u.
  const categories = [...new Set(fitSet.map((s) => s.category))].sort(cmp);
  const versions = [...new Set(fitSet.map((s) => s.weightSetVersion))].sort((a, b) => a - b);
  const versionCols = versions.slice(1); // the oldest version is the reference
  const sourceKeys = new Set<string>();
  const publisherSources = new Map<string, Map<string, number>>();
  for (const s of fitSet) {
    for (const c of contrib.get(s)!) {
      sourceKeys.add(c.sourceKey);
      if (c.publisherKey) {
        const bySource = publisherSources.get(c.publisherKey) ?? new Map<string, number>();
        bySource.set(c.sourceKey, (bySource.get(c.sourceKey) ?? 0) + s.w);
        publisherSources.set(c.publisherKey, bySource);
      }
    }
  }
  const sources = [...sourceKeys].sort(cmp);
  const publishers = [...publisherSources.keys()].sort(cmp);
  // A publisher seen under several sources is shrunk toward the one carrying most weight.
  const publisherParent = new Map(publishers.map((p) => {
    const ranked = [...publisherSources.get(p)!.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
    return [p, ranked[0][0]] as const;
  }));

  const col = new Map<string, number>();
  const mean: number[] = [];
  const prec: number[] = [];
  const addCol = (name: string, m: number, sd: number) => {
    col.set(name, mean.length);
    mean.push(m);
    prec.push(1 / (sd * sd));
  };
  for (const c of categories) addCol(`category:${c}`, 0, priorSd.category);
  for (const v of versionCols) addCol(`version:${v}`, 0, priorSd.version);
  for (const k of sources) addCol(k, 1, priorSd.source);
  for (const p of publishers) addCol(`u:${p}`, 0, priorSd.publisher);

  const rowOf = (s: WeightSample): SparseRow => {
    const acc = new Map<number, number>();
    const add = (i: number | undefined, v: number) => {
      if (i !== undefined) acc.set(i, (acc.get(i) ?? 0) + v);
    };
    add(col.get(`category:${s.category}`), 1);
    add(col.get(`version:${s.weightSetVersion}`), 1);
    for (const c of contrib.get(s)!) {
      add(col.get(c.sourceKey), c.x);
      if (c.publisherKey) add(col.get(`u:${c.publisherKey}`), c.x);
    }
    const idx = [...acc.keys()].sort((a, b) => a - b);
    return { idx, val: idx.map((i) => acc.get(i)!), offset: logit(s.baseRate), o: s.o, w: s.w };
  };
  const fit = fitPenalisedLogit(fitSet.map(rowOf), Float64Array.from(mean), Float64Array.from(prec));
  const n = mean.length;
  const th = (name: string) => fit.theta[col.get(name)!];
  const cv = (a: string, b: string) => fit.cov[col.get(a)! * n + col.get(b)!];

  // ── Support per key: samples (and markets) where the key's regressor is non-zero.
  const support = new Map<string, { ws: number[]; markets: Set<string> }>();
  for (const s of fitSet) {
    const keys = new Set<string>();
    for (const c of contrib.get(s)!) {
      if (c.x === 0) continue;
      keys.add(c.sourceKey);
      if (c.publisherKey) keys.add(c.publisherKey);
    }
    for (const k of keys) {
      const e = support.get(k) ?? { ws: [], markets: new Set<string>() };
      e.ws.push(s.w);
      e.markets.add(s.marketId);
      support.set(k, e);
    }
  }

  // ── Proposal.
  const parent = opts.parent;
  const weights: Record<string, number> = { ...COMPILED_WEIGHT_TABLE.weights, ...parent.weights };
  const intervals: Record<string, KeyInterval> = {};
  const keyInfo: Array<{ key: string; beta: number; sd: number; current: number; parentKey?: string }> = [
    ...sources.map((k) => ({
      key: k,
      beta: th(k),
      sd: Math.sqrt(Math.max(0, cv(k, k))),
      current: sourceWeight(k.slice('source:'.length), null, parent),
    })),
    ...publishers.map((p) => {
      const src = publisherParent.get(p)!;
      const u = `u:${p}`;
      return {
        key: p,
        beta: th(src) + th(u),
        sd: Math.sqrt(Math.max(0, cv(src, src) + cv(u, u) + 2 * cv(src, u))),
        current: parent.weights[p] ?? sourceWeight(src.slice('source:'.length), null, parent),
        parentKey: src,
      };
    }),
  ];
  for (const { key, beta, sd, current, parentKey } of keyInfo) {
    const sup = support.get(key);
    const nEff = round(sup ? nEffOf(sup.ws) : 0, 3);
    const nMarkets = sup?.markets.size ?? 0;
    const insufficient = nEff < minNEff;
    if (!insufficient) weights[key] = clampWeight(current * beta);
    intervals[key] = {
      lower: insufficient ? current : clampWeight(current * (beta - Z90 * sd)),
      upper: insufficient ? current : clampWeight(current * (beta + Z90 * sd)),
      nEff,
      nMarkets,
      insufficient,
      current,
      beta: round(beta),
      betaSd: round(sd),
      ...(parentKey ? { parentKey } : {}),
    };
  }
  const sortedWeights = Object.fromEntries(Object.keys(weights).sort((a, b) => keyFamily(a) - keyFamily(b) || cmp(a, b)).map((k) => [k, weights[k]]));
  const proposed: SourceWeightTable = { id: null, version: -1, weights: sortedWeights };

  // ── Held-out: the fitted fixed effects with the parent's weights (ratio 1)
  // versus the proposed weights (ratio w_new / w_parent per contribution).
  const effects = (s: WeightSample) => {
    const c = col.get(`category:${s.category}`);
    const v = col.get(`version:${s.weightSetVersion}`);
    return (c !== undefined ? fit.theta[c] : 0) + (v !== undefined ? fit.theta[v] : 0);
  };
  const scored = heldOutSet.map((s) => {
    const base = logit(s.baseRate) + effects(s);
    let etaParent = base;
    let etaNew = base;
    for (const c of contrib.get(s)!) {
      const wParent = sourceWeight(c.source, c.publisher, parent);
      const wNew = sourceWeight(c.source, c.publisher, proposed);
      etaParent += c.x;
      etaNew += (wParent > 0 ? wNew / wParent : 1) * c.x;
    }
    return { parent: { p: sigmoid(etaParent), o: s.o, w: s.w }, proposed: { p: sigmoid(etaNew), o: s.o, w: s.w } };
  });
  const parentSamples: Sample[] = scored.map((x) => x.parent);
  const proposedSamples: Sample[] = scored.map((x) => x.proposed);
  const llParent = scored.length ? round(logLoss(parentSamples)) : null;
  const llProposed = scored.length ? round(logLoss(proposedSamples)) : null;
  const delta = llParent !== null && llProposed !== null ? round(llProposed - llParent) : null;

  const method: WeightSetMethod = {
    estimator: 'penalised-logit-irls',
    priorSd,
    window: opts.window,
    cutoff: opts.cutoff.toISOString(),
    inputDigest: samplesDigest(samples),
    minNEff,
    intervalLevel: 0.9,
    heldOutDeltaLogLoss: delta,
    regression: delta !== null && delta > 0,
    heldOut: {
      samples: heldOutSet.length,
      markets: new Set(heldOutSet.map((s) => s.marketId)).size,
      logLossParent: llParent,
      logLossProposed: llProposed,
      deltaBrier: scored.length ? round(brier(proposedSamples) - brier(parentSamples)) : null,
    },
    fit: {
      samples: fitSet.length,
      markets: new Set(fitSet.map((s) => s.marketId)).size,
      iterations: fit.iterations,
      converged: fit.converged,
      maxIter: IRLS_MAX_ITER,
      tol: IRLS_TOL,
    },
    categoryEffects: Object.fromEntries(categories.map((c) => [c, round(th(`category:${c}`))])),
    versionEffects: Object.fromEntries(versionCols.map((v) => [`v${v}`, round(th(`version:${v}`))])),
    ...(opts.counts ? { counts: opts.counts } : {}),
    parentVersion: parent.version,
    notes: [
      'Only the first LLM sample\'s adjustments are recorded when FORECAST_LLM_SAMPLES > 1.',
      'Adjustments sharing a clusterId are averaged into one contribution.',
      'Traces scored with different weight-set versions are pooled only with a per-version fixed effect.',
      'base + delta is clamped to [0.02, 0.98] before taking logits.',
    ],
  };
  return { parentId: parent.id, weights: sortedWeights, intervals, method };
}

/** Per-key change between two weight maps (keys in either), sorted by key. */
export function diffWeights(
  from: Record<string, number>,
  to: Record<string, number>,
): Array<{ key: string; from: number | null; to: number | null; delta: number | null }> {
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort((a, b) => keyFamily(a) - keyFamily(b) || cmp(a, b));
  return keys.map((key) => {
    const a = from[key] ?? null;
    const b = to[key] ?? null;
    return { key, from: a, to: b, delta: a !== null && b !== null ? round(b - a, 4) : null };
  });
}

// ─── Extraction (SQL) ─────────────────────────────────────────────────────────

type Db = Pick<typeof prisma, '$queryRaw'> & { signal: Pick<typeof prisma.signal, 'findMany'> };

interface RawWeightRow {
  traceId: string;
  marketId: string;
  category: string;
  createdAt: Date;
  resolvedAt: Date;
  o: number;
  weightSetVersion: number | null;
  members: unknown;
}

/** The LLM member's { baseRate, adjustments } from a pinned forecast's members, or null. */
export function llmDetail(members: unknown): { baseRate: number; adjustments: Array<{ signalId: string | null; delta: number }> } | null {
  if (!Array.isArray(members)) return null;
  for (const m of members) {
    if (!m || typeof m !== 'object' || typeof (m as { model?: unknown }).model !== 'string') continue;
    if (!(m as { model: string }).model.startsWith('llm:')) continue;
    const detail = (m as { detail?: unknown }).detail as { baseRate?: unknown; adjustments?: unknown } | undefined;
    if (!detail || typeof detail.baseRate !== 'number' || !Array.isArray(detail.adjustments) || detail.adjustments.length === 0) return null;
    const adjustments = detail.adjustments
      .filter((a): a is { signalId?: unknown; delta: number } => !!a && typeof (a as { delta?: unknown }).delta === 'number')
      .map((a) => ({ signalId: typeof a.signalId === 'string' ? a.signalId : null, delta: a.delta }));
    return adjustments.length ? { baseRate: detail.baseRate, adjustments } : null;
  }
  return null;
}

/**
 * Samples for the estimator: extractRows()'s filters, the pinned forecast's
 * LLM adjustments and the cited signals' source/publisher/cluster. Traces
 * without adjustments and unresolved signal ids are counted, not guessed.
 */
export async function loadWeightSamples(db: Db, since: Date | null): Promise<{ samples: WeightSample[]; counts: ExtractionCounts }> {
  const sinceIso = since ? since.toISOString() : null;
  const raw = await db.$queryRaw<RawWeightRow[]>(Prisma.sql`
    SELECT t.id                                   AS "traceId",
           t."marketId"                           AS "marketId",
           m."category"::text                     AS "category",
           t."createdAt"                          AS "createdAt",
           m."resolvedAt"                         AS "resolvedAt",
           m."resolvedOutcome"::int               AS "o",
           t."sourceWeightSetVersion"             AS "weightSetVersion",
           p.payload->'forecast'->'members'       AS "members"
    FROM reasoning_traces t
    JOIN markets m ON m.id = t."marketId"
    LEFT JOIN trace_publications p ON p."traceId" = t.id
    WHERE m.status = 'RESOLVED'
      AND m."resolvedOutcome" IS NOT NULL
      AND m."onChainMarketId" IS NOT NULL
      AND t."createdAt" < m."resolvedAt"
      AND (${sinceIso}::text IS NULL OR m."resolvedAt" >= ${sinceIso}::timestamp)
    ORDER BY t."marketId", t."createdAt", t.id
  `);

  const counts: ExtractionCounts = { traces: raw.length, tracesWithoutAdjustments: 0, adjustments: 0, unresolvedAdjustments: 0 };
  const parsed = raw.map((r) => ({ r, d: llmDetail(r.members) }));
  const ids = [...new Set(parsed.flatMap((x) => x.d?.adjustments.map((a) => a.signalId).filter((id): id is string => !!id) ?? []))];
  const signals = new Map<string, { source: string; publisher: string | null; clusterId: string | null }>();
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await db.signal.findMany({
      where: { id: { in: ids.slice(i, i + 1000) } },
      select: { id: true, source: true, publisher: true, clusterId: true },
    });
    for (const s of rows) signals.set(s.id, s);
  }

  const rows: Parameters<typeof weightSamplesFromRows>[0] = [];
  for (const { r, d } of parsed) {
    if (!d) {
      counts.tracesWithoutAdjustments++;
      continue;
    }
    const adjustments: WeightAdjustment[] = [];
    for (const a of d.adjustments) {
      counts.adjustments++;
      const s = a.signalId ? signals.get(a.signalId) : undefined;
      if (!a.signalId || !s) {
        counts.unresolvedAdjustments++;
        continue;
      }
      // FRED rows are one observation each: cluster size 1.
      adjustments.push({ signalId: a.signalId, delta: a.delta, source: s.source, publisher: s.publisher, clusterId: s.source === 'FRED' ? null : s.clusterId });
    }
    rows.push({
      marketId: r.marketId,
      traceId: r.traceId,
      category: r.category,
      o: r.o === 1 ? 1 : 0,
      baseRate: d.baseRate,
      weightSetVersion: r.weightSetVersion ?? 0,
      adjustments,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    });
  }
  return { samples: weightSamplesFromRows(rows), counts };
}

// ─── Storage and lifecycle ───────────────────────────────────────────────────

const LOCK_NAME = 'oracledesk:source_weight_sets';

/** Stores an estimate as the next DRAFT version. */
export async function saveWeightSet(est: EstimatedWeightSet, createdBy: string): Promise<WeightSetRow> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAME}))`;
    const last = await tx.sourceWeightSet.findFirst({ orderBy: { version: 'desc' }, select: { version: true } });
    return tx.sourceWeightSet.create({
      data: {
        version: (last?.version ?? 0) + 1,
        status: 'DRAFT',
        weights: est.weights,
        intervals: est.intervals as unknown as Prisma.InputJsonValue,
        method: est.method as unknown as Prisma.InputJsonValue,
        parentId: est.parentId,
        createdBy,
      },
    });
  });
}

export async function listWeightSets(): Promise<WeightSetRow[]> {
  return prisma.sourceWeightSet.findMany({ orderBy: { version: 'desc' } });
}

/** A set with its per-key diff against the active set (or the compiled table). */
export async function getWeightSetWithDiff(id: string) {
  const set = await prisma.sourceWeightSet.findUnique({ where: { id } });
  if (!set) throw new AppError(404, 'WEIGHT_SET_NOT_FOUND', 'Source weight set not found');
  const active = await prisma.sourceWeightSet.findFirst({ where: { status: 'ACTIVE' } });
  const base = active ? parseWeights(active.weights) : { ...COMPILED_WEIGHT_TABLE.weights };
  return {
    set,
    active: active ? { id: active.id, version: active.version } : { id: null, version: 0 },
    diff: diffWeights(base, parseWeights(set.weights)),
  };
}

const isRegression = (method: unknown) => !!method && typeof method === 'object' && (method as { regression?: unknown }).regression === true;

/** Approval rules: a DRAFT, not a held-out regression, approved by someone other than its creator. */
export function assertApprovable(set: { status: string; createdBy: string; method: unknown }, actor: string): void {
  if (set.createdBy === actor) throw new AppError(403, 'SELF_APPROVAL', 'A weight set must be approved by a different admin than its creator');
  if (set.status !== 'DRAFT') throw new AppError(409, 'WEIGHT_SET_NOT_DRAFT', `Only DRAFT sets can be approved (this one is ${set.status})`);
  if (isRegression(set.method)) {
    throw new AppError(409, 'WEIGHT_SET_REGRESSION', 'This set is worse than its parent on held-out log loss and cannot be approved');
  }
}

async function audit(tx: Prisma.TransactionClient, actor: string, action: string, target: string | null, metadata: Record<string, unknown>) {
  await tx.adminAuditLog.create({ data: { actor, action, target, metadata: metadata as Prisma.InputJsonValue } });
}

export async function approveWeightSet(id: string, actor: string): Promise<WeightSetRow> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAME}))`;
    const set = await tx.sourceWeightSet.findUnique({ where: { id } });
    if (!set) throw new AppError(404, 'WEIGHT_SET_NOT_FOUND', 'Source weight set not found');
    assertApprovable(set, actor);
    const updated = await tx.sourceWeightSet.update({ where: { id }, data: { status: 'APPROVED', approvedBy: actor } });
    await audit(tx, actor, 'SOURCE_WEIGHTS_APPROVED', id, { version: set.version, createdBy: set.createdBy });
    return updated;
  });
}

/**
 * Retires the ACTIVE set and activates an APPROVED one in one transaction
 * (advisory lock plus the partial unique index: one ACTIVE row). Running
 * cycles keep the table they loaded; new aggregations pick this one up within
 * the 60 s cache.
 */
export async function activateWeightSet(id: string, actor: string, now = new Date()): Promise<WeightSetRow> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAME}))`;
    const set = await tx.sourceWeightSet.findUnique({ where: { id } });
    if (!set) throw new AppError(404, 'WEIGHT_SET_NOT_FOUND', 'Source weight set not found');
    if (set.status !== 'APPROVED') throw new AppError(409, 'WEIGHT_SET_NOT_APPROVED', `Only APPROVED sets can be activated (this one is ${set.status})`);
    if (isRegression(set.method)) throw new AppError(409, 'WEIGHT_SET_REGRESSION', 'Regression sets cannot be activated');
    const previous = await tx.sourceWeightSet.findFirst({ where: { status: 'ACTIVE' } });
    if (previous) await tx.sourceWeightSet.update({ where: { id: previous.id }, data: { status: 'RETIRED' } });
    const activated = await tx.sourceWeightSet.update({ where: { id }, data: { status: 'ACTIVE', activatedAt: now } });
    await audit(tx, actor, 'SOURCE_WEIGHTS_ACTIVATED', id, {
      version: set.version,
      previousId: previous?.id ?? null,
      previousVersion: previous?.version ?? 0,
    });
    return activated;
  });
  resetWeightTableCache();
  return result;
}

/**
 * Reactivates the set that was active before the current one: the RETIRED
 * set with the latest activatedAt before the current set's. Repeated
 * rollbacks walk further back. With no earlier set the current one is retired
 * and the compiled table (v0) applies again.
 */
export async function rollbackWeightSet(actor: string): Promise<{ retired: { id: string; version: number }; active: { id: string | null; version: number } }> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAME}))`;
    const current = await tx.sourceWeightSet.findFirst({ where: { status: 'ACTIVE' } });
    if (!current) throw new AppError(409, 'NO_ACTIVE_WEIGHT_SET', 'There is no active weight set to roll back');
    const previous = await tx.sourceWeightSet.findFirst({
      where: {
        status: 'RETIRED',
        activatedAt: current.activatedAt ? { lt: current.activatedAt } : { not: null },
      },
      orderBy: [{ activatedAt: 'desc' }, { version: 'desc' }],
    });
    await tx.sourceWeightSet.update({ where: { id: current.id }, data: { status: 'RETIRED' } });
    // activatedAt is kept: it orders the activation history the next rollback walks.
    if (previous) await tx.sourceWeightSet.update({ where: { id: previous.id }, data: { status: 'ACTIVE' } });
    const active = previous ? { id: previous.id, version: previous.version } : { id: null, version: 0 };
    await audit(tx, actor, 'SOURCE_WEIGHTS_ROLLED_BACK', current.id, {
      retiredVersion: current.version,
      activeId: active.id,
      activeVersion: active.version,
    });
    return { retired: { id: current.id, version: current.version }, active };
  });
  resetWeightTableCache();
  return result;
}
