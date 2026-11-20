import test from 'node:test';
import assert from 'node:assert/strict';
import * as fpmm from '../src/generated/fpmm';
import { boughtReserves, sizeAgainstPool, sizeAtMid, type ImpactSizingInput, type PoolState } from '../src/services/impact-kelly';
import { mulberry32 } from '../src/backtest/rng';

const USDC = 10_000_000n;
const STEP = 1_000_000n; // the sizer's 0.1 USDC scan step

function poolAt(yesBps: number, seedUsdc: bigint, feeBps = 0n): PoolState {
  const r = fpmm.seedReserves(seedUsdc * USDC, BigInt(yesBps));
  return { reserveYes: r.reserveYes, reserveNo: r.reserveNo, feeBps, asOfLedger: 1, source: 'sim' };
}

function input(over: Partial<ImpactSizingInput> = {}): ImpactSizingInput {
  return {
    p: 0.7, side: 'YES', pool: poolAt(5000, 50_000_000n), wealthRaw: 10_000n * USDC, maxRaw: 10_000n * USDC,
    kellyMultiplier: 0.5, minRaw: USDC, ...over,
  };
}

/** The objective, recomputed by hand from calcBuy; a fill past the 99% bound is infeasible. */
function G(i: ImpactSizingInput, c: bigint): number {
  const [rB, rO] = i.side === 'YES' ? [i.pool.reserveYes, i.pool.reserveNo] : [i.pool.reserveNo, i.pool.reserveYes];
  const q = fpmm.calcBuy(rB, rO, c, i.pool.feeBps);
  if ((q.newReserveOther * 10_000n) / (q.newReserveBought + q.newReserveOther) > fpmm.MAX_PROB_BPS) return -Infinity;
  const s = q.sharesOut;
  const W = Number(i.wealthRaw);
  return i.p * Math.log(Number(i.wealthRaw - c + s) / W) + (1 - i.p) * Math.log(Number(i.wealthRaw - c) / W);
}

/** Closed-form fractional Kelly at the mid q: k · (p − q) / (1 − q) · W. */
const closedForm = (p: number, q: number, W: bigint, k = 0.5) => k * ((p - q) / (1 - q)) * Number(W);

test('deep pool: within 1% of closed-form half-Kelly on the same p and mid', () => {
  for (const [yesBps, p, side] of [[5000, 0.7, 'YES'], [3000, 0.45, 'YES'], [6500, 0.5, 'NO']] as const) {
    const i = input({ p, side, pool: poolAt(yesBps, 50_000_000n) });
    const r = sizeAgainstPool(i);
    const q = r.midBps / 10_000;
    const expected = closedForm(p, q, i.wealthRaw);
    assert.equal(r.reason, undefined);
    assert.ok(Math.abs(Number(r.collateralRaw) - expected) / expected < 0.01, `${side}@${yesBps}: ${r.collateralRaw} vs ${expected}`);
    assert.ok(r.impactBps <= 1, 'a 50M USDC pool barely moves');
  }
});

test('thin pool: strictly smaller than the deep pool, average price below p', () => {
  const deep = sizeAgainstPool(input({ pool: poolAt(5000, 50_000_000n, 100n) }));
  const thin = sizeAgainstPool(input({ pool: poolAt(5000, 5_000n, 100n) }));
  assert.ok(thin.collateralRaw > 0n && thin.collateralRaw < deep.collateralRaw, `${thin.collateralRaw} < ${deep.collateralRaw}`);
  assert.ok(thin.avgPriceBps < 7000);
  assert.ok(thin.effectiveEdge > 0);
  assert.ok(thin.postPriceBps > thin.midBps, 'the buy moves the price up');
  assert.ok(thin.impactBps > deep.impactBps);
  // The fee is the market's, charged on collateral in, rounded up.
  assert.equal(thin.feeRaw, (thin.collateralRaw * 100n + 9_999n) / 10_000n);
});

test('the bought side’s reserve goes first: YES uses reserveYes, NO uses reserveNo', () => {
  const pool = poolAt(3000, 20_000n, 100n); // YES at 30%, NO at 70%
  assert.deepEqual(boughtReserves(pool, 'YES'), [pool.reserveYes, pool.reserveNo]);
  assert.deepEqual(boughtReserves(pool, 'NO'), [pool.reserveNo, pool.reserveYes]);

  const yes = sizeAgainstPool(input({ p: 0.45, side: 'YES', pool }));
  const yesQuote = fpmm.calcBuy(pool.reserveYes, pool.reserveNo, yes.collateralRaw, 100n);
  assert.equal(yes.sharesOutRaw, yesQuote.sharesOut);
  const total = pool.reserveYes + pool.reserveNo;
  assert.equal(yes.midBps, Number((pool.reserveNo * 10_000n) / total));
  assert.ok(Math.abs(yes.midBps - 3000) <= 1);

  const no = sizeAgainstPool(input({ p: 0.85, side: 'NO', pool }));
  const noQuote = fpmm.calcBuy(pool.reserveNo, pool.reserveYes, no.collateralRaw, 100n);
  assert.ok(no.collateralRaw > 0n);
  assert.equal(no.sharesOutRaw, noQuote.sharesOut, 'hand-computed calcBuy with reserveNo as rBought');
  assert.notEqual(no.sharesOutRaw, fpmm.calcBuy(pool.reserveYes, pool.reserveNo, no.collateralRaw, 100n).sharesOut);
  assert.equal(no.midBps, Number((pool.reserveYes * 10_000n) / total));
  assert.ok(Math.abs(no.midBps - 7000) <= 1);
  assert.equal(no.postPriceBps, Number((noQuote.newReserveOther * 10_000n) / (noQuote.newReserveBought + noQuote.newReserveOther)));
  assert.equal(no.avgPriceBps, Number((no.collateralRaw * 10_000n) / noQuote.sharesOut));
});

test('NO_EDGE_AT_MARGIN when the smallest order already costs p, or the pool sits at 99%', () => {
  // Mid 0.50, 1% fee: one USDC buys under 1.98 shares, so 0.505 is not enough.
  const thin = sizeAgainstPool(input({ p: 0.505, pool: poolAt(5000, 1_000n, 100n) }));
  assert.equal(thin.reason, 'NO_EDGE_AT_MARGIN');
  assert.equal(thin.collateralRaw, 0n);
  assert.equal(thin.midBps, 5000);

  const edge = sizeAgainstPool(input({ p: 0.999, pool: poolAt(9900, 1_000n) }));
  assert.equal(edge.reason, 'NO_EDGE_AT_MARGIN', 'never size into a 99% price');
  assert.equal(edge.collateralRaw, 0n);
});

test('BELOW_MIN when the caps or the fraction leave less than the minimum order', () => {
  assert.equal(sizeAgainstPool(input({ maxRaw: USDC - 1n })).reason, 'BELOW_MIN');
  assert.equal(sizeAgainstPool(input({ wealthRaw: USDC })).reason, 'BELOW_MIN', 'maxRaw is clamped to W − 1');
  // A 1% edge at a 1% fraction of 100 USDC is far below 1 USDC.
  const tiny = sizeAgainstPool(input({ p: 0.52, pool: poolAt(5000, 50_000_000n), wealthRaw: 100n * USDC, maxRaw: 100n * USDC, kellyMultiplier: 0.01 }));
  assert.equal(tiny.reason, 'BELOW_MIN');
  assert.equal(tiny.collateralRaw, 0n);
});

test('caps bound the fractional order, never halve it', () => {
  const r = sizeAgainstPool(input({ maxRaw: 250n * USDC }));
  assert.equal(r.collateralRaw, 250n * USDC, 'half-Kelly (2 000 USDC) is above the cap: the cap is the size');
  const mid = sizeAtMid(input({ maxRaw: 250n * USDC }));
  assert.equal(mid.collateralRaw, 250n * USDC);
});

test('deterministic, and among equal scores the smaller size wins', () => {
  const i = input({ pool: poolAt(5000, 20_000n, 100n), kellyMultiplier: 1 });
  const a = sizeAgainstPool(i);
  const b = sizeAgainstPool({ ...i, pool: { ...i.pool } });
  assert.deepEqual(a, b);
  // c* is a local maximum on the scan grid; a step down scores strictly less.
  assert.ok(G(i, a.collateralRaw) >= G(i, a.collateralRaw + STEP));
  assert.ok(G(i, a.collateralRaw - STEP) < G(i, a.collateralRaw));
});

test('a calcBuy MathError bounds the search instead of crashing it', () => {
  // A 100% fee leaves nothing to buy with: every point throws.
  const allFee = sizeAgainstPool(input({ pool: poolAt(5000, 1_000n, 10_000n) }));
  assert.equal(allFee.reason, 'NO_EDGE_AT_MARGIN');

  // Past 500 USDC the pool refuses: the optimum (2 000 USDC full-Kelly ×2) is cut there.
  const orig = fpmm.calcBuy;
  (fpmm as any).calcBuy = (rB: bigint, rO: bigint, c: bigint, fee: bigint) => {
    if (c > 500n * USDC) throw new fpmm.MathError('insufficient liquidity');
    return orig(rB, rO, c, fee);
  };
  try {
    const r = sizeAgainstPool(input({ kellyMultiplier: 1 }));
    assert.equal(r.reason, undefined);
    assert.ok(r.collateralRaw <= 500n * USDC && r.collateralRaw > 499n * USDC, `${r.collateralRaw}`);
  } finally {
    (fpmm as any).calcBuy = orig;
  }

  // A thin pool and a near-certain p would push the price past 99%: the search stops short of it.
  const pushed = sizeAgainstPool(input({ p: 0.98, pool: poolAt(5000, 200n), wealthRaw: 1_000_000n * USDC, maxRaw: 1_000_000n * USDC, kellyMultiplier: 1 }));
  assert.ok(pushed.collateralRaw > 0n);
  assert.ok(pushed.postPriceBps <= 9900);
});

test('property: G(result) ≥ G(result ± 0.1 USDC) over random pools (full Kelly)', () => {
  const rng = mulberry32(225);
  let sized = 0;
  for (let n = 0; n < 150; n++) {
    const yesBps = 500 + Math.floor(rng() * 9_000);
    const side = rng() < 0.5 ? 'YES' : 'NO';
    const pool = poolAt(yesBps, BigInt(200 + Math.floor(rng() * 2_000_000)), BigInt(Math.floor(rng() * 300)));
    const mid = side === 'YES' ? yesBps / 10_000 : 1 - yesBps / 10_000;
    const p = Math.min(0.98, mid + 0.01 + rng() * (0.98 - mid));
    const W = BigInt(100 + Math.floor(rng() * 100_000)) * USDC;
    const maxRaw = rng() < 0.3 ? BigInt(1 + Math.floor(rng() * 500)) * USDC : W;
    const i = input({ p, side, pool, wealthRaw: W, maxRaw, kellyMultiplier: 1 });
    const r = sizeAgainstPool(i);
    if (r.reason) continue;
    sized++;
    const cap = maxRaw < W - 1n ? maxRaw : W - 1n;
    assert.ok(r.collateralRaw >= i.minRaw && r.collateralRaw <= cap, `case ${n}: within bounds`);
    assert.ok(r.avgPriceBps < p * 10_000, `case ${n}: average price below p`);
    const g = G(i, r.collateralRaw);
    for (const c of [r.collateralRaw - STEP, r.collateralRaw + STEP]) {
      if (c < i.minRaw || c > cap) continue;
      let gc = -Infinity;
      try { gc = G(i, c); } catch (err) { if (!(err instanceof fpmm.MathError)) throw err; }
      assert.ok(g >= gc, `case ${n}: G(${r.collateralRaw})=${g} < G(${c})=${gc}`);
    }
  }
  assert.ok(sized > 50, `only ${sized} cases sized`);
});

test('p is not rounded to basis points before the search', () => {
  const a = sizeAgainstPool(input({ p: 0.70004, pool: poolAt(5000, 20_000n, 100n) }));
  const b = sizeAgainstPool(input({ p: 0.70, pool: poolAt(5000, 20_000n, 100n) }));
  assert.ok(a.collateralRaw > b.collateralRaw);
});
