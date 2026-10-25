import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';
import {
  createEmptyLot,
  applyBuy,
  applySell,
  applySettlement,
  applyRedeem,
  markToMarket,
  toBig,
  toDec,
  applyWalletEvent,
} from '../services/wallet-pnl.service';
import {
  calcBuy,
  calcSell,
  settleValue,
  priceYesBps,
  seedReserves,
} from '../generated/fpmm';
import { prisma } from '../lib/prisma';

setupTestEnv();

test('applyBuy adds shares, cost basis, fees, and bought volume', () => {
  const lot = createEmptyLot();
  const feeBps = 100n; // 1%
  const collateralIn = 10_000_000n; // 1 USDC (7 decimals)
  const quote = calcBuy(100_000_000n, 100_000_000n, collateralIn, feeBps);

  const updated = applyBuy(lot, collateralIn, quote.sharesOut, quote.fee);
  assert.equal(updated.shares, quote.sharesOut);
  assert.equal(updated.cost, collateralIn);
  assert.equal(updated.bought, collateralIn);
  assert.equal(updated.fees, quote.fee);
  assert.equal(updated.trades, 1);
  assert.equal(updated.realized, 0n);
});

test('applySell computes average-cost realized PnL correctly on partial sell', () => {
  let lot = createEmptyLot();
  // Buy 200 shares for 200 collateral (1 per share)
  lot = applyBuy(lot, 200n, 200n, 0n);

  // Sell 100 shares for 120 collateral (profit of 20)
  const { lot: updated, realized } = applySell(lot, 120n, 100n, 0n);

  assert.equal(updated.shares, 100n);
  assert.equal(updated.cost, 100n); // 200 - (200 * 100 / 200) = 100
  assert.equal(realized, 20n); // 120 - 100 = 20
  assert.equal(updated.realized, 20n);
  assert.equal(updated.sold, 120n);
  assert.equal(updated.trades, 2);
});

test('applySell on full liquidation clears shares and basis', () => {
  let lot = createEmptyLot();
  lot = applyBuy(lot, 500n, 500n, 5n);

  const { lot: updated, realized } = applySell(lot, 400n, 500n, 4n);

  assert.equal(updated.shares, 0n);
  assert.equal(updated.cost, 0n);
  assert.equal(realized, -100n); // 400 - 500 = -100
  assert.equal(updated.realized, -100n);
  assert.equal(updated.incomplete, false);
});

test('sell beyond known shares marks position incomplete instead of going negative', () => {
  let lot = createEmptyLot();
  lot = applyBuy(lot, 100n, 100n, 0n);

  // Attempt to sell 150 shares (50 more than owned)
  const { lot: updated, realized } = applySell(lot, 180n, 150n, 0n);

  assert.equal(updated.shares, 0n);
  assert.equal(updated.cost, 0n);
  assert.equal(updated.incomplete, true);
  assert.equal(realized, 80n); // 180 - 100 = 80
});

test('settlement Yes, No, and Void matches settle_value for combined position', () => {
  const yesLot = applyBuy(createEmptyLot(), 100n, 100n, 0n);
  const noLot = applyBuy(createEmptyLot(), 80n, 80n, 0n);

  // 1. Yes settlement
  const resYes = applySettlement(yesLot, noLot, 'yes');
  assert.equal(resYes.realized, (100n - 100n) + (0n - 80n)); // -80n

  // 2. No settlement
  const resNo = applySettlement(yesLot, noLot, 'no');
  assert.equal(resNo.realized, (0n - 100n) + (80n - 80n)); // -100n

  // 3. Void settlement: settle_value = (yes + no) / 2
  const resVoid = applySettlement(yesLot, noLot, 'void');
  const expectedSettleVal = settleValue('void', 100n, 80n);
  assert.equal(expectedSettleVal, 90n); // (100 + 80) / 2
  assert.equal(resVoid.realized, expectedSettleVal - (100n + 80n)); // 90 - 180 = -90
});

test('applyRedeem tracks payout in redeemed accumulator', () => {
  const lot = createEmptyLot();
  const redeemed = applyRedeem(lot, 250n);
  assert.equal(redeemed.redeemed, 250n);
});

test('markToMarket calculates mid and liquidation values', () => {
  let lot = createEmptyLot();
  lot = applyBuy(lot, 50n, 100n, 0n); // 100 shares

  const rYes = 100_000_000n;
  const rNo = 100_000_000n;

  // Mid price is 50%
  const midVal = markToMarket(lot, 'Yes', rYes, rNo, 'mid', 100);
  assert.equal(midVal, 50n); // 100 * 5000 / 10000 = 50

  // Liquidation value is > 0 and <= mid
  const liqVal = markToMarket(lot, 'Yes', rYes, rNo, 'liquidation', 100);
  assert.ok(liqVal > 0n);
  assert.ok(liqVal <= midVal);
});

test('toBig and toDec conversions preserve exact integers without floating drift', () => {
  const val = 12345678901234567890n;
  const dec = toDec(val);
  const back = toBig(dec);
  assert.equal(back, val);

  assert.equal(toBig('5000000'), 5000000n);
  assert.equal(toBig(null), 0n);
});
