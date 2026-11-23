import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('decomposeBuyShortfall inverts FPMM buy and decomposes shortfall exactly (#295)', async () => {
  const { decomposeBuyShortfall } = await import('../src/services/execution-quality.service');
  const { calcBuy, priceYesBps } = await import('../src/generated/fpmm');

  const preYes = 10_000_000_000n; // 1000 USDC
  const preNo = 10_000_000_000n;  // 1000 USDC (5000 bps)
  const collateral = 1_000_000_000n; // 100 USDC
  const feeBps = 100n;

  const buy = calcBuy(preYes, preNo, collateral, feeBps);
  assert.equal(Number(priceYesBps(preYes, preNo)), 5000);

  const res = decomposeBuyShortfall({
    direction: 'YES',
    collateral,
    shares: buy.sharesOut,
    fee: buy.fee,
    postReserveYes: buy.newReserveBought,
    postReserveNo: buy.newReserveOther,
    decisionMidBps: 4950,
    quoteMidBps: 4980,
  });

  assert.equal(res.preReserveYes, preYes);
  assert.equal(res.preReserveNo, preNo);
  assert.equal(res.preMidBps, 5000);
  assert.equal(res.liquidityBucket, 'MEDIUM');
  assert.ok(res.impactBps > 0, 'impactBps should be positive');
  assert.ok(res.feeBps > 0, 'feeBps should be positive');
  assert.equal(res.delayBps, 30);    // 4980 - 4950
  assert.equal(res.residualBps, 20); // 5000 - 4980
  assert.equal(
    res.delayBps + res.impactBps + res.feeBps + res.residualBps,
    res.totalShortfallBps,
  );
});

test('decomposeSellShortfall inverts FPMM sell and decomposes shortfall exactly (#295)', async () => {
  const { decomposeSellShortfall } = await import('../src/services/execution-quality.service');
  const { calcSell } = await import('../src/generated/fpmm');

  const preYes = 2_000_000_000n; // 200 USDC
  const preNo = 2_000_000_000n;  // 200 USDC (< 500 USDC total -> THIN)
  const collateralOut = 200_000_000n; // 20 USDC
  const feeBps = 100n;

  const sell = calcSell(preYes, preNo, collateralOut, feeBps);

  const res = decomposeSellShortfall({
    direction: 'YES',
    collateral: collateralOut,
    shares: sell.sharesIn,
    fee: sell.fee,
    postReserveYes: sell.newReserveSold,
    postReserveNo: sell.newReserveOther,
    decisionMidBps: 5050,
    quoteMidBps: 5020,
  });

  assert.equal(res.preReserveYes, preYes);
  assert.equal(res.preReserveNo, preNo);
  assert.equal(res.liquidityBucket, 'THIN');
  assert.ok(res.impactBps > 0);
  assert.ok(res.feeBps > 0);
  assert.equal(
    res.delayBps + res.impactBps + res.feeBps + res.residualBps,
    res.totalShortfallBps,
  );
});

test('aggregateExecutionQuality counts SlippageExceeded per bound and recommends slippage bounds (#295)', async () => {
  const { aggregateExecutionQuality } = await import('../src/services/execution-quality.service');

  const summary = aggregateExecutionQuality([
    {
      status: 'CONFIRMED',
      liquidityBucket: 'THIN',
      slippageBoundBps: 100,
      delayBps: 10,
      impactBps: 120,
      feeBps: 100,
      residualBps: 30,
      totalShortfallBps: 260,
    },
    {
      status: 'SLIPPAGE_EXCEEDED',
      liquidityBucket: 'THIN',
      slippageBoundBps: 100,
      delayBps: null,
      impactBps: null,
      feeBps: null,
      residualBps: null,
      totalShortfallBps: null,
    },
    {
      status: 'CONFIRMED',
      liquidityBucket: 'DEEP',
      slippageBoundBps: 100,
      delayBps: 0,
      impactBps: 10,
      feeBps: 100,
      residualBps: 5,
      totalShortfallBps: 115,
    },
  ]);

  assert.equal(summary.totalReports, 3);
  const thin = summary.buckets.find((b) => b.bucket === 'THIN')!;
  assert.equal(thin.confirmedCount, 1);
  assert.equal(thin.slippageExceededCount, 1);
  assert.equal(thin.slippageExceededByBound['100'], 1);
  assert.equal(thin.recommendedSlippageBps, 175); // 120 + 30 + 25 = 175

  const deep = summary.buckets.find((b) => b.bucket === 'DEEP')!;
  assert.equal(deep.confirmedCount, 1);
  assert.equal(deep.recommendedSlippageBps, 50); // min 50 bps
});
