import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

const USDC = 10_000_000n;

test('drawdown boundary is decided from raw collateral without float rounding', async () => {
  const { evaluateDailyDrawdown } = await import('../src/services/hedging.service');
  const bankrollRaw = 1_000n * USDC;
  const now = new Date('2026-10-18T12:00:00Z');

  assert.equal(evaluateDailyDrawdown([-300n * USDC + 1n], bankrollRaw, now).isPaused, false);
  assert.equal(evaluateDailyDrawdown([-300n * USDC], bankrollRaw, now).isPaused, true);
});

test('legacy stop-loss fallback compares integer basis points and ignores favorable moves', async () => {
  const { evaluateStopLoss } = await import('../src/services/hedging.service');

  assert.equal(evaluateStopLoss({ entryPriceBps: 5_000, currentPriceBps: 4_251, entryPrice: 0.5, currentPrice: 0.4251 }).shouldClose, false);
  assert.equal(evaluateStopLoss({ entryPriceBps: 5_000, currentPriceBps: 4_250, entryPrice: 0.5, currentPrice: 0.425 }).shouldClose, true);
  assert.equal(evaluateStopLoss({ entryPriceBps: 5_000, currentPriceBps: 5_750, entryPrice: 0.5, currentPrice: 0.575 }).shouldClose, false);
});

test('production hedge sizing uses raw cost basis and liquidation PnL', async () => {
  const { planHedges } = await import('../src/services/hedging.service');
  const [recommendation] = await planHedges([{
    marketId: 'original',
    category: 'CRYPTO',
    direction: 'YES',
    entryPrice: 0.5,
    currentPrice: 0.5,
    entryPriceBps: 5_000,
    currentPriceBps: 5_000,
    size: 100,
    sizeRaw: 100n * USDC,
    pnl: 0,
    costBasisRaw: 100n * USDC,
    unrealisedPnlRaw: -10n * USDC,
    edgeDetected: 0.2,
    edgeBps: 2_000,
  }], async () => ({ id: 'hedge-market' }));

  assert.equal(recommendation.hedgeSizeRaw, 50n * USDC);
  assert.equal(recommendation.hedgeSize, 50);
});
