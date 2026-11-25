import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

import { resolutionHash, type ResolutionSpecJson } from '../src/lib/resolution-spec';
import { sha256Hex } from '../src/utils/hash.util';
import {
  buildMarketProvenance,
  clearProvenanceCacheForTest,
  type ProvenanceDeps,
} from '../src/services/provenance.service';
import { checkTraceAgainstRegistry } from '../src/services/trace-publish.service';

const AGENT = Keypair.random().publicKey();
const SIGNER = Keypair.random().publicKey();
const SPEC: ResolutionSpecJson = {
  kind: 'signers',
  signers: [SIGNER],
  threshold: 1,
  disputeWindow: 86_400,
};
const RES_HASH = resolutionHash(SPEC).toString('hex');
const QUESTION_BYTES = Buffer.from(JSON.stringify({ version: 2, question: 'Will BTC exceed 100k?' }), 'utf8');
const QUESTION_HASH = sha256Hex(QUESTION_BYTES);
const TRACE_BYTES = Buffer.from(JSON.stringify({ secretPremiumAnalysis: 'DO NOT LEAK', prob: 0.72 }), 'utf8');
const TRACE_HASH = sha256Hex(TRACE_BYTES);

function makeFakePrisma(marketOverride: Record<string, unknown> = {}, indexedEvents: any[] = []) {
  let traceUpdateCalls = 0;
  const baseMarket = {
    id: 'market-prov-1',
    onChainMarketId: 7n,
    questionHash: QUESTION_HASH,
    metaUri: 'ipfs://bafyquestion',
    resolutionHash: RES_HASH,
    resolutionSpec: SPEC,
    generationProvenance: {
      source: 'llm',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      promptId: 'market-proposal',
      promptVersion: 1,
      promptHash: 'abcd',
      outputSha256: '1234',
    },
    creationTxHash: 'a'.repeat(64),
    creationInnerTxHash: 'b'.repeat(64),
    chainSyncedLedger: 100,
    updatedAt: new Date('2026-10-20T00:00:00Z'),
    creationAttempt: { txHash: 'c'.repeat(64), questionHash: QUESTION_HASH, resolutionHash: RES_HASH },
    reasoningTraces: [
      {
        id: 'trace-1',
        onChainTraceId: 11n,
        traceHash: TRACE_HASH,
        ipfsCid: 'bafytrace11',
        agentWallet: AGENT,
        updatedAt: new Date('2026-10-20T00:01:00Z'),
        publication: null,
      },
    ],
    ...marketOverride,
  };

  return {
    get traceUpdateCalls() {
      return traceUpdateCalls;
    },
    market: {
      findUnique: async () => baseMarket,
    },
    chainEvent: {
      findFirst: async ({ where }: any) => {
        return (
          indexedEvents.find((ev) => {
            if (where.txHash && ev.txHash !== where.txHash) return false;
            if (where.eventName && ev.eventName !== where.eventName) return false;
            if (where.params?.equals && String(ev.params?.market_id) !== where.params.equals) return false;
            return true;
          }) ?? null
        );
      },
    },
    reasoningTrace: {
      update: async () => {
        traceUpdateCalls++;
      },
    },
  };
}

function makeDeps(fakePrisma: any, over: Partial<ProvenanceDeps> = {}): ProvenanceDeps {
  return {
    prisma: fakePrisma,
    bypassCache: true,
    getOnChainMarketWithLedger: async () => ({
      ledger: 120,
      market: {
        question_hash: Buffer.from(QUESTION_HASH, 'hex'),
        resolution_hash: Buffer.from(RES_HASH, 'hex'),
        meta_uri: 'ipfs://bafyquestion',
        creator: AGENT,
        fee_bps: 100,
      } as any,
    }),
    getOnChainTraceOrNull: async () => ({
      trace_hash: Buffer.from(TRACE_HASH, 'hex'),
      ipfs_cid: 'bafytrace11',
      market_id: 7n,
      agent: AGENT,
      action: 'trade',
      published_at: 1_700_000_000n,
    }),
    resolverStateWithLedger: async () => ({
      ledger: 121,
      value: { tag: 'SignersConfigured', values: [] } as any,
    }),
    getTransaction: async (hash: string) => {
      if (hash === 'a'.repeat(64)) return { status: 'NOT_FOUND' };
      if (hash === 'b'.repeat(64)) return { status: 'SUCCESS', ledger: 115 };
      return { status: 'NOT_FOUND' };
    },
    fetchVerifiedBytes: async (cid: string) => {
      if (cid === 'bafyquestion') return { bytes: QUESTION_BYTES, source: 'cache' as const };
      if (cid === 'bafytrace11') return { bytes: TRACE_BYTES, source: 'gateway' as const };
      throw new Error('IPFS unavailable');
    },
    ...over,
  };
}

test('buildMarketProvenance verifies the complete chain, stays read-only, and never leaks trace content', async () => {
  const fakePrisma = makeFakePrisma({}, [
    {
      id: 'ev-mc-1',
      txHash: 'b'.repeat(64),
      eventName: 'MarketCreated',
      ledger: 115,
      params: { market_id: '7' },
    },
  ]);

  const prov = await buildMarketProvenance('market-prov-1', makeDeps(fakePrisma));
  assert.equal(prov.marketId, 'market-prov-1');
  assert.equal(prov.onChainMarketId, '7');
  assert.equal(prov.asOfLedger, 121);
  assert.equal(prov.summary.mismatched, 0);
  assert.equal(prov.summary.pending, 0);
  assert.equal(prov.summary.unavailable, 0);
  assert.equal(prov.summary.verified, 8); // 6 market links + 2 trace links

  // Read-only: must never write audit fields on ReasoningTrace
  assert.equal(fakePrisma.traceUpdateCalls, 0);

  // No premium leakage in serialized response
  const json = JSON.stringify(prov);
  assert.ok(!json.includes('DO NOT LEAK'));
  assert.ok(!json.includes('previewSources'));

  // Links are ordered and include copy-pastable verify commands
  assert.deepEqual(
    prov.links.map((l) => l.name),
    [
      'proposal',
      'question_document',
      'question_commitment',
      'resolution_commitment',
      'resolver_registration',
      'creation_transaction',
    ],
  );
  assert.ok(prov.links[1].verifyCommand?.includes('sha256sum'));
  assert.ok(prov.links[2].verifyCommand?.includes('get_market'));
  assert.ok(prov.traces[0].links[0].verifyCommand?.includes('get_trace'));
});

test('buildMarketProvenance handles NOT_APPLICABLE, PENDING, MISMATCH and UNAVAILABLE modes', async () => {
  const fakePrisma = makeFakePrisma(
    {
      generationProvenance: null, // pre-#66 -> NOT_APPLICABLE
      resolutionSpec: null, // unrevealed -> PENDING
      reasoningTraces: [
        {
          id: 'trace-pending',
          onChainTraceId: null,
          traceHash: null,
          ipfsCid: null,
          agentWallet: null,
          publication: { status: 'AWAITING_MARKET', submittedTxHash: null },
        },
      ],
    },
    [],
  );

  const prov = await buildMarketProvenance(
    'market-prov-1',
    makeDeps(fakePrisma, {
      getTransaction: async () => ({ status: 'NOT_FOUND' }),
      fetchVerifiedBytes: async () => {
        throw new Error('gateway 504');
      },
      resolverStateWithLedger: async () => ({
        ledger: 121,
        value: { tag: 'Unconfigured', values: undefined } as any,
      }),
    }),
  );

  const byName = Object.fromEntries(prov.links.map((l) => [l.name, l]));
  assert.equal(byName.proposal.status, 'NOT_APPLICABLE');
  assert.equal(byName.question_document.status, 'UNAVAILABLE');
  assert.equal(byName.question_document.reason, 'IPFS_UNREACHABLE');
  assert.equal(byName.resolution_commitment.status, 'PENDING');
  assert.equal(byName.resolver_registration.status, 'PENDING');
  assert.equal(byName.creation_transaction.status, 'UNAVAILABLE');
  assert.equal(byName.creation_transaction.reason, 'OUTSIDE_RETENTION');
  assert.equal(prov.traces[0].links[0].status, 'PENDING');
  assert.equal(prov.traces[0].links[0].reason, 'AWAITING_MARKET');
});

test('buildMarketProvenance falls back to indexed MarketCreated event past RPC retention', async () => {
  const fakePrisma = makeFakePrisma({}, [
    {
      id: 'ev-indexed-7',
      txHash: 'd'.repeat(64),
      eventName: 'MarketCreated',
      ledger: 99,
      params: { market_id: '7' },
    },
  ]);

  const prov = await buildMarketProvenance(
    'market-prov-1',
    makeDeps(fakePrisma, {
      getTransaction: async () => ({ status: 'NOT_FOUND' }),
    }),
  );

  const creation = prov.links.find((l) => l.name === 'creation_transaction')!;
  assert.equal(creation.status, 'VERIFIED');
  assert.equal(creation.evidence?.source, 'indexed');
  assert.equal(creation.evidence?.txHash, 'd'.repeat(64));
});

test('buildMarketProvenance coalesces concurrent cache misses (single-flight)', async () => {
  clearProvenanceCacheForTest();
  let marketCalls = 0;
  const fakePrisma = makeFakePrisma({}, [
    { id: 'ev-1', txHash: 'b'.repeat(64), eventName: 'MarketCreated', ledger: 115, params: { market_id: '7' } },
  ]);
  const deps = makeDeps(fakePrisma, {
    bypassCache: false,
    getOnChainMarketWithLedger: async () => {
      marketCalls++;
      await new Promise((r) => setTimeout(r, 25));
      return {
        ledger: 120,
        market: {
          question_hash: Buffer.from(QUESTION_HASH, 'hex'),
          resolution_hash: Buffer.from(RES_HASH, 'hex'),
          meta_uri: 'ipfs://bafyquestion',
        } as any,
      };
    },
  });

  const [a, b] = await Promise.all([
    buildMarketProvenance('market-prov-1', deps),
    buildMarketProvenance('market-prov-1', deps),
  ]);
  assert.equal(marketCalls, 1);
  assert.equal(a.inputsDigest, b.inputsDigest);
  clearProvenanceCacheForTest();
});

test('checkTraceAgainstRegistry verifies trace without performing any DB writes', async () => {
  const res = await checkTraceAgainstRegistry(
    {
      id: 'trace-1',
      onChainTraceId: 11n,
      traceHash: TRACE_HASH,
      ipfsCid: 'bafytrace11',
    },
    {
      getOnChainTrace: async () => ({
        trace_hash: Buffer.from(TRACE_HASH, 'hex'),
        ipfs_cid: 'bafytrace11',
        market_id: 7n,
        agent: AGENT,
      }),
      fetchVerifiedBytes: async () => ({ bytes: TRACE_BYTES, source: 'cache' }),
    },
  );
  assert.equal(res.hashMatchesStored, true);
  assert.equal(res.cidMatchesStored, true);
  assert.equal(res.bytesVerified, true);
  assert.equal(res.computedHash, TRACE_HASH);
});
