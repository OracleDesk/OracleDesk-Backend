import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

// #244 — Platt recalibration maps.

/** Deterministic PRNG so the synthetic data sets are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const logit = (p: number) => Math.log(p / (1 - p));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Forecasts p and outcomes drawn from the true probability logistic(k·logit(p)).
 * k < 1: the forecaster is overconfident; k > 1: underconfident.
 */
function synthetic(n: number, k: number, seed = 7) {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const p = 0.05 + 0.9 * r();
    const truth = logistic(k * logit(p));
    return { p, o: (r() < truth ? 1 : 0) as 0 | 1, w: 1 };
  });
}

const brier = (s: Array<{ p: number; o: number }>) => s.reduce((a, x) => a + (x.p - x.o) ** 2, 0) / s.length;

test('fitPlatt on synthetic overconfident data yields b < 1 and lowers Brier on a holdout', async () => {
  const { fitPlatt, applyMap } = await import('../src/services/recalibration.service');
  const train = synthetic(2000, 0.5, 1);
  const holdout = synthetic(2000, 0.5, 2);
  const fit = fitPlatt(train, { a0: 0, b0: 1, tau: 20 / train.length });
  assert.ok(fit.converged);
  assert.ok(fit.b < 0.8, `slope ${fit.b}`);
  const mapped = holdout.map((s) => ({ ...s, p: applyMap(fit, s.p) }));
  assert.ok(brier(mapped) < brier(holdout), `${brier(mapped)} < ${brier(holdout)}`);
});

test('fitPlatt on underconfident data is clamped to identity slope', async () => {
  const { fitPlatt } = await import('../src/services/recalibration.service');
  const data = synthetic(2000, 2, 3);
  const fit = fitPlatt(data, { a0: 0, b0: 1, tau: 20 / data.length });
  assert.equal(fit.b, 1, 'the map never increases confidence');
  assert.ok(Math.abs(fit.a) <= 0.5);
});

test('intercept is clamped to RECALIBRATION_MAX_INTERCEPT', async () => {
  const { fitPlatt } = await import('../src/services/recalibration.service');
  // Every outcome is YES: the unconstrained intercept would run large.
  const data = synthetic(500, 1, 4).map((s) => ({ ...s, o: 1 as const }));
  const fit = fitPlatt(data, { a0: 0, b0: 1, tau: 0.01 }, { maxIntercept: 0.5 });
  assert.ok(fit.a <= 0.5 + 1e-12);
});

test('applyMap is monotone and keeps lower ≤ p ≤ upper', async () => {
  const { applyMap, applyMapToInterval } = await import('../src/services/recalibration.service');
  const map = { a: 0.2, b: 0.6 };
  let prev = -Infinity;
  for (let p = 0.02; p <= 0.98; p += 0.01) {
    const q = applyMap(map, p);
    assert.ok(q >= prev, `monotone at ${p}`);
    prev = q;
  }
  const p = applyMap(map, 0.7);
  const ci = applyMapToInterval(map, { lower: 0.6, upper: 0.8 }, p);
  assert.ok(ci.lower <= p && p <= ci.upper, JSON.stringify({ ci, p }));
});

test('thin data falls back: fitSlice returns null below MIN_SHRINKAGE_MARKETS', async () => {
  const { fitSlice } = await import('../src/services/recalibration.service');
  const { MIN_SHRINKAGE_MARKETS } = await import('../src/services/calibration.service');
  const resolvedAt = new Date('2026-10-01T00:00:00Z');
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      marketId: `m${i}`,
      agentType: 'TRADER',
      decisionType: 'OPEN_POSITION',
      category: 'FED',
      p: 0.7,
      pm: 0.5,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      resolvedAt,
      o: (i % 2) as 0 | 1,
      promptVersion: null,
      model: null,
    }));
  assert.equal(fitSlice('TRADER', 'FED', rows(MIN_SHRINKAGE_MARKETS - 1), 1), null);
  const fitted = fitSlice('TRADER', 'FED', rows(MIN_SHRINKAGE_MARKETS), 1);
  assert.ok(fitted);
  assert.equal(fitted!.nMarkets, MIN_SHRINKAGE_MARKETS);
});

test('map id is deterministic for the same inputs', async () => {
  const { mapId, identityMap } = await import('../src/services/recalibration.service');
  const base = {
    version: 3,
    agentType: 'TRADER',
    category: 'FED',
    kind: 'platt' as const,
    a: 0.1,
    b: 0.7,
    fittedFrom: { snapshotComputedAt: '2026-11-01T03:10:00.000Z', window: 'all' as const, rowsDigest: 'abc' },
  };
  assert.equal(mapId(base), mapId({ ...base }));
  assert.notEqual(mapId(base), mapId({ ...base, b: 0.71 }));
  assert.equal(identityMap('TRADER', 'FED').id, identityMap('TRADER', 'FED').id);
});

test('recalibrate: disabled records an identity map with applied=false; enabled pulls toward 0.5', async () => {
  const { recalibrate } = await import('../src/services/forecast.service');
  const { identityMap } = await import('../src/services/recalibration.service');
  const f = { p: 0.8, ci: { lower: 0.7, upper: 0.9 }, sigmaLogit: 0.4, shrink: 0.15, members: [], inputsDigest: 'd' };

  const off = recalibrate(f, identityMap('TRADER', 'FED'), 'FED', false);
  assert.equal(off.p, 0.8);
  assert.deepEqual(off.raw, { p: 0.8, ci: f.ci });
  assert.equal(off.calibration?.applied, false);

  const map = { ...identityMap('TRADER', 'FED'), kind: 'platt' as const, a: 0, b: 0.5, id: 'm1', version: 2 };
  const on = recalibrate(f, map, 'FED', true);
  assert.ok(on.p < 0.8 && on.p > 0.5, `p ${on.p}`);
  assert.ok(on.ci.lower <= on.p && on.p <= on.ci.upper);
  assert.equal(on.sigmaLogit, 0.2);
  assert.deepEqual(on.calibration, { mapId: 'm1', version: 2, category: 'FED', applied: true });
  assert.equal(on.raw?.p, 0.8, 'raw value kept for calibration');
});

test('map change invalidates the forecast cache key', async () => {
  const { forecastCacheKey } = await import('../src/services/forecast.service');
  const market = { id: 'mk', question: 'Will the Fed cut?', questionHash: null };
  const plain = forecastCacheKey(market as any, []);
  assert.equal(plain, forecastCacheKey(market as any, [], undefined), 'no map: key unchanged from before #244');
  assert.notEqual(forecastCacheKey(market as any, [], 'map-a'), forecastCacheKey(market as any, [], 'map-b'));
});
