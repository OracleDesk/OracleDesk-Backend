/**
 * Risk parameter schemas and hashing (#274).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('schema rejects maxSinglePositionPct above 0.05', async () => {
  const { TraderParamsV1 } = await import('../src/lib/risk-params');
  const base = (await import('../src/lib/risk-params')).compiledTraderParamsV1();
  assert.throws(() => TraderParamsV1.parse({ ...base, maxSinglePositionPct: 0.06 }));
});

test('schema rejects minConservativeEdge above minEdge', async () => {
  const { TraderParamsV1, compiledTraderParamsV1 } = await import('../src/lib/risk-params');
  const base = compiledTraderParamsV1();
  assert.throws(() => TraderParamsV1.parse({ ...base, minConservativeEdge: base.minEdge + 0.01 }));
});

test('same params produce the same hash regardless of key order', async () => {
  const { compiledTraderParamsV1, traderParamsHash } = await import('../src/lib/risk-params');
  const a = compiledTraderParamsV1();
  const b = { ...a, minEdge: a.minEdge };
  assert.equal(traderParamsHash(a), traderParamsHash(b));
  const reversed = JSON.parse(JSON.stringify(a));
  const keys = Object.keys(reversed).reverse();
  const shuffled: Record<string, unknown> = {};
  for (const k of keys) shuffled[k] = reversed[k];
  const { TraderParamsV1: Schema } = await import('../src/lib/risk-params');
  assert.equal(traderParamsHash(a), traderParamsHash(Schema.parse(shuffled)));
});