// Per-category probability recalibration (#244).
//
// A Platt map logit(p') = a + b·logit(p) is fitted per (agentType, category)
// from resolved markets, by weighted logistic regression of the outcome on the
// RAW forecast's log-odds (traces store rawProbabilityEstimate so calibration
// never fits on its own output). The fit is a MAP estimate under a Gaussian
// prior centred on the identity (a = 0, b = 1) whose precision shrinks as the
// effective sample size grows, and it is clamped so it can only pull toward
// 0.5: b ≤ 1 and |a| ≤ RECALIBRATION_MAX_INTERCEPT. An underconfident slice
// therefore stays at (or near) identity; the map never adds confidence.
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { canonicalJson, sha256Hex } from '../utils/hash.util';
import { withAdvisoryLock } from '../lib/advisory-lock';
import type { ConfidenceInterval } from '../types';
import { buildSamples, effectiveN, extractRows, MIN_SHRINKAGE_MARKETS, type Sample, type TraceRow } from './calibration.service';

/** Same clamp the forecaster uses, so logit() is finite. */
const P_MIN = 0.02;
const P_MAX = 0.98;
const CI_MIN = 0.001;
const CI_MAX = 0.999;
const clampP = (p: number) => Math.min(P_MAX, Math.max(P_MIN, p));
const logit = (p: number) => {
  const q = clampP(p);
  return Math.log(q / (1 - q));
};
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const round = (x: number, d = 6) => Math.round(x * 10 ** d) / 10 ** d;

/** Category key used for the agent-wide fallback map. */
export const ALL_CATEGORIES = '*';
/** A refit is stored only when a parameter moves by more than this. */
export const PARAM_EPSILON = 1e-3;

export interface RecalibrationMap {
  /** sha256(canonicalJson({ agentType, category, version, kind, a, b, fittedFrom })). */
  id: string;
  version: number;
  agentType: string;
  category: string;
  kind: 'identity' | 'platt';
  a: number;
  b: number;
  nMarkets: number;
  nEff: number;
  fittedFrom: { snapshotComputedAt: string | null; window: 'all' | '90d'; rowsDigest: string };
}

export function mapId(m: Omit<RecalibrationMap, 'id' | 'nMarkets' | 'nEff'>): string {
  return sha256Hex(
    canonicalJson({
      agentType: m.agentType,
      category: m.category,
      version: m.version,
      kind: m.kind,
      a: round(m.a),
      b: round(m.b),
      fittedFrom: m.fittedFrom,
    }),
  );
}

export function identityMap(agentType = 'TRADER', category = ALL_CATEGORIES): RecalibrationMap {
  const base = {
    version: 0,
    agentType,
    category,
    kind: 'identity' as const,
    a: 0,
    b: 1,
    fittedFrom: { snapshotComputedAt: null, window: 'all' as const, rowsDigest: '' },
  };
  return { ...base, id: mapId(base), nMarkets: 0, nEff: 0 };
}

export interface PlattPrior {
  a0: number;
  b0: number;
  /** Prior precision on each parameter. */
  tau: number;
}

export interface FitOptions {
  maxIntercept?: number;
  maxIterations?: number;
}

/**
 * Weighted logistic regression of o on x = logit(p) with an identity-centred
 * Gaussian prior, by Newton–Raphson. Returns the identity when it does not
 * converge. Clamped: b ∈ [0, 1], |a| ≤ maxIntercept.
 */
export function fitPlatt(
  samples: Sample[],
  prior: PlattPrior,
  opts: FitOptions = {},
): { a: number; b: number; converged: boolean } {
  const maxIntercept = opts.maxIntercept ?? config.RECALIBRATION_MAX_INTERCEPT;
  const maxIterations = opts.maxIterations ?? 25;
  const xs = samples.map((s) => logit(s.p));
  let a = prior.a0;
  let b = prior.b0;
  let converged = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Gradient and Hessian of the negative log posterior.
    let ga = prior.tau * (a - prior.a0);
    let gb = prior.tau * (b - prior.b0);
    let haa = prior.tau;
    let hab = 0;
    let hbb = prior.tau;
    for (let i = 0; i < samples.length; i++) {
      const { o, w } = samples[i];
      const x = xs[i];
      const q = logistic(a + b * x);
      const r = w * (q - o);
      ga += r;
      gb += r * x;
      const v = w * q * (1 - q);
      haa += v;
      hab += v * x;
      hbb += v * x * x;
    }
    const det = haa * hbb - hab * hab;
    if (!Number.isFinite(det) || det <= 1e-12) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da;
    b -= db;
    if (!Number.isFinite(a) || !Number.isFinite(b)) break;
    if (Math.abs(da) < 1e-9 && Math.abs(db) < 1e-9) {
      converged = true;
      break;
    }
  }

  if (!converged) return { a: 0, b: 1, converged: false };
  // Never more confident than the evidence: slope at most 1 (and not negative,
  // which would invert the forecast), bounded intercept.
  b = Math.min(1, Math.max(0, b));
  a = Math.min(maxIntercept, Math.max(-maxIntercept, a));
  return { a, b, converged: true };
}

export function applyMap(map: Pick<RecalibrationMap, 'a' | 'b'>, p: number): number {
  return clampP(logistic(map.a + map.b * logit(p)));
}

/** The map is monotone (b ≥ 0), so mapping the endpoints keeps their order. */
export function applyMapToInterval(map: Pick<RecalibrationMap, 'a' | 'b'>, ci: ConfidenceInterval, p?: number): ConfidenceInterval {
  let lower = Math.max(CI_MIN, applyMap(map, ci.lower));
  let upper = Math.min(CI_MAX, applyMap(map, ci.upper));
  if (p !== undefined) {
    lower = Math.min(lower, p);
    upper = Math.max(upper, p);
  }
  return { lower: round(lower, 4), upper: round(upper, 4) };
}

/** Fits one slice. Thin slices (< MIN_SHRINKAGE_MARKETS markets) return null. */
export function fitSlice(
  agentType: string,
  category: string,
  rows: TraceRow[],
  version: number,
  opts: { priorStrength?: number; maxIntercept?: number; snapshotComputedAt?: string | null; window?: 'all' | '90d' } = {},
): RecalibrationMap | null {
  const nMarkets = new Set(rows.map((r) => r.marketId)).size;
  if (nMarkets < MIN_SHRINKAGE_MARKETS) return null;
  const samples = buildSamples(rows, config.CALIBRATION_WEIGHTING);
  if (samples.length === 0) return null;
  const nEff = effectiveN(samples);
  const priorStrength = opts.priorStrength ?? config.RECALIBRATION_PRIOR_STRENGTH;
  const tau = priorStrength / Math.max(1, nEff);
  const fit = fitPlatt(samples, { a0: 0, b0: 1, tau }, { maxIntercept: opts.maxIntercept });
  const rowsDigest = sha256Hex(
    canonicalJson(rows.map((r) => [r.marketId, r.createdAt.toISOString(), round(r.p, 6), r.o])),
  );
  const base = {
    version,
    agentType,
    category,
    kind: fit.converged && (fit.a !== 0 || fit.b !== 1) ? ('platt' as const) : ('identity' as const),
    a: round(fit.a),
    b: round(fit.b),
    fittedFrom: { snapshotComputedAt: opts.snapshotComputedAt ?? null, window: opts.window ?? ('all' as const), rowsDigest },
  };
  return { ...base, id: mapId(base), nMarkets, nEff: round(nEff, 3) };
}

// ─── Storage and lookup ──────────────────────────────────────────────────────

function rowToMap(row: any): RecalibrationMap {
  const params = row.params as { kind: 'identity' | 'platt'; a: number; b: number; nMarkets: number; nEff: number };
  return {
    id: row.id,
    version: row.version,
    agentType: row.agentType,
    category: row.category,
    kind: params.kind,
    a: params.a,
    b: params.b,
    nMarkets: params.nMarkets,
    nEff: params.nEff,
    fittedFrom: row.fittedFrom,
  };
}

const CACHE_MS = 10 * 60_000;
const memo = new Map<string, { at: number; map: RecalibrationMap }>();

export function resetRecalibrationCache(): void {
  memo.clear();
}

/** Active map for (agentType, category), else the agent-wide map, else identity. Cached 10 minutes. */
export async function activeMap(agentType: string, category: string, now = Date.now()): Promise<RecalibrationMap> {
  const key = `${agentType}:${category}`;
  const hit = memo.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.map;
  let map = identityMap(agentType, category);
  try {
    const rows = await prisma.recalibrationMapRow.findMany({
      where: { agentType, active: true, category: { in: [category, ALL_CATEGORIES] } },
    });
    const exact = rows.find((r) => r.category === category);
    const fallback = rows.find((r) => r.category === ALL_CATEGORIES);
    if (exact) map = rowToMap(exact);
    else if (fallback) map = rowToMap(fallback);
  } catch (err) {
    logger.warn({ err: (err as Error)?.message, agentType, category }, 'Recalibration map lookup failed; using identity');
  }
  memo.set(key, { at: now, map });
  return map;
}

/** All active maps (for GET /agents/calibration?include=maps). */
export async function listActiveMaps(): Promise<RecalibrationMap[]> {
  const rows = await prisma.recalibrationMapRow.findMany({ where: { active: true }, orderBy: [{ agentType: 'asc' }, { category: 'asc' }] });
  return rows.map(rowToMap);
}

/**
 * Daily refit (runs after the calibration snapshots): one map per TRADER
 * category plus an agent-wide fallback. A new version is written only when a
 * parameter moves by more than PARAM_EPSILON; the previous version is kept
 * (inactive) for audit.
 */
export async function fitAndStoreMaps(now = new Date()): Promise<{ written: number; skipped: number } | null> {
  const result = await withAdvisoryLock('oracledesk:recalibration_maps', async (tx) => {
    const rows = (await extractRows(tx, null)).filter((r) => r.agentType === 'TRADER');
    const byCategory = new Map<string, TraceRow[]>([[ALL_CATEGORIES, rows]]);
    for (const r of rows) {
      const list = byCategory.get(r.category) ?? [];
      list.push(r);
      byCategory.set(r.category, list);
    }

    let written = 0;
    let skipped = 0;
    for (const [category, slice] of byCategory) {
      const current = await tx.recalibrationMapRow.findFirst({
        where: { agentType: 'TRADER', category, active: true },
        orderBy: { version: 'desc' },
      });
      const fitted = fitSlice('TRADER', category, slice, (current?.version ?? 0) + 1, {
        snapshotComputedAt: now.toISOString(),
      });
      if (!fitted) {
        skipped++;
        continue;
      }
      if (current) {
        const prev = rowToMap(current);
        if (Math.abs(prev.a - fitted.a) <= PARAM_EPSILON && Math.abs(prev.b - fitted.b) <= PARAM_EPSILON) {
          skipped++;
          continue;
        }
        await tx.recalibrationMapRow.update({ where: { id: current.id }, data: { active: false } });
      }
      await tx.recalibrationMapRow.create({
        data: {
          id: fitted.id,
          agentType: 'TRADER',
          category,
          version: fitted.version,
          params: { kind: fitted.kind, a: fitted.a, b: fitted.b, nMarkets: fitted.nMarkets, nEff: fitted.nEff },
          fittedFrom: fitted.fittedFrom,
          active: true,
        },
      });
      written++;
    }
    return { written, skipped };
  });
  if (!result.acquired) return null;
  resetRecalibrationCache();
  logger.info(result.value, 'Recalibration maps refit');
  return result.value;
}
