/**
 * Reflector feed health monitor and close-time snapshot capture (#309).
 *
 * Watches every open price-mode market while it is open so feed degradation
 * (dropped asset, changed decimals/resolution, staleness, grid gaps) surfaces
 * well before finality — when a guardian can still void the market.
 *
 * At close, captures `price(asset, close_time)` plus the k = 3 preceding grid
 * slots into `price_close_snapshots` so post-resolution verification still
 * works after the feed's on-chain retention ages out.
 */
import { Prisma } from '@prisma/client';
import { config } from '../config';
import { feedFor } from '../config/reflector-feeds';
import { prisma as defaultPrisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { ResolutionSpecJson } from '../lib/resolution-spec';
import { AlertService } from './alerts.service';
import {
  reflectorReader,
  type OracleAsset,
  type PriceResolutionBlock,
  type ReflectorReader,
} from './price-resolution.service';

export type FeedSeverity = 'OK' | 'WARN' | 'CRITICAL';

export interface FeedHealth {
  marketId: string;
  supported: boolean;
  lastTs: bigint | null;
  ageSecs: number | null;
  decimalsNow: number;
  decimalsChanged: boolean;
  resolutionNow: number;
  resolutionChanged: boolean;
  gapSlots: number;
  severity: FeedSeverity;
  reasons: string[];
}

export interface CloseSnapshotRecord {
  requestedTs: string;
  price: string | null;
  timestamp: string | null;
}

export interface PriceFeedMonitorDeps {
  reader?: ReflectorReader;
  alerts?: AlertService;
  prisma?: typeof defaultPrisma;
  closeWindowSecs?: number;
  gapSlotsCount?: number;
}

const SEVERITY_RANK: Record<FeedSeverity, number> = {
  OK: 0,
  WARN: 1,
  CRITICAL: 2,
};

export const CLOSE_SNAPSHOT_NEIGHBOURS = 3;

type PriceSpec = Extract<ResolutionSpecJson, { kind: 'price' }>;

interface PriceFeedCheckRow {
  id: string;
  marketId: string;
  checkedAt: Date;
  ledger: number;
  health: unknown;
  severity: string;
}

interface PriceCloseSnapshotRow {
  id: string;
  marketId: string;
  closeTime: bigint;
  records: unknown;
  ledger: number;
  readAt: Date;
}

function dbModels(db: typeof defaultPrisma) {
  return db as unknown as {
    market: typeof defaultPrisma.market;
    priceFeedCheck: {
      findFirst(args: unknown): Promise<PriceFeedCheckRow | null>;
      findMany(args: unknown): Promise<PriceFeedCheckRow[]>;
      create(args: unknown): Promise<PriceFeedCheckRow>;
      update(args: unknown): Promise<PriceFeedCheckRow>;
    };
    priceCloseSnapshot: {
      findUnique(args: unknown): Promise<PriceCloseSnapshotRow | null>;
      findMany(args: unknown): Promise<PriceCloseSnapshotRow[]>;
      create(args: unknown): Promise<PriceCloseSnapshotRow>;
    };
    priceResolutionCheck: {
      findMany(args: unknown): Promise<Array<{ id: string; marketId: string; eventId: string; verdict: string; detail: unknown; checkedAt: Date }>>;
    };
  };
}

function assetLabel(asset: OracleAsset): string {
  return asset.kind === 'stellar' ? asset.address : asset.symbol;
}

export interface FeedFacts {
  decimalsAtCreation: number | null;
  resolutionAtCreation: number | null;
  feedSource?: string;
  inferred: boolean;
}

/** Reads creation-time feed facts from Market.resolutionDetails (nested under `.price` or top-level). */
export function extractFeedFacts(resolutionDetails: unknown): FeedFacts {
  if (!resolutionDetails || typeof resolutionDetails !== 'object') {
    return { decimalsAtCreation: null, resolutionAtCreation: null, inferred: false };
  }
  const obj = resolutionDetails as Record<string, unknown>;
  const block = (obj.price && typeof obj.price === 'object' ? obj.price : obj) as Partial<PriceResolutionBlock>;
  const decimalsAtCreation =
    typeof block.decimalsAtCreation === 'number'
      ? block.decimalsAtCreation
      : typeof block.decimals === 'number'
        ? block.decimals
        : null;
  const resolutionAtCreation =
    typeof block.resolutionAtCreation === 'number' ? block.resolutionAtCreation : null;
  return {
    decimalsAtCreation,
    resolutionAtCreation,
    feedSource: typeof block.feedSource === 'string' ? block.feedSource : undefined,
    inferred: block.inferred === true,
  };
}

export interface EvaluateFeedHealthInput {
  marketId: string;
  supported: boolean;
  lastTs: bigint | null;
  ledgerCloseTime: bigint;
  maxStaleness: number;
  secsToClose: number;
  closeWindowSecs: number;
  decimalsNow: number;
  decimalsAtCreation: number;
  resolutionNow: number;
  resolutionAtCreation: number | null;
  gapSlots: number;
}

/**
 * Pure feed-health classifier.
 *
 * - CRITICAL: unsupported asset, decimals changed since creation, or stale/missing
 *   data inside the close window.
 * - WARN: age > maxStaleness / 2 (or stale/missing outside close window),
 *   any missing grid slots in the recent window, or resolution() changed.
 */
export function evaluateFeedHealth(input: EvaluateFeedHealthInput): FeedHealth {
  const reasons: string[] = [];
  let severity: FeedSeverity = 'OK';
  const raise = (next: FeedSeverity, reason: string) => {
    reasons.push(reason);
    if (SEVERITY_RANK[next] > SEVERITY_RANK[severity]) severity = next;
  };

  const ageSecs = input.lastTs !== null ? Number(input.ledgerCloseTime - input.lastTs) : null;
  const decimalsChanged = input.decimalsNow !== input.decimalsAtCreation;
  const resolutionChanged =
    input.resolutionAtCreation !== null && input.resolutionNow !== input.resolutionAtCreation;
  const inCloseWindow = input.secsToClose <= input.closeWindowSecs;

  if (!input.supported) raise('CRITICAL', 'FEED_UNSUPPORTED');
  if (decimalsChanged) raise('CRITICAL', 'DECIMALS_CHANGED');

  if (ageSecs === null) {
    raise(inCloseWindow ? 'CRITICAL' : 'WARN', inCloseWindow ? 'NO_DATA_NEAR_CLOSE' : 'NO_DATA');
  } else if (ageSecs > input.maxStaleness) {
    raise(inCloseWindow ? 'CRITICAL' : 'WARN', inCloseWindow ? 'STALE_NEAR_CLOSE' : 'FEED_STALE');
  } else if (ageSecs > input.maxStaleness / 2) {
    raise('WARN', 'FEED_AGING');
  }

  if (input.gapSlots > 0) raise('WARN', 'GRID_GAPS');
  if (resolutionChanged) raise('WARN', 'RESOLUTION_CHANGED');

  return {
    marketId: input.marketId,
    supported: input.supported,
    lastTs: input.lastTs,
    ageSecs,
    decimalsNow: input.decimalsNow,
    decimalsChanged,
    resolutionNow: input.resolutionNow,
    resolutionChanged,
    gapSlots: input.gapSlots,
    severity,
    reasons,
  };
}

function serializeHealth(health: FeedHealth): Record<string, unknown> {
  return {
    ...health,
    lastTs: health.lastTs !== null ? health.lastTs.toString() : null,
  };
}

/** Counts missing grid records across the last `slots` resolution intervals ending at ledgerCloseTime. */
export async function countGridGaps(
  reader: ReflectorReader,
  reflector: string,
  asset: OracleAsset,
  resolutionSecs: number,
  ledgerCloseTime: bigint,
  slots: number,
): Promise<number> {
  if (resolutionSecs <= 0 || slots <= 0) return 0;
  const step = BigInt(resolutionSecs);
  const latestGrid = (ledgerCloseTime / step) * step;
  let gaps = 0;
  for (let i = 0; i < slots; i++) {
    const slotTs = latestGrid - BigInt(i) * step;
    if (slotTs <= 0n) break;
    try {
      const record = await reader.price(reflector, asset, slotTs);
      if (!record || record.timestamp < slotTs - step) {
        gaps++;
      }
    } catch {
      gaps++;
    }
  }
  return gaps;
}

export interface MonitoredPriceMarket {
  id: string;
  onChainMarketId: bigint | null;
  expiryTimestamp: Date;
  resolutionSpec: unknown;
  resolutionDetails: unknown;
}

/**
 * Checks one open price-mode market's Reflector feed, lazily backfills missing
 * creation-time facts (marked `inferred: true`), persists the latest health
 * (preserving severity transitions), and sends an alert on severity increase.
 */
export async function checkPriceMarketFeed(
  market: MonitoredPriceMarket,
  deps: PriceFeedMonitorDeps = {},
): Promise<{ health: FeedHealth; ledger: number; escalated: boolean }> {
  const reader = deps.reader ?? reflectorReader();
  const db = deps.prisma ?? defaultPrisma;
  const models = dbModels(db);
  const closeWindowSecs = deps.closeWindowSecs ?? config.PRICE_FEED_MONITOR_CLOSE_WINDOW_SECS;
  const gapSlotsCount = deps.gapSlotsCount ?? config.PRICE_FEED_GAP_SLOTS;
  const spec = market.resolutionSpec as PriceSpec;

  const [ledgerInfo, supported, decimalsNow, resolutionNow, last] = await Promise.all([
    reader.latestLedger(),
    reader.supports(spec.reflector, spec.asset, { fresh: true }),
    reader.decimals(spec.reflector, { fresh: true }),
    reader.resolution(spec.reflector, { fresh: true }),
    reader.lastPrice(spec.reflector, spec.asset),
  ]);

  const facts = extractFeedFacts(market.resolutionDetails);
  let decimalsAtCreation = facts.decimalsAtCreation;
  let resolutionAtCreation = facts.resolutionAtCreation;
  let feedSource = facts.feedSource;

  // Lazy backfill for pre-#309 markets so subsequent runs detect drift from the first observed values.
  if (decimalsAtCreation === null || resolutionAtCreation === null) {
    const inferredDecimals = decimalsAtCreation ?? decimalsNow;
    const inferredResolution = resolutionAtCreation ?? resolutionNow;
    const registeredFeed =
      spec.asset.kind === 'other'
        ? feedFor(config.STELLAR_NETWORK_PASSPHRASE, spec.asset.symbol)
        : null;
    feedSource = feedSource ?? registeredFeed?.source;

    const existingDetails =
      market.resolutionDetails && typeof market.resolutionDetails === 'object'
        ? (market.resolutionDetails as Record<string, unknown>)
        : {};
    const existingPrice =
      existingDetails.price && typeof existingDetails.price === 'object'
        ? (existingDetails.price as Record<string, unknown>)
        : {};
    const updatedDetails = {
      ...existingDetails,
      price: {
        ...existingPrice,
        kind: 'price',
        asset: assetLabel(spec.asset),
        reflector: spec.reflector,
        direction: spec.direction,
        thresholdRaw: spec.threshold,
        decimals: inferredDecimals,
        decimalsAtCreation: inferredDecimals,
        resolutionAtCreation: inferredResolution,
        ...(feedSource ? { feedSource } : {}),
        inferred: true,
      },
    };
    await models.market
      .update({
        where: { id: market.id },
        data: { resolutionDetails: updatedDetails as Prisma.InputJsonValue },
      })
      .catch((err) => {
        logger.warn({ marketId: market.id, err: err instanceof Error ? err.message : String(err) }, 'price feed monitor: failed lazy backfill of feed facts');
      });

    decimalsAtCreation = inferredDecimals;
    resolutionAtCreation = inferredResolution;
  }

  const gapSlots = supported
    ? await countGridGaps(reader, spec.reflector, spec.asset, resolutionNow, ledgerInfo.closeTime, gapSlotsCount)
    : gapSlotsCount;

  const closeTimeSecs = BigInt(Math.floor(market.expiryTimestamp.getTime() / 1000));
  const secsToClose = Number(closeTimeSecs - ledgerInfo.closeTime);

  const health = evaluateFeedHealth({
    marketId: market.id,
    supported,
    lastTs: last?.timestamp ?? null,
    ledgerCloseTime: ledgerInfo.closeTime,
    maxStaleness: spec.maxStaleness,
    secsToClose,
    closeWindowSecs,
    decimalsNow,
    decimalsAtCreation,
    resolutionNow,
    resolutionAtCreation,
    gapSlots,
  });

  const previous = await models.priceFeedCheck.findFirst({
    where: { marketId: market.id },
    orderBy: { checkedAt: 'desc' },
  });

  const serialized = serializeHealth(health);
  if (previous && previous.severity === health.severity) {
    // Same severity: update latest row in place so history keeps transitions only.
    await models.priceFeedCheck.update({
      where: { id: previous.id },
      data: {
        checkedAt: new Date(),
        ledger: ledgerInfo.sequence,
        health: serialized as Prisma.InputJsonValue,
      },
    });
  } else {
    await models.priceFeedCheck.create({
      data: {
        marketId: market.id,
        ledger: ledgerInfo.sequence,
        health: serialized as Prisma.InputJsonValue,
        severity: health.severity,
      },
    });
  }

  const prevRank = previous ? (SEVERITY_RANK[previous.severity as FeedSeverity] ?? 0) : 0;
  const nextRank = SEVERITY_RANK[health.severity];
  const escalated = nextRank > prevRank && (health.severity === 'WARN' || health.severity === 'CRITICAL');

  if (escalated) {
    const alerts = deps.alerts ?? new AlertService();
    const subjectId = `price_feed:${market.id}:${health.severity}`;
    await alerts
      .send(subjectId, {
        kind: 'price_feed',
        level: health.severity,
        title: `Reflector feed ${health.severity} for price market ${market.onChainMarketId?.toString() ?? market.id}`,
        marketId: market.id,
        onChainMarketId: market.onChainMarketId?.toString() ?? null,
        feed: {
          reflector: spec.reflector,
          asset: assetLabel(spec.asset),
          ...(feedSource ? { source: feedSource } : {}),
        },
        severity: health.severity,
        reasons: health.reasons,
        secsToClose,
        detail: `Feed health degraded (${health.reasons.join(', ')}) with ${Math.max(0, secsToClose)}s until close.`,
      })
      .catch((err) => {
        logger.warn({ marketId: market.id, err: err instanceof Error ? err.message : String(err) }, 'price feed monitor: failed sending alert');
      });
  }

  return { health, ledger: ledgerInfo.sequence, escalated };
}

/**
 * Monitors open (`ACTIVE` | `RESOLVING`) price-mode markets.
 * When `onlyCloseWindow` is true, checks only markets within `PRICE_FEED_MONITOR_CLOSE_WINDOW_SECS` of close.
 */
export async function runPriceFeedMonitor(
  opts: PriceFeedMonitorDeps & { onlyCloseWindow?: boolean; now?: Date } = {},
): Promise<{ checked: number; warnings: number; critical: number; escalated: number }> {
  const db = opts.prisma ?? defaultPrisma;
  const closeWindowSecs = opts.closeWindowSecs ?? config.PRICE_FEED_MONITOR_CLOSE_WINDOW_SECS;
  const now = opts.now ?? new Date();

  const markets = await db.market.findMany({
    where: {
      status: { in: ['ACTIVE', 'RESOLVING'] },
      resolutionSpec: { path: ['kind'], equals: 'price' },
      ...(opts.onlyCloseWindow
        ? { expiryTimestamp: { lte: new Date(now.getTime() + closeWindowSecs * 1000) } }
        : {}),
    },
    select: {
      id: true,
      onChainMarketId: true,
      expiryTimestamp: true,
      resolutionSpec: true,
      resolutionDetails: true,
    },
  });

  let checked = 0;
  let warnings = 0;
  let critical = 0;
  let escalated = 0;

  for (const market of markets) {
    try {
      const res = await checkPriceMarketFeed(market, opts);
      checked++;
      if (res.health.severity === 'WARN') warnings++;
      if (res.health.severity === 'CRITICAL') critical++;
      if (res.escalated) escalated++;
    } catch (err) {
      logger.warn(
        { marketId: market.id, err: err instanceof Error ? err.message : String(err) },
        'price feed monitor: market check failed',
      );
    }
  }

  return { checked, warnings, critical, escalated };
}

/**
 * Captures `price(asset, close_time)` and the `k = 3` preceding grid slots into
 * `price_close_snapshots`. Idempotent: the first successful read wins.
 */
export async function captureCloseSnapshot(
  market: { id: string; expiryTimestamp: Date; resolutionSpec: unknown },
  deps: { reader?: ReflectorReader; prisma?: typeof defaultPrisma; neighbours?: number } = {},
): Promise<PriceCloseSnapshotRow | null> {
  const db = deps.prisma ?? defaultPrisma;
  const models = dbModels(db);
  const existing = await models.priceCloseSnapshot.findUnique({ where: { marketId: market.id } });
  if (existing) return existing;

  const spec = market.resolutionSpec as PriceSpec | null;
  if (!spec || spec.kind !== 'price') return null;

  const reader = deps.reader ?? reflectorReader();
  const neighbours = deps.neighbours ?? CLOSE_SNAPSHOT_NEIGHBOURS;
  const closeTime = BigInt(Math.floor(market.expiryTimestamp.getTime() / 1000));

  const [ledgerInfo, resolutionSecs] = await Promise.all([
    reader.latestLedger(),
    reader.resolution(spec.reflector),
  ]);
  if (ledgerInfo.closeTime < closeTime) return null;

  const step = BigInt(Math.max(1, resolutionSecs));
  const records: CloseSnapshotRecord[] = [];
  for (let i = 0; i <= neighbours; i++) {
    const requestedTs = closeTime - BigInt(i) * step;
    const data = await reader.price(spec.reflector, spec.asset, requestedTs);
    records.push({
      requestedTs: requestedTs.toString(),
      price: data ? data.price.toString() : null,
      timestamp: data ? data.timestamp.toString() : null,
    });
  }

  // Wait until the close-time record itself is present so we don't lock in an empty pre-publication snapshot.
  if (records[0]?.price === null) return null;

  try {
    return await models.priceCloseSnapshot.create({
      data: {
        marketId: market.id,
        closeTime,
        records: records as unknown as Prisma.InputJsonValue,
        ledger: ledgerInfo.sequence,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return models.priceCloseSnapshot.findUnique({ where: { marketId: market.id } });
    }
    throw err;
  }
}

/**
 * Admin view for GET /api/v1/admin/price-markets/health (#309):
 * lists open price markets with their latest FeedHealth and closed/resolved
 * price markets with their post-resolution verification verdicts.
 */
export async function getPriceMarketsHealthOverview(db: typeof defaultPrisma = defaultPrisma) {
  const models = dbModels(db);
  const nowSecs = Math.floor(Date.now() / 1000);

  const [openMarkets, closedMarkets] = await Promise.all([
    db.market.findMany({
      where: {
        status: { in: ['ACTIVE', 'RESOLVING'] },
        resolutionSpec: { path: ['kind'], equals: 'price' },
      },
      orderBy: { expiryTimestamp: 'asc' },
      select: {
        id: true,
        question: true,
        status: true,
        onChainMarketId: true,
        expiryTimestamp: true,
        resolutionSpec: true,
        resolutionDetails: true,
      },
    }),
    db.market.findMany({
      where: {
        status: { in: ['RESOLVED', 'CANCELLED'] },
        resolutionSpec: { path: ['kind'], equals: 'price' },
      },
      orderBy: { resolvedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        question: true,
        status: true,
        onChainMarketId: true,
        expiryTimestamp: true,
        resolvedAt: true,
        resolvedOutcome: true,
        resolutionSpec: true,
      },
    }),
  ]);

  const openIds = openMarkets.map((m) => m.id);
  const closedIds = closedMarkets.map((m) => m.id);

  const [feedChecks, resolutionChecks, closeSnapshots] = await Promise.all([
    openIds.length > 0
      ? models.priceFeedCheck.findMany({
          where: { marketId: { in: openIds } },
          orderBy: { checkedAt: 'desc' },
        })
      : Promise.resolve([]),
    closedIds.length > 0
      ? models.priceResolutionCheck.findMany({
          where: { marketId: { in: closedIds } },
        })
      : Promise.resolve([]),
    closedIds.length > 0
      ? models.priceCloseSnapshot.findMany({
          where: { marketId: { in: closedIds } },
        })
      : Promise.resolve([]),
  ]);

  const latestCheckByMarket = new Map<string, PriceFeedCheckRow>();
  for (const c of feedChecks) {
    if (!latestCheckByMarket.has(c.marketId)) latestCheckByMarket.set(c.marketId, c);
  }
  const verifyByMarket = new Map(resolutionChecks.map((r) => [r.marketId, r]));
  const snapshotByMarket = new Map(closeSnapshots.map((s) => [s.marketId, s]));

  return {
    open: openMarkets.map((m) => {
      const latest = latestCheckByMarket.get(m.id) ?? null;
      const secsToClose = Math.floor(m.expiryTimestamp.getTime() / 1000) - nowSecs;
      return {
        marketId: m.id,
        onChainMarketId: m.onChainMarketId?.toString() ?? null,
        question: m.question,
        status: m.status,
        expiryTimestamp: m.expiryTimestamp,
        secsToClose,
        latestCheck: latest
          ? {
              checkedAt: latest.checkedAt,
              ledger: latest.ledger,
              severity: latest.severity,
              health: latest.health,
            }
          : null,
      };
    }),
    closed: closedMarkets.map((m) => {
      const check = verifyByMarket.get(m.id) ?? null;
      const snap = snapshotByMarket.get(m.id) ?? null;
      return {
        marketId: m.id,
        onChainMarketId: m.onChainMarketId?.toString() ?? null,
        question: m.question,
        status: m.status,
        expiryTimestamp: m.expiryTimestamp,
        resolvedAt: m.resolvedAt,
        resolvedOutcome: m.resolvedOutcome,
        snapshotCaptured: snap !== null,
        verification: check
          ? {
              eventId: check.eventId,
              verdict: check.verdict,
              detail: check.detail,
              checkedAt: check.checkedAt,
            }
          : null,
      };
    }),
  };
}
