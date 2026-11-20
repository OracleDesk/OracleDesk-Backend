import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

import { Keypair, xdr } from '@stellar/stellar-sdk';

type Row = import('../src/services/stellar/outbox').ChainTransactionRow;
type Store = import('../src/services/stellar/outbox').OutboxStore;
type BacklogRow = import('../src/services/chain-write-health.service').BacklogRow;
type ChainWriteDeps = import('../src/services/chain-write-health.service').ChainWriteDeps;
type ProbeContext = import('../src/services/health.service').ProbeContext;

const NOW = 1_800_000_000_000;
const signal = new AbortController().signal;
const thresholds = () => ({ maxInFlight: 50, maxAgeMs: 300_000, maxStreak: 5, minRunwayHours: 24 });

const rpcCtx = (ok = true): ProbeContext => ({
  result: async () => ({ name: 'rpc', ok, critical: false, latencyMs: 1, checkedAt: '' }),
});

function accountEntry(stroops: bigint, numSubEntries = 0): xdr.AccountEntry {
  return new xdr.AccountEntry({
    accountId: Keypair.random().xdrAccountId(),
    balance: xdr.Int64.fromString(stroops.toString()),
    seqNum: xdr.Int64.fromString('1'), // SequenceNumber is an Int64 typedef
    numSubEntries,
    inflationDest: null,
    flags: 0,
    homeDomain: '',
    thresholds: Buffer.from([1, 0, 0, 0]),
    signers: [],
    ext: new xdr.AccountEntryExt(0),
  });
}

/** Fake RPC: balances per public key; unknown keys throw like the SDK does. */
function fakeServer(balances: Record<string, bigint>) {
  const server = {
    calls: 0,
    async getAccountEntry(pub: string) {
      server.calls++;
      if (!(pub in balances)) throw new Error(`Account not found: ${pub}`);
      return accountEntry(balances[pub]);
    },
  };
  return server;
}

async function probes(over: Partial<ChainWriteDeps> = {}) {
  const { createChainWriteProbes } = await import('../src/services/chain-write-health.service');
  const list = createChainWriteProbes({
    isWriter: () => true,
    backlog: async () => [],
    handlers: () => ({ kinds: {} }),
    balances: { snapshot: async () => ({ accounts: [], stale: false, takenAt: null }) },
    channels: async () => ({ total: 0, healthy: 0, leased: 0 }),
    thresholds,
    now: () => NOW,
    ...over,
  });
  return Object.fromEntries(list.map((p) => [p.name, p]));
}

const backlogRow = (status: string, n: number, ageMs: number, extra: Partial<BacklogRow> = {}): BacklogRow => ({
  status,
  n,
  oldest: new Date(NOW - ageMs),
  past_max_time: 0,
  oldest_unhandled: null,
  ...extra,
});

// ─── Outbox ──────────────────────────────────────────────────────────────────

test('outbox probe is ok with an empty backlog and failing past HEALTH_OUTBOX_MAX_AGE_MS', async () => {
  const empty = await probes();
  const ok = await empty.outbox.run(signal, rpcCtx());
  assert.equal(ok.ok, true);
  assert.equal(ok.state, undefined);
  assert.equal((ok.detail as { inFlight: number }).inFlight, 0);

  const stuck = await probes({ backlog: async () => [backlogRow('PENDING', 2, 300_001)] });
  const res = await stuck.outbox.run(signal, rpcCtx());
  assert.equal(res.ok, false);
  assert.equal(res.error, 'stuck');
  assert.equal((res.detail as { oldestInFlightMs: number }).oldestInFlightMs, 300_001);

  const half = await probes({ backlog: async () => [backlogRow('SUBMITTED', 1, 200_000)] });
  const degraded = await half.outbox.run(signal, rpcCtx());
  assert.deepEqual([degraded.ok, degraded.state, degraded.error], [true, 'degraded', 'stuck']);
});

test('outbox probe fails on rows past maxTime and on a backlog over HEALTH_OUTBOX_MAX_INFLIGHT', async () => {
  const past = await probes({ backlog: async () => [backlogRow('PENDING', 1, 1_000, { past_max_time: 1 })] });
  const res = await past.outbox.run(signal, rpcCtx());
  assert.equal(res.ok, false);
  assert.equal(res.error, 'stuck');

  const many = await probes({ backlog: async () => [backlogRow('SUBMITTED', 30, 1_000), backlogRow('SIGNED', 21, 1_000)] });
  const backlog = await many.outbox.run(signal, rpcCtx());
  assert.equal(backlog.error, 'backlog');
  assert.equal(backlog.ok, false);
  // Terminal (unhandled) rows count in byStatus but not as in-flight.
  const mixed = await probes({ backlog: async () => [backlogRow('SUCCESS', 60, 1_000, { oldest_unhandled: new Date(NOW - 1_000) })] });
  const terminal = await mixed.outbox.run(signal, rpcCtx());
  assert.equal(terminal.ok, true);
  assert.equal((terminal.detail as { byStatus: Record<string, number> }).byStatus.SUCCESS, 60);
});

test('an unhandled terminal row older than the age limit fails as handler_failing', async () => {
  const p = await probes({ backlog: async () => [backlogRow('FAILED', 1, 400_000, { oldest_unhandled: new Date(NOW - 400_000) })] });
  const res = await p.outbox.run(signal, rpcCtx());
  assert.equal(res.ok, false);
  assert.equal(res.error, 'handler_failing');
  assert.equal((res.detail as { oldestUnhandledMs: number }).oldestUnhandledMs, 400_000);
});

test('the backlog query runs once per probe run and is index-only shaped (one grouped query)', async () => {
  const seen: number[] = [];
  const p = await probes({ backlog: async (nowSecs) => { seen.push(nowSecs); return []; } });
  await p.outbox.run(signal, rpcCtx());
  assert.deepEqual(seen, [Math.floor(NOW / 1000)]);
});

// ─── Handler streaks ─────────────────────────────────────────────────────────

const blankRow = (id: string, kind: string): Row => ({
  id, kind, refId: null, contract: null, method: null, args: null, simulated: null, source: null,
  sequence: null, hash: 'h'.repeat(64), envelopeXdr: null, status: 'SUCCESS', submitLedger: null,
  minTime: null, maxTime: null, ledger: null, resultXdr: null, returnValue: null,
  innerFee: null, resourceFee: null, feeBumpHashes: [], feeBumpEnvelopes: null,
  landedHash: null, bumpAttempts: 0, attempts: 0, error: null, handledAt: null,
});

function unhandledStore(rows: Row[]): Store {
  return {
    async findUnhandled() { return rows.filter((r) => !r.handledAt).map((r) => ({ ...r })); },
    async findInFlight() { return []; },
    async markHandled(id) { const r = rows.find((x) => x.id === id); if (r) r.handledAt = new Date(); },
    async create() { throw new Error('unused'); },
    async transition() { return null; },
    async findByAnyHash() { return null; },
    // recoverInFlight re-reads each row under its lease (#221).
    async findById(id) { const r = rows.find((x) => x.id === id); return r ? { ...r } : null; },
    async recordBump() { return false; },
    async recordError() {},
  };
}

test('handler streak reaches HEALTH_HANDLER_MAX_STREAK, fails the probe, then resets on success', async () => {
  const outbox = await import('../src/services/stellar/outbox');
  outbox.clearHandlerStreaksForTest();
  let fail = true;
  class XdrDecodeError extends Error { name = 'XdrDecodeError'; }
  outbox.registerHandler('test.streak', async () => {
    if (fail) throw new XdrDecodeError('AAAAAgAAAAB… envelope bytes');
  });
  const rows = [blankRow('s1', 'test.streak')];
  const store = unhandledStore(rows);
  try {
    for (let i = 0; i < 5; i++) await outbox.recoverInFlight({ store });
    const streak = outbox.handlerHealth().kinds['test.streak'];
    assert.equal(streak.count, 5);
    assert.equal(streak.lastErrorClass, 'XdrDecodeError');
    assert.ok(streak.since);
    // Only the class is kept; the message (which can carry XDR) is not.
    assert.ok(!JSON.stringify(outbox.handlerHealth()).includes('AAAA'));
    assert.equal(outbox.handlerHealth().scope, 'instance');

    const p = await probes({ handlers: outbox.handlerHealth });
    const res = await p.outbox.run(signal, rpcCtx());
    assert.equal(res.ok, false);
    assert.equal(res.error, 'handler_failing');
    assert.deepEqual((res.detail as { handlerFailing: string[] }).handlerFailing, ['test.streak']);

    fail = false;
    await outbox.recoverInFlight({ store });
    assert.equal(outbox.handlerHealth().kinds['test.streak'].count, 0);
    assert.ok(rows[0].handledAt);
    assert.equal((await p.outbox.run(signal, rpcCtx())).ok, true);
  } finally {
    outbox.clearHandlerStreaksForTest();
  }
});

// ─── Writer gating ───────────────────────────────────────────────────────────

test('a non-writer instance reports writer:false and never queries', async () => {
  let queried = 0;
  const p = await probes({
    isWriter: () => false,
    backlog: async () => { queried++; return []; },
    balances: { snapshot: async () => { queried++; return { accounts: [], stale: false, takenAt: null }; } },
    channels: async () => { queried++; return { total: 1, healthy: 0, leased: 0 }; },
  });
  const ctx: ProbeContext = { result: async () => { queried++; throw new Error('must not read rpc'); } };
  for (const name of ['outbox', 'signers', 'channels']) {
    const res = await p[name].run(signal, ctx);
    assert.deepEqual(res, { ok: true, detail: { writer: false } });
    assert.equal(p[name].critical!(), false);
  }
  assert.equal(queried, 0);
});

test('isChainWriter: dry-run never writes; auto follows the outbox worker; true/false force it', async () => {
  const { isChainWriter } = await import('../src/services/chain-write-health.service');
  const { config } = await import('../src/config');
  const mode = config.CHAIN_EXECUTION_MODE;
  const setting = config.HEALTH_CHAIN_WRITER;
  try {
    config.CHAIN_EXECUTION_MODE = 'dry-run';
    config.HEALTH_CHAIN_WRITER = 'true';
    assert.equal(isChainWriter(() => true), false);

    config.CHAIN_EXECUTION_MODE = 'live';
    config.HEALTH_CHAIN_WRITER = 'auto';
    assert.equal(isChainWriter(() => true), true);
    assert.equal(isChainWriter(() => false), false);
    config.HEALTH_CHAIN_WRITER = 'true';
    assert.equal(isChainWriter(() => false), true);
    config.HEALTH_CHAIN_WRITER = 'false';
    assert.equal(isChainWriter(() => true), false);
  } finally {
    config.CHAIN_EXECUTION_MODE = mode;
    config.HEALTH_CHAIN_WRITER = setting;
  }
});

test('outboxWorkerRunning is set by startOutboxWorker and cleared by its stop function', async () => {
  const outbox = await import('../src/services/stellar/outbox');
  assert.equal(outbox.outboxWorkerRunning(), false);
  const stop = outbox.startOutboxWorker({
    store: unhandledStore([]),
    server: { getLatestLedger: async () => ({ sequence: 1 }), getTransaction: async () => ({}), sendTransaction: async () => ({}) } as never,
  });
  try {
    assert.equal(outbox.outboxWorkerRunning(), true);
  } finally {
    stop();
  }
  assert.equal(outbox.outboxWorkerRunning(), false);
});

// ─── Balances ────────────────────────────────────────────────────────────────

async function monitor(server: ReturnType<typeof fakeServer>, opts: { agent?: string; feePayer?: string; spend?: { agent: bigint; feePayer: bigint; agentEstimated: boolean }; now?: () => number } = {}) {
  const { createBalanceMonitor } = await import('../src/services/stellar/balances');
  let spendCalls = 0;
  const m = createBalanceMonitor({
    server,
    signers: () => [
      ...(opts.agent ? [{ publicKey: opts.agent, role: 'agent' as const }] : []),
      ...(opts.feePayer ? [{ publicKey: opts.feePayer, role: 'feePayer' as const }] : []),
    ],
    channels: () => [],
    channelMinStroops: () => 50_000_000n,
    spend: async () => { spendCalls++; return opts.spend ?? { agent: 0n, feePayer: 0n, agentEstimated: false }; },
    ttlMs: 60_000,
    now: opts.now,
  });
  return { m, spendCalls: () => spendCalls };
}

test('fee payer below reserve is failing; low runway is degraded; a fresh deployment has no runway estimate', async () => {
  const { evaluateSigners, reserveStroops } = await import('../src/services/chain-write-health.service').then(async (mod) => ({
    ...mod,
    ...(await import('../src/services/stellar/balances')),
  }));
  const agent = Keypair.random().publicKey();
  const payer = Keypair.random().publicKey();
  const min = reserveStroops(0); // 2 × 0.5 XLM + 1 XLM margin

  // Fee payer one stroop under the minimum.
  const low = await monitor(fakeServer({ [agent]: 1_000_000_000n, [payer]: min - 1n }), { agent, feePayer: payer });
  const failing = evaluateSigners(await low.m.snapshot(true), thresholds());
  assert.equal(failing.ok, false);
  assert.equal(failing.error, 'low_balance');

  // 2 XLM above the minimum, 1 XLM spent per 24 h on bumps → 48 h runway: ok;
  // 0.5 XLM above at the same rate → 12 h: degraded.
  const spend = { agent: 0n, feePayer: 10_000_000n, agentEstimated: false };
  const roomy = await monitor(fakeServer({ [agent]: 1_000_000_000n, [payer]: min + 20_000_000n }), { agent, feePayer: payer, spend });
  const snap = await roomy.m.snapshot(true);
  const fp = snap.accounts.find((a) => a.role === 'feePayer')!;
  assert.equal(fp.runwayHours, 48);
  assert.equal(fp.estimated, true);
  assert.equal(evaluateSigners(snap, thresholds()).ok, true);
  const tight = await monitor(fakeServer({ [agent]: 1_000_000_000n, [payer]: min + 5_000_000n }), { agent, feePayer: payer, spend });
  const degraded = evaluateSigners(await tight.m.snapshot(true), thresholds());
  assert.deepEqual([degraded.ok, degraded.state, degraded.error], [true, 'degraded', 'low_balance']);

  // No spend history: runway is unknown (null), never zero, and the probe is ok.
  const fresh = await monitor(fakeServer({ [agent]: min + 1n }), { agent });
  const freshSnap = await fresh.m.snapshot(true);
  assert.equal(freshSnap.accounts[0].runwayHours, null);
  assert.equal(evaluateSigners(freshSnap, thresholds()).ok, true);
});

test('an unfunded fee payer is failing with account_missing, not a timeout', async () => {
  const { evaluateSigners } = await import('../src/services/chain-write-health.service');
  const payer = Keypair.random().publicKey();
  const { m } = await monitor(fakeServer({}), { feePayer: payer });
  const res = evaluateSigners(await m.snapshot(true), thresholds());
  assert.equal(res.ok, false);
  assert.equal(res.error, 'account_missing');
  // Detail is JSON-safe (bigint stroops as strings).
  assert.doesNotThrow(() => JSON.stringify(res.detail));
});

test('balance snapshot is reused within HEALTH_BALANCE_TTL_MS and not refreshed while the rpc probe fails', async () => {
  const agent = Keypair.random().publicKey();
  const server = fakeServer({ [agent]: 1_000_000_000n });
  let t = NOW;
  const { m, spendCalls } = await monitor(server, { agent, now: () => t });

  await Promise.all([m.snapshot(true), m.snapshot(true), m.snapshot(true)]);
  assert.equal(server.calls, 1, 'concurrent callers share one refresh');
  t += 59_000;
  await m.snapshot(true);
  assert.equal(server.calls, 1, 'reused within the ttl');

  t += 2_000;
  const stale = await m.snapshot(false);
  assert.equal(server.calls, 1, 'no RPC while the rpc probe fails');
  assert.equal(stale.stale, true);
  assert.equal(stale.accounts[0].stroops, 1_000_000_000n);

  await m.snapshot(true);
  assert.equal(server.calls, 2);
  assert.equal(spendCalls(), 2);
});

test('signers probe passes the rpc probe result to the snapshot', async () => {
  const seen: boolean[] = [];
  const p = await probes({ balances: { snapshot: async (rpcOk) => { seen.push(rpcOk !== false); return { accounts: [], stale: !rpcOk, takenAt: null }; } } });
  await p.signers.run(signal, rpcCtx(false));
  await p.signers.run(signal, rpcCtx(true));
  assert.deepEqual(seen, [false, true]);
});

test('runwayHours compares bigint stroops and handles zero spend', async () => {
  const { runwayHours } = await import('../src/services/stellar/balances');
  assert.equal(runwayHours(100n, 50n, 0n), null);
  assert.equal(runwayHours(40n, 50n, 10n), 0);
  // Above Number.MAX_SAFE_INTEGER stroops still divides exactly.
  assert.equal(runwayHours(9_007_199_254_740_993n + 24n, 9_007_199_254_740_993n, 24n), 24);
});

// ─── Channels ────────────────────────────────────────────────────────────────

test('checkBalances reads getAccountEntry stroops and marks a low channel unhealthy', async () => {
  const { ChannelPool } = await import('../src/services/stellar/channels');
  const { config } = await import('../src/config');
  const low = Keypair.random();
  const high = Keypair.random();
  const min = BigInt(Math.round(config.CHANNEL_MIN_BALANCE_XLM * 1e7));
  const server = fakeServer({ [low.publicKey()]: min - 1n, [high.publicKey()]: min });
  const pool = new ChannelPool({} as never, server);
  (pool as unknown as { channels: unknown[] }).channels = [
    { publicKey: low.publicKey(), keypair: low, healthy: true, lastBalanceXlm: null },
    { publicKey: high.publicKey(), keypair: high, healthy: true, lastBalanceXlm: null },
  ];
  await pool.checkBalances();
  const [l, h] = pool.getChannels();
  assert.equal(server.calls, 2);
  assert.equal(l.healthy, false);
  assert.equal(l.lastBalanceStroops, min - 1n);
  assert.equal(h.healthy, true, 'exactly the minimum is healthy');
  assert.equal(h.lastBalanceStroops, min);
  assert.ok(h.lastCheckedAt);
});

test('channels probe: empty pool is ok, no healthy channel is failing, some unhealthy is degraded', async () => {
  const none = await probes({ channels: async () => ({ total: 0, healthy: 0, leased: 0 }) });
  const r0 = await none.channels.run(signal, rpcCtx());
  assert.equal(r0.ok, true);
  assert.equal((r0.detail as { configured: boolean }).configured, false);

  const dry = await probes({ channels: async () => ({ total: 3, healthy: 0, leased: 0 }) });
  const r1 = await dry.channels.run(signal, rpcCtx());
  assert.deepEqual([r1.ok, r1.error], [false, 'channels_exhausted']);

  const some = await probes({ channels: async () => ({ total: 3, healthy: 2, leased: 1 }) });
  const r2 = await some.channels.run(signal, rpcCtx());
  assert.deepEqual([r2.ok, r2.state, r2.error], [true, 'degraded', 'low_balance']);
  assert.equal((r2.detail as { leased: number }).leased, 1);
});
