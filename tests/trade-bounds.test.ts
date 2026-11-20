import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

// #245 — execution bounds mirrored from market-core buy_within_limit / sell_within_limit.

test('buy_within_limit boundary: equality passes, one unit over fails', async () => {
  const { buyWithinLimit } = await import('../src/services/trade-bounds');
  // 600 collateral for 1000 shares = 6000 bps average price.
  assert.equal(buyWithinLimit(600n, 1000n, 6000), true);
  assert.equal(buyWithinLimit(601n, 1000n, 6000), false);
  assert.equal(buyWithinLimit(600n, 1000n, 0), false, 'a 0 limit is never treated as "no limit"');
});

test('sell_within_limit boundary', async () => {
  const { sellWithinLimit } = await import('../src/services/trade-bounds');
  assert.equal(sellWithinLimit(400n, 1000n, 4000), true);
  assert.equal(sellWithinLimit(399n, 1000n, 4000), false);
});

test('buyLimitBps: conservative prob minus minEdge, clamped; zero edge means no trade', async () => {
  const { buyLimitBps } = await import('../src/services/trade-bounds');
  assert.equal(buyLimitBps({ conservativeProb: 0.58, minEdge: 0.08 }), 5000);
  // NO side: the caller passes 1 − upper.
  assert.equal(buyLimitBps({ conservativeProb: 1 - 0.3, minEdge: 0.08 }), 6200);
  assert.equal(buyLimitBps({ conservativeProb: 0.08, minEdge: 0.08 }), 0);
  assert.equal(buyLimitBps({ conservativeProb: 2, minEdge: 0 }), 10_000);
});

test('deadline = close time + bounded TTL; strict > like the contract', async () => {
  const { deadlineFor, deadlinePassed } = await import('../src/services/trade-bounds');
  assert.equal(deadlineFor({ closeTime: 1000, ttlSecs: 60 }), 1060n);
  assert.equal(deadlineFor({ closeTime: 1000, ttlSecs: 10_000 }), 1300n, 'TTL capped at 300 s');
  assert.equal(deadlinePassed(1060n, 1060), false);
  assert.equal(deadlinePassed(1060n, 1061), true);
});

test('deadline and limit failures are attributed and never retried', async () => {
  const { attributeTradeBoundFailure, RETRY_POLICY } = await import('../src/services/stellar/failures');
  const base = { class: 'CONTRACT_ERROR' as const, txCode: null, opCode: null, contractError: null, txHash: null, submitted: false };
  assert.equal(attributeTradeBoundFailure(base, { diagnosticContractCodes: [19] }).class, 'DEADLINE_EXPIRED');
  assert.equal(attributeTradeBoundFailure(base, { diagnosticContractCodes: [20] }).class, 'LIMIT_PRICE');
  assert.equal(attributeTradeBoundFailure(base, { deadline: 100n, ledgerCloseTime: 101 }).class, 'DEADLINE_EXPIRED');
  assert.equal(attributeTradeBoundFailure(base, { limitRecheckFailed: true }).class, 'LIMIT_PRICE');
  assert.equal(attributeTradeBoundFailure(base, {}).class, 'CONTRACT_ERROR');
  assert.equal(RETRY_POLICY.DEADLINE_EXPIRED, 'never');
  assert.equal(RETRY_POLICY.LIMIT_PRICE, 'never');
});
