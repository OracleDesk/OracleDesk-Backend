import { z } from 'zod';
import { isKnownEntityId } from '../services/dedup-entities';

export const HEDGE_PREDICATE_SCHEMA_VERSION = 1 as const;

export const FRED_SERIES_IDS = ['FEDFUNDS', 'CPIAUCSL', 'UNRATE', 'T10Y2Y'] as const;
export type FredSeriesId = (typeof FRED_SERIES_IDS)[number];

export const PREDICATE_COMPARATORS = ['gt', 'gte', 'lt', 'lte'] as const;
export type PredicateComparator = (typeof PREDICATE_COMPARATORS)[number];

export const PREDICATE_ACTIONS = ['EXIT', 'REFORECAST'] as const;
export type PredicateAction = (typeof PREDICATE_ACTIONS)[number];

/** Expected units per FRED series so ungrounded unit/series pairs are rejected. */
export const FRED_SERIES_UNITS: Record<FredSeriesId, ReadonlyArray<'percent' | 'index' | 'spread'>> = {
  FEDFUNDS: ['percent'],
  CPIAUCSL: ['index', 'percent'],
  UNRATE: ['percent'],
  T10Y2Y: ['spread', 'percent'],
};

export const FredSeriesPredicateSchema = z
  .object({
    id: z.string().min(1).max(32),
    version: z.literal(HEDGE_PREDICATE_SCHEMA_VERSION),
    kind: z.literal('fred_series'),
    seriesId: z.enum(FRED_SERIES_IDS),
    comparator: z.enum(PREDICATE_COMPARATORS),
    threshold: z.number().finite(),
    unit: z.enum(['percent', 'index', 'spread']),
    action: z.enum(PREDICATE_ACTIONS),
    description: z.string().min(1).max(500),
  })
  .strict();

export const NewsEntityCountPredicateSchema = z
  .object({
    id: z.string().min(1).max(32),
    version: z.literal(HEDGE_PREDICATE_SCHEMA_VERSION),
    kind: z.literal('news_entity_count'),
    entities: z.array(z.string().min(1).max(64)).min(1).max(5),
    comparator: z.enum(PREDICATE_COMPARATORS),
    threshold: z.number().int().min(1).max(1000),
    windowHours: z.number().int().min(1).max(720),
    unit: z.literal('articles'),
    action: z.enum(PREDICATE_ACTIONS),
    description: z.string().min(1).max(500),
  })
  .strict();

export const HedgePredicateSchema = z.discriminatedUnion('kind', [
  FredSeriesPredicateSchema,
  NewsEntityCountPredicateSchema,
]);

export type FredSeriesPredicate = z.infer<typeof FredSeriesPredicateSchema>;
export type NewsEntityCountPredicate = z.infer<typeof NewsEntityCountPredicateSchema>;
export type HedgePredicate = z.infer<typeof HedgePredicateSchema>;

/** Wire shape emitted by the LLM structured spec (flat object for Gemini/OpenAI compatibility). */
export interface LlmHedgePredicateWire {
  kind: 'fred_series' | 'news_entity_count';
  series_id: string | null;
  entities: string[] | null;
  window_hours: number | null;
  comparator: PredicateComparator;
  threshold: number;
  unit: 'percent' | 'index' | 'spread' | 'articles';
  action: PredicateAction;
  description: string;
}

export const MAX_HEDGE_PREDICATES = 10;

export interface PredicateGroundingResult {
  valid: HedgePredicate[];
  droppedCount: number;
  droppedReasons: string[];
}

/**
 * Validates and grounds raw LLM predicate candidates to observable FRED series
 * and canonical entity IDs. Predicates that do not ground are dropped and counted.
 */
export function validateAndGroundPredicates(
  raw: ReadonlyArray<LlmHedgePredicateWire | Record<string, unknown>> | null | undefined,
): PredicateGroundingResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { valid: [], droppedCount: 0, droppedReasons: [] };
  }

  const valid: HedgePredicate[] = [];
  const droppedReasons: string[] = [];
  let droppedCount = 0;

  for (const item of raw) {
    if (valid.length >= MAX_HEDGE_PREDICATE_COUNT) {
      droppedCount++;
      droppedReasons.push('MAX_PREDICATES_EXCEEDED');
      continue;
    }

    const id = `p${valid.length + 1}`;
    const desc = typeof item.description === 'string' ? item.description.trim().slice(0, 500) : '';

    if (item.kind === 'fred_series') {
      const seriesId = (item as LlmHedgePredicateWire).series_id ?? (item as { seriesId?: unknown }).seriesId;
      if (typeof seriesId !== 'string' || !(FRED_SERIES_IDS as readonly string[]).includes(seriesId)) {
        droppedCount++;
        droppedReasons.push(`UNGROUNDED_FRED_SERIES:${String(seriesId)}`);
        continue;
      }
      const allowedUnits = FRED_SERIES_UNITS[seriesId as FredSeriesId];
      if (typeof item.unit !== 'string' || !(allowedUnits as readonly string[]).includes(item.unit)) {
        droppedCount++;
        droppedReasons.push(`INVALID_FRED_UNIT:${seriesId}:${String(item.unit)}`);
        continue;
      }
      const parsed = FredSeriesPredicateSchema.safeParse({
        id,
        version: HEDGE_PREDICATE_SCHEMA_VERSION,
        kind: 'fred_series',
        seriesId,
        comparator: item.comparator,
        threshold: item.threshold,
        unit: item.unit,
        action: item.action,
        description: desc,
      });
      if (!parsed.success) {
        droppedCount++;
        droppedReasons.push(`INVALID_FRED_PREDICATE:${parsed.error.issues[0]?.message ?? 'schema'}`);
        continue;
      }
      valid.push(parsed.data);
      continue;
    }

    if (item.kind === 'news_entity_count') {
      const rawEntities = (item as LlmHedgePredicateWire).entities;
      if (!Array.isArray(rawEntities) || rawEntities.length === 0) {
        droppedCount++;
        droppedReasons.push('MISSING_ENTITIES');
        continue;
      }
      const normalizedEntities = rawEntities
        .map((e) => (typeof e === 'string' ? e.trim() : ''))
        .filter(Boolean);
      const ungrounded = normalizedEntities.filter((e) => !isKnownEntityId(e));
      if (normalizedEntities.length === 0 || ungrounded.length > 0) {
        droppedCount++;
        droppedReasons.push(`UNGROUNDED_ENTITIES:${ungrounded.join(',') || 'empty'}`);
        continue;
      }
      const windowHours = (item as LlmHedgePredicateWire).window_hours ?? (item as { windowHours?: unknown }).windowHours;
      const parsed = NewsEntityCountPredicateSchema.safeParse({
        id,
        version: HEDGE_PREDICATE_SCHEMA_VERSION,
        kind: 'news_entity_count',
        entities: normalizedEntities,
        comparator: item.comparator,
        threshold: item.threshold,
        windowHours,
        unit: item.unit,
        action: item.action,
        description: desc,
      });
      if (!parsed.success) {
        droppedCount++;
        droppedReasons.push(`INVALID_NEWS_PREDICATE:${parsed.error.issues[0]?.message ?? 'schema'}`);
        continue;
      }
      valid.push(parsed.data);
      continue;
    }

    droppedCount++;
    droppedReasons.push(`UNKNOWN_KIND:${String((item as { kind?: unknown }).kind)}`);
  }

  return { valid, droppedCount, droppedReasons };
}

const MAX_HEDGE_PREDICATE_COUNT = MAX_HEDGE_PREDICATES;

/** Evaluates a numeric comparator cleanly without floating-point surprises. */
export function comparePredicateValue(
  observed: number,
  comparator: PredicateComparator,
  threshold: number,
): boolean {
  if (!Number.isFinite(observed) || !Number.isFinite(threshold)) return false;
  switch (comparator) {
    case 'gt': return observed > threshold;
    case 'gte': return observed >= threshold;
    case 'lt': return observed < threshold;
    case 'lte': return observed <= threshold;
  }
}
