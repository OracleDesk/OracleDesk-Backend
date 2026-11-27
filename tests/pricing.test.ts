import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('priceAt selects the schedule effective at the boundary', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const pricing = await import('../src/services/pricing');
  const original = prisma.priceSchedule.findMany;
  (prisma.priceSchedule.findMany as any) = async () => [
    { version: 1, dailyPassPriceRaw: '5000000', effectiveAt: new Date('2026-01-01T00:00:00Z') },
    { version: 2, dailyPassPriceRaw: '7000000', effectiveAt: new Date('2026-02-01T00:00:00Z') },
  ];
  try {
    pricing.invalidatePriceCache();
    const before = await pricing.priceAt(new Date('2026-01-31T23:59:59.999Z'));
    const boundary = await pricing.priceAt(new Date('2026-02-01T00:00:00Z'));
    assert.equal(before.version, 1);
    assert.equal(before.validUntil?.toISOString(), '2026-02-01T00:00:00.000Z');
    assert.equal(boundary.version, 2);
    assert.equal(boundary.dailyPassPriceRaw, 7_000_000n);
  } finally {
    (prisma.priceSchedule.findMany as any) = original;
    pricing.invalidatePriceCache();
  }
});
