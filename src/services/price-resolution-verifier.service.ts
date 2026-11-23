/**
 * Independent post-resolution verifier for Reflector price-mode markets (#309).
 *
 * `resolve_price` finalises immediately on-chain with no dispute window. When
 * the indexer stores a `PriceResolution` event, this verifier:
 *   1. reloads the committed spec and verifies its canonical hash against `Market.resolutionHash`,
 *   2. recomputes the exact expected outcome from `(event.price, spec.threshold, spec.direction)`,
 *   3. cross-checks `event.price` / `event.price_timestamp` against the close-time snapshot
 *      (falling back to a live Reflector query if no snapshot was captured),
 *   4. checks whether `event.price` is an outlier versus neighbouring grid records that
 *      flipped the outcome relative to their median,
 *   5. persists the verdict in `price_resolution_checks` and raises a CRITICAL alert
 *      on any mismatch or outcome-flipping outlier.
 */
import { Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma as defaultPrisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import {
  resolutionHash,
  validateResolutionSpec,
  type PriceDirectionName,
  type ResolutionSpecJson,
} from '../lib/resolution-spec';
import { AlertService } from './alerts.service';
import { reflectorReader, type ReflectorReader } from './price-resolution.service';
import { CLOSE_SNAPSHOT_NEIGHBOURS, type CloseSnapshotRecord } from './price-feed-monitor.service';

export type PriceDirection = PriceDirectionName;

export type VerifyVerdict =
  | 'CONSISTENT'
  | 'OUTCOME_MISMATCH'
  | 'PRICE_MISMATCH'
  | 'OUTLIER'
  | 'UNVERIFIABLE';

export interface VerifyResult {
  marketId: string;
  onChainMarketId: string;
  eventId: string;
  verdict: VerifyVerdict;
  detail: Record<string, unknown>;
}

export interface VerifyDeps {
  prisma?: typeof defaultPrisma;
  reader?: ReflectorReader;
  alerts?: AlertService;
  outlierBps?: number;
}

type PriceSpec = Extract<ResolutionSpecJson, { kind: 'price' }>;

function dbModels(db: typeof defaultPrisma) {
  return db as unknown as {
    chainEvent: typeof defaultPrisma.chainEvent;
    market: typeof defaultPrisma.market;
    priceCloseSnapshot: {
      findUnique(args: unknown): Promise<{ closeTime: bigint; records: unknown; ledger: number } | null>;
    };
    priceResolutionCheck: {
      findUnique(args: unknown): Promise<{ id: string; marketId: string; eventId: string; verdict: string; detail: unknown } | null>;
      findMany(args: unknown): Promise<Array<{ marketId: string }>>;
      upsert(args: unknown): Promise<unknown>;
    };
  };
}

/** Pure, exact i128 comparison matching the pinned resolver contract (`resolve_price`). */
export function expectedOutcome(price: bigint, threshold: bigint, dir: PriceDirection): 'Yes' | 'No' {
  switch (dir) {
    case 'Above':
      return price > threshold ? 'Yes' : 'No';
    case 'AtOrAbove':
      return price >= threshold ? 'Yes' : 'No';
    case 'Below':
      return price < threshold ? 'Yes' : 'No';
    case 'AtOrBelow':
      return price <= threshold ? 'Yes' : 'No';
  }
}

function absBigInt(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/** Exact integer median of a non-empty array of BigInts. */
export function medianBigInt(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2n;
}

/** Basis-points distance: `|a - b| * 10_000 / |denom|`. Null when denom is 0. */
export function bpsDistance(a: bigint, b: bigint, denom: bigint): number | null {
  const absDenom = absBigInt(denom);
  if (absDenom === 0n) return null;
  return Number((absBigInt(a - b) * 10_000n) / absDenom);
}

function parseEventOutcome(raw: unknown): 'Yes' | 'No' | null {
  const tag = raw && typeof raw === 'object' && 'tag' in raw ? (raw as { tag: unknown }).tag : raw;
  if (tag === 'Yes' || tag === 'YES') return 'Yes';
  if (tag === 'No' || tag === 'NO') return 'No';
  return null;
}

/**
 * Verifies a single indexed `PriceResolution` event, persists the verdict in
 * `price_resolution_checks`, and alerts CRITICAL on mismatches or outcome-flipping outliers.
 */
export async function verifyPriceResolution(
  eventId: string,
  deps: VerifyDeps = {},
): Promise<VerifyResult> {
  const db = deps.prisma ?? defaultPrisma;
  const models = dbModels(db);
  const reader = deps.reader ?? reflectorReader();
  const outlierBps = deps.outlierBps ?? config.PRICE_VERIFY_OUTLIER_BPS;

  const event = await models.chainEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    throw new Error(`PriceResolution chain event ${eventId} not found`);
  }
  const params = (event.params ?? {}) as Record<string, unknown>;
  const onChainMarketId = BigInt(String(params.market_id));
  const eventPrice = BigInt(String(params.price));
  const eventPriceTs = BigInt(String(params.price_timestamp));
  const eventOutcome = parseEventOutcome(params.outcome);

  const market = await models.market.findUnique({
    where: { onChainMarketId },
    select: {
      id: true,
      onChainMarketId: true,
      expiryTimestamp: true,
      resolutionHash: true,
      resolutionSpec: true,
    },
  });
  if (!market) {
    throw new Error(`Market for on-chain id ${onChainMarketId.toString()} not found`);
  }

  const persistAndAlert = async (
    verdict: VerifyVerdict,
    detail: Record<string, unknown>,
  ): Promise<VerifyResult> => {
    await models.priceResolutionCheck.upsert({
      where: { marketId: market.id },
      create: {
        marketId: market.id,
        eventId,
        verdict,
        detail: detail as Prisma.InputJsonValue,
      },
      update: {
        eventId,
        verdict,
        detail: detail as Prisma.InputJsonValue,
        checkedAt: new Date(),
      },
    });

    if (verdict === 'OUTCOME_MISMATCH' || verdict === 'PRICE_MISMATCH' || verdict === 'OUTLIER') {
      const alerts = deps.alerts ?? new AlertService();
      await alerts
        .send(`price_verify:${market.id}`, {
          kind: 'price_verify',
          level: 'CRITICAL',
          title: `Price resolution verification ${verdict} for market ${onChainMarketId.toString()}`,
          marketId: market.id,
          onChainMarketId: onChainMarketId.toString(),
          eventId,
          verdict,
          detail: typeof detail.reason === 'string' ? detail.reason : `Verification flagged ${verdict}`,
          metrics: detail,
        })
        .catch((err) => {
          logger.warn({ marketId: market.id, eventId, err: err instanceof Error ? err.message : String(err) }, 'price verifier: alert send failed');
        });
    }

    return {
      marketId: market.id,
      onChainMarketId: onChainMarketId.toString(),
      eventId,
      verdict,
      detail,
    };
  };

  // 1. Validate committed spec against Market.resolutionHash
  const rawSpec = market.resolutionSpec as ResolutionSpecJson | null;
  if (!rawSpec || rawSpec.kind !== 'price' || !market.resolutionHash) {
    return persistAndAlert('OUTCOME_MISMATCH', {
      reason: 'SPEC_MISSING_OR_NOT_PRICE',
      eventPrice: eventPrice.toString(),
      eventPriceTimestamp: eventPriceTs.toString(),
      eventOutcome,
    });
  }
  const spec: PriceSpec = rawSpec;
  try {
    validateResolutionSpec(spec);
    const computedHash = resolutionHash(spec).toString('hex').toLowerCase();
    if (computedHash !== market.resolutionHash.toLowerCase()) {
      return persistAndAlert('OUTCOME_MISMATCH', {
        reason: 'SPEC_HASH_MISMATCH',
        expectedHash: market.resolutionHash.toLowerCase(),
        computedHash,
      });
    }
  } catch (err) {
    return persistAndAlert('OUTCOME_MISMATCH', {
      reason: 'SPEC_INVALID',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Recompute expected outcome from committed spec + event price
  const threshold = BigInt(spec.threshold);
  const recomputed = expectedOutcome(eventPrice, threshold, spec.direction);
  const distanceToThresholdBps = bpsDistance(eventPrice, threshold, threshold !== 0n ? threshold : 1n);

  if (eventOutcome === null || recomputed !== eventOutcome) {
    return persistAndAlert('OUTCOME_MISMATCH', {
      reason: 'OUTCOME_DISAGREES_WITH_SPEC',
      eventPrice: eventPrice.toString(),
      eventPriceTimestamp: eventPriceTs.toString(),
      threshold: spec.threshold,
      direction: spec.direction,
      expectedOutcome: recomputed,
      observedOutcome: eventOutcome,
      distanceToThresholdBps,
    });
  }

  // 3. Load close-time snapshot, or fall back to live Reflector historical read
  let records: CloseSnapshotRecord[] | null = null;
  let source: 'snapshot' | 'live' = 'snapshot';
  const snapshot = await models.priceCloseSnapshot.findUnique({ where: { marketId: market.id } });
  if (snapshot && Array.isArray(snapshot.records)) {
    records = snapshot.records as CloseSnapshotRecord[];
  } else {
    source = 'live';
    try {
      const closeTime = BigInt(Math.floor(market.expiryTimestamp.getTime() / 1000));
      const resolutionSecs = await reader.resolution(spec.reflector);
      const step = BigInt(Math.max(1, resolutionSecs));
      const fetched: CloseSnapshotRecord[] = [];
      for (let i = 0; i <= CLOSE_SNAPSHOT_NEIGHBOURS; i++) {
        const ts = closeTime - BigInt(i) * step;
        const data = await reader.price(spec.reflector, spec.asset, ts);
        fetched.push({
          requestedTs: ts.toString(),
          price: data ? data.price.toString() : null,
          timestamp: data ? data.timestamp.toString() : null,
        });
      }
      if (fetched[0]?.price !== null) {
        records = fetched;
      }
    } catch (err) {
      logger.warn({ marketId: market.id, err: err instanceof Error ? err.message : String(err) }, 'price verifier: live Reflector fallback failed');
    }
  }

  if (!records || records.length === 0 || records[0]?.price === null || records[0]?.timestamp === null) {
    return persistAndAlert('UNVERIFIABLE', {
      reason: 'NO_SNAPSHOT_AND_HISTORY_UNAVAILABLE',
      eventPrice: eventPrice.toString(),
      eventPriceTimestamp: eventPriceTs.toString(),
      expectedOutcome: recomputed,
      distanceToThresholdBps,
    });
  }

  // 4. Compare snapshot close record against event price & timestamp
  const closeRecord = records[0];
  const snapPrice = BigInt(closeRecord.price);
  const snapTs = BigInt(closeRecord.timestamp);
  if (snapPrice !== eventPrice || snapTs !== eventPriceTs) {
    return persistAndAlert('PRICE_MISMATCH', {
      reason: 'EVENT_PRICE_DIFFERS_FROM_FEED_RECORD',
      source,
      eventPrice: eventPrice.toString(),
      eventPriceTimestamp: eventPriceTs.toString(),
      snapshotPrice: snapPrice.toString(),
      snapshotTimestamp: snapTs.toString(),
      distanceToThresholdBps,
    });
  }

  // 5. Cross-check against neighbouring grid records for an outcome-flipping outlier
  const neighbourPrices = records
    .slice(1)
    .map((r) => (r.price !== null ? BigInt(r.price) : null))
    .filter((v): v is bigint => v !== null);

  let medianPrice: bigint | null = null;
  let deviationFromMedianBps: number | null = null;
  if (neighbourPrices.length > 0) {
    medianPrice = medianBigInt(neighbourPrices);
    deviationFromMedianBps = bpsDistance(eventPrice, medianPrice, medianPrice);
    const medianOutcome = expectedOutcome(medianPrice, threshold, spec.direction);
    const flippedOutcome = medianOutcome !== eventOutcome;
    if (
      deviationFromMedianBps !== null &&
      deviationFromMedianBps > outlierBps &&
      flippedOutcome
    ) {
      return persistAndAlert('OUTLIER', {
        reason: 'OUTLIER_FLIPPED_OUTCOME',
        source,
        eventPrice: eventPrice.toString(),
        eventPriceTimestamp: eventPriceTs.toString(),
        threshold: spec.threshold,
        direction: spec.direction,
        eventOutcome,
        medianPrice: medianPrice.toString(),
        medianOutcome,
        deviationFromMedianBps,
        outlierThresholdBps: outlierBps,
        distanceToThresholdBps,
        neighbourCount: neighbourPrices.length,
      });
    }
  }

  return persistAndAlert('CONSISTENT', {
    source,
    eventPrice: eventPrice.toString(),
    eventPriceTimestamp: eventPriceTs.toString(),
    threshold: spec.threshold,
    direction: spec.direction,
    outcome: eventOutcome,
    medianPrice: medianPrice !== null ? medianPrice.toString() : null,
    deviationFromMedianBps,
    distanceToThresholdBps,
    neighbourCount: neighbourPrices.length,
  });
}

/**
 * Schedules verification after the indexer poll tick (non-blocking, mirrors
 * `scheduleReview` in dispute-monitor.service.ts).
 */
export function schedulePriceVerification(eventId: string, deps?: VerifyDeps): void {
  setImmediate(() => {
    verifyPriceResolution(eventId, deps).catch((err) => {
      logger.error({ eventId, err: err instanceof Error ? err.message : String(err) }, 'price verifier: scheduled verification failed');
    });
  });
}

/**
 * Sweep for resolved price-mode markets that have a `PriceResolution` event in
 * `chain_events` but no `price_resolution_checks` row yet.
 */
export async function sweepUnverifiedPriceResolutions(deps: VerifyDeps = {}): Promise<VerifyResult[]> {
  const db = deps.prisma ?? defaultPrisma;
  const models = dbModels(db);

  const existingChecks = await models.priceResolutionCheck.findMany({ select: { marketId: true } });
  const checkedIds = new Set(existingChecks.map((c) => c.marketId));

  const resolvedPriceMarkets = await db.market.findMany({
    where: {
      status: 'RESOLVED',
      onChainMarketId: { not: null },
      resolutionSpec: { path: ['kind'], equals: 'price' },
    },
    select: { id: true, onChainMarketId: true },
    take: 100,
  });

  const missing = resolvedPriceMarkets.filter((m) => !checkedIds.has(m.id) && m.onChainMarketId !== null);
  const results: VerifyResult[] = [];
  for (const m of missing) {
    const ev = await db.chainEvent.findFirst({
      where: {
        contractName: 'resolver',
        eventName: 'PriceResolution',
        params: { path: ['market_id'], equals: m.onChainMarketId!.toString() },
      },
      orderBy: { ledger: 'desc' },
      select: { id: true },
    });
    if (!ev) continue;
    try {
      results.push(await verifyPriceResolution(ev.id, deps));
    } catch (err) {
      logger.warn({ marketId: m.id, eventId: ev.id, err: err instanceof Error ? err.message : String(err) }, 'price verifier: sweep check failed');
    }
  }
  return results;
}
