/**
 * Learned source weights (#223): the estimator on synthetic histories, the
 * approval guard, sample extraction and the runtime fallback. Pure where
 * possible; the lifecycle SQL runs in tests/integration/source-weights.int.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

type WeightSample = import('../src/services/source-weights.service').WeightSample;
type WeightAdjustment = import('../src/services/source-weights.service').WeightAdjustment;

/** mulberry32: a seeded RNG so every synthetic history is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EARLY = '2026-06-01T00:00:00.000Z';
const LATE = '2026-11-01T00:00:00.000Z';
const CUTOFF = new Date('2026-09-01T00:00:00Z');
const FAR_CUTOFF = new Date('2030-01-01T00:00:00Z');

let seq = 0;
const adj = (source: string, publisher: string | null, delta: number, over: Partial<WeightAdjustment> = {}): WeightAdjustment => ({
  signalId: `sig-${String(++seq).padStart(6, '0')}`,
  delta,
  source,
  publisher,
  clusterId: null,
  ...over,
});

function sample(i: number, o: 0 | 1, adjustments: WeightAdjustment[], over: Partial<WeightSample> = {}): WeightSample {
  return {
    marketId: `m${String(i).padStart(5, '0')}`,
    traceId: `t${String(i).padStart(5, '0')}`,
    category: 'MACRO',
    o,
    w: 1,
    baseRate: 0.5,
    resolvedAt: EARLY,
    weightSetVersion: 0,
    adjustments,
    ...over,
  };
}

/** Publisher Alpha calls the outcome 80 % of the time; Beta is a coin flip. Both are NEWSAPI. */
function alphaBetaHistory(n: number, seed: number, over: (i: number) => Partial<WeightSample> = () => ({}), alphaAccuracy = 0.8): WeightSample[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const o: 0 | 1 = r() < 0.5 ? 1 : 0;
    const right = r() < alphaAccuracy;
    const alphaUp = right ? o === 1 : o === 0;
    const betaUp = r() < 0.5;
    return sample(i, o, [adj('NEWSAPI', 'Alpha', alphaUp ? 0.15 : -0.15), adj('NEWSAPI', 'Beta', betaUp ? 0.15 : -0.15)], over(i));
  });
}

async function svc() {
  // error.middleware → response.util → cache.middleware → … → resilience → error.middleware
  // is an existing import cycle that only resolves when response.util loads first
  // (as it does in the app); load it before the service under test.
  await import('../src/utils/response.util');
  return import('../src/services/source-weights.service');
}

// ─── estimator ───────────────────────────────────────────────────────────────

test('a publisher that predicts outcomes gets β > 1 and a coin-flip publisher β ≈ 0', async () => {
  const { estimateWeightSet, COMPILED_WEIGHT_TABLE } = await svc();
  const est = estimateWeightSet(alphaBetaHistory(800, 1), { parent: COMPILED_WEIGHT_TABLE, cutoff: FAR_CUTOFF, window: 'all', minNEff: 30 });
  const alpha = est.intervals['publisher:alpha'];
  const beta = est.intervals['publisher:beta'];
  assert.ok(alpha.beta > 1.5, `β_alpha = ${alpha.beta}`);
  assert.ok(Math.abs(beta.beta) < 0.35, `β_beta = ${beta.beta}`);
  assert.equal(alpha.parentKey, 'source:NEWSAPI');
  // w = clamp(w_parent · β̂, 0.05, 1), with the parent weight of a new publisher = its source's.
  assert.equal(alpha.current, 0.7);
  assert.equal(est.weights['publisher:alpha'], 1);
  assert.ok(est.weights['publisher:beta'] < 0.25);
  assert.ok(alpha.lower <= est.weights['publisher:alpha'] && est.weights['publisher:alpha'] <= alpha.upper);
  assert.ok(beta.lower < beta.upper, '90 % interval has width');
  close(alpha.nEff, 800);
  assert.equal(alpha.nMarkets, 800);
  assert.equal(est.method.fit.converged, true);
  assert.ok(est.method.fit.iterations <= est.method.fit.maxIter);
  // Every compiled source key survives into the set.
  for (const k of Object.keys(COMPILED_WEIGHT_TABLE.weights)) assert.ok(k in est.weights, k);
});

test('the category fixed effect removes credit for a source confined to a high-base-rate category', async () => {
  const { estimateWeightSet, COMPILED_WEIGHT_TABLE } = await svc();
  const r = rng(7);
  const history: WeightSample[] = [];
  for (let i = 0; i < 400; i++) {
    // FRED only ever appears on FED questions, which resolve YES 80 % of the time;
    // its adjustment is always +0.1, i.e. it carries no information within FED.
    history.push(sample(i, r() < 0.8 ? 1 : 0, [adj('FRED', 'FRED', 0.1)], { category: 'FED' }));
  }
  for (let i = 400; i < 800; i++) {
    history.push(sample(i, r() < 0.5 ? 1 : 0, [adj('NEWSAPI', null, r() < 0.5 ? 0.1 : -0.1)], { category: 'MACRO' }));
  }
  const opts = { parent: COMPILED_WEIGHT_TABLE, cutoff: FAR_CUTOFF, window: 'all', minNEff: 30 };
  const withCategory = estimateWeightSet(history, opts);
  const pooled = estimateWeightSet(history.map((s) => ({ ...s, category: 'ALL' })), opts);
  const fredWith = withCategory.intervals['source:FRED'].beta;
  const fredPooled = pooled.intervals['source:FRED'].beta;
  assert.ok(fredPooled > 1.8, `without category effects FRED is credited with FED's base rate (β = ${fredPooled})`);
  assert.ok(fredWith < 1.3, `with category effects β_FRED stays near its prior (β = ${fredWith})`);
  assert.ok(withCategory.method.categoryEffects.FED > 0.7, 'α_FED absorbs the base rate');
  // FRED's publisher is the source itself: no publisher key.
  assert.ok(!('publisher:fred' in withCategory.intervals));
});

test('keys below WEIGHTS_MIN_NEFF keep the parent weight and are flagged', async () => {
  const { estimateWeightSet, COMPILED_WEIGHT_TABLE } = await svc();
  const r = rng(11);
  const history = alphaBetaHistory(200, 3);
  for (let i = 0; i < 10; i++) history.push(sample(1000 + i, r() < 0.5 ? 1 : 0, [adj('GDELT', 'rare.example', 0.2)]));
  const parent = { id: 'parent-set', version: 3, weights: { ...COMPILED_WEIGHT_TABLE.weights, 'source:GDELT': 0.42 } };
  const est = estimateWeightSet(history, { parent, cutoff: FAR_CUTOFF, window: '180d', minNEff: 30 });
  assert.equal(est.intervals['source:GDELT'].insufficient, true);
  assert.equal(est.intervals['source:GDELT'].nEff, 10);
  assert.equal(est.weights['source:GDELT'], 0.42);
  assert.equal(est.intervals['publisher:rare.example'].insufficient, true);
  assert.ok(!('publisher:rare.example' in est.weights), 'an insufficient new publisher falls back to its source at runtime');
  assert.equal(est.intervals['publisher:alpha'].insufficient, false);
  assert.equal(est.parentId, 'parent-set');
  assert.equal(est.method.parentVersion, 3);
});

test('permuted input order yields an identical set and inputDigest', async () => {
  const { estimateWeightSet, COMPILED_WEIGHT_TABLE } = await svc();
  const history = alphaBetaHistory(300, 5, (i) => ({ resolvedAt: i % 4 === 0 ? LATE : EARLY, category: i % 3 ? 'MACRO' : 'FED' }));
  const r = rng(99);
  const shuffled = history
    .map((s) => ({ s: { ...s, adjustments: [...s.adjustments].reverse() }, k: r() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.s);
  const opts = { parent: COMPILED_WEIGHT_TABLE, cutoff: CUTOFF, window: '180d', minNEff: 30 };
  const a = estimateWeightSet(history, opts);
  const b = estimateWeightSet(shuffled, opts);
  assert.equal(a.method.inputDigest, b.method.inputDigest);
  assert.deepEqual(a, b);
  assert.match(a.method.inputDigest, /^[0-9a-f]{64}$/);
  assert.ok(a.method.heldOut.samples > 0 && a.method.heldOutDeltaLogLoss !== null);
});

test('a set worse than its parent on held-out log loss is flagged, and approval rejects it', async () => {
  const { estimateWeightSet, assertApprovable, COMPILED_WEIGHT_TABLE } = await svc();
  // Alpha predicts outcomes before the cutoff and is wrong after it.
  const fit = alphaBetaHistory(400, 21);
  const heldOut = alphaBetaHistory(200, 22, () => ({ resolvedAt: LATE }), 0.2).map((s, i) => ({ ...s, marketId: `h${i}`, traceId: `ht${i}` }));
  const est = estimateWeightSet([...fit, ...heldOut], { parent: COMPILED_WEIGHT_TABLE, cutoff: CUTOFF, window: '180d', minNEff: 30 });
  assert.equal(est.method.heldOut.samples, 200);
  assert.ok((est.method.heldOutDeltaLogLoss ?? 0) > 0, `Δ log loss = ${est.method.heldOutDeltaLogLoss}`);
  assert.equal(est.method.regression, true);
  assert.throws(
    () => assertApprovable({ status: 'DRAFT', createdBy: 'GCREATOR', method: est.method }, 'GAPPROVER'),
    (err: any) => err.statusCode === 409 && err.code === 'WEIGHT_SET_REGRESSION',
  );

  // The same history without the reversal improves held-out loss.
  const good = estimateWeightSet([...fit, ...alphaBetaHistory(200, 23, () => ({ resolvedAt: LATE })).map((s, i) => ({ ...s, marketId: `g${i}`, traceId: `gt${i}` }))], {
    parent: COMPILED_WEIGHT_TABLE, cutoff: CUTOFF, window: '180d', minNEff: 30,
  });
  assert.equal(good.method.regression, false);
  assert.ok((good.method.heldOutDeltaLogLoss ?? 0) < 0);
  assertApprovable({ status: 'DRAFT', createdBy: 'GCREATOR', method: good.method }, 'GAPPROVER');
});

test('approval rejects self-approval and anything but a DRAFT', async () => {
  const { assertApprovable } = await svc();
  const method = { regression: false };
  assert.throws(() => assertApprovable({ status: 'DRAFT', createdBy: 'GA', method }, 'GA'), (err: any) => err.statusCode === 403 && err.code === 'SELF_APPROVAL');
  assert.throws(() => assertApprovable({ status: 'ACTIVE', createdBy: 'GA', method }, 'GB'), (err: any) => err.statusCode === 409 && err.code === 'WEIGHT_SET_NOT_DRAFT');
  assertApprovable({ status: 'DRAFT', createdBy: 'GA', method }, 'GB');
});

test('adjustments sharing a clusterId collapse to one averaged contribution; base + δ is clamped', async () => {
  const { contributions } = await svc();
  const logit = (p: number) => Math.log(p / (1 - p));
  const s = sample(1, 1, [
    adj('NEWSAPI', 'Reuters', 0.1, { signalId: 'a', clusterId: 'c1' }),
    adj('NEWSAPI', 'AP', 0.3, { signalId: 'b', clusterId: 'c1' }),
    adj('GDELT', 'example.com', 0.9, { signalId: 'c' }),
  ], { baseRate: 0.5 });
  const c = contributions(s);
  assert.equal(c.length, 2);
  const cluster = c.find((x) => x.sourceKey === 'source:NEWSAPI')!;
  close(cluster.x, logit(0.7) - logit(0.5));
  assert.equal(cluster.publisherKey, 'publisher:reuters', 'attributed to the smallest signalId');
  const clamped = c.find((x) => x.sourceKey === 'source:GDELT')!;
  close(clamped.x, logit(0.98) - logit(0.5));
});

test('time weights give each market total weight 1 and drop post-resolution traces', async () => {
  const { weightSamplesFromRows } = await svc();
  const at = (min: number) => new Date(Date.parse('2026-09-01T00:00:00Z') + min * 60_000);
  const base = { category: 'FED', o: 1 as const, baseRate: 0.4, weightSetVersion: 0, adjustments: [adj('FRED', 'FRED', 0.1)], resolvedAt: at(100) };
  const out = weightSamplesFromRows([
    { ...base, marketId: 'm1', traceId: 't1', createdAt: at(0) },
    { ...base, marketId: 'm1', traceId: 't2', createdAt: at(75) },
    { ...base, marketId: 'm1', traceId: 't3', createdAt: at(120) },
    { ...base, marketId: 'm2', traceId: 't4', createdAt: at(50) },
  ]);
  const w = Object.fromEntries(out.map((s) => [s.traceId, s.w]));
  close(w.t1, 0.75);
  close(w.t2, 0.25);
  assert.equal(w.t3, undefined);
  close(w.t4, 1);
});

test('loadWeightSamples skips traces without adjustments and counts unresolved signal ids', async () => {
  const { loadWeightSamples, llmDetail } = await svc();
  const at = (min: number) => new Date(Date.parse('2026-09-01T00:00:00Z') + min * 60_000);
  const llm = (adjustments: unknown[]) => [
    { model: 'base-rate', p: 0.4, detail: {} },
    { model: 'llm:anthropic:claude', p: 0.6, detail: { baseRate: 0.4, adjustments } },
  ];
  const rows = [
    { traceId: 't1', marketId: 'm1', category: 'FED', createdAt: at(0), resolvedAt: at(100), o: 1, weightSetVersion: null,
      members: llm([{ signal_id: 's1', signalId: 'fred-1', delta: 0.1 }, { signal_id: 's2', signalId: 'gone', delta: 0.2 }, { signal_id: 's3', signalId: null, delta: 0.1 }]) },
    { traceId: 't2', marketId: 'm2', category: 'MACRO', createdAt: at(0), resolvedAt: at(100), o: 0, weightSetVersion: 2, members: null },
    { traceId: 't3', marketId: 'm3', category: 'MACRO', createdAt: at(0), resolvedAt: at(100), o: 0, weightSetVersion: 2, members: llm([]) },
  ];
  const db = {
    $queryRaw: async () => rows,
    signal: { findMany: async () => [{ id: 'fred-1', source: 'FRED', publisher: 'FRED', clusterId: 'fred-1' }] },
  };
  const { samples, counts } = await loadWeightSamples(db as any, null);
  assert.deepEqual(counts, { traces: 3, tracesWithoutAdjustments: 2, adjustments: 3, unresolvedAdjustments: 2 });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].weightSetVersion, 0, 'null version maps to v0');
  assert.deepEqual(samples[0].adjustments, [{ signalId: 'fred-1', delta: 0.1, source: 'FRED', publisher: 'FRED', clusterId: null }]);
  assert.equal(llmDetail([{ model: 'base-rate', detail: { baseRate: 0.3, adjustments: [{ delta: 0.1 }] } }]), null, 'only the LLM member counts');
});

// ─── runtime ─────────────────────────────────────────────────────────────────

test('with no active set the compiled table applies and relevanceScore equals today\'s values', async () => {
  const { getActiveWeightTable } = await svc();
  const { relevanceScore, sourceWeight } = await import('../src/services/signal-normalize');
  const { SOURCE_WEIGHTS } = await import('../src/services/market-policy');
  const table = await getActiveWeightTable({ load: async () => null });
  assert.deepEqual({ id: table.id, version: table.version }, { id: null, version: 0 });
  const now = new Date('2026-10-18T12:00:00Z');
  const ages = [new Date('2026-10-18T11:00:00Z'), new Date('2026-10-17T02:00:00Z')];
  for (const source of [...Object.keys(SOURCE_WEIGHTS), 'UNKNOWN', 'newsapi']) {
    for (const publisher of [null, 'Reuters', 'FRED']) {
      assert.equal(sourceWeight(source, publisher, table), sourceWeight(source));
      for (const age of ages) {
        for (const size of [1, 3]) assert.equal(relevanceScore(source, age, size, now, table, publisher), relevanceScore(source, age, size, now));
      }
    }
  }
  const failing = await getActiveWeightTable({ load: async () => { throw new Error('db down'); } });
  assert.equal(failing.version, 0, 'a failed lookup falls back to the compiled table');
});

test('the active set is served with publisher > source > 0.5 precedence', async () => {
  const { getActiveWeightTable } = await svc();
  const { sourceWeight } = await import('../src/services/signal-normalize');
  const table = await getActiveWeightTable({
    load: async () => ({ id: 'set-4', version: 4, weights: { 'source:NEWSAPI': 0.64, 'publisher:reuters': 0.81, 'source:BAD': 'x' } }),
  });
  assert.deepEqual({ id: table.id, version: table.version }, { id: 'set-4', version: 4 });
  assert.equal(sourceWeight('NEWSAPI', ' Reuters ', table), 0.81);
  assert.equal(sourceWeight('newsapi', 'AP', table), 0.64);
  assert.equal(sourceWeight('NEWSAPI', null, table), 0.64);
  assert.equal(sourceWeight('GDELT', null, table), 0.5);
  assert.equal(sourceWeight('BAD', null, table), 0.5, 'non-numeric weights are dropped');
});

test('diffWeights lists every key of either set', async () => {
  const { diffWeights } = await svc();
  assert.deepEqual(diffWeights({ 'source:A': 0.5, 'source:B': 0.7 }, { 'source:A': 0.6, 'publisher:x': 0.9 }), [
    { key: 'source:A', from: 0.5, to: 0.6, delta: 0.1 },
    { key: 'source:B', from: 0.7, to: null, delta: null },
    { key: 'publisher:x', from: null, to: 0.9, delta: null },
  ]);
});

test('agents.weights.approve exists and is granted to super_admin only', async () => {
  await svc();
  const { ADMIN_PERMISSIONS } = await import('../src/services/admin-rbac.service');
  assert.ok((ADMIN_PERMISSIONS as readonly string[]).includes('agents.weights.approve'));
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const src = readFileSync(join(__dirname, '..', '..', 'src', 'services', 'admin-rbac.service.ts'), 'utf8');
  const roles = src.slice(src.indexOf('operator: ['), src.indexOf('const ROLE_DESCRIPTIONS'));
  assert.ok(!roles.includes('agents.weights.approve'), 'operator and auditor lists do not grant it');
});

test('source weight routes require the permission, step-up and opt out of the generic audit', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const routes = readFileSync(join(__dirname, '..', '..', 'src', 'routes', 'admin.routes.ts'), 'utf8');
  for (const path of ["'/source-weights/:id/approve'", "'/source-weights/:id/activate'", "'/source-weights/rollback'"]) {
    const line = routes.split('\n').find((l) => l.includes(path));
    assert.ok(line, path);
    assert.match(line!, /requirePermission\('agents\.weights\.approve', \{ audit: false \}\), requireStepUp,/);
  }
});

function close(a: number, b: number, eps = 1e-9) {
  assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);
}
