import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('market proposal validation accepts strict binary JSON and rejects malformed confidence intervals', async () => {
  const { validateMarketQuestion } = await import('../src/services/market.service');

  const valid = validateMarketQuestion(JSON.stringify({
    market_question: 'Will the Federal Reserve cut rates by June 30, 2026?',
    initial_yes_probability: 0.62,
    resolution_oracle: 'FRED',
    expiry_timestamp: 1782777600,
    settlement_currency: 'USDC',
    minimum_liquidity_usdc: 100,
    category: 'FED',
    confidence_interval: { lower: 0.52, upper: 0.72 },
    reasoning: 'Fed signals and inflation trends support a rate cut probability.',
    grounding_signal_ids: ['n1'],
  }));

  assert.equal(valid.category, 'FED');
  assert.equal(valid.initial_yes_probability, 0.62);

  assert.throws(() => validateMarketQuestion(JSON.stringify({
    ...valid,
    confidence_interval: { lower: 0.7, upper: 0.8 },
  })), /Probability must be within the confidence interval/);
});

test('probability, confidence interval, and edge calculations are deterministic', async () => {
  const { calculateProbability } = await import('../src/services/market.service');
  const { calculateConfidenceInterval, calculateEdge } = await import('../src/services/reasoning.service');

  const signals = [
    { source: 'FRED', weight: 0.9, signal: 'Rates falling', rawValue: 0.7 },
    { source: 'NEWSAPI', weight: 0.7, signal: 'Dovish comments', rawValue: 0.6 },
    { source: 'GDELT', weight: 0.6, signal: 'Macro stress', rawValue: 0.55 },
  ];

  const estimate = calculateProbability(signals, 0.5);
  const ci = calculateConfidenceInterval(signals, estimate.probability);

  assert.equal(calculateEdge(0.68, 0.51), 0.17);
  assert.ok(estimate.probability > 0.59);
  assert.ok(estimate.confidenceInterval.lower < estimate.probability);
  assert.ok(ci.lower <= ci.upper);
});

test('kelly sizing caps single-position exposure', async () => {
  const { calculateKellySize } = await import('../src/services/trade.service');

  const { compiledTraderParamsV1 } = await import('../src/lib/risk-params');
  const result = calculateKellySize(
    {
      agentProbability: 0.7,
      marketProbability: 0.5,
      bankroll: 10_000,
      netOdds: 1,
    },
    compiledTraderParamsV1(),
  );

  assert.equal(result.halfKelly, 0.025);
  assert.equal(result.betSize, 250);
});


test('questionDocument emits v1 unchanged without resolutionDetails and v2 with it; both hash deterministically', async () => {
  const { questionDocument } = await import('../src/services/market-chain.service');
  const { canonicalBytes, sha256Hex } = await import('../src/utils/hash.util');
  const market: any = {
    id: 'm1', question: 'Will CPI for September 2026 exceed 3%?', category: 'MACRO',
    expiryTimestamp: new Date('2026-10-17T05:00:00Z'), resolutionOracle: 'BLS', resolutionDetails: null,
  };
  const hash = 'ab'.repeat(32);

  const v1 = questionDocument(market, hash);
  assert.equal(v1.version, 1);
  assert.ok(!('resolution' in v1));
  assert.deepEqual(Object.keys(v1).sort(), [
    'backendMarketId', 'category', 'closeTime', 'contractCategory', 'question', 'resolutionHash', 'resolutionSource', 'version',
  ]);
  assert.equal(sha256Hex(canonicalBytes(v1)), sha256Hex(canonicalBytes(questionDocument(market, hash))));

  const resolution = {
    sourceId: 'BLS', url: 'https://www.bls.gov/news.release/', measurable: 'CPI', comparator: '>',
    threshold: { value: 3, unit: '%', text: '3%' }, deadlineUtc: '2026-10-01T03:59:59.000Z', instructions: 'First release only.',
  };
  const v2 = questionDocument({ ...market, resolutionDetails: resolution }, hash);
  assert.equal(v2.version, 2);
  assert.deepEqual((v2 as any).resolution, resolution);
  assert.equal(sha256Hex(canonicalBytes(v2)), sha256Hex(canonicalBytes(questionDocument({ ...market, resolutionDetails: resolution }, hash))));
  assert.notEqual(sha256Hex(canonicalBytes(v1)), sha256Hex(canonicalBytes(v2)));
  // v1 fields are a subset of v2, so v1 readers keep working.
  for (const [k, v] of Object.entries(v1)) if (k !== 'version') assert.deepEqual((v2 as any)[k], v);
});

// ─── generateReasoningTrace on TraceDocV2 (#227) ─────────────────────────────

async function withTraceStubs<T>(
  market: { onChainMarketId: bigint | null } | null,
  fn: (created: any[]) => Promise<T>,
): Promise<T> {
  const { prisma } = await import('../src/lib/prisma');
  const llm = await import('../src/lib/llm');
  const budget = await import('../src/lib/llm-budget');
  const created: any[] = [];
  const orig = { create: prisma.reasoningTrace.create, findUnique: prisma.market.findUnique };
  (prisma.reasoningTrace.create as any) = async ({ data }: any) => {
    created.push(data);
    return { ...data, createdAt: new Date(), updatedAt: new Date() };
  };
  (prisma.market.findUnique as any) = async () => market;
  const prevCaller = llm.setLlmJsonCaller(async () =>
    JSON.stringify({ hedge_conditions: ['Close if CPI exceeds 3.5%'], reasoning_summary: 'CPI drives it.', key_signals: ['CPI'], risk_factors: ['Revision'] }),
  );
  const prevStore = budget.setLlmGuardStore(new budget.MemoryGuardStore());
  try {
    return await fn(created);
  } finally {
    (prisma.reasoningTrace.create as any) = orig.create;
    (prisma.market.findUnique as any) = orig.findUnique;
    llm.setLlmJsonCaller(prevCaller);
    budget.setLlmGuardStore(prevStore);
  }
}

const TRACE_INPUT = {
  marketId: '22222222-2222-4222-8222-222222222222',
  agentType: 'TRADER' as const,
  decisionType: 'OPEN_POSITION',
  sourcesUsed: [{ source: 'NEWSAPI', weight: 0.7, signal: 'Fed holds', signalId: 'sig_1', url: 'https://example.com/a', publisher: 'Wire', publishedAt: '2026-10-16T00:00:00Z' }],
  probabilityEstimate: 0.6,
  marketProbability: 0.5,
  edge: 0.1,
  confidenceInterval: { lower: 0.5, upper: 0.7 },
  betFraction: 0.05,
  betSizeUsdc: 10,
};

test('generateReasoningTrace: row id equals tracePayload.traceId and the payload is a valid TraceDocV2', async () => {
  const { generateReasoningTrace } = await import('../src/services/reasoning.service');
  const { TraceDocV2 } = await import('../src/schemas/trace');
  const { FakeClock, setClock } = await import('../src/lib/clock');
  const prev = setClock(new FakeClock(new Date('2026-10-18T12:00:00Z')));
  try {
    await withTraceStubs({ onChainMarketId: 9n }, async (created) => {
      const { trace, tracePayload } = await generateReasoningTrace(TRACE_INPUT);
      assert.equal(created.length, 1);
      assert.equal(created[0].id, tracePayload.traceId);
      assert.equal(trace.id, tracePayload.traceId);
      assert.doesNotThrow(() => TraceDocV2.parse(tracePayload));
      assert.equal(tracePayload.market.onChainId, '9');
      assert.equal(tracePayload.createdAt, '2026-10-18T12:00:00.000Z', 'createdAt comes from lib/clock');
      assert.equal(tracePayload.provenance.llm.length, 1);
      assert.equal(tracePayload.sourcesUsed[0].signalId, 'sig_1');
    });
  } finally {
    setClock(prev);
  }
});

test('generateReasoningTrace: a missing market row yields market.onChainId null', async () => {
  const { generateReasoningTrace } = await import('../src/services/reasoning.service');
  await withTraceStubs(null, async () => {
    const { tracePayload } = await generateReasoningTrace(TRACE_INPUT);
    assert.equal(tracePayload.market.onChainId, null);
  });
});

test('generateReasoningTrace: an invalid document throws TRACE_DOC_INVALID and writes no row', async () => {
  const { generateReasoningTrace } = await import('../src/services/reasoning.service');
  await withTraceStubs(null, async (created) => {
    await assert.rejects(
      generateReasoningTrace({ ...TRACE_INPUT, marketId: 'not-a-uuid' }),
      (err: any) => err.code === 'TRACE_DOC_INVALID' && err.statusCode === 422 && Array.isArray(err.details?.issues),
    );
    assert.equal(created.length, 0);
  });
});
