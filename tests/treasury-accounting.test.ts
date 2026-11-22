import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';
import { readTreasuryAccounting, type AccountingReader } from '../src/services/treasury-accounting.service';
import { budgetSnapshot, readTreasuryBudget } from '../src/services/treasury-budget.service';

setupTestEnv();

function fakeReader(overrides: Partial<AccountingReader> = {}): AccountingReader {
  return {
    nav: async () => ({ value: 5_000_000_000n, ledger: 200 }),
    capitalBreakdown: async () => ({
      value: { liquid: 3_000_000_000n, yield_principal: 0n, yield_value: 0n },
      ledger: 200,
    }),
    liquidCapital: async () => ({ value: 3_000_000_000n, ledger: 200 }),
    dailyHeadroom: async () => ({ value: 1_500_000_000n, ledger: 200 }),
    netExposure: async () => ({ value: 2_000_000_000n, ledger: 200 }),
    queueReserved: async () => ({ value: 500_000_000n, ledger: 200 }),
    yieldVenue: async () => ({ value: null, ledger: 200 }),
    ...overrides,
  };
}

test('readTreasuryAccounting computes spendableRaw = max(0, liquid - queueReserved) and flags active yield venues (#299)', async () => {
  const acct = await readTreasuryAccounting({
    fresh: true,
    reader: fakeReader({
      capitalBreakdown: async () => ({
        value: { liquid: 3_000_000_000n, yield_principal: 1_000_000_000n, yield_value: 980_000_000n },
        ledger: 200,
      }),
      yieldVenue: async () => ({ value: { venue: 'CBLEND', enabled: true }, ledger: 200 }),
    }),
  });

  assert.equal(acct.ledger, 200);
  assert.equal(acct.spendableRaw, 2_500_000_000n);
  assert.equal(acct.yieldValueShares, 980_000_000n);
  assert.ok(acct.flags.includes('NAV_EXCLUDES_YIELD'));
  assert.ok(acct.flags.includes('YIELD_VALUE_IN_SHARES'));
  assert.ok(acct.flags.includes('AVAILABLE_MIXES_UNITS'));
});

test('readTreasuryAccounting falls back to liquid_capital and sets YIELD_READ_FAILED when capital_breakdown traps (#299)', async () => {
  const acct = await readTreasuryAccounting({
    fresh: true,
    reader: fakeReader({
      capitalBreakdown: async () => {
        throw new Error('BlendPositions decoding trap');
      },
      liquidCapital: async () => ({ value: 1_200_000_000n, ledger: 201 }),
      queueReserved: async () => ({ value: 200_000_000n, ledger: 201 }),
      nav: async () => ({ value: 1_000_000_000n, ledger: 201 }),
      dailyHeadroom: async () => ({ value: 800_000_000n, ledger: 201 }),
      netExposure: async () => ({ value: 0n, ledger: 201 }),
    }),
  });

  assert.equal(acct.liquidRaw, 1_200_000_000n);
  assert.equal(acct.spendableRaw, 1_000_000_000n);
  assert.equal(acct.yieldValueShares, null);
  assert.ok(acct.flags.includes('YIELD_READ_FAILED'));
});

test('readTreasuryAccounting retries when ledger skew exceeds ACCOUNTING_MAX_LEDGER_SKEW (#299)', async () => {
  let calls = 0;
  const acct = await readTreasuryAccounting({
    fresh: true,
    reader: fakeReader({
      nav: async () => {
        calls++;
        return { value: 5_000_000_000n, ledger: calls === 1 ? 200 : 210 };
      },
      queueReserved: async () => ({ value: 500_000_000n, ledger: calls === 1 ? 205 : 210 }),
      capitalBreakdown: async () => ({
        value: { liquid: 3_000_000_000n, yield_principal: 0n, yield_value: 0n },
        ledger: calls === 1 ? 200 : 210,
      }),
      dailyHeadroom: async () => ({ value: 1_500_000_000n, ledger: calls === 1 ? 200 : 210 }),
      netExposure: async () => ({ value: 2_000_000_000n, ledger: calls === 1 ? 200 : 210 }),
    }),
  });

  assert.equal(calls, 2);
  assert.equal(acct.ledger, 210);
});

test('readTreasuryBudget sizes from min(spendableRaw, dailyHeadroomRaw) and snapshots accounting fields (#299)', async () => {
  const b = await readTreasuryBudget({
    availableCapital: async () => 99_000_000_000n, // inflated by bToken shares; must not be used
    getConfig: async () => ({ max_trade: 500_000_000n, max_market: 2_000_000_000n, max_daily: 1_500_000_000n }),
    dailyUsage: async () => ({ amount: 300_000_000n, day_start: 1_700_000_000n }),
    accounting: async () => ({
      ledger: 300,
      navRaw: 4_000_000_000n,
      liquidRaw: 1_000_000_000n,
      yieldPrincipalRaw: 500_000_000n,
      yieldValueShares: 490_000_000n,
      queueReservedRaw: 400_000_000n,
      dailyHeadroomRaw: 1_200_000_000n,
      netExposureRaw: 2_500_000_000n,
      spendableRaw: 600_000_000n,
      flags: ['NAV_EXCLUDES_YIELD', 'YIELD_VALUE_IN_SHARES', 'AVAILABLE_MIXES_UNITS'],
    }),
  });

  assert.equal(b.spendableRaw, 600_000_000n);
  assert.equal(b.dailyHeadroomRaw, 1_200_000_000n);
  assert.equal(b.availableRaw, 600_000_000n); // min(spendable=600M, headroom=1200M)
  assert.equal(b.navRaw, 4_000_000_000n);
  assert.equal(b.queueReservedRaw, 400_000_000n);

  const snap = budgetSnapshot(b);
  assert.equal(snap.spendableRaw, '600000000');
  assert.equal(snap.navRaw, '4000000000');
  assert.equal(snap.queueReservedRaw, '400000000');
  assert.equal(snap.dailyHeadroomRaw, '1200000000');
  assert.deepEqual(snap.flags, ['NAV_EXCLUDES_YIELD', 'YIELD_VALUE_IN_SHARES', 'AVAILABLE_MIXES_UNITS']);
});
