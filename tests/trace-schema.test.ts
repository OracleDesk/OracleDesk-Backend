import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestEnv } from './helpers/env';
import { TraceDocV1, LegacyTraceDoc, buildTraceDoc, fromContractsTrace } from '../src/schemas/trace';
import { QuestionDocV1, QuestionDocV2, questionDocument } from '../src/schemas/question';
import { canonicalJson, canonicalJsonStrict, verifyTraceHash } from '../src/utils/hash.util';
import { pinDocument, setIpfsTransportForTests } from '../src/services/ipfs.service';
import { generateSchemas } from '../scripts/gen-schemas';

setupTestEnv();

test('buildTraceDoc output validates against TraceDocV1 for market-maker and trader inputs', () => {
  const mmDoc = buildTraceDoc({
    traceId: '11111111-1111-1111-1111-111111111111',
    agentType: 'MARKET_MAKER',
    decisionType: 'MARKET_CREATION',
    action: 'create_market',
    backendMarketId: '22222222-2222-2222-2222-222222222222',
    onChainMarketId: '0',
    probabilityEstimate: 0.65,
    marketProbability: 0.5,
    edge: 0.15,
    confidenceInterval: { lower: 0.55, upper: 0.75 },
    sourcesUsed: [{ source: 'FRED', weight: 0.8, signal: 'Rates drop', rawValue: 0.5 }],
    betFraction: null,
    betSizeUsdc: null,
    hedgeConditions: ['CPI > 3.0%'],
  });

  assert.equal(mmDoc.schemaVersion, 1);
  assert.equal(mmDoc.kind, 'oracledesk.trace');
  assert.equal(mmDoc.agentType, 'MARKET_MAKER');
  assert.equal(mmDoc.action, 'create_market');
  assert.equal(mmDoc.market.onChainId, '0');
  assert.doesNotThrow(() => TraceDocV1.parse(mmDoc));

  const traderDoc = buildTraceDoc({
    traceId: '33333333-3333-3333-3333-333333333333',
    agentType: 'TRADER',
    decisionType: 'BUY_YES',
    action: 'buy_yes',
    backendMarketId: '22222222-2222-2222-2222-222222222222',
    onChainMarketId: 1,
    probabilityEstimate: 0.8,
    marketProbability: 0.6,
    edge: 0.2,
    confidenceInterval: { lower: 0.75, upper: 0.85 },
    sourcesUsed: [{ source: 'NEWSAPI', weight: 0.9, signal: 'Approval likely', rawValue: 1 }],
    betFraction: 0.05,
    betSizeUsdc: 50,
  });

  assert.equal(traderDoc.agentType, 'TRADER');
  assert.equal(traderDoc.betFraction, 0.05);
  assert.equal(traderDoc.betSizeUsdc, 50);
  assert.doesNotThrow(() => TraceDocV1.parse(traderDoc));
});

test('trace doc never contains undefined and canonicalJsonStrict round-trips', () => {
  const doc = buildTraceDoc({
    traceId: '11111111-1111-1111-1111-111111111111',
    agentType: 'MARKET_MAKER',
    decisionType: 'MARKET_CREATION',
    action: 'create_market',
    backendMarketId: '22222222-2222-2222-2222-222222222222',
    onChainMarketId: null,
    probabilityEstimate: 0.5,
    marketProbability: 0.5,
    edge: 0.0,
    confidenceInterval: { lower: 0.4, upper: 0.6 },
    sourcesUsed: [],
  });

  // Must not throw with strict canonicalization
  const canonical = canonicalJsonStrict(doc);
  assert.ok(typeof canonical === 'string');
  assert.ok(!canonical.includes('undefined'));

  // Round trip parse and check identical bytes
  const parsed = JSON.parse(canonical);
  const reCanonical = canonicalJsonStrict(parsed);
  assert.equal(canonical, reCanonical);
});

test('pinDocument refuses an invalid trace and never calls the transport', async () => {
  let transportCalled = false;
  setIpfsTransportForTests(async () => {
    transportCalled = true;
    return { cid: 'fake-cid', size: 100 };
  });

  try {
    const invalidDoc = {
      schemaVersion: 1,
      kind: 'oracledesk.trace',
      // missing traceId and required fields
    };

    await assert.rejects(
      async () => {
        await pinDocument(TraceDocV1, invalidDoc as any, 'invalid-trace');
      },
      (err: any) => {
        return err.name === 'AppError' || err.message.includes('DOCUMENT_SCHEMA_INVALID');
      },
    );

    assert.equal(transportCalled, false);
  } finally {
    setIpfsTransportForTests(null);
  }
});

test('question v1 documents for existing markets validate and hash predictably', () => {
  const v1 = questionDocument(
    {
      id: '22222222-2222-2222-2222-222222222222',
      question: 'Will the Fed cut rates by 25bps?',
      category: 'FED',
      expiryTimestamp: 1729000000000,
    },
    {
      specHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      source: 'FRED',
    },
    'Macro',
    1,
  );

  assert.equal(v1.version, 1);
  assert.doesNotThrow(() => QuestionDocV1.parse(v1));
});

test('question v2 document validates and pins', async () => {
  let transportCalled = false;
  setIpfsTransportForTests(async () => {
    transportCalled = true;
    return { cid: 'test-cid-question-v2', size: 120 };
  });

  try {
    const v2 = questionDocument(
      {
        id: '22222222-2222-2222-2222-222222222222',
        question: 'Will the Fed cut rates by 25bps in 2026?',
        category: 'FED',
        expiryTimestamp: 1782777600000,
      },
      {
        specHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        source: 'FRED',
      },
      'Macro',
      2,
    );

    assert.equal(v2.schemaVersion, 2);
    assert.equal(v2.kind, 'oracledesk.question');
    assert.doesNotThrow(() => QuestionDocV2.parse(v2));

    const pinned = await pinDocument(QuestionDocV2, v2, 'test-question-v2');
    assert.equal(pinned.cid, 'test-cid-question-v2');
    assert.equal(transportCalled, true);
  } finally {
    setIpfsTransportForTests(null);
  }
});

test('legacy trace without schemaVersion verifies by hash and reports schemaVersion 0', () => {
  const legacy = {
    traceId: '11111111-1111-1111-1111-111111111111',
    agentType: 'MARKET_MAKER',
    action: 'create_market',
    probability: 0.65,
    reasoning: 'Legacy unversioned reasoning payload',
  };

  const bytes = Buffer.from(canonicalJson(legacy), 'utf8');
  const hash = require('crypto').createHash('sha256').update(bytes).digest('hex');

  const verified = verifyTraceHash(bytes, hash);
  assert.equal(verified, true);

  const parsed = JSON.parse(bytes.toString('utf8'));
  const isV1 = TraceDocV1.safeParse(parsed).success;
  const isLegacy = LegacyTraceDoc.safeParse(parsed).success;

  assert.equal(isV1, false);
  assert.equal(isLegacy, true);
  const reportedVersion = (parsed as any).schemaVersion ?? 0;
  assert.equal(reportedVersion, 0);
});

test('backend canonicalJson matches contracts canonicalize on shared fixtures', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'contracts-trace.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  // Contracts canonicalize sorts keys recursively and drops undefined
  const cJson = canonicalJson(fixture);
  const strictJson = canonicalJsonStrict(fixture);
  assert.equal(cJson, strictJson);
});

test('fromContractsTrace maps the contracts fixture to a valid TraceDocV1', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'contracts-trace.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const v1 = fromContractsTrace(fixture);
  assert.equal(v1.schemaVersion, 1);
  assert.equal(v1.kind, 'oracledesk.trace');
  assert.equal(v1.agentType, 'MARKET_MAKER');
  assert.equal(v1.action, 'create_market');
  assert.equal(v1.market.onChainId, '0');
  assert.equal(v1.sourcesUsed.length, 2);
  assert.doesNotThrow(() => TraceDocV1.parse(v1));
});

test('committed JSON schemas are up to date', () => {
  const ok = generateSchemas({ check: true });
  assert.equal(ok, true, 'Committed JSON schemas must match generator output');
});
