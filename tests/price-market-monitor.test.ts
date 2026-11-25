import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

import { resolutionHash } from '../src/lib/resolution-spec';
import {
  evaluateFeedHealth,
  captureCloseSnapshot,
  checkPriceMarketFeed,
} from '../src/services/price-feed-monitor.service';
import {
  expectedOutcome,
  verifyPriceResolution,
} from '../src/services/price-resolution-verifier.service';
import { AlertService, type Alert, type AlertSink } from '../src/services/alerts.service';
import type { ReflectorReader } from '../src/services/price-resolution.service';

const REFLECTOR = 'CDDJU3PH6T3Z4O6EYLALXXB5XBFPYO2G5P5RBDEIZ7ZVN6V37OQSVYGR';

const PRICE_SPEC = {
  kind: 'price' as const,
  reflector: REFLECTOR,
  asset: { kind: 'other' as const, symbol: 'BTC' },
  threshold: '100000000000', // 100,000 * 10^6
  direction: 'AtOrAbove' as const,
  maxStaleness: 900,
};

function makeReader(over: Partial<ReflectorReader> = {}): ReflectorReader {
  return {
    decimals: async () => 6,
    supports: async () => true,
    lastPrice: async () => ({ price: 105_000_000_000n, timestamp: 1_700_000_000n }),
    resolution: async () => 300,
    price: async (_c, _a, ts) => ({ price: 105_000_000_000n, timestamp: ts }),
    latestLedger: async () => ({ sequence: 500_000, closeTime: 1_700_000_100n }),
    ...over,
  };
}

class MemorySink implements AlertSink {
  sent: Alert[] = [];
  constructor(public readonly name = 'mem') {}
  async send(alert: Alert): Promise<void> {
    this.sent.push(alert);
  }
}

test('expectedOutcome matches exact resolver i128 comparisons across all 4 directions', () => {
  assert.equal(expectedOutcome(101n, 100n, 'Above'), 'Yes');
  assert.equal(expectedOutcome(100n, 100n, 'Above'), 'No');
  assert.equal(expectedOutcome(100n, 100n, 'AtOrAbove'), 'Yes');
  assert.equal(expectedOutcome(99n, 100n, 'AtOrAbove'), 'No');
  assert.equal(expectedOutcome(99n, 100n, 'Below'), 'Yes');
  assert.equal(expectedOutcome(100n, 100n, 'Below'), 'No');
  assert.equal(expectedOutcome(100n, 100n, 'AtOrBelow'), 'Yes');
  assert.equal(expectedOutcome(101n, 100n, 'AtOrBelow'), 'No');
});

test('evaluateFeedHealth classifies OK, WARN and CRITICAL conditions accurately', () => {
  const base = {
    marketId: 'm-1',
    supported: true,
    lastTs: 1_700_000_000n,
    ledgerCloseTime: 1_700_000_100n,
    maxStaleness: 900,
    secsToClose: 20_000,
    closeWindowSecs: 7_200,
    decimalsNow: 6,
    decimalsAtCreation: 6,
    resolutionNow: 300,
    resolutionAtCreation: 300,
    gapSlots: 0,
  };

  const ok = evaluateFeedHealth(base);
  assert.equal(ok.severity, 'OK');
  assert.deepEqual(ok.reasons, []);

  const aging = evaluateFeedHealth({ ...base, ledgerCloseTime: 1_700_000_600n });
  assert.equal(aging.severity, 'WARN');
  assert.ok(aging.reasons.includes('FEED_AGING'));

  const gaps = evaluateFeedHealth({ ...base, gapSlots: 2 });
  assert.equal(gaps.severity, 'WARN');
  assert.ok(gaps.reasons.includes('GRID_GAPS'));

  const resChanged = evaluateFeedHealth({ ...base, resolutionNow: 600 });
  assert.equal(resChanged.severity, 'WARN');
  assert.equal(resChanged.resolutionChanged, true);
  assert.ok(resChanged.reasons.includes('RESOLUTION_CHANGED'));

  const decimalsChanged = evaluateFeedHealth({ ...base, decimalsNow: 8 });
  assert.equal(decimalsChanged.severity, 'CRITICAL');
  assert.equal(decimalsChanged.decimalsChanged, true);
  assert.ok(decimalsChanged.reasons.includes('DECIMALS_CHANGED'));

  const unsupported = evaluateFeedHealth({ ...base, supported: false });
  assert.equal(unsupported.severity, 'CRITICAL');
  assert.ok(unsupported.reasons.includes('FEED_UNSUPPORTED'));

  const staleNearClose = evaluateFeedHealth({
    ...base,
    ledgerCloseTime: 1_700_001_500n,
    secsToClose: 3_600,
  });
  assert.equal(staleNearClose.severity, 'CRITICAL');
  assert.ok(staleNearClose.reasons.includes('STALE_NEAR_CLOSE'));
});

test('captureCloseSnapshot stores close_time + k=3 neighbours and is idempotent', async () => {
  const created: any[] = [];
  const fakePrisma: any = {
    priceCloseSnapshot: {
      findUnique: async ({ where }: any) => created.find((r) => r.marketId === where.marketId) ?? null,
      create: async ({ data }: any) => {
        const row = { id: 'snap-1', readAt: new Date(), ...data };
        created.push(row);
        return row;
      },
    },
  };

  const closeTime = 1_700_000_000n;
  const market = {
    id: 'm-snap',
    expiryTimestamp: new Date(Number(closeTime) * 1000),
    resolutionSpec: PRICE_SPEC,
  };

  const first = await captureCloseSnapshot(market, { prisma: fakePrisma, reader: makeReader() });
  assert.ok(first);
  assert.equal(created.length, 1);
  assert.equal((first!.records as any[]).length, 4);
  assert.equal((first!.records as any[])[0].requestedTs, closeTime.toString());
  assert.equal((first!.records as any[])[3].requestedTs, (closeTime - 900n).toString());

  // Second call returns the existing snapshot without re-creating
  const second = await captureCloseSnapshot(market, { prisma: fakePrisma, reader: makeReader() });
  assert.equal(second?.id, 'snap-1');
  assert.equal(created.length, 1);
});

test('verifyPriceResolution detects CONSISTENT, OUTCOME_MISMATCH, PRICE_MISMATCH, OUTLIER and UNVERIFIABLE', async () => {
  const hashHex = resolutionHash(PRICE_SPEC).toString('hex');
  const closeTime = 1_700_000_000n;

  async function runCase(opts: {
    eventPrice: bigint;
    eventTs?: bigint;
    eventOutcome: 'Yes' | 'No';
    snapshotRecords: Array<{ requestedTs: string; price: string | null; timestamp: string | null }> | null;
    livePrice?: bigint | null;
  }) {
    const checks: any[] = [];
    const deliveries: any[] = [];
    const sink = new MemorySink();
    const fakePrisma: any = {
      chainEvent: {
        findUnique: async () => ({
          id: 'evt-1',
          params: {
            market_id: '42',
            price: opts.eventPrice.toString(),
            price_timestamp: (opts.eventTs ?? closeTime).toString(),
            outcome: { tag: opts.eventOutcome },
          },
        }),
      },
      market: {
        findUnique: async () => ({
          id: 'm-42',
          onChainMarketId: 42n,
          expiryTimestamp: new Date(Number(closeTime) * 1000),
          resolutionHash: hashHex,
          resolutionSpec: PRICE_SPEC,
        }),
      },
      priceCloseSnapshot: {
        findUnique: async () =>
          opts.snapshotRecords ? { closeTime, records: opts.snapshotRecords, ledger: 500_000 } : null,
      },
      priceResolutionCheck: {
        upsert: async ({ create }: any) => {
          checks.push(create);
          return create;
        },
      },
      alertDelivery: {
        findUnique: async ({ where }: any) => deliveries.find((d) => d.dedupeKey === where.dedupeKey) ?? null,
        upsert: async ({ create }: any) => {
          deliveries.push(create);
          return create;
        },
      },
    };
    const { prisma: globalPrisma } = await import('../src/lib/prisma');
    const prevFindUnique = (globalPrisma.alertDelivery as any).findUnique;
    const prevUpsert = (globalPrisma.alertDelivery as any).upsert;
    (globalPrisma.alertDelivery as any).findUnique = fakePrisma.alertDelivery.findUnique;
    (globalPrisma.alertDelivery as any).upsert = fakePrisma.alertDelivery.upsert;

    try {
      const result = await verifyPriceResolution('evt-1', {
        prisma: fakePrisma,
        reader: makeReader({
          price: async (_c, _a, ts) =>
            opts.livePrice === null ? null : { price: opts.livePrice ?? opts.eventPrice, timestamp: ts },
        }),
        alerts: new AlertService({ sinks: [sink], sleep: async () => undefined }),
        outlierBps: 500,
      });
      return { result, sink, checks };
    } finally {
      (globalPrisma.alertDelivery as any).findUnique = prevFindUnique;
      (globalPrisma.alertDelivery as any).upsert = prevUpsert;
    }
  }

  // 1. CONSISTENT
  const consistent = await runCase({
    eventPrice: 105_000_000_000n,
    eventOutcome: 'Yes',
    snapshotRecords: [
      { requestedTs: closeTime.toString(), price: '105000000000', timestamp: closeTime.toString() },
      { requestedTs: (closeTime - 300n).toString(), price: '104800000000', timestamp: (closeTime - 300n).toString() },
      { requestedTs: (closeTime - 600n).toString(), price: '104900000000', timestamp: (closeTime - 600n).toString() },
      { requestedTs: (closeTime - 900n).toString(), price: '105100000000', timestamp: (closeTime - 900n).toString() },
    ],
  });
  assert.equal(consistent.result.verdict, 'CONSISTENT');
  assert.equal(consistent.sink.sent.length, 0);

  // 2. OUTCOME_MISMATCH
  const outcomeMismatch = await runCase({
    eventPrice: 105_000_000_000n,
    eventOutcome: 'No',
    snapshotRecords: [
      { requestedTs: closeTime.toString(), price: '105000000000', timestamp: closeTime.toString() },
    ],
  });
  assert.equal(outcomeMismatch.result.verdict, 'OUTCOME_MISMATCH');
  assert.equal(outcomeMismatch.sink.sent.length, 1);
  assert.equal(outcomeMismatch.sink.sent[0].kind, 'price_verify');

  // 3. PRICE_MISMATCH
  const priceMismatch = await runCase({
    eventPrice: 105_000_000_000n,
    eventOutcome: 'Yes',
    snapshotRecords: [
      { requestedTs: closeTime.toString(), price: '102000000000', timestamp: closeTime.toString() },
    ],
  });
  assert.equal(priceMismatch.result.verdict, 'PRICE_MISMATCH');
  assert.equal(priceMismatch.sink.sent.length, 1);

  // 4. OUTLIER flipping outcome (neighbours ~95k -> No, event 105k -> Yes, >10% deviation across 100k threshold)
  const outlier = await runCase({
    eventPrice: 105_000_000_000n,
    eventOutcome: 'Yes',
    snapshotRecords: [
      { requestedTs: closeTime.toString(), price: '105000000000', timestamp: closeTime.toString() },
      { requestedTs: (closeTime - 300n).toString(), price: '95000000000', timestamp: (closeTime - 300n).toString() },
      { requestedTs: (closeTime - 600n).toString(), price: '95100000000', timestamp: (closeTime - 600n).toString() },
      { requestedTs: (closeTime - 900n).toString(), price: '94900000000', timestamp: (closeTime - 900n).toString() },
    ],
  });
  assert.equal(outlier.result.verdict, 'OUTLIER');
  assert.equal(outlier.sink.sent.length, 1);
  assert.ok(typeof outlier.result.detail.distanceToThresholdBps === 'number');

  // 5. UNVERIFIABLE when snapshot missing and live Reflector history aged out
  const unverifiable = await runCase({
    eventPrice: 105_000_000_000n,
    eventOutcome: 'Yes',
    snapshotRecords: null,
    livePrice: null,
  });
  assert.equal(unverifiable.result.verdict, 'UNVERIFIABLE');
  assert.equal(unverifiable.sink.sent.length, 0);
});

test('checkPriceMarketFeed persists transitions and alerts only on severity increase', async () => {
  const rows: any[] = [];
  const marketUpdates: any[] = [];
  const sink = new MemorySink();
  const fakePrisma: any = {
    market: {
      update: async ({ data }: any) => {
        marketUpdates.push(data);
        return data;
      },
    },
    priceFeedCheck: {
      findFirst: async () => (rows.length ? rows[rows.length - 1] : null),
      create: async ({ data }: any) => {
        const row = { id: `chk-${rows.length + 1}`, checkedAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        Object.assign(rows[idx], data);
        return rows[idx];
      },
    },
  };

  const { prisma: globalPrisma } = await import('../src/lib/prisma');
  const deliveries: any[] = [];
  const prevFindUnique = (globalPrisma.alertDelivery as any).findUnique;
  const prevUpsert = (globalPrisma.alertDelivery as any).upsert;
  (globalPrisma.alertDelivery as any).findUnique = async ({ where }: any) =>
    deliveries.find((d) => d.dedupeKey === where.dedupeKey) ?? null;
  (globalPrisma.alertDelivery as any).upsert = async ({ create }: any) => {
    deliveries.push(create);
    return create;
  };

  try {
    const market = {
      id: 'm-mon',
      onChainMarketId: 9n,
      expiryTimestamp: new Date((1_700_000_100 + 3600) * 1000),
      resolutionSpec: PRICE_SPEC,
      resolutionDetails: null, // triggers lazy backfill with inferred: true
    };
    const alerts = new AlertService({ sinks: [sink], sleep: async () => undefined });

    // Pass 1: OK -> creates 1 row, lazily backfills creation facts, no alert
    const r1 = await checkPriceMarketFeed(market, { prisma: fakePrisma, reader: makeReader(), alerts });
    assert.equal(r1.health.severity, 'OK');
    assert.equal(rows.length, 1);
    assert.equal(marketUpdates.length, 1);
    assert.equal(marketUpdates[0].resolutionDetails.price.inferred, true);
    assert.equal(sink.sent.length, 0);

    // Pass 2: still OK -> updates in place (still 1 row)
    market.resolutionDetails = marketUpdates[0].resolutionDetails;
    await checkPriceMarketFeed(market, { prisma: fakePrisma, reader: makeReader(), alerts });
    assert.equal(rows.length, 1);

    // Pass 3: decimals changed -> transitions to CRITICAL (2nd row) and sends price_feed alert
    const r3 = await checkPriceMarketFeed(market, {
      prisma: fakePrisma,
      reader: makeReader({ decimals: async () => 8 }),
      alerts,
    });
    assert.equal(r3.health.severity, 'CRITICAL');
    assert.equal(r3.escalated, true);
    assert.equal(rows.length, 2);
    assert.equal(sink.sent.length, 1);
    assert.equal(sink.sent[0].kind, 'price_feed');
  } finally {
    (globalPrisma.alertDelivery as any).findUnique = prevFindUnique;
    (globalPrisma.alertDelivery as any).upsert = prevUpsert;
  }
});
