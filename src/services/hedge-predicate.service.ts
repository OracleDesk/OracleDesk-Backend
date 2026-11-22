import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { extractEntities } from './dedup-entities';
import {
  HedgePredicateSchema,
  comparePredicateValue,
  type HedgePredicate,
} from '../schemas/hedge-predicate';

export interface SignalObservation {
  id: string;
  externalId: string | null;
  numericValue: number | null;
  publishedAt: Date;
}

export interface NewsSignalItem {
  id: string;
  title: string;
  summary: string | null;
  publishedAt: Date;
  firstSeenAt: Date;
}

export interface SignalPredicateReader {
  latestFredObservation(seriesId: string, asOf: Date): Promise<SignalObservation | null>;
  newsSignalsInWindow(windowStart: Date, asOf: Date): Promise<NewsSignalItem[]>;
}

export const prismaSignalPredicateReader: SignalPredicateReader = {
  async latestFredObservation(seriesId, asOf) {
    return prisma.signal.findFirst({
      where: {
        source: 'FRED',
        externalId: seriesId,
        publishedAt: { lte: asOf },
        numericValue: { not: null },
      },
      orderBy: [{ publishedAt: 'desc' }, { firstSeenAt: 'desc' }],
      select: { id: true, externalId: true, numericValue: true, publishedAt: true },
    });
  },
  async newsSignalsInWindow(windowStart, asOf) {
    return prisma.signal.findMany({
      where: {
        source: { in: ['NEWSAPI', 'GDELT'] },
        publishedAt: { gte: windowStart, lte: asOf },
        firstSeenAt: { lte: asOf },
      },
      select: { id: true, title: true, summary: true, publishedAt: true, firstSeenAt: true },
    });
  },
};

export interface PredicateEvaluation {
  triggered: boolean;
  observedValue: number | null;
  threshold: number;
  comparator: string;
  asOf: string;
  detail: Record<string, unknown>;
}

/**
 * Evaluates a single validated hedge predicate point-in-time as of `asOf`
 * against the signal store.
 */
export async function evaluatePredicate(
  predicate: HedgePredicate,
  asOf: Date,
  reader: SignalPredicateReader = prismaSignalPredicateReader,
): Promise<PredicateEvaluation> {
  if (predicate.kind === 'fred_series') {
    const obs = await reader.latestFredObservation(predicate.seriesId, asOf);
    if (!obs || obs.numericValue === null || !Number.isFinite(obs.numericValue)) {
      return {
        triggered: false,
        observedValue: null,
        threshold: predicate.threshold,
        comparator: predicate.comparator,
        asOf: asOf.toISOString(),
        detail: { reason: 'NO_OBSERVATION', seriesId: predicate.seriesId },
      };
    }
    const triggered = comparePredicateValue(obs.numericValue, predicate.comparator, predicate.threshold);
    return {
      triggered,
      observedValue: obs.numericValue,
      threshold: predicate.threshold,
      comparator: predicate.comparator,
      asOf: asOf.toISOString(),
      detail: {
        seriesId: predicate.seriesId,
        signalId: obs.id,
        observationDate: obs.publishedAt.toISOString(),
        unit: predicate.unit,
      },
    };
  }

  const windowStart = new Date(asOf.getTime() - predicate.windowHours * 3_600_000);
  const items = await reader.newsSignalsInWindow(windowStart, asOf);
  let matchedCount = 0;
  const matchedIds: string[] = [];

  for (const item of items) {
    const entities = extractEntities(`${item.title} ${item.summary ?? ''}`);
    if (predicate.entities.every((e) => entities.has(e))) {
      matchedCount++;
      if (matchedIds.length < 10) matchedIds.push(item.id);
    }
  }

  const triggered = comparePredicateValue(matchedCount, predicate.comparator, predicate.threshold);
  return {
    triggered,
    observedValue: matchedCount,
    threshold: predicate.threshold,
    comparator: predicate.comparator,
    asOf: asOf.toISOString(),
    detail: {
      entities: predicate.entities,
      windowStart: windowStart.toISOString(),
      windowHours: predicate.windowHours,
      scannedCount: items.length,
      matchedIds,
    },
  };
}

/**
 * Copies validated hedge predicates from a reasoning trace onto a newly
 * created position so the trader loop evaluates them every cycle.
 */
export async function attachTracePredicatesToPosition(
  positionId: string,
  traceId: string | null | undefined,
): Promise<number> {
  if (!traceId) return 0;

  const trace = await prisma.reasoningTrace.findUnique({
    where: { id: traceId },
    select: { hedgePredicates: true },
  });
  if (!trace?.hedgePredicates || !Array.isArray(trace.hedgePredicates)) return 0;

  const rows: Prisma.PositionPredicateCreateManyInput[] = [];
  for (const raw of trace.hedgePredicates) {
    const parsed = HedgePredicateSchema.safeParse(raw);
    if (!parsed.success) continue;
    rows.push({
      positionId,
      traceId,
      predicateId: parsed.data.id,
      kind: parsed.data.kind,
      action: parsed.data.action,
      predicate: parsed.data as unknown as Prisma.InputJsonValue,
      status: 'ACTIVE',
    });
  }

  if (rows.length === 0) return 0;

  const result = await prisma.positionPredicate.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}

export interface TriggeredPredicateResult {
  predicateRowId: string;
  predicate: HedgePredicate;
  evaluation: PredicateEvaluation;
}

/**
 * Evaluates all ACTIVE predicates for `positionId` as of `asOf` and
 * idempotently claims any that trigger using a conditional updateMany.
 */
export async function evaluatePositionPredicates(
  positionId: string,
  asOf: Date,
  cycleId: string,
  reader: SignalPredicateReader = prismaSignalPredicateReader,
): Promise<TriggeredPredicateResult[]> {
  const activeRows = await prisma.positionPredicate.findMany({
    where: { positionId, status: 'ACTIVE' },
    orderBy: { predicateId: 'asc' },
  });

  const triggered: TriggeredPredicateResult[] = [];

  for (const row of activeRows) {
    const parsed = HedgePredicateSchema.safeParse(row.predicate);
    if (!parsed.success) {
      logger.warn({ positionId, predicateRowId: row.id }, 'Invalid stored hedge predicate — cancelling');
      await prisma.positionPredicate.updateMany({
        where: { id: row.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED', evaluatedAt: asOf },
      });
      continue;
    }

    const evaluation = await evaluatePredicate(parsed.data, asOf, reader);
    if (!evaluation.triggered) {
      await prisma.positionPredicate.updateMany({
        where: { id: row.id, status: 'ACTIVE' },
        data: {
          evaluatedAt: asOf,
          evaluationResult: evaluation as unknown as Prisma.InputJsonValue,
        },
      });
      continue;
    }

    // Idempotent claim: only the cycle that transitions ACTIVE -> TRIGGERED acts.
    const claimed = await prisma.positionPredicate.updateMany({
      where: { id: row.id, status: 'ACTIVE' },
      data: {
        status: 'TRIGGERED',
        evaluatedAt: asOf,
        triggeredAt: asOf,
        triggerCycleId: cycleId,
        evaluationResult: evaluation as unknown as Prisma.InputJsonValue,
      },
    });

    if (claimed.count === 1) {
      triggered.push({
        predicateRowId: row.id,
        predicate: parsed.data,
        evaluation,
      });
    }
  }

  return triggered;
}

/** Marks remaining ACTIVE predicates on a closed position as CANCELLED. */
export async function cancelPositionPredicates(positionId: string): Promise<number> {
  const res = await prisma.positionPredicate.updateMany({
    where: { positionId, status: 'ACTIVE' },
    data: { status: 'CANCELLED' },
  });
  return res.count;
}
