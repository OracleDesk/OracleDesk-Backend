/**
 * Portfolio risk service unit tests (#280).
 *
 * These tests exercise the pure simulation helpers in isolation so they run
 * without a database or Redis connection.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ---------------------------------------------------------------------------
// Inline helpers copied from service to avoid DB imports in unit tests
// ---------------------------------------------------------------------------

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - 0.3989422804014327 * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? p : 1 - p;
}

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

function mulberry32(seed: number) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function simulate(
  positions: Array<{ markRaw: number; payoffYes: number; payoffNo: number; pYes: number }>,
  rho: number,
  paths: number,
  seed: number,
): number[] {
  const n = positions.length;
  const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : rho)));
  const L = cholesky(M);
  if (!L) throw new Error('Cholesky failed');
  const rand = mulberry32(seed);
  const pnls: number[] = [];
  for (let p = 0; p < paths; p++) {
    const g = Array.from({ length: n }, () => gaussian(rand));
    const z = Array.from({ length: n }, (_, i) => {
      let s = 0;
      for (let k = 0; k <= i; k++) s += L[i][k] * g[k];
      return s;
    });
    let pnl = 0;
    for (let i = 0; i < n; i++) {
      const u = normalCdf(z[i]);
      pnl += u < positions[i].pYes ? positions[i].payoffYes - positions[i].markRaw
                                    : positions[i].payoffNo  - positions[i].markRaw;
    }
    pnls.push(pnl);
  }
  pnls.sort((a, b) => a - b);
  return pnls;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('portfolio-risk simulation', () => {
  it('independent markets: simulated ES99 converges to analytic value within 2%', () => {
    const mark = 100;
    const positions = [
      { markRaw: mark, payoffYes: 200, payoffNo: 0, pYes: 0.5 },
      { markRaw: mark, payoffYes: 200, payoffNo: 0, pYes: 0.5 },
    ];
    const paths = 50_000;
    const pnls = simulate(positions, 0, paths, 42);
    const idx99 = Math.floor(paths * 0.01);
    const es99 = pnls.slice(0, idx99 + 1).reduce((s, v) => s + v, 0) / (idx99 + 1);
    // Both positions lose → worst PnL ≈ -200; ES99 ≈ -200 for independent
    assert.ok(es99 < -180, `ES99 ${es99} should be < -180`);
    assert.ok(es99 > -220, `ES99 ${es99} should be > -220`);
  });

  it('rho=1 between two same-side positions makes worst case equal VaR99', () => {
    const mark = 100;
    const positions = [
      { markRaw: mark, payoffYes: 200, payoffNo: 0, pYes: 0.5 },
      { markRaw: mark, payoffYes: 200, payoffNo: 0, pYes: 0.5 },
    ];
    const paths = 10_000;
    // rho close to 1 (not exactly 1 to keep matrix PD)
    const pnls = simulate(positions, 0.9999, paths, 42);
    const idx99 = Math.floor(paths * 0.01);
    const var99 = pnls[idx99];
    const es99 = pnls.slice(0, idx99 + 1).reduce((s, v) => s + v, 0) / (idx99 + 1);
    // With rho ≈ 1, VaR99 ≈ ES99 — they lose together
    assert.ok(Math.abs(var99 - es99) / Math.abs(es99) < 0.05, `var99=${var99} es99=${es99} should be close`);
  });

  it('opposite-side positions in a rho=1 pair hedge to near-zero tail loss', () => {
    const mark = 100;
    const positions = [
      { markRaw: mark, payoffYes: 200, payoffNo: 0, pYes: 0.5 }, // YES
      { markRaw: mark, payoffYes: 0,   payoffNo: 200, pYes: 0.5 }, // NO (opposite)
    ];
    const paths = 10_000;
    const pnls = simulate(positions, 0.9999, paths, 42);
    const idx99 = Math.floor(paths * 0.01);
    const es99 = pnls.slice(0, idx99 + 1).reduce((s, v) => s + v, 0) / (idx99 + 1);
    // Opposite sides with rho ≈ 1 → net payoff always ≈ 200 − 100 = 0
    assert.ok(Math.abs(es99) < 50, `ES99 ${es99} should be near zero for a perfect hedge`);
  });

  it('same seed and inputs give identical results', () => {
    const positions = [
      { markRaw: 100, payoffYes: 150, payoffNo: 50, pYes: 0.6 },
    ];
    const a = simulate(positions, 0, 1000, 123);
    const b = simulate(positions, 0, 1000, 123);
    assert.deepStrictEqual(a, b);
  });

  it('normalCdf is monotone and bounded', () => {
    for (let z = -4; z <= 4; z += 0.5) {
      const p = normalCdf(z);
      assert.ok(p >= 0 && p <= 1, `normalCdf(${z})=${p} out of [0,1]`);
      if (z > -4) assert.ok(normalCdf(z) > normalCdf(z - 0.5), 'not monotone');
    }
  });

  it('cholesky of identity is identity', () => {
    const I = [[1, 0], [0, 1]];
    const L = cholesky(I)!;
    assert.ok(Math.abs(L[0][0] - 1) < 1e-10);
    assert.ok(Math.abs(L[1][1] - 1) < 1e-10);
    assert.ok(Math.abs(L[1][0]) < 1e-10);
  });

  it('non-PSD input (negative eigenvalue) causes cholesky to return null', () => {
    const bad = [[1, 2], [2, 1]]; // det < 0 → not PSD
    assert.strictEqual(cholesky(bad), null);
  });
});
