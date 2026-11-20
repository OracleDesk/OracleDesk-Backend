/**
 * Outbox crash recovery against a real Postgres 16 and Redis 7 (#229).
 *
 * Each case drives a real live write through chain.service.ts (fake bindings,
 * a scriptable RPC behind setTransactionSender/setTransactionReader), freezes
 * it at a crash point with setCrashHookForTest (no catch/finally runs, as in a
 * process death), restarts into a fresh module context with its own Prisma
 * client, scripts the chain outcome and recovers. Every case ends with an
 * extra pass that must be a no-op, and asserts exactly one domain effect for
 * market.create, trade.buy, trade.sell and trace.publish.
 *
 * Complements tests/chain-outbox.test.ts (in-memory store, unit tier).
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Keypair, TransactionBuilder, nativeToScVal, type Transaction, type xdr } from '@stellar/stellar-sdk';
import Redis from 'ioredis';
import { integrationEnv, skipReason } from './setup';
import type { FakeChain, ModuleContext, SimulatedResults } from '../helpers/outbox-harness';

type Harness = typeof import('../helpers/outbox-harness');
type Factories = typeof import('../helpers/factories');
type CrashPoint = import('../../src/services/chain.service').CrashPoint;
type Row = import('../../src/services/stellar/outbox').ChainTransactionRow;
type Handler = import('../../src/services/stellar/outbox').CompletionHandler;
type RecoverDeps = import('../../src/services/stellar/outbox').RecoverDeps;

let db: Awaited<ReturnType<typeof integrationEnv>>;
let harness: Harness;
let factories: Factories;
let truncateAll: typeof import('../helpers/db').truncateAll;
let redisUrl: string;
let flusher: Redis;
let ctx: ModuleContext | null = null;

// Throwaway keys, generated per run; never funded.
const AGENT = Keypair.random();
const FEE_PAYER = Keypair.random();
const START_LEDGER = 5_000;

before(async () => {
  db = await integrationEnv('outbox_recovery');
  if (!db) return;
  // A Redis database of this file's own: flushed before each case, which drops
  // the source-account lock a frozen write never releases.
  const u = new URL(process.env.REDIS_URL!);
  u.pathname = '/11';
  redisUrl = u.toString();
  process.env.REDIS_URL = redisUrl;
  flusher = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  harness = await import('../helpers/outbox-harness');
  factories = await import('../helpers/factories');
  truncateAll = (await import('../helpers/db')).truncateAll;
});
beforeEach(async () => {
  if (!db) return;
  await flusher.flushdb();
  ctx = await harness.freshModules(ctx);
  await truncateAll(ctx.prisma);
});
after(async () => {
  if (!db) return;
  if (ctx) await harness.abandonContext(ctx);
  harness.clearSrcModules();
  await flusher.quit();
  await db.drop();
});

const wallNow = () => Math.floor(Date.now() / 1000);

/** Puts one context in live mode against the fake chain. */
function boot(c: ModuleContext, chain: FakeChain, results: SimulatedResults, opts: { feeBump?: boolean } = {}): ModuleContext {
  Object.assign(c.config as Record<string, unknown>, {
    CHAIN_EXECUTION_MODE: 'live',
    AGENT_SECRET_KEY: AGENT.secret(),
    CHAIN_RETRY_MAX_ATTEMPTS: 1,
    SEQ_LOCK_WAIT_MS: 5_000,
    // A frozen write keeps its heartbeat timer; keep it quiet for the run.
    SEQ_LOCK_HEARTBEAT_MS: 600_000,
    OUTBOX_INLINE_WAIT_MS: 5_000,
    FEE_BUMP_ENABLED: opts.feeBump ?? false,
    FEE_PAYER_SECRET: FEE_PAYER.secret(),
  });
  c.txInspect.setTransactionSender(chain.sender);
  c.txInspect.setTransactionReader(chain.reader);
  c.sequence.setSequenceDepsForTest({ rpc: { getAccount: async (id: string) => new Account(id, '1000') } as never });
  harness.installBindings(c, AGENT, chain, () => results);
  return c;
}

const recoverDeps = (chain: FakeChain, now: number = wallNow() + 2): RecoverDeps => ({
  server: chain.server,
  now: () => now,
  signedGraceMs: 0,
  feePayer: FEE_PAYER,
});

async function outboxRowFor(c: ModuleContext, refId: string): Promise<Row> {
  const rows = (await c.prisma.chainTransaction.findMany({ where: { refId } })) as unknown as Row[];
  assert.equal(rows.length, 1, `exactly one outbox row for ${refId}`);
  return rows[0];
}

// ─── Domain fixtures ─────────────────────────────────────────────────────────

type Kind = 'market.create' | 'trade.buy' | 'trade.sell' | 'trace.publish';
const KINDS: Kind[] = ['market.create', 'trade.buy', 'trade.sell', 'trace.publish'];

const SHARES_HELD = 8_000_000n;
const COLLATERAL_OUT = 1_000_000n;
let uniqueId = 70_000n;

interface Fixture {
  kind: Kind;
  refId: string;
  /** The landed (and simulated) return value. */
  value: bigint;
  returnValue: xdr.ScVal;
  results: SimulatedResults;
  write(c: ModuleContext): Promise<unknown>;
  handler(c: ModuleContext): Handler;
  /** Exactly one success effect, carrying `txHash`. */
  assertSuccess(c: ModuleContext, txHash: string, innerHash: string): Promise<void>;
  /** Exactly one failure effect (or, for trace.publish, none: failures belong to its worker). */
  assertFailure(c: ModuleContext, error: string, outboxId: string): Promise<void>;
  snapshot(c: ModuleContext): Promise<unknown>;
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

async function fixture(kind: Kind, c: ModuleContext): Promise<Fixture> {
  const p = c.prisma;
  const ref = (refId: string) => ({ kind, refId });
  switch (kind) {
    case 'market.create': {
      const market = await factories.makeMarket(p);
      // createMarketOnChain claims the creation and marks it SUBMITTED before the write (#41).
      await p.marketCreationAttempt.create({ data: { marketId: market.id, status: 'SUBMITTED' } });
      const value = ++uniqueId;
      return {
        kind, refId: market.id, value,
        returnValue: nativeToScVal(value, { type: 'u64' }),
        results: { agent_create_market: value },
        write: (cc) => cc.chain.agentCreateMarket({
          question_hash: Buffer.alloc(32, 1), resolution_hash: Buffer.alloc(32, 2), meta_uri: 'ipfs://test',
          category: { tag: 'Fed', values: undefined } as never, close_time: BigInt(wallNow() + 86_400),
          seed_amount: 50_000_000n, initial_yes_bps: 5_000,
        }, undefined, ref(market.id)),
        handler: (cc) => cc.marketChain.handleMarketCreateOutcome,
        async assertSuccess(cc, txHash, innerHash) {
          const m = await cc.prisma.market.findUniqueOrThrow({ where: { id: market.id } });
          assert.equal(m.onChainMarketId, value);
          assert.equal(m.status, 'ACTIVE');
          assert.equal(m.creationTxHash, txHash);
          if (txHash !== innerHash) assert.equal(m.creationInnerTxHash, innerHash);
          const attempt = await cc.prisma.marketCreationAttempt.findUniqueOrThrow({ where: { marketId: market.id } });
          assert.equal(attempt.status, 'LANDED');
          assert.equal(attempt.onChainMarketId, value);
          assert.equal(await cc.prisma.agentLog.count({ where: { action: { in: ['MARKET_CREATION_FAILED', 'CREATION_ID_CONFLICT'] } } }), 0);
        },
        async assertFailure(cc, error, outboxId) {
          const m = await cc.prisma.market.findUniqueOrThrow({ where: { id: market.id } });
          assert.equal(m.onChainMarketId, null);
          assert.equal(m.status, 'PENDING');
          const logs = await cc.prisma.agentLog.findMany({ where: { action: 'MARKET_CREATION_FAILED', marketId: market.id } });
          assert.equal(logs.length, 1, 'one MARKET_CREATION_FAILED log per outbox row');
          assert.equal((logs[0].data as { outboxId?: string }).outboxId, outboxId);
          assert.equal((logs[0].data as { error?: string }).error ?? null, error === 'expired unsubmitted' ? null : error);
        },
        snapshot: async (cc) => json({
          market: await cc.prisma.market.findUnique({ where: { id: market.id }, select: { onChainMarketId: true, status: true, creationTxHash: true, updatedAt: true } }),
          logs: await cc.prisma.agentLog.count(),
          attempt: await cc.prisma.marketCreationAttempt.findUnique({ where: { marketId: market.id } }),
        }),
      };
    }
    case 'trade.buy': {
      const trade = await factories.makePendingTrade(p);
      const market = await p.market.findUniqueOrThrow({ where: { id: trade.marketId } });
      const value = 7_777_000n;
      return {
        kind, refId: trade.id, value,
        returnValue: nativeToScVal(value, { type: 'i128' }),
        results: { agent_buy: value },
        write: (cc) => cc.chain.agentBuy(
          { market_id: market.onChainMarketId!, outcome: cc.chain.Outcomes.Yes, collateral_in: 40_000_000n, min_shares_out: 1n },
          undefined, { feeRaw: '400000' }, ref(trade.id),
        ),
        handler: (cc) => cc.trade.handleTradeBuyOutcome,
        async assertSuccess(cc, txHash, innerHash) {
          const t = await cc.prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
          assert.equal(t.status, 'EXECUTED');
          assert.equal(t.txHash, txHash);
          assert.equal(t.innerTxHash, innerHash);
          const positions = await cc.prisma.position.findMany({ where: { tradeId: trade.id } });
          assert.equal(positions.length, 1, 'exactly one Position');
          assert.equal(positions[0].sharesRaw?.toString(), value.toString());
          assert.equal(positions[0].costBasisRaw?.toString(), '40000000');
          assert.equal(positions[0].feesPaidRaw?.toString(), '400000');
        },
        async assertFailure(cc, error) {
          const t = await cc.prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
          assert.equal(t.status, 'FAILED');
          assert.equal(t.errorMessage, error);
          assert.equal(await cc.prisma.position.count({ where: { tradeId: trade.id } }), 0);
        },
        snapshot: async (cc) => json({
          trade: await cc.prisma.trade.findUnique({ where: { id: trade.id } }),
          positions: await cc.prisma.position.findMany({ where: { tradeId: trade.id } }),
        }),
      };
    }
    case 'trade.sell': {
      const { position, exit } = await factories.makeOpenPositionWithExit(p, { sharesRaw: SHARES_HELD, exits: [COLLATERAL_OUT] });
      const market = await p.market.findUniqueOrThrow({ where: { id: position.marketId } });
      const value = 2_000_000n; // shares burnt
      return {
        kind, refId: exit.id, value,
        returnValue: nativeToScVal(value, { type: 'i128' }),
        results: { agent_sell: value },
        write: (cc) => cc.chain.agentSell(
          { market_id: market.onChainMarketId!, outcome: cc.chain.Outcomes.Yes, collateral_out: COLLATERAL_OUT, max_shares_in: COLLATERAL_OUT * 3n },
          undefined, ref(exit.id),
        ),
        handler: (cc) => cc.exit.handleTradeSellOutcome,
        async assertSuccess(cc, txHash) {
          const e = await cc.prisma.positionExit.findUniqueOrThrow({ where: { id: exit.id } });
          assert.equal(e.status, 'CONFIRMED');
          assert.equal(e.sharesSoldRaw.toString(), value.toString());
          assert.equal(e.txHash, txHash);
          const pos = await cc.prisma.position.findUniqueOrThrow({ where: { id: position.id } });
          assert.equal(pos.sharesRaw?.toString(), (SHARES_HELD - value).toString(), 'shares reduced once');
          assert.equal(pos.realisedCollateralRaw.toString(), COLLATERAL_OUT.toString(), 'collateral realised once');
        },
        async assertFailure(cc, error) {
          const e = await cc.prisma.positionExit.findUniqueOrThrow({ where: { id: exit.id } });
          assert.equal(e.status, 'FAILED');
          assert.equal(e.error, error);
          const pos = await cc.prisma.position.findUniqueOrThrow({ where: { id: position.id } });
          assert.equal(pos.sharesRaw?.toString(), SHARES_HELD.toString());
          assert.equal(pos.realisedCollateralRaw.toString(), '0');
          assert.equal(pos.status, 'OPEN');
        },
        snapshot: async (cc) => json({
          exit: await cc.prisma.positionExit.findUnique({ where: { id: exit.id } }),
          position: await cc.prisma.position.findUnique({ where: { id: position.id } }),
        }),
      };
    }
    case 'trace.publish': {
      const { market, trace } = await factories.makeTraceWithPublication(p);
      const value = ++uniqueId;
      return {
        kind, refId: trace.id, value,
        returnValue: nativeToScVal(value, { type: 'u64' }),
        results: { publish_trace: value },
        write: (cc) => cc.chain.publishTrace(
          { agent: AGENT.publicKey(), market_id: market.onChainMarketId!, action: 'OPEN_POSITION', trace_hash: Buffer.alloc(32, 3), ipfs_cid: trace.ipfsCid! },
          undefined, 'TRADER', ref(trace.id),
        ),
        handler: (cc) => cc.tracePublish.handleTracePublishOutcome,
        async assertSuccess(cc, txHash, innerHash) {
          const t = await cc.prisma.reasoningTrace.findUniqueOrThrow({ where: { id: trace.id } });
          assert.equal(t.onChainTraceId, value);
          assert.equal(t.publishTxHash, txHash);
          assert.equal(t.publishInnerTxHash, innerHash);
          const pub = await cc.prisma.tracePublication.findUniqueOrThrow({ where: { traceId: trace.id } });
          assert.equal(pub.status, 'CONFIRMED');
        },
        async assertFailure(cc) {
          // Failures are left to the publication worker's own retry state machine.
          const t = await cc.prisma.reasoningTrace.findUniqueOrThrow({ where: { id: trace.id } });
          assert.equal(t.onChainTraceId, null);
          const pub = await cc.prisma.tracePublication.findUniqueOrThrow({ where: { traceId: trace.id } });
          assert.equal(pub.status, 'SUBMITTED');
        },
        snapshot: async (cc) => json({
          trace: await cc.prisma.reasoningTrace.findUnique({ where: { id: trace.id } }),
          publication: await cc.prisma.tracePublication.findUnique({ where: { traceId: trace.id } }),
        }),
      };
    }
  }
}

// ─── Crashing ────────────────────────────────────────────────────────────────

/** Runs the write until `point`, where it freezes for good. */
async function crashWrite(c: ModuleContext, fx: Fixture, point: CrashPoint): Promise<void> {
  let crashed!: () => void;
  const reached = new Promise<'crashed'>((resolve) => { crashed = () => resolve('crashed'); });
  c.chain.setCrashHookForTest(async (p) => {
    if (p !== point) return;
    crashed();
    return harness.forever();
  });
  const settled = fx.write(c).then(() => 'the write resolved', (err) => `the write threw: ${err instanceof Error ? err.message : err}`);
  assert.equal(await Promise.race([reached, settled]), 'crashed', `${fx.kind} never reached ${point}`);
  c.chain.setCrashHookForTest(null);
}

/** Runs `start` until the kind's real handler has finished; the process dies before markHandled. */
async function crashAfterHandler(c: ModuleContext, fx: Fixture, start: () => Promise<unknown>): Promise<void> {
  const real = fx.handler(c);
  let ran!: () => void;
  const reached = new Promise<'ran'>((resolve) => { ran = () => resolve('ran'); });
  c.outbox.registerHandler(fx.kind, async (row, outcome) => {
    await real(row, outcome);
    ran();
    return harness.forever();
  });
  const settled = start().then(() => 'settled without running the handler', (err) => `threw: ${err instanceof Error ? err.message : err}`);
  assert.equal(await Promise.race([reached, settled]), 'ran', `${fx.kind} handler never ran`);
}

/**
 * Wraps the row's stored inner envelope in a fee bump paid by FEE_PAYER,
 * records it through the real store (recordBump: CAS on bumpAttempts, array
 * push into the GIN-indexed feeBumpHashes) and submits it. This stands in for
 * outbox.ts bumpRow, which cannot build a bump under SDK 16 (see the todo test
 * below); everything after the bump is the real recovery path.
 */
async function bumpOnce(c: ModuleContext, chain: FakeChain, refId: string): Promise<string> {
  const row = await outboxRowFor(c, refId);
  const passphrase = c.config.STELLAR_NETWORK_PASSPHRASE;
  const inner = TransactionBuilder.fromXDR(row.envelopeXdr!, passphrase) as Transaction;
  const outer = TransactionBuilder.buildFeeBumpTransaction(FEE_PAYER.publicKey(), String(Number(inner.fee) * 2), inner, passphrase);
  outer.sign(FEE_PAYER);
  const outerHash = harness.hashOf(outer);
  const recorded = await c.outbox.prismaOutboxStore().recordBump(row, outerHash, {
    hash: outerHash, fee: outer.fee, xdr: outer.toEnvelope().toXDR('base64'), at: new Date().toISOString(),
  });
  assert.ok(recorded, 'the bump was recorded');
  await chain.server.sendTransaction(outer);
  return outerHash;
}

// ─── The matrix ──────────────────────────────────────────────────────────────

interface MatrixRow {
  name: string;
  /** Where the first process dies. */
  crash: CrashPoint | 'handler-inline-success' | 'handler-recovery-failure';
  beforeWrite?(chain: FakeChain, c: ModuleContext): void;
  /** Chain scripting after the crash, before the restarted process recovers. */
  script?(chain: FakeChain, row: Row, fx: Fixture): void;
  /** Runs after pass i (0-based) of the restarted process. */
  between?: Array<((chain: FakeChain, c: ModuleContext, fx: Fixture) => Promise<unknown> | void) | undefined>;
  passes: number;
  /** Injected recovery time; defaults to just after the wall clock. */
  now?(row: Row): number;
  status: 'SUCCESS' | 'FAILED' | 'EXPIRED';
  /** The failure's error as the handler records it. */
  error?: string;
  via?: 'inner' | 'outer';
}

const landsOnSend = (chain: FakeChain, fx: Fixture, ledger = START_LEDGER + 1) =>
  chain.onSend((tx) => {
    chain.land(harness.hashOf(tx), { status: 'SUCCESS', returnValue: fx.returnValue, ledger });
    return 'PENDING';
  });

const MATRIX: MatrixRow[] = [
  {
    name: 'after-built: nothing was signed; the row fails',
    crash: 'after-built',
    passes: 1,
    status: 'FAILED',
    error: 'abandoned before signing',
  },
  {
    name: 'after-signed: the stored envelope resubmits (PENDING) and then lands',
    crash: 'after-signed',
    script: (chain, _row, fx) => landsOnSend(chain, fx),
    passes: 2,
    status: 'SUCCESS',
    via: 'inner',
  },
  {
    name: 'after-signed: the resubmission is rejected (tx_bad_seq)',
    crash: 'after-signed',
    script: (chain) => chain.onSend(() => 'ERROR'),
    passes: 1,
    status: 'FAILED',
    error: 'rejected on resubmit',
  },
  {
    name: 'after-send-accepted: the envelope landed',
    crash: 'after-send-accepted',
    script: (chain, row, fx) => chain.land(row.hash!, { status: 'SUCCESS', returnValue: fx.returnValue, ledger: START_LEDGER + 1 }),
    passes: 1,
    status: 'SUCCESS',
    via: 'inner',
  },
  {
    name: 'after-send-timeout: resubmit is a DUPLICATE, a fee bump lands under its outer hash',
    crash: 'after-send-timeout',
    beforeWrite: (chain) => chain.timeoutNextSend(() => Object.assign(new Error('rpc-write timed out'), { code: 'UPSTREAM_TIMEOUT' })),
    script: (chain, row, fx) =>
      chain.onSend((tx) => {
        if (!harness.isFeeBump(tx)) return 'DUPLICATE'; // the timed-out send did reach the network
        chain.land(row.hash!, { status: 'SUCCESS', returnValue: fx.returnValue, ledger: START_LEDGER + 9, viaOuter: harness.hashOf(tx) });
        return 'PENDING';
      }),
    // Pass 1 resubmits (DUPLICATE: SUBMITTED); the row is fee-bumped; pass 2
    // finds only the outer hash.
    between: [(chain, c, fx) => bumpOnce(c, chain, fx.refId)],
    passes: 2,
    status: 'SUCCESS',
    via: 'outer',
  },
  {
    name: 'after-advance: NOT_FOUND inside retention, close time past maxTime',
    crash: 'after-advance',
    script: (chain, row) => chain.setLatest(START_LEDGER + 200, Number(row.maxTime) + 120),
    now: (row) => Number(row.maxTime) + 120,
    passes: 1,
    status: 'EXPIRED',
    error: 'expired unsubmitted',
  },
  {
    name: 'inline success: handler ran, crash before markHandled',
    crash: 'handler-inline-success',
    passes: 1,
    status: 'SUCCESS',
    via: 'inner',
  },
  {
    name: 'recovered failure: handler ran, crash before markHandled',
    crash: 'handler-recovery-failure',
    passes: 1,
    status: 'FAILED',
    error: 'transaction failed on-chain',
  },
];

for (const row of MATRIX) {
  for (const kind of KINDS) {
    test(`${kind} | ${row.name}`, { skip: skipReason() }, async () => {
      const chain = harness.fakeChain({ ledger: START_LEDGER, closeTime: wallNow() });
      let c = ctx!;
      const fx = await fixture(kind, c);
      boot(c, chain, fx.results);
      row.beforeWrite?.(chain, c);

      // ── The first process runs until it dies ──
      if (row.crash === 'handler-inline-success') {
        landsOnSend(chain, fx);
        await crashAfterHandler(c, fx, () => fx.write(c));
      } else if (row.crash === 'handler-recovery-failure') {
        await crashWrite(c, fx, 'after-advance');
        const submitted = await outboxRowFor(c, fx.refId);
        chain.land(submitted.hash!, { status: 'FAILED', ledger: START_LEDGER + 1 });
        await crashAfterHandler(c, fx, () => c.outbox.recoverInFlight(recoverDeps(chain)));
      } else {
        await crashWrite(c, fx, row.crash);
      }
      const crashedRow = await outboxRowFor(c, fx.refId);

      // ── Restart ──
      c = ctx = boot(await harness.freshModules(c), chain, fx.results);
      row.script?.(chain, crashedRow, fx);
      const sentBefore = chain.sent.length;
      const deps = recoverDeps(chain, row.now?.(crashedRow));
      for (let i = 0; i < row.passes; i++) {
        await c.outbox.recoverInFlight(deps);
        await row.between?.[i]?.(chain, c, fx);
      }

      const final = await outboxRowFor(c, fx.refId);
      assert.equal(final.status, row.status, `row ${final.status} (${final.error ?? 'no error'})`);
      assert.ok(final.handledAt, 'handled');
      if (row.status === 'SUCCESS') {
        const outer = final.feeBumpHashes[0];
        const landed = row.via === 'outer' ? outer : final.hash!;
        assert.ok(landed);
        assert.equal(final.landedHash, landed);
        if (row.via === 'outer') assert.equal(final.feeBumpHashes.length, 1);
        await fx.assertSuccess(c, landed, final.hash!);
      } else {
        await fx.assertFailure(c, row.error!, final.id);
      }
      if (row.crash === 'after-signed') {
        assert.deepEqual(chain.sent.slice(sentBefore), [crashedRow.hash], 'the stored envelope was resubmitted byte-for-byte');
      }

      // ── One more pass is a no-op ──
      const before = json({ row: final, domain: await fx.snapshot(c) });
      const stats = await c.outbox.recoverInFlight(deps);
      assert.deepEqual(stats, { resolved: 0, resubmitted: 0, expired: 0, handled: 0, bumped: 0 });
      assert.deepEqual(json({ row: await outboxRowFor(c, fx.refId), domain: await fx.snapshot(c) }), before);
    });
  }
}

// ─── Beyond the matrix ───────────────────────────────────────────────────────

test('NOT_FOUND before maxTime leaves the row in flight and the domain untouched', { skip: skipReason() }, async () => {
  const chain = harness.fakeChain({ ledger: START_LEDGER, closeTime: wallNow() });
  let c = ctx!;
  const fx = await fixture('trade.buy', c);
  boot(c, chain, fx.results);
  await crashWrite(c, fx, 'after-advance');
  c = ctx = boot(await harness.freshModules(c), chain, fx.results);

  const deps = recoverDeps(chain);
  const before = json({ row: await outboxRowFor(c, fx.refId), domain: await fx.snapshot(c) });
  for (let i = 0; i < 2; i++) {
    const stats = await c.outbox.recoverInFlight(deps);
    assert.deepEqual(stats, { resolved: 0, resubmitted: 0, expired: 0, handled: 0, bumped: 0 });
  }
  const row = await outboxRowFor(c, fx.refId);
  assert.equal(row.status, 'SUBMITTED');
  assert.equal(row.handledAt, null);
  assert.deepEqual(json({ row, domain: await fx.snapshot(c) }), before);
});

test('recoverByTxHash on the outer fee-bump hash resolves the inner row', { skip: skipReason() }, async () => {
  const chain = harness.fakeChain({ ledger: START_LEDGER, closeTime: wallNow() });
  let c = ctx!;
  const fx = await fixture('trade.buy', c);
  boot(c, chain, fx.results);
  await crashWrite(c, fx, 'after-advance');
  const crashed = await outboxRowFor(c, fx.refId);

  c = ctx = boot(await harness.freshModules(c), chain, fx.results);
  chain.onSend((tx) => {
    chain.land(crashed.hash!, { status: 'SUCCESS', returnValue: fx.returnValue, ledger: START_LEDGER + 9, viaOuter: harness.hashOf(tx) });
    return 'PENDING';
  });
  const outer = await bumpOnce(c, chain, fx.refId);
  assert.notEqual(outer, crashed.hash);
  // findByAnyHash resolves the outer hash to the row through feeBumpHashes.
  assert.equal((await c.outbox.findRowByAnyHash([outer]))?.id, crashed.id);
  assert.equal(await c.outbox.innerHashForTx(outer), crashed.hash);

  // The indexer saw an event carrying the outer hash.
  await c.outbox.recoverByTxHash(outer, recoverDeps(chain));
  const final = await outboxRowFor(c, fx.refId);
  assert.equal(final.status, 'SUCCESS');
  assert.equal(final.landedHash, outer);
  assert.ok(final.handledAt);
  await fx.assertSuccess(c, outer, crashed.hash!);
});

test(
  'bumpRow wraps a stuck SUBMITTED row in a fee bump and records it',
  {
    skip: skipReason(),
    todo: 'blocked: src/services/stellar/fee-bump.ts buildFeeBump assigns .fee on an immutable FeeBumpTransaction (SDK 16)',
  },
  async () => {
    const chain = harness.fakeChain({ ledger: START_LEDGER, closeTime: wallNow() });
    let c = ctx!;
    const fx = await fixture('trade.buy', c);
    boot(c, chain, fx.results);
    await crashWrite(c, fx, 'after-advance');
    c = ctx = boot(await harness.freshModules(c), chain, fx.results, { feeBump: true });
    chain.setLatest(START_LEDGER + 10, wallNow());
    const stats = await c.outbox.recoverInFlight(recoverDeps(chain));
    assert.equal(stats.bumped, 1);
    const row = await outboxRowFor(c, fx.refId);
    assert.equal(row.feeBumpHashes.length, 1);
    assert.equal(chain.sent[chain.sent.length - 1], row.feeBumpHashes[0]);
  },
);

test(
  'recordBump appends each bump envelope to feeBumpEnvelopes',
  {
    skip: skipReason(),
    todo: 'blocked: outbox.ts prismaOutboxStore().recordBump writes { push: envelope } into the Json column, replacing the history',
  },
  async () => {
    const chain = harness.fakeChain({ ledger: START_LEDGER, closeTime: wallNow() });
    let c = ctx!;
    const fx = await fixture('trade.buy', c);
    boot(c, chain, fx.results);
    await crashWrite(c, fx, 'after-advance');
    c = ctx = boot(await harness.freshModules(c), chain, fx.results);
    const first = await bumpOnce(c, chain, fx.refId);
    const second = await bumpOnce(c, chain, fx.refId);
    const row = await outboxRowFor(c, fx.refId);
    assert.deepEqual(row.feeBumpHashes, [first, second]);
    assert.ok(Array.isArray(row.feeBumpEnvelopes), `feeBumpEnvelopes: ${JSON.stringify(row.feeBumpEnvelopes)?.slice(0, 60)}`);
    assert.deepEqual((row.feeBumpEnvelopes as Array<{ hash: string }>).map((e) => e.hash), [first, second]);
  },
);

/** Wraps each kind's real handler in `c` to count runs per outbox row. */
function countHandlerRuns(c: ModuleContext, fixtures: Fixture[], runs: Map<string, number>): void {
  for (const fx of fixtures) {
    const real = fx.handler(c);
    c.outbox.registerHandler(fx.kind, async (row, outcome) => {
      runs.set(row.id, (runs.get(row.id) ?? 0) + 1);
      await real(row, outcome);
    });
  }
}

/** A second process whose Redis is unreachable, so it cannot take the recovery lock. */
function loadLocklessContext(chain: FakeChain, results: SimulatedResults): ModuleContext {
  process.env.REDIS_URL = 'redis://127.0.0.1:1/0';
  try {
    return boot(harness.loadContext(), chain, results);
  } finally {
    process.env.REDIS_URL = redisUrl;
  }
}

/** Crashes one write per kind after the sequence advanced: all four rows SUBMITTED and landed. */
async function submittedRowsForEveryKind(c: ModuleContext, chain: FakeChain): Promise<{ fixtures: Fixture[]; rows: Row[]; results: SimulatedResults }> {
  const fixtures: Fixture[] = [];
  const results: SimulatedResults = {};
  for (const kind of KINDS) {
    const fx = await fixture(kind, c);
    Object.assign(results, fx.results);
    fixtures.push(fx);
  }
  boot(c, chain, results);
  const rows: Row[] = [];
  for (const fx of fixtures) {
    await crashWrite(c, fx, 'after-advance');
    await flusher.flushdb(); // drop the frozen write's source-account lock
    const row = await outboxRowFor(c, fx.refId);
    chain.land(row.hash!, { status: 'SUCCESS', returnValue: fx.returnValue, ledger: START_LEDGER + 1 });
    rows.push(row);
  }
  return { fixtures, rows, results };
}

test('two recoverers with separate Prisma clients and no shared lock apply each row once', { skip: skipReason() }, async () => {
  const chain = harness.fakeChain({ ledger: START_LEDGER, closeTime: wallNow() });
  const { fixtures, rows, results } = await submittedRowsForEveryKind(ctx!, chain);

  await harness.abandonContext(ctx!);
  const a = (ctx = boot(await harness.freshModules(), chain, results));
  const b = loadLocklessContext(chain, results);
  assert.notEqual(a.prisma, b.prisma);
  assert.notEqual(a.outbox, b.outbox);
  const runs = new Map<string, number>();
  countHandlerRuns(a, fixtures, runs);
  countHandlerRuns(b, fixtures, runs);

  try {
    const deps = recoverDeps(chain);
    const [sa, sb] = await Promise.all([a.outbox.recoverInFlight(deps), b.outbox.recoverInFlight(deps)]);
    assert.equal(sa.resolved + sb.resolved, rows.length, 'one SUCCESS transition per row across both');

    for (const [i, fx] of fixtures.entries()) {
      const final = await outboxRowFor(a, fx.refId);
      assert.equal(final.status, 'SUCCESS');
      assert.ok(final.handledAt);
      // The transition is a CAS, but the handler itself may run twice at once:
      // the other process's findUnhandled sweep sees a row whose transition
      // committed and whose handler is still running exactly like a row whose
      // process died there. Handlers must therefore be idempotent under
      // concurrent re-runs too; the effect below is what must happen once.
      assert.ok((runs.get(final.id) ?? 0) >= 1, `${fx.kind}: the handler ran`);
      await fx.assertSuccess(a, rows[i].hash!, rows[i].hash!);
    }

    // handledAt is written once: a further pass from either side changes nothing.
    const before = await a.prisma.chainTransaction.findMany({ orderBy: { createdAt: 'asc' } });
    await Promise.all([a.outbox.recoverInFlight(deps), b.outbox.recoverInFlight(deps)]);
    assert.deepEqual(await a.prisma.chainTransaction.findMany({ orderBy: { createdAt: 'asc' } }), before);
  } finally {
    await harness.abandonContext(b);
  }
});

test('two outbox workers, one without Redis (no recovery lock), apply each row once', { skip: skipReason() }, async () => {
  const chain = harness.fakeChain({ ledger: START_LEDGER, closeTime: wallNow() });
  const { fixtures, rows, results } = await submittedRowsForEveryKind(ctx!, chain);

  await harness.abandonContext(ctx!);
  const a = (ctx = boot(await harness.freshModules(), chain, results));
  const b = loadLocklessContext(chain, results);
  const runs = new Map<string, number>();
  countHandlerRuns(a, fixtures, runs);
  countHandlerRuns(b, fixtures, runs);

  const deps = recoverDeps(chain);
  const stops = [a.outbox.startOutboxWorker(deps), b.outbox.startOutboxWorker(deps)];
  try {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const open = await a.prisma.chainTransaction.count({ where: { handledAt: null } });
      if (open === 0) break;
      assert.ok(Date.now() < deadline, `${open} rows still unhandled`);
      await new Promise((r) => setTimeout(r, 50));
    }
    for (const stop of stops) stop();
    for (const [i, fx] of fixtures.entries()) {
      const final = await outboxRowFor(a, fx.refId);
      assert.equal(final.status, 'SUCCESS');
      assert.ok((runs.get(final.id) ?? 0) >= 1, `${fx.kind}: the handler ran`);
      await fx.assertSuccess(a, rows[i].hash!, rows[i].hash!);
    }
  } finally {
    for (const stop of stops) stop();
    // Let a tick that is still running finish before the contexts go away.
    await new Promise((r) => setTimeout(r, 200));
    await harness.abandonContext(b);
  }
});

test('two exits of one position confirmed by two recoverers at once both reduce the position', { skip: skipReason() }, async () => {
  const chain = harness.fakeChain({ ledger: START_LEDGER, closeTime: wallNow() });
  const w = ctx!;
  const { position, exits } = await factories.makeOpenPositionWithExit(w.prisma, { sharesRaw: SHARES_HELD, exits: [COLLATERAL_OUT, COLLATERAL_OUT] });
  const market = await w.prisma.market.findUniqueOrThrow({ where: { id: position.marketId } });
  const sold = [2_000_000n, 3_000_000n];
  let current = 0n;
  boot(w, chain, { get agent_sell() { return current; } } as SimulatedResults);

  const rows: Row[] = [];
  for (const [i, exit] of exits.entries()) {
    current = sold[i];
    const fx = {
      kind: 'trade.sell',
      refId: exit.id,
      write: (cc: ModuleContext) => cc.chain.agentSell(
        { market_id: market.onChainMarketId!, outcome: cc.chain.Outcomes.Yes, collateral_out: COLLATERAL_OUT, max_shares_in: COLLATERAL_OUT * 3n },
        undefined, { kind: 'trade.sell', refId: exit.id },
      ),
    } as unknown as Fixture;
    await crashWrite(w, fx, 'after-advance');
    await flusher.flushdb();
    const row = await outboxRowFor(w, exit.id);
    chain.land(row.hash!, { status: 'SUCCESS', returnValue: nativeToScVal(sold[i], { type: 'i128' }), ledger: START_LEDGER + 1 });
    rows.push(row);
  }

  await harness.abandonContext(w);
  const a = (ctx = boot(await harness.freshModules(), chain, {}));
  const b = loadLocklessContext(chain, {});
  try {
    const deps = recoverDeps(chain);
    // Each process resolves a different row of the same position at the same time.
    await Promise.all([a.outbox.recoverRow(rows[0], deps), b.outbox.recoverRow(rows[1], deps)]);

    for (const [i, exit] of exits.entries()) {
      const e = await a.prisma.positionExit.findUniqueOrThrow({ where: { id: exit.id } });
      assert.equal(e.status, 'CONFIRMED');
      assert.equal(e.sharesSoldRaw.toString(), sold[i].toString());
    }
    const pos = await a.prisma.position.findUniqueOrThrow({ where: { id: position.id } });
    assert.equal(pos.sharesRaw?.toString(), (SHARES_HELD - sold[0] - sold[1]).toString(), 'both exits reduced the shares');
    assert.equal(pos.realisedCollateralRaw.toString(), (COLLATERAL_OUT * 2n).toString(), 'both exits realised collateral');
    assert.equal(pos.costBasisRaw?.toString(), '1500000', 'cost basis released pro rata by both exits');
  } finally {
    await harness.abandonContext(b);
  }
});
