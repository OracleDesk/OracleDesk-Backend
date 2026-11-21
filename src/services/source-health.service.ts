/**
 * Per-source signal health from fetch logs and the signal store (#277).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { secret } from '../config/secrets';
import { getRedis } from '../lib/redis';
import { logger } from '../lib/logger';
import { now as clockNow } from '../lib/clock';
import type { SignalSource } from './signal-normalize';
import { SOURCE_EXPECTATIONS, type SourceExpectation } from '../config/signal-sources';
import { sourceBreakerTripLowOkRate, sourceBreakerSnapshots, type SourceBreakerSnapshot } from '../lib/source-breaker';
import { FRED_SERIES } from './ingestion.service';

export type SourceHealthState = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
export type SourceHealthWindow = '1h' | '24h';

export interface SourceHealth {
  source: SignalSource;
  window: SourceHealthWindow;
  fetches: number;
  okRate: number;
  emptyRate: number;
  rejectRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  freshnessLagMin: number | null;
  noveltyRate: number | null;
  score: number;
  state: SourceHealthState;
  reasons: string[];
}

const SOURCES: SignalSource[] = ['NEWSAPI', 'FRED', 'GDELT'];
const CACHE_KEY = 'source-health:v1';
const CACHE_TTL_SEC = 60;

const EXCLUDED_FETCH_STATUSES = ['skipped_breaker_open'] as const;

export function healthFactor(state: SourceHealthState): number {
  switch (state) {
    case 'HEALTHY':
      return 1;
    case 'DEGRADED':
      return 0.5;
    case 'UNHEALTHY':
      return 0;
    case 'UNKNOWN':
      return 1;
    default:
      return 1;
  }
}

export function scoreHealth(
  m: Omit<SourceHealth, 'score' | 'state' | 'reasons' | 'source' | 'window'>,
  expect: SourceExpectation,
  configured: boolean,
): Pick<SourceHealth, 'score' | 'state' | 'reasons'> {
  const reasons: string[] = [];
  if (!configured) {
    return { score: 0, state: 'UNKNOWN', reasons: ['source not configured'] };
  }
  if (m.fetches === 0) {
    return { score: 0.5, state: 'DEGRADED', reasons: ['no fetches in window'] };
  }

  let score = 1;
  if (m.okRate < 0.9) {
    score -= 0.35;
    reasons.push(`ok rate ${(m.okRate * 100).toFixed(0)}%`);
  }
  if (m.emptyRate > 0.5) {
    score -= 0.2;
    reasons.push(`empty responses ${(m.emptyRate * 100).toFixed(0)}%`);
  }
  if (m.rejectRate > 0.3) {
    score -= 0.1;
    reasons.push(`high rejection rate`);
  }
  if (m.noveltyRate !== null && m.noveltyRate < 0.1) {
    score -= 0.15;
    reasons.push('low novelty');
  }
  if (expect.maxFreshnessLagMin !== null && m.freshnessLagMin !== null && m.freshnessLagMin > expect.maxFreshnessLagMin) {
    score -= 0.35;
    reasons.push(`stale feed (${Math.round(m.freshnessLagMin)}m lag)`);
  }

  score = Math.max(0, Math.min(1, score));
  let state: SourceHealthState = 'HEALTHY';
  if (m.okRate < 0.3) state = 'UNHEALTHY';
  else if (score < 0.45 || m.okRate < config.SIGNAL_BREAKER_MIN_OK_RATE) state = 'UNHEALTHY';
  else if (score < 0.75) state = 'DEGRADED';
  if (reasons.length === 0) reasons.push('within expectations');
  return { score, state, reasons };
}

function configuredSources(): Set<SignalSource> {
  const out = new Set<SignalSource>(['GDELT']);
  if (secret('NEWSAPI_KEY')) out.add('NEWSAPI');
  if (secret('FRED_API_KEY')) out.add('FRED');
  return out;
}

async function fetchWindowMetrics(source: SignalSource, since: Date): Promise<{
  fetches: number;
  okRate: number;
  emptyRate: number;
  rejectRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  noveltyRate: number | null;
}> {
  const rows = await prisma.$queryRaw<
    Array<{
      fetches: bigint;
      ok_count: bigint;
      empty_count: bigint;
      reject_sum: bigint;
      item_sum: bigint;
      new_sum: bigint;
      p50: number | null;
      p95: number | null;
    }>
  >`
    SELECT
      COUNT(*)::bigint AS fetches,
      COUNT(*) FILTER (WHERE status IN ('ok', 'partial'))::bigint AS ok_count,
      COUNT(*) FILTER (WHERE status = 'ok' AND "itemCount" = 0)::bigint AS empty_count,
      COALESCE(SUM("rejectedCount"), 0)::bigint AS reject_sum,
      COALESCE(SUM("itemCount"), 0)::bigint AS item_sum,
      COALESCE(SUM("newCount"), 0)::bigint AS new_sum,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") FILTER (WHERE status IN ('ok', 'partial', 'error', 'timeout')) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") FILTER (WHERE status IN ('ok', 'partial', 'error', 'timeout')) AS p95
    FROM "signal_fetches"
    WHERE "source" = ${source}
      AND "startedAt" >= ${since}
      AND "status" NOT IN (${Prisma.join(EXCLUDED_FETCH_STATUSES)})
  `;
  const r = rows[0];
  const fetches = Number(r?.fetches ?? 0);
  const okRate = fetches > 0 ? Number(r.ok_count) / fetches : 0;
  const emptyRate = fetches > 0 ? Number(r.empty_count) / fetches : 0;
  const itemSum = Number(r?.item_sum ?? 0);
  const rejectRate = itemSum > 0 ? Number(r?.reject_sum ?? 0) / itemSum : 0;
  const newSum = Number(r?.new_sum ?? 0);
  const noveltyRate = itemSum > 0 ? newSum / itemSum : null;
  return {
    fetches,
    okRate,
    emptyRate,
    rejectRate,
    p50Ms: r?.p50 ?? null,
    p95Ms: r?.p95 ?? null,
    noveltyRate,
  };
}

async function freshnessLagForSource(source: SignalSource, since: Date, now: Date): Promise<number | null> {
  if (source === 'FRED') {
    const rows = await prisma.signal.findMany({
      where: { source: 'FRED', firstSeenAt: { gte: since } },
      select: { externalId: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    });
    if (!rows.length) return null;
    let worst = 0;
    for (const seriesId of FRED_SERIES) {
      const cadence = SOURCE_EXPECTATIONS.FRED.fredSeries?.[seriesId]?.cadenceDays ?? 35;
      const row = rows.find((r) => r.externalId === seriesId);
      if (!row) {
        worst = Math.max(worst, cadence * 24 * 60);
        continue;
      }
      const lagMin = (now.getTime() - row.publishedAt.getTime()) / 60_000;
      worst = Math.max(worst, lagMin);
    }
    return worst;
  }
  const row = await prisma.signal.findFirst({
    where: { source, firstSeenAt: { gte: since } },
    orderBy: { publishedAt: 'desc' },
    select: { publishedAt: true },
  });
  if (!row) return null;
  return Math.max(0, (now.getTime() - row.publishedAt.getTime()) / 60_000);
}

async function computeForWindow(now: Date, window: SourceHealthWindow): Promise<SourceHealth[]> {
  const ms = window === '1h' ? 3_600_000 : 24 * 3_600_000;
  const since = new Date(now.getTime() - ms);
  const configured = configuredSources();
  const out: SourceHealth[] = [];
  for (const source of SOURCES) {
    const metrics = await fetchWindowMetrics(source, since);
    const freshnessLagMin = await freshnessLagForSource(source, since, now);
    const partial = {
      ...metrics,
      freshnessLagMin,
    };
    const scored = scoreHealth(partial, SOURCE_EXPECTATIONS[source], configured.has(source));
    out.push({
      source,
      window,
      ...partial,
      ...scored,
    });
    if (window === '1h' && configured.has(source) && metrics.fetches >= 3 && metrics.okRate < config.SIGNAL_BREAKER_MIN_OK_RATE) {
      void sourceBreakerTripLowOkRate(source);
    }
  }
  return out;
}

export async function computeSourceHealth(now = clockNow()): Promise<SourceHealth[]> {
  const one = await computeForWindow(now, '1h');
  const day = await computeForWindow(now, '24h');
  return [...one, ...day];
}

export async function getCachedSourceHealth(now = clockNow()): Promise<SourceHealth[]> {
  try {
    const r = getRedis();
    const hit = await r.get(CACHE_KEY);
    if (hit) return JSON.parse(hit) as SourceHealth[];
  } catch {
  /* use compute */
  }
  const rows = await computeSourceHealth(now);
  try {
    const r = getRedis();
    await r.set(CACHE_KEY, JSON.stringify(rows), 'EX', CACHE_TTL_SEC);
  } catch (err) {
    logger.debug({ err }, 'Could not cache source health');
  }
  return rows;
}

export function sourceHealthMap(health: SourceHealth[]): Record<SignalSource, SourceHealthState> {
  const map: Record<SignalSource, SourceHealthState> = {
    NEWSAPI: 'UNKNOWN',
    FRED: 'UNKNOWN',
    GDELT: 'UNKNOWN',
  };
  for (const row of health) {
    if (row.window !== '1h') continue;
    map[row.source] = row.state;
  }
  return map;
}

export function quietPeriod(health: SourceHealth[]): boolean {
  const hour = health.filter((h) => h.window === '1h' && h.state !== 'UNKNOWN');
  if (hour.length === 0) return false;
  return hour.every((h) => {
    if (h.state === 'HEALTHY') return true;
    if (h.state !== 'DEGRADED') return false;
    const quietReasons = h.reasons.every((r) => /novelty|empty|no fetches|quiet/i.test(r));
    return quietReasons && h.okRate >= 0.5;
  });
}

export async function adminSourceHealthPayload(): Promise<{
  health: SourceHealth[];
  breakers: Record<SignalSource, SourceBreakerSnapshot>;
}> {
  const [health, breakers] = await Promise.all([getCachedSourceHealth(), sourceBreakerSnapshots()]);
  return { health, breakers };
}

export function countHealthySources(health: SourceHealth[]): number {
  return health.filter((h) => h.window === '1h' && h.state === 'HEALTHY').length;
}