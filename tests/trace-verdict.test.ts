import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

import { sha256Hex } from '../src/utils/hash.util';
import {
  mapBindingVerdict,
  runTraceAudit,
  runVerdictRecheck,
  getFreshTraceVerdict,
  clearLiveVerdictCacheForTest,
  TraceVerdictKind,
  type RegistryReader,
} from '../src/services/trace-audit.service';
import { AlertService, type Alert, type AlertSink } from '../src/services/alerts.service';

const BACKEND_AGENT = Keypair.random().publicKey();
const OTHER_AGENT = Keypair.random().publicKey();

class MemorySink implements AlertSink {
  sent: Alert[] = [];
  constructor(public readonly name = 'mem') {}
  async send(a: Alert): Promise<void> {
    this.sent.push(a);
  }
}

test('mapBindingVerdict maps all Soroban TraceVerdict variants cleanly', () => {
  assert.deepEqual(mapBindingVerdict({ tag: 'Valid', values: undefined }), {
    kind: TraceVerdictKind.VALID,
    reason: null,
    effectiveFrom: null,
  });
  assert.deepEqual(mapBindingVerdict({ tag: 'HashMismatch', values: undefined }), {
    kind: TraceVerdictKind.HASH_MISMATCH,
    reason: null,
    effectiveFrom: null,
  });
  assert.deepEqual(mapBindingVerdict({ tag: 'Flagged', values: ['stale_data'] }), {
    kind: TraceVerdictKind.FLAGGED,
    reason: 'stale_data',
    effectiveFrom: null,
  });
  assert.deepEqual(mapBindingVerdict({ tag: 'AgentRevokedAfter', values: [1_700_000_000n] }), {
    kind: TraceVerdictKind.AGENT_REVOKED_AFTER,
    reason: null,
    effectiveFrom: 1_700_000_000n,
  });
  assert.deepEqual(mapBindingVerdict(['Flagged', 'manual_review']), {
    kind: TraceVerdictKind.FLAGGED,
    reason: 'manual_review',
    effectiveFrom: null,
  });
  assert.deepEqual(mapBindingVerdict(null), {
    kind: TraceVerdictKind.UNKNOWN,
    reason: null,
    effectiveFrom: null,
  });
});

test('runTraceAudit records verdict, flag history, version increments only on change, and stays within maxRpc', async () => {
  const bytes = Buffer.from(JSON.stringify({ ok: true }), 'utf8');
  const hash = sha256Hex(bytes);

  const traceRow: any = {
    id: 'trace-1',
    marketId: 'm-1',
    onChainTraceId: 1n,
    traceHash: hash,
    ipfsCid: 'bafytrace1',
    agentWallet: BACKEND_AGENT,
    verified: true,
    verdict: TraceVerdictKind.VALID,
    verdictReason: null,
    verdictEffectiveFrom: null,
    verdictCheckedAt: null,
    verdictVersion: 1,
    market: { onChainMarketId: 5n },
  };
  const flagEvents: any[] = [];
  const auditRuns: any[] = [];

  const fakePrisma: any = {
    traceAuditRun: {
      create: async ({ data }: any) => { auditRuns.push(data); return data; },
      findFirst: async () => null,
      update: async ({ data }: any) => { Object.assign(auditRuns[auditRuns.length - 1], data); return data; },
    },
    market: {
      findMany: async () => [{ id: 'm-1', onChainMarketId: 5n }],
      findFirst: async () => ({ id: 'm-1', onChainMarketId: 5n }),
    },
    traceAudit: {
      findMany: async () => [],
      upsert: async ({ create }: any) => create,
      create: async ({ data }: any) => data,
    },
    reasoningTrace: {
      findUnique: async () => traceRow,
      findMany: async ({ where }: any) => {
        if (where?.onChainTraceId === null) return [];
        if (where?.verdict?.not === TraceVerdictKind.VALID) {
          return traceRow.verdict !== TraceVerdictKind.VALID ? [traceRow] : [];
        }
        return [traceRow];
      },
      update: async ({ data }: any) => {
        Object.assign(traceRow, data);
        return traceRow;
      },
    },
    traceFlagEvent: {
      upsert: async ({ create }: any) => {
        const idx = flagEvents.findIndex(
          (f) => f.onChainTraceId === create.onChainTraceId && f.historyIndex === create.historyIndex,
        );
        if (idx >= 0) flagEvents[idx] = create;
        else flagEvents.push(create);
        return create;
      },
    },
    agentRevocation: {
      findMany: async () => [],
    },
  };

  const sink = new MemorySink();
  const deliveries: any[] = [];
  const { prisma: globalPrisma } = await import('../src/lib/prisma');
  const prevFindUnique = (globalPrisma.alertDelivery as any).findUnique;
  const prevUpsert = (globalPrisma.alertDelivery as any).upsert;
  (globalPrisma.alertDelivery as any).findUnique = async ({ where }: any) =>
    deliveries.find((d) => d.dedupeKey === where.dedupeKey) ?? null;
  (globalPrisma.alertDelivery as any).upsert = async ({ create }: any) => {
    deliveries.push(create);
    return create;
  };

  try {
    const reader: RegistryReader = {
      traceCount: async () => 1n,
      marketTraceCount: async () => 1n,
      marketTraceAt: async () => 1n,
      getOnChainTraceOrNull: async () => ({
        market_id: 5n,
        agent: BACKEND_AGENT,
        action: 'trade',
        trace_hash: Buffer.from(hash, 'hex'),
        ipfs_cid: 'bafytrace1',
        published_at: 1_700_000_000n,
      }),
      traceVerdict: async () => ({ kind: TraceVerdictKind.FLAGGED, reason: 'bad_signal', effectiveFrom: null }),
      traceFlags: async () => [
        { active: true, reason: 'bad_signal', flaggedAt: 1_700_000_100n, historyIndex: 0 },
      ],
    };

    const summary1 = await runTraceAudit({
      prisma: fakePrisma,
      reader,
      maxRpc: 20,
      verdictRpcShare: 0.3,
      fetchBytesFn: async () => bytes,
      alerts: new AlertService({ sinks: [sink], sleep: async () => undefined }),
      knownAgentsOverride: new Set([BACKEND_AGENT]),
    });

    assert.ok(summary1.rpcCalls <= 20);
    assert.equal(summary1.rpcCallsByCategory.verdict, 1);
    assert.equal(summary1.rpcCallsByCategory.flags, 1);
    assert.equal(traceRow.verdict, TraceVerdictKind.FLAGGED);
    assert.equal(traceRow.verdictReason, 'bad_signal');
    assert.equal(traceRow.verdictVersion, 2);
    assert.equal(traceRow.verified, false, 'flagged trace must not remain verified: true');
    assert.equal(flagEvents.length, 1);
    assert.equal(sink.sent.length, 1);
    assert.equal(sink.sent[0].kind, 'trace_verdict');

    // Second identical run: verdict unchanged -> verdictVersion stays 2 and alert dedupes
    await runTraceAudit({
      prisma: fakePrisma,
      reader,
      maxRpc: 20,
      verdictRpcShare: 0.3,
      fetchBytesFn: async () => bytes,
      alerts: new AlertService({ sinks: [sink], sleep: async () => undefined }),
      knownAgentsOverride: new Set([BACKEND_AGENT]),
    });
    assert.equal(traceRow.verdictVersion, 2);
    assert.equal(sink.sent.length, 1);
  } finally {
    (globalPrisma.alertDelivery as any).findUnique = prevFindUnique;
    (globalPrisma.alertDelivery as any).upsert = prevUpsert;
  }
});

test('runVerdictRecheck pauses ALL agent scopes and alerts when backend agent is revoked', async () => {
  const hash = sha256Hex(Buffer.from('revoked-trace'));
  const traceRow: any = {
    id: 'trace-rev',
    onChainTraceId: 9n,
    traceHash: hash,
    agentWallet: BACKEND_AGENT,
    verdict: TraceVerdictKind.VALID,
    verdictReason: null,
    verdictEffectiveFrom: null,
    verdictVersion: 0,
  };
  const pauses: any[] = [];
  const sink = new MemorySink();
  const deliveries: any[] = [];
  const { prisma: globalPrisma } = await import('../src/lib/prisma');
  const prevFindUnique = (globalPrisma.alertDelivery as any).findUnique;
  const prevUpsert = (globalPrisma.alertDelivery as any).upsert;
  (globalPrisma.alertDelivery as any).findUnique = async ({ where }: any) =>
    deliveries.find((d) => d.dedupeKey === where.dedupeKey) ?? null;
  (globalPrisma.alertDelivery as any).upsert = async ({ create }: any) => {
    deliveries.push(create);
    return create;
  };

  const fakePrisma: any = {
    reasoningTrace: {
      findMany: async () => [traceRow],
      update: async ({ data }: any) => Object.assign(traceRow, data),
    },
    agentRevocation: {
      findMany: async () => [{ agent: BACKEND_AGENT }],
    },
  };

  try {
    const res = await runVerdictRecheck({
      prisma: fakePrisma,
      onChainTraceIds: [9n],
      knownAgentsOverride: new Set([BACKEND_AGENT]),
      alerts: new AlertService({ sinks: [sink], sleep: async () => undefined }),
      pauseAgentFn: (async (scope: any, opts: any) => {
        pauses.push({ scope, opts });
      }) as any,
      reader: {
        traceCount: async () => 0n,
        marketTraceCount: async () => 0n,
        marketTraceAt: async () => 0n,
        getOnChainTraceOrNull: async () => null,
        traceVerdict: async () => ({
          kind: TraceVerdictKind.AGENT_REVOKED_AFTER,
          reason: null,
          effectiveFrom: 1_700_000_000n,
        }),
      },
    });

    assert.equal(res.checked, 1);
    assert.equal(res.changed, 1);
    assert.equal(traceRow.verdict, TraceVerdictKind.AGENT_REVOKED_AFTER);
    assert.equal(traceRow.verified, false);
    assert.equal(pauses.length, 1);
    assert.equal(pauses[0].scope, 'ALL');
    assert.equal(pauses[0].opts.reason, 'agent revoked in registry');
    assert.equal(sink.sent.length, 1);
  } finally {
    (globalPrisma.alertDelivery as any).findUnique = prevFindUnique;
    (globalPrisma.alertDelivery as any).upsert = prevUpsert;
  }
});

test('getFreshTraceVerdict refreshes stale verdicts live with a 60s cache for copy-trade gate', async () => {
  clearLiveVerdictCacheForTest();
  let rpcCalls = 0;
  const hash = sha256Hex(Buffer.from('copy-trade-trace'));
  const traceRow: any = {
    id: 'trace-ct',
    onChainTraceId: 33n,
    traceHash: hash,
    agentWallet: OTHER_AGENT,
    verdict: TraceVerdictKind.VALID,
    verdictReason: null,
    verdictEffectiveFrom: null,
    verdictCheckedAt: new Date(Date.now() - 600_000), // 10 min old -> stale
    verdictVersion: 1,
  };
  const fakePrisma: any = {
    reasoningTrace: {
      update: async ({ data }: any) => Object.assign(traceRow, data),
    },
  };
  const reader: RegistryReader = {
    traceCount: async () => 0n,
    marketTraceCount: async () => 0n,
    marketTraceAt: async () => 0n,
    getOnChainTraceOrNull: async () => null,
    traceVerdict: async () => {
      rpcCalls++;
      return { kind: TraceVerdictKind.FLAGGED, reason: 'disowned', effectiveFrom: null };
    },
  };

  const v1 = await getFreshTraceVerdict(traceRow, { prisma: fakePrisma, reader, maxAgeSecs: 300 });
  assert.equal(v1.kind, TraceVerdictKind.FLAGGED);
  assert.equal(v1.liveChecked, true);
  assert.equal(rpcCalls, 1);

  // Second call within 60s hits live cache instead of calling RPC again
  const v2 = await getFreshTraceVerdict(traceRow, { prisma: fakePrisma, reader, maxAgeSecs: 300 });
  assert.equal(v2.kind, TraceVerdictKind.FLAGGED);
  assert.equal(rpcCalls, 1);
  clearLiveVerdictCacheForTest();
});
