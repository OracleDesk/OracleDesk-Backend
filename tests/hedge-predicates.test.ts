import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('validateAndGroundPredicates accepts grounded FRED and news entity predicates and drops ungrounded ones', async () => {
  const { validateAndGroundPredicates } = await import('../src/schemas/hedge-predicate');

  const res = validateAndGroundPredicates([
    {
      kind: 'fred_series',
      series_id: 'CPIAUCSL',
      entities: null,
      window_hours: null,
      comparator: 'gt',
      threshold: 315.0,
      unit: 'index',
      action: 'EXIT',
      description: 'Exit if CPI index exceeds 315',
    },
    {
      kind: 'news_entity_count',
      series_id: null,
      entities: ['FED', 'CPI'],
      window_hours: 48,
      comparator: 'gte',
      threshold: 3,
      unit: 'articles',
      action: 'REFORECAST',
      description: 'Reforecast if 3+ Fed+CPI articles appear in 48h',
    },
    {
      // Unknown FRED series -> dropped
      kind: 'fred_series',
      series_id: 'UNKNOWN_SERIES',
      entities: null,
      window_hours: null,
      comparator: 'gt',
      threshold: 5,
      unit: 'percent',
      action: 'EXIT',
      description: 'Invalid series',
    },
    {
      // Unknown entity -> dropped
      kind: 'news_entity_count',
      series_id: null,
      entities: ['NOT_A_REAL_ENTITY'],
      window_hours: 24,
      comparator: 'gte',
      threshold: 2,
      unit: 'articles',
      action: 'EXIT',
      description: 'Ungrounded entity',
    },
    {
      // Invalid unit for FEDFUNDS -> dropped
      kind: 'fred_series',
      series_id: 'FEDFUNDS',
      entities: null,
      window_hours: null,
      comparator: 'gte',
      threshold: 5.5,
      unit: 'articles',
      action: 'EXIT',
      description: 'Wrong unit',
    },
  ]);

  assert.equal(res.valid.length, 2);
  assert.equal(res.droppedCount, 3);
  assert.equal(res.valid[0].id, 'p1');
  assert.equal(res.valid[0].kind, 'fred_series');
  assert.equal(res.valid[1].id, 'p2');
  assert.equal(res.valid[1].kind, 'news_entity_count');
});

test('evaluatePredicate evaluates FRED series and news entity counts point-in-time', async () => {
  const { evaluatePredicate } = await import('../src/services/hedge-predicate.service');

  const asOf = new Date('2026-11-20T12:00:00Z');
  const reader = {
    async latestFredObservation(seriesId: string, cutoff: Date) {
      assert.equal(seriesId, 'FEDFUNDS');
      assert.equal(cutoff.getTime(), asOf.getTime());
      return {
        id: 'sig-fred-1',
        externalId: 'FEDFUNDS',
        numericValue: 5.25,
        publishedAt: new Date('2026-11-19T00:00:00Z'),
      };
    },
    async newsSignalsInWindow(windowStart: Date, cutoff: Date) {
      assert.equal(cutoff.getTime(), asOf.getTime());
      assert.equal(windowStart.getTime(), asOf.getTime() - 24 * 3_600_000);
      return [
        {
          id: 'n1',
          title: 'Federal Reserve signals pause on rate cuts',
          summary: 'FOMC members cite inflation.',
          publishedAt: new Date('2026-11-20T10:00:00Z'),
          firstSeenAt: new Date('2026-11-20T10:01:00Z'),
        },
        {
          id: 'n2',
          title: 'Fed officials warn on inflation',
          summary: null,
          publishedAt: new Date('2026-11-20T11:00:00Z'),
          firstSeenAt: new Date('2026-11-20T11:01:00Z'),
        },
        {
          id: 'n3',
          title: 'Unrelated sports headline',
          summary: null,
          publishedAt: new Date('2026-11-20T11:30:00Z'),
          firstSeenAt: new Date('2026-11-20T11:31:00Z'),
        },
      ];
    },
  };

  const fredHit = await evaluatePredicate(
    {
      id: 'p1',
      version: 1,
      kind: 'fred_series',
      seriesId: 'FEDFUNDS',
      comparator: 'gte',
      threshold: 5.0,
      unit: 'percent',
      action: 'EXIT',
      description: 'Fed funds >= 5%',
    },
    asOf,
    reader,
  );
  assert.equal(fredHit.triggered, true);
  assert.equal(fredHit.observedValue, 5.25);

  const newsHit = await evaluatePredicate(
    {
      id: 'p2',
      version: 1,
      kind: 'news_entity_count',
      entities: ['FED', 'CPI'],
      comparator: 'gte',
      threshold: 2,
      windowHours: 24,
      unit: 'articles',
      action: 'REFORECAST',
      description: '2+ Fed+CPI articles in 24h',
    },
    asOf,
    reader,
  );
  assert.equal(newsHit.triggered, true);
  assert.equal(newsHit.observedValue, 2);
});

test('buildTraceDocV2 pins hedgePredicates when provided and null when absent', async () => {
  const { buildTraceDocV2 } = await import('../src/schemas/trace');
  const now = new Date('2026-11-20T12:00:00Z');
  const base = {
    traceId: '11111111-1111-4111-8111-111111111111',
    agentType: 'TRADER' as const,
    decisionType: 'OPEN_POSITION',
    action: 'BUY_YES',
    backendMarketId: '22222222-2222-4222-8222-222222222222',
    onChainMarketId: 1n,
    probabilityEstimate: 0.65,
    marketProbability: 0.50,
    edge: 0.15,
    confidenceInterval: { lower: 0.55, upper: 0.75 },
    sourcesUsed: [],
    provenance: {
      schema: 'oracledesk.trace.provenance/1' as const,
      llm: [{ source: 'default' as const, promptId: 'hedge-conditions', promptVersion: 2, reason: 'LLM_FAILED' as const }],
      generator: { service: 'oracledesk-backend' as const, version: '1.0.0' },
    },
    hedgeConditions: ['Exit if UNRATE >= 5%'],
    hedgePredicates: [
      {
        id: 'p1',
        version: 1 as const,
        kind: 'fred_series' as const,
        seriesId: 'UNRATE' as const,
        comparator: 'gte' as const,
        threshold: 5,
        unit: 'percent' as const,
        action: 'EXIT' as const,
        description: 'Exit if UNRATE >= 5%',
      },
    ],
  };

  const doc = buildTraceDocV2(base, now);
  assert.equal(doc.hedgePredicates?.length, 1);
  assert.equal(doc.hedgePredicates?.[0].kind, 'fred_series');
});
