/**
 * Fractional-Kelly sizing against the FPMM curve (#225).
 *
 * The closed-form Kelly in kelly.ts assumes any amount fills at the mid. On
 * market-core a buy pays fee_bps and walks the constant-product curve, so the
 * average price per share is worse than the mid and gets worse with size.
 * This sizer instead maximises expected log wealth over the real fill:
 *
 *   G(c) = p·ln(W − c + s(c)) + (1 − p)·ln(W − c)
 *
 * where s(c) is the exact shares out of calcBuy (src/generated/fpmm.ts) for
 * c collateral against the market's own reserves and fee. G is concave on
 * [0, W), so an integer golden-section search finds the full-Kelly optimum
 * c*; the order is floor(c* × kellyMultiplier), never above maxRaw.
 *
 * Pure and deterministic: bigint pool math, float logs only on Number(x)/W.
 * Production (trader-policy.ts) and the backtester run it on the same inputs.
 */
import { BPS, MAX_PROB_BPS, MathError, calcBuy } from '../generated/fpmm';

export interface PoolState {
  reserveYes: bigint;
  reserveNo: bigint;
  /** The market's own fee, fixed at creation; never a config default. */
  feeBps: bigint;
  asOfLedger: number;
  source: 'indexed' | 'rpc' | 'sim';
}

export interface ImpactSizingInput {
  /** Conservative probability of the side being bought. Not rounded to bps. */
  p: number;
  side: 'YES' | 'NO';
  pool: PoolState;
  /** Free cash the order is a share of (W). */
  wealthRaw: bigint;
  /** Largest order the caps allow; clamped to W − 1. */
  maxRaw: bigint;
  /** 0.5 for half-Kelly. Applied to the full-Kelly optimum. */
  kellyMultiplier: number;
  /** Smallest order worth sending. */
  minRaw: bigint;
}

export interface ImpactSizing {
  collateralRaw: bigint;
  sharesOutRaw: bigint;
  feeRaw: bigint;
  /** Bought side's price before the trade. */
  midBps: number;
  /** collateral × 10 000 / shares: what a share costs, fee included. */
  avgPriceBps: number;
  /** Bought side's price after the trade. */
  postPriceBps: number;
  /** Curve impact only: (collateral − fee) × 10 000 / shares − mid. */
  impactBps: number;
  /** G(collateralRaw) − G(0), with wealth normalised to 1. */
  expectedLogGrowth: number;
  /** p − average price per share. */
  effectiveEdge: number;
  reason?: 'NO_EDGE_AT_MARGIN' | 'BELOW_MIN';
}

/** One USDC in base units (7 decimals). */
const USDC = 10_000_000n;
/** Final scan step: 0.1 USDC. */
const SCAN_STEP = 1_000_000n;
/** (√5 − 1) / 2, as a fraction of 10⁶. */
const GOLDEN_NUM = 618_034n;
const GOLDEN_DEN = 1_000_000n;

const minBig = (a: bigint, b: bigint) => (a < b ? a : b);
const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);

/** [rBought, rOther]: the bought side's reserve first, as in valuePosition. */
export function boughtReserves(pool: PoolState, side: 'YES' | 'NO'): [bigint, bigint] {
  return side === 'YES' ? [pool.reserveYes, pool.reserveNo] : [pool.reserveNo, pool.reserveYes];
}

interface Fill {
  sharesOut: bigint;
  fee: bigint;
  net: bigint;
  postPriceBps: bigint;
}

/** calcBuy plus the post-trade price, or null when the pool cannot fill it or the fill crosses MAX_PROB_BPS. */
function fill(rBought: bigint, rOther: bigint, c: bigint, feeBps: bigint): Fill | null {
  try {
    const q = calcBuy(rBought, rOther, c, feeBps);
    // The bought side's price is rOther / (rBought + rOther) after the trade too.
    const postPriceBps = (q.newReserveOther * BPS) / (q.newReserveBought + q.newReserveOther);
    if (postPriceBps > MAX_PROB_BPS) return null;
    return { sharesOut: q.sharesOut, fee: q.fee, net: q.net, postPriceBps };
  } catch (err) {
    if (err instanceof MathError) return null;
    throw err;
  }
}

function validate(i: ImpactSizingInput): void {
  if (!Number.isFinite(i.p) || i.p <= 0 || i.p >= 1) throw new RangeError(`p must be in (0, 1), got ${i.p}`);
  if (!Number.isFinite(i.kellyMultiplier) || i.kellyMultiplier <= 0 || i.kellyMultiplier > 1) {
    throw new RangeError(`kellyMultiplier must be in (0, 1], got ${i.kellyMultiplier}`);
  }
}

/** The recorded fields for an order of `c` (all zero-size fields when it cannot fill). */
function describe(i: ImpactSizingInput, c: bigint): ImpactSizing {
  const [rB, rO] = boughtReserves(i.pool, i.side);
  const midBps = Number((rO * BPS) / (rB + rO));
  const f = c > 0n ? fill(rB, rO, c, i.pool.feeBps) : null;
  if (!f) {
    return {
      collateralRaw: 0n, sharesOutRaw: 0n, feeRaw: 0n, midBps, avgPriceBps: midBps, postPriceBps: midBps, impactBps: 0,
      expectedLogGrowth: 0, effectiveEdge: i.p - midBps / 10_000,
    };
  }
  const avgPriceBps = Number((c * BPS) / f.sharesOut);
  return {
    collateralRaw: c,
    sharesOutRaw: f.sharesOut,
    feeRaw: f.fee,
    midBps,
    avgPriceBps,
    postPriceBps: Number(f.postPriceBps),
    impactBps: Number((f.net * BPS) / f.sharesOut) - midBps,
    expectedLogGrowth: logGrowth(i.p, i.wealthRaw, c, f.sharesOut),
    effectiveEdge: i.p - Number(c) / Number(f.sharesOut),
  };
}

function logGrowth(p: number, W: bigint, c: bigint, shares: bigint): number {
  const w = Number(W);
  return p * Math.log(Number(W - c + shares) / w) + (1 - p) * Math.log(Number(W - c) / w);
}

const zero = (i: ImpactSizingInput, reason: NonNullable<ImpactSizing['reason']>): ImpactSizing => ({ ...describe(i, 0n), reason });

/**
 * The size that maximises fractional-Kelly log growth over the FPMM curve,
 * within [minRaw, maxRaw]. Returns collateralRaw 0 with a reason when no
 * order is worth sending: NO_EDGE_AT_MARGIN when even the minimum order's
 * average price is ≥ p (or the pool sits at the 99% bound), BELOW_MIN when
 * the caps or the fraction leave less than minRaw.
 */
export function sizeAgainstPool(i: ImpactSizingInput): ImpactSizing {
  validate(i);
  const W = i.wealthRaw;
  const maxRaw = minBig(i.maxRaw, W - 1n);
  const minRaw = maxBig(i.minRaw, 1n);
  if (maxRaw < minRaw) return zero(i, 'BELOW_MIN');

  const [rB, rO] = boughtReserves(i.pool, i.side);
  if (rB <= 0n || rO <= 0n) return zero(i, 'NO_EDGE_AT_MARGIN');
  // A pool at the bound: never size into a 99% price.
  if ((rO * BPS) / (rB + rO) >= MAX_PROB_BPS) return zero(i, 'NO_EDGE_AT_MARGIN');

  // Early exit: the smallest order already pays p or more per share.
  const first = fill(rB, rO, minRaw, i.pool.feeBps);
  if (!first || Number(minRaw) >= i.p * Number(first.sharesOut)) return zero(i, 'NO_EDGE_AT_MARGIN');

  // An infeasible point (MathError, past 99%) scores −∞: it bounds the search, never crashes it.
  const memo = new Map<bigint, number>();
  const G = (c: bigint): number => {
    let g = memo.get(c);
    if (g === undefined) {
      const f = fill(rB, rO, c, i.pool.feeBps);
      g = f ? logGrowth(i.p, W, c, f.sharesOut) : -Infinity;
      memo.set(c, g);
    }
    return g;
  };

  // Search the full-Kelly optimum; the fraction is applied afterwards, so
  // the bracket ends where the fractional order would reach maxRaw.
  const capFull = BigInt(Math.floor(Number(maxRaw) / i.kellyMultiplier));
  const hi = minBig(W - 1n, capFull);
  const tol = maxBig(USDC, hi / 10_000n);

  let a = minRaw;
  let b = hi;
  while (b - a > tol) {
    const d = ((b - a) * GOLDEN_NUM) / GOLDEN_DEN;
    const x1 = b - d;
    const x2 = a + d;
    // Ties keep the left part: the smaller size wins.
    if (G(x1) >= G(x2)) b = x2;
    else a = x1;
  }
  let best = a;
  for (let c = a + SCAN_STEP; c < b; c += SCAN_STEP) if (G(c) > G(best)) best = c;
  if (G(b) > G(best)) best = b;
  // Polish: b need not sit on the scan grid, so settle on a local maximum of
  // the 0.1 USDC grid around c* (ties still go to the smaller size).
  while (best + SCAN_STEP <= hi && G(best + SCAN_STEP) > G(best)) best += SCAN_STEP;
  while (best - SCAN_STEP >= minRaw && G(best - SCAN_STEP) >= G(best)) best -= SCAN_STEP;

  // At the bracket's cap the fractional order is the cap itself.
  const collateral = best === hi && hi === capFull
    ? maxRaw
    : minBig(maxRaw, BigInt(Math.floor(Number(best) * i.kellyMultiplier)));
  if (collateral < minRaw) return zero(i, 'BELOW_MIN');

  const sized = describe(i, collateral);
  // Re-quoted at the fractional size; a fill that has eaten the edge is never proposed.
  if (sized.collateralRaw === 0n || sized.effectiveEdge <= 0) return zero(i, 'NO_EDGE_AT_MARGIN');
  return sized;
}

/**
 * The pre-#225 rule for comparison (backtest `--sizing mid`): closed-form
 * fractional Kelly at the mid, f* = (p − q) / (1 − q), clamped to maxRaw.
 * The recorded fields still come from the real fill.
 */
export function sizeAtMid(i: ImpactSizingInput): ImpactSizing {
  validate(i);
  const W = i.wealthRaw;
  const maxRaw = minBig(i.maxRaw, W - 1n);
  const minRaw = maxBig(i.minRaw, 1n);
  if (maxRaw < minRaw) return zero(i, 'BELOW_MIN');
  const [rB, rO] = boughtReserves(i.pool, i.side);
  if (rB <= 0n || rO <= 0n) return zero(i, 'NO_EDGE_AT_MARGIN');
  const q = Number(rO) / Number(rB + rO);
  const fStar = (i.p - q) / (1 - q);
  if (!(fStar > 0)) return zero(i, 'NO_EDGE_AT_MARGIN');
  const collateral = minBig(maxRaw, BigInt(Math.floor(fStar * i.kellyMultiplier * Number(W))));
  if (collateral < minRaw) return zero(i, 'BELOW_MIN');
  const sized = describe(i, collateral);
  return sized.collateralRaw === 0n ? zero(i, 'NO_EDGE_AT_MARGIN') : sized;
}
