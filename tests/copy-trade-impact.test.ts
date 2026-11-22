import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('computeCopyTradeImpact computes exact BigInt FPMM quote, impact, and maxSize bounds', async () => {
  const { computeCopyTradeImpact } = await import('../src/services/copy-trade-impact.service');
  const { calcBuy, priceYesBps, BPS } = await import('../src/generated/fpmm');

  // Pool at 50% (1000 USDC YES, 1000 USDC NO), 100 bps (1%) fee
  const reserveYes = 10_000_000_000n; // 1000 USDC
  const reserveNo = 10_000_000_000n;  // 1000 USDC
  const feeBps = 100n;
  const agentProbBps = 5500n; // 55% YES -> 500 bps edge
  const collateralInRaw = 2_000_000_000n; // 200 USDC

  const impact = computeCopyTradeImpact({
    direction: 'YES',
    collateralInRaw,
    agentProbBps,
    pool: {
      reserveYes,
      reserveNo,
      feeBps,
      asOfLedger: 12345,
      source: 'indexed',
      lagLedgers: 1,
    },
    recentFlow: {
      windowMinutes: 60,
      traceConfirmedVolumeRaw: '500000000',
      traceConfirmedCount: 2,
      marketConfirmedVolumeRaw: '1500000000',
      marketConfirmedCount: 4,
    },
    maxImpactBps: 2000,
  });

  assert.equal(impact.outcome, 'YES');
  assert.equal(impact.midPriceBps, 5000);
  assert.equal(impact.agentSideProbBps, 5500);
  assert.equal(impact.pool.asOfLedger, 12345);
  assert.equal(impact.recentFlow.traceConfirmedCount, 2);

  // Verify maxSizeRaw keeps postPriceBps <= agentSideProbBps (5500)
  const maxSize = BigInt(impact.maxSizeRaw);
  assert.ok(maxSize > 0n);
  const atMax = calcBuy(reserveYes, reserveNo, maxSize, feeBps);
  const postAtMax = priceYesBps(atMax.newReserveBought, atMax.newReserveOther);
  assert.ok(postAtMax <= agentProbBps, `postAtMax=${postAtMax} must be <= ${agentProbBps}`);

  // One unit larger should exceed or equal the boundary
  const aboveMax = calcBuy(reserveYes, reserveNo, maxSize + 100_000n, feeBps);
  const postAboveMax = priceYesBps(aboveMax.newReserveBought, aboveMax.newReserveOther);
  assert.ok(postAboveMax >= postAtMax);

  // Verify maxSizeAvgEdgeRaw keeps avgPriceBps < agentSideProbBps
  const maxAvg = BigInt(impact.maxSizeAvgEdgeRaw);
  assert.ok(maxAvg >= maxSize, 'average price lags marginal post-trade price, so maxSizeAvgEdgeRaw >= maxSizeRaw');
  const atMaxAvg = calcBuy(reserveYes, reserveNo, maxAvg, feeBps);
  const avgBpsAtMax = (maxAvg * BPS + atMaxAvg.sharesOut - 1n) / atMaxAvg.sharesOut;
  assert.ok(avgBpsAtMax < agentProbBps, `avgBpsAtMax=${avgBpsAtMax} must be < ${agentProbBps}`);
});

test('computeCopyTradeImpact flags exceedsMaxImpact when impactBps > maxImpactBps', async () => {
  const { computeCopyTradeImpact } = await import('../src/services/copy-trade-impact.service');

  const impact = computeCopyTradeImpact({
    direction: 'NO',
    collateralInRaw: 5_000_000_000n, // 500 USDC on 1000 USDC pool
    agentProbBps: 3000n, // agent says 30% YES -> 70% NO
    pool: {
      reserveYes: 10_000_000_000n,
      reserveNo: 10_000_000_000n,
      feeBps: 100n,
      asOfLedger: 99,
      source: 'rpc',
      lagLedgers: 0,
    },
    recentFlow: {
      windowMinutes: 60,
      traceConfirmedVolumeRaw: '0',
      traceConfirmedCount: 0,
      marketConfirmedVolumeRaw: '0',
      marketConfirmedCount: 0,
    },
    maxImpactBps: 100, // 1% max impact
  });

  assert.ok(impact.impactBps > 100);
  assert.equal(impact.exceedsMaxImpact, true);
  assert.equal(impact.maxImpactBps, 100);
});
