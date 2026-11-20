import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { FakeRedis } from './helpers/fake-redis';
import { memoryStore, type MemoryStore } from './helpers/memory-outbox';

type Row = import('../src/services/stellar/outbox').ChainTransactionRow;
type AuditEntry = import('../src/services/outbox-admin.service').OutboxAuditEntry;

const NOW_SECS = 1_800_000_000;
const ACTOR = Keypair.random().publicKey();
const REASON = 'operator investigating a stuck write';

const loadOutbox = () => import('../src/services/stellar/outbox');
const loadAdmin = () => import('../src/services/outbox-admin.service');

// ─── Fakes ───────────────────────────────────────────────────────────────────

const NOT_FOUND = (over: Record<string, unknown> = {}) => ({
  status: 'NOT_FOUND',
  latestLedger: 200,
  latestLedgerCloseTime: NOW_SECS,
  oldestLedger: 1,
  oldestLedgerCloseTime: NOW_SECS - 100_000,
  ...over,
});

function fakeServer(byHash: Record<string, unknown>, opts: { gate?: Promise<void>; fallback?: () => unknown } = {}) {
  const calls: string[] = [];
  return {
    calls,
    async getTransaction(hash: string) {
      calls.push(hash);
      if (opts.gate) await opts.gate;
      return (byHash[hash] ?? (opts.fallback ? opts.fallback() : NOT_FOUND())) as never;
    },
    async sendTransaction() {
      return { status: 'PENDING', latestLedger: 200 } as never;
    },
    async getLatestLedger() {
      return { sequence: 200 } as never;
    },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

interface Harness {
  store: MemoryStore;
  redis: FakeRedis;
  audits: AuditEntry[];
  deps: (server?: unknown) => Record<string, unknown>;
}

function harness(): Harness {
  const store = memoryStore();
  const redis = new FakeRedis();
  const audits: AuditEntry[] = [];
  return {
    store,
    redis,
    audits,
    deps: (server?: unknown) => ({
      store,
      server: server ?? fakeServer({}),
      leaseRedis: redis,
      clearHandled: store.clearHandled,
      audit: async (e: AuditEntry) => void audits.push(e),
      now: () => NOW_SECS,
    }),
  };
}

async function withHandlers(handlers: Record<string, (row: Row, outcome: { status: string; value?: unknown }) => Promise<void>>, fn: () => Promise<void>) {
  const outbox = await loadOutbox();
  outbox.clearHandlersForTest();
  for (const [kind, h] of Object.entries(handlers)) outbox.registerHandler(kind, h as never);
  try {
    await fn();
  } finally {
    outbox.clearHandlersForTest();
  }
}

async function rejectsWith(p: Promise<unknown>, status: number, code: string): Promise<Record<string, unknown> | undefined> {
  let caught: unknown;
  await assert.rejects(p, (err: unknown) => {
    caught = err;
    return true;
  });
  const e = caught as { statusCode?: number; code?: string; details?: Record<string, unknown>; message?: string };
  assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
  assert.equal(e.statusCode, status);
  return e.details;
}

const submitted = (over: Partial<Row> = {}): Partial<Row> & { kind: string } => ({
  kind: 'test.kind',
  status: 'SUBMITTED',
  hash: 'aa'.repeat(32),
  envelopeXdr: 'unused',
  maxTime: BigInt(NOW_SECS - 600),
  submitLedger: 150,
  ...over,
});

// ─── List ────────────────────────────────────────────────────────────────────

/** Evaluates the subset of Prisma `where` that outboxListWhere produces. */
function matchWhere(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as any[]).every((c) => matchWhere(row, c));
    if (key === 'OR') return (cond as any[]).some((c) => matchWhere(row, c));
    const value = row[key];
    if (cond === null) return value == null;
    if (typeof cond !== 'object' || cond instanceof Date) return value === cond;
    if ('in' in cond) return cond.in.includes(value);
    if ('notIn' in cond) return !cond.notIn.includes(value);
    if ('has' in cond) return (value ?? []).includes(cond.has);
    if ('not' in cond) return cond.not === null ? value != null : value !== cond.not;
    if ('lt' in cond) return value < cond.lt;
    throw new Error(`unsupported where: ${key}`);
  });
}

test('list filters by status, kind, unhandled and inner/fee-bump hash, without envelopes', async () => {
  const admin = await loadAdmin();
  const now = new Date(NOW_SECS * 1000);
  const rows = [
    { id: 'r1', kind: 'trade.buy', status: 'SUBMITTED', hash: '11'.repeat(32), feeBumpHashes: ['22'.repeat(32)], handledAt: null, createdAt: new Date(now.getTime() - 3_600_000), envelopeXdr: 'AAAA-secret-envelope', feeBumpEnvelopes: [{ hash: '22'.repeat(32), xdr: 'BBBB' }] },
    { id: 'r2', kind: 'market.create', status: 'SUCCESS', hash: '33'.repeat(32), feeBumpHashes: [], handledAt: null, createdAt: new Date(now.getTime() - 60_000) },
    { id: 'r3', kind: 'trade.buy', status: 'FAILED', hash: '44'.repeat(32), feeBumpHashes: [], handledAt: new Date(), createdAt: now },
    { id: 'r4', kind: 'trade.sell', status: 'PENDING', hash: '55'.repeat(32), feeBumpHashes: [], landedHash: null, handledAt: null, createdAt: now },
  ].map((r) => ({ refId: null, landedHash: null, bumpAttempts: 0, attempts: 0, submitLedger: null, ledger: null, minTime: null, maxTime: null, error: null, contract: null, method: null, ...r }));
  const queries: Array<Record<string, any>> = [];
  const db = {
    async findMany(args: any) {
      queries.push(args);
      return rows.filter((r) => matchWhere(r, args.where)).slice(args.skip, args.skip + args.take) as never;
    },
    async count(args: any) {
      return rows.filter((r) => matchWhere(r, args.where)).length;
    },
  };
  const ids = async (f: Record<string, unknown>) =>
    (await admin.listOutbox({ page: 1, limit: 20, ...f } as never, { db, now })).rows.map((r) => r.id).sort();

  assert.deepEqual(await ids({ status: ['SUBMITTED', 'PENDING'] }), ['r1', 'r4']);
  assert.deepEqual(await ids({ kind: 'trade.buy' }), ['r1', 'r3']);
  assert.deepEqual(await ids({ unhandled: true }), ['r2']);
  assert.deepEqual(await ids({ unhandled: false }), ['r1', 'r3', 'r4']);
  assert.deepEqual(await ids({ hash: '11'.repeat(32) }), ['r1'], 'inner hash');
  assert.deepEqual(await ids({ hash: '22'.repeat(32).toUpperCase() }), ['r1'], 'fee-bump hash, case-insensitive');
  assert.deepEqual(await ids({ olderThanSecs: 600 }), ['r1']);
  assert.deepEqual(await ids({ kind: 'trade.buy', status: ['FAILED'] }), ['r3']);

  const page = await admin.listOutbox({ page: 2, limit: 1 }, { db, now });
  assert.equal(page.total, 4);
  assert.equal(page.rows.length, 1);
  assert.equal(queries[queries.length - 1].skip, 1);

  const all = JSON.stringify(await admin.listOutbox({ page: 1, limit: 20 }, { db, now }));
  assert.ok(!all.includes('AAAA-secret-envelope') && !all.includes('BBBB'), 'list never returns envelopes');
});

// ─── Detail ──────────────────────────────────────────────────────────────────

function signedInvoke(): { envelopeXdr: string; hash: string; txSig: Buffer; authSig: Buffer } {
  const source = Keypair.random();
  const signer = Keypair.random();
  const contractId = StrKey.encodeContract(Buffer.alloc(32, 7));
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contractId).toScAddress(),
    functionName: 'agent_buy',
    args: [nativeToScVal(123n, { type: 'i128' }), nativeToScVal('yes', { type: 'symbol' })],
  });
  const authSig = Buffer.alloc(64, 0xab);
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(signer.publicKey()).toScAddress(),
        nonce: xdr.Int64.fromString('12345'),
        signatureExpirationLedger: 777,
        signature: xdr.ScVal.scvVec([
          xdr.ScVal.scvMap([
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('public_key'), val: xdr.ScVal.scvBytes(signer.rawPublicKey()) }),
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signature'), val: xdr.ScVal.scvBytes(authSig) }),
          ]),
        ]),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
      subInvocations: [],
    }),
  });
  const tx = new TransactionBuilder(new Account(source.publicKey(), '100'), { fee: '5200', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs), auth: [entry] }))
    .setSorobanData(new SorobanDataBuilder().setResourceFee(5000).build())
    .setTimeout(300)
    .build();
  tx.sign(source);
  return { envelopeXdr: tx.toXDR(), hash: tx.hash().toString('hex'), txSig: tx.signatures[0].signature(), authSig };
}

test('detail decodes the envelope, bumps, RPC status and linked rows but never returns signature bytes', async () => {
  const admin = await loadAdmin();
  const h = harness();
  const { envelopeXdr, hash, txSig, authSig } = signedInvoke();
  const bumpHash = 'bb'.repeat(32);
  const row = h.store.seed(submitted({
    kind: 'trade.buy',
    refId: 'trade-1',
    contract: 'treasury',
    method: 'agent_buy',
    hash,
    envelopeXdr,
    maxTime: BigInt(NOW_SECS + 300),
    feeBumpHashes: [bumpHash],
    feeBumpEnvelopes: [{ hash: bumpHash, fee: '20000', inclusionPerOp: '9000', xdr: 'FEEBUMP-OUTER-XDR', at: '2026-11-20T00:00:00.000Z' }],
  }));
  const db = {
    trade: { findUnique: async (args: any) => ({ id: args.where.id, status: 'PENDING' }) },
  };
  const server = fakeServer({ [hash]: NOT_FOUND(), [bumpHash]: NOT_FOUND() });
  const detail = await admin.outboxDetail(row.id, { ...h.deps(server), db: db as never });

  assert.equal(detail.envelope!.operations[0].function, 'agent_buy');
  assert.deepEqual(detail.envelope!.operations[0].args, ['123', 'yes']);
  assert.equal(detail.envelope!.authEntries.length, 1);
  assert.equal(detail.envelope!.authEntries[0].nonce, '12345');
  assert.equal(detail.envelope!.authEntries[0].signatureExpirationLedger, 777);
  assert.equal(detail.envelope!.signatureCount, 1);
  assert.equal(detail.envelope!.sequence, '101');
  assert.deepEqual(detail.feeBumps, [{ hash: bumpHash, fee: '20000', inclusionPerOp: '9000', at: '2026-11-20T00:00:00.000Z' }]);
  assert.deepEqual(detail.rpc.map((r) => [r.role, r.status]), [['inner', 'NOT_FOUND'], ['fee_bump', 'NOT_FOUND']]);
  assert.equal(detail.expiry!.decision, 'PENDING');
  assert.deepEqual(detail.linked, { trade: { id: 'trade-1', status: 'PENDING' } });
  assert.deepEqual(server.calls, [hash, bumpHash], 'every known hash is queried');

  const json = JSON.stringify(detail);
  for (const secret of [txSig.toString('hex'), txSig.toString('base64'), authSig.toString('hex'), authSig.toString('base64'), envelopeXdr, 'FEEBUMP-OUTER-XDR']) {
    assert.ok(!json.includes(secret), `detail leaks ${secret.slice(0, 16)}…`);
  }
});

test('linked rows by kind; unknown kinds link nothing', async () => {
  const admin = await loadAdmin();
  const seen: string[] = [];
  const model = (name: string) => ({ findUnique: async () => (seen.push(name), { name }) });
  const db = {
    market: model('market'), marketCreationAttempt: model('marketCreationAttempt'), trade: model('trade'),
    positionExit: model('positionExit'), reasoningTrace: model('reasoningTrace'), tracePublication: model('tracePublication'),
  };
  assert.deepEqual(Object.keys((await admin.linkedRows({ kind: 'market.create', refId: 'x' }, db))!), ['market', 'creationAttempt']);
  assert.deepEqual(Object.keys((await admin.linkedRows({ kind: 'trade.sell', refId: 'x' }, db))!), ['positionExit']);
  assert.deepEqual(Object.keys((await admin.linkedRows({ kind: 'trace.publish', refId: 'x' }, db))!), ['reasoningTrace', 'tracePublication']);
  assert.equal(await admin.linkedRows({ kind: 'treasury.withdraw', refId: 'x' }, db), null);
});

// ─── Abandon ─────────────────────────────────────────────────────────────────

test('abandon refuses when a fee-bump hash landed (inner NOT_FOUND) and resolves the row instead', async () => {
  const admin = await loadAdmin();
  const h = harness();
  const bumpHash = 'cc'.repeat(32);
  const row = h.store.seed(submitted({ feeBumpHashes: [bumpHash] }));
  let runs = 0;
  await withHandlers({ 'test.kind': async () => void runs++ }, async () => {
    const server = fakeServer({ [bumpHash]: { status: 'SUCCESS', ledger: 190 } });
    const details = await rejectsWith(admin.abandon(row.id, ACTOR, REASON, h.deps(server) as never), 409, 'OUTBOX_ROW_LANDED');
    assert.equal(details!.landedHash, bumpHash);
    const after = h.store.rows.get(row.id)!;
    assert.equal(after.status, 'SUCCESS');
    assert.equal(after.landedHash, bumpHash);
    assert.equal(runs, 1);
    assert.equal(h.audits.length, 1);
    assert.match(h.audits[0].outcome, /refused/);
  });
});

test('abandon refuses while ledger close time is not past maxTime + skew', async () => {
  const admin = await loadAdmin();
  const outbox = await loadOutbox();
  const h = harness();
  const maxTime = NOW_SECS - 30;
  const row = h.store.seed(submitted({ maxTime: BigInt(maxTime) }));
  // Exactly maxTime + skew is still not past it.
  const server = fakeServer({}, { fallback: () => NOT_FOUND({ latestLedgerCloseTime: maxTime + outbox.OUTBOX_EXPIRY_SKEW_SECONDS }) });
  const details = await rejectsWith(admin.abandon(row.id, ACTOR, REASON, h.deps(server) as never), 409, 'OUTBOX_NOT_PROVABLE');
  assert.equal(details!.decision, 'PENDING');
  assert.equal(h.store.rows.get(row.id)!.status, 'SUBMITTED');
  assert.equal(h.audits.length, 0);
});

test('abandon refuses when the submission is outside RPC retention, unknown, or the row predates maxTime', async () => {
  const admin = await loadAdmin();
  const h = harness();
  const old = h.store.seed(submitted({ submitLedger: 10 }));
  const server = fakeServer({}, { fallback: () => NOT_FOUND({ oldestLedger: 50 }) });
  const d1 = await rejectsWith(admin.abandon(old.id, ACTOR, REASON, h.deps(server) as never), 409, 'OUTBOX_NOT_PROVABLE');
  assert.equal(d1!.decision, 'UNKNOWN');

  // A SIGNED row may have been sent before a crash: same rule, and no submitLedger means UNKNOWN.
  const signed = h.store.seed(submitted({ status: 'SIGNED', hash: 'dd'.repeat(32), submitLedger: null }));
  const d2 = await rejectsWith(admin.abandon(signed.id, ACTOR, REASON, h.deps() as never), 409, 'OUTBOX_NOT_PROVABLE');
  assert.equal(d2!.decision, 'UNKNOWN');

  const legacy = h.store.seed(submitted({ hash: 'ee'.repeat(32), maxTime: null }));
  await rejectsWith(admin.abandon(legacy.id, ACTOR, REASON, h.deps() as never), 409, 'OUTBOX_NOT_PROVABLE');

  const terminal = h.store.seed(submitted({ hash: 'ff'.repeat(32), status: 'SUCCESS' }));
  await rejectsWith(admin.abandon(terminal.id, ACTOR, REASON, h.deps() as never), 409, 'OUTBOX_INVALID_STATE');

  for (const id of [old.id, signed.id, legacy.id]) assert.notEqual(h.store.rows.get(id)!.status, 'EXPIRED');
});

test('abandon moves SUBMITTED to EXPIRED, runs the EXPIRED handler once and audits the reason', async () => {
  const admin = await loadAdmin();
  const outbox = await loadOutbox();
  const h = harness();
  const row = h.store.seed(submitted({ feeBumpHashes: ['12'.repeat(32)] }));
  const outcomes: string[] = [];
  await withHandlers({ 'test.kind': async (_r, o) => void outcomes.push(o.status) }, async () => {
    const res = await admin.abandon(row.id, ACTOR, REASON, h.deps() as never);
    assert.deepEqual(res, { id: row.id, kind: 'test.kind', fromStatus: 'SUBMITTED', toStatus: 'EXPIRED', handled: true });
    const after = h.store.rows.get(row.id)!;
    assert.equal(after.status, 'EXPIRED');
    assert.equal(after.error, `abandoned by admin: ${REASON}`);
    assert.ok(after.handledAt);
    assert.deepEqual(outcomes, ['EXPIRED']);

    // The worker finds nothing left to do for it.
    await outbox.recoverInFlight({ server: fakeServer({}) as never, store: h.store, now: () => NOW_SECS, leaseRedis: h.redis as never });
    assert.deepEqual(outcomes, ['EXPIRED']);

    assert.equal(h.audits.length, 1);
    assert.deepEqual(
      { ...h.audits[0], outcome: undefined },
      {
        actor: ACTOR, action: 'CHAIN_OUTBOX_ABANDON', outboxId: row.id, kind: 'test.kind', fromStatus: 'SUBMITTED',
        toStatus: 'EXPIRED', reason: REASON, hashes: [row.hash, '12'.repeat(32)], outcome: undefined,
      },
    );
  });
});

// ─── Rerun handler, per kind ─────────────────────────────────────────────────

async function rerunTwice(kind: string, handler: unknown, row: Partial<Row>): Promise<{ h: Harness; id: string }> {
  const admin = await loadAdmin();
  const h = harness();
  const seeded = h.store.seed({ kind, handledAt: new Date(1_000), ...row });
  await withHandlers({ [kind]: handler as never }, async () => {
    for (let i = 0; i < 2; i++) {
      const res = await admin.rerunHandler(seeded.id, ACTOR, REASON, h.deps() as never);
      assert.equal(res.handled, true);
      assert.ok(h.store.rows.get(seeded.id)!.handledAt, 'marked handled again');
    }
  });
  assert.equal(h.audits.length, 2);
  assert.ok(h.audits.every((a) => a.action === 'CHAIN_OUTBOX_RERUN_HANDLER' && a.reason === REASON));
  return { h, id: seeded.id };
}

test('rerun-handler market.create: clears handledAt by CAS, links the stored id, and is a no-op the second time', async () => {
  const { handleMarketCreateOutcome } = await import('../src/services/market-chain.service');
  const { prisma } = await import('../src/lib/prisma');
  const idempotency = await import('../src/services/market-idempotency.service');
  const market: Record<string, unknown> = { id: 'm1', onChainMarketId: null };
  (prisma.market.findUnique as unknown) = async () => ({ onChainMarketId: market.onChainMarketId });
  (prisma.market.create as unknown) = async () => assert.fail('a re-run must never create a market');
  const links: bigint[] = [];
  (idempotency as { linkLandedMarket: unknown }).linkLandedMarket = async (_id: string, onChainId: bigint) => {
    links.push(onChainId);
    market.onChainMarketId = onChainId;
    return true;
  };
  await rerunTwice('market.create', handleMarketCreateOutcome, { status: 'SUCCESS', refId: 'm1', hash: 'a1'.repeat(32), returnValue: '5' });
  assert.deepEqual(links, [5n]);
});

test('rerun-handler trade.buy: executes the trade once; the second run creates no second Position', async () => {
  const { handleTradeBuyOutcome } = await import('../src/services/trade.service');
  const { prisma } = await import('../src/lib/prisma');
  const { Prisma } = await import('@prisma/client');
  const trade: Record<string, unknown> = { id: 't1', marketId: 'm1', direction: 'YES', amount: 4, status: 'PENDING' };
  const positions = new Map<string, unknown>();
  let transitions = 0;
  (prisma.trade.findUnique as unknown) = async () => ({ ...trade });
  (prisma.trade.updateMany as unknown) = async ({ where, data }: { where: { status: { in: string[] } }; data: object }) => {
    if (!where.status.in.includes(trade.status as string)) return { count: 0 };
    Object.assign(trade, data);
    transitions++;
    return { count: 1 };
  };
  (prisma.position.create as unknown) = async ({ data }: { data: { tradeId: string } }) => {
    if (positions.has(data.tradeId)) throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    positions.set(data.tradeId, data);
    return data;
  };
  await rerunTwice('trade.buy', handleTradeBuyOutcome, {
    status: 'SUCCESS', refId: 't1', hash: 'a2'.repeat(32), returnValue: '777', args: { collateral_in: '40000000', feeRaw: '400000' },
  });
  assert.equal(trade.status, 'EXECUTED');
  assert.equal(transitions, 1);
  assert.equal(positions.size, 1);
});

test('rerun-handler trade.sell: fails the exit once; the second run leaves it alone', async () => {
  const { handleTradeSellOutcome } = await import('../src/services/exit.service');
  const { prisma } = await import('../src/lib/prisma');
  const exit: Record<string, unknown> = { id: 'x1', positionId: 'p1', status: 'SUBMITTED' };
  let writes = 0;
  (prisma.positionExit.findUnique as unknown) = async () => ({ ...exit });
  (prisma.positionExit.updateMany as unknown) = async ({ where, data }: { where: { status: string }; data: object }) => {
    if (exit.status !== where.status) return { count: 0 };
    Object.assign(exit, data);
    writes++;
    return { count: 1 };
  };
  await rerunTwice('trade.sell', handleTradeSellOutcome, { status: 'EXPIRED', refId: 'x1', hash: 'a3'.repeat(32), error: 'expired by timebounds' });
  assert.equal(exit.status, 'FAILED');
  assert.equal(exit.error, 'expired unsubmitted');
  assert.equal(writes, 1);
});

test('rerun-handler trace.publish: links the trace once; the second run changes nothing', async () => {
  const { handleTracePublishOutcome } = await import('../src/services/trace-publish.service');
  const { prisma } = await import('../src/lib/prisma');
  const trace: Record<string, unknown> = { id: 'tr1', onChainTraceId: null };
  const publication: Record<string, unknown> = { traceId: 'tr1', status: 'SUBMITTED' };
  let writes = 0;
  (prisma.reasoningTrace.updateMany as unknown) = async ({ data }: { data: Record<string, unknown> }) => {
    if (trace.onChainTraceId !== null) return { count: 0 };
    Object.assign(trace, data);
    writes++;
    return { count: 1 };
  };
  (prisma.tracePublication.updateMany as unknown) = async ({ where, data }: { where: { status: { in: string[] } }; data: object }) => {
    if (!where.status.in.includes(publication.status as string)) return { count: 0 };
    Object.assign(publication, data);
    writes++;
    return { count: 1 };
  };
  await rerunTwice('trace.publish', handleTracePublishOutcome, { status: 'SUCCESS', refId: 'tr1', hash: 'a4'.repeat(32), returnValue: '42' });
  assert.equal(trace.onChainTraceId, 42n);
  assert.equal(publication.status, 'CONFIRMED');
  assert.equal(writes, 2, 'one trace link and one publication confirm, then nothing');
});

test('rerun-handler refuses non-terminal rows and a concurrently changed handledAt', async () => {
  const admin = await loadAdmin();
  const h = harness();
  const live = h.store.seed(submitted());
  await rejectsWith(admin.rerunHandler(live.id, ACTOR, REASON, h.deps() as never), 409, 'OUTBOX_INVALID_STATE');
  const done = h.store.seed({ kind: 'test.kind', status: 'SUCCESS', handledAt: new Date(5_000) });
  const deps = { ...h.deps(), clearHandled: async () => false };
  await rejectsWith(admin.rerunHandler(done.id, ACTOR, REASON, deps as never), 409, 'OUTBOX_INVALID_STATE');
  assert.equal(h.audits.length, 0);
});

// ─── Recover now ─────────────────────────────────────────────────────────────

test('recover resolves a non-terminal row now and runs a terminal row\'s missing handler', async () => {
  const admin = await loadAdmin();
  const h = harness();
  const live = h.store.seed(submitted({ maxTime: BigInt(NOW_SECS + 600) }));
  const unhandled = h.store.seed({ kind: 'test.kind', status: 'FAILED', hash: 'b2'.repeat(32), error: 'boom' });
  const outcomes: string[] = [];
  await withHandlers({ 'test.kind': async (_r, o) => void outcomes.push(o.status) }, async () => {
    const server = fakeServer({ [live.hash!]: { status: 'SUCCESS', ledger: 199 } });
    const res = await admin.recoverNow(live.id, ACTOR, REASON, h.deps(server) as never);
    assert.equal(res.fromStatus, 'SUBMITTED');
    assert.equal(res.toStatus, 'SUCCESS');
    assert.equal(res.stats!.resolved, 1);

    const res2 = await admin.recoverNow(unhandled.id, ACTOR, REASON, h.deps() as never);
    assert.equal(res2.handled, true);
    assert.deepEqual(outcomes, ['SUCCESS', 'FAILED']);

    // Handled terminal rows go through rerun-handler instead.
    await rejectsWith(admin.recoverNow(unhandled.id, ACTOR, REASON, h.deps() as never), 409, 'OUTBOX_INVALID_STATE');
  });
  assert.equal(h.audits.length, 2);
});

test('recover refuses a BUILT row still inside the signing grace (owned by the live writer)', async () => {
  const admin = await loadAdmin();
  const h = harness();
  const row = h.store.seed({ kind: 'test.kind', status: 'BUILT', updatedAt: new Date(NOW_SECS * 1000 - 1_000) });
  await rejectsWith(admin.recoverNow(row.id, ACTOR, REASON, h.deps() as never), 409, 'OUTBOX_INVALID_STATE');
  assert.equal(h.store.rows.get(row.id)!.status, 'BUILT');
});

// ─── Lease ───────────────────────────────────────────────────────────────────

test('an action returns 409 OUTBOX_ROW_BUSY while the worker holds the row lease', async () => {
  const admin = await loadAdmin();
  const outbox = await loadOutbox();
  const h = harness();
  const row = h.store.seed(submitted({ maxTime: BigInt(NOW_SECS + 600) }));
  const gate = deferred();
  const server = fakeServer({}, { gate: gate.promise });
  await withHandlers({ 'test.kind': async () => undefined }, async () => {
    const pass = outbox.recoverInFlight({ server: server as never, store: h.store, now: () => NOW_SECS, leaseRedis: h.redis as never });
    while (server.calls.length === 0) await new Promise((r) => setImmediate(r));
    assert.ok(h.redis.store.has(outbox.rowLeaseKey(row.id)), 'the worker holds outbox:row:<id>');
    for (const action of [
      admin.recoverNow(row.id, ACTOR, REASON, h.deps() as never),
      admin.abandon(row.id, ACTOR, REASON, h.deps() as never),
      admin.rerunHandler(row.id, ACTOR, REASON, h.deps() as never),
    ]) {
      await rejectsWith(action, 409, 'OUTBOX_ROW_BUSY');
    }
    gate.resolve();
    await pass;
    assert.ok(!h.redis.store.has(outbox.rowLeaseKey(row.id)), 'the worker released the lease');
  });
  assert.equal(h.audits.length, 0);
});

test('the worker skips a row leased by an admin action', async () => {
  const admin = await loadAdmin();
  const outbox = await loadOutbox();
  const h = harness();
  const row = h.store.seed({ kind: 'test.kind', status: 'SUCCESS', hash: 'c3'.repeat(32) });
  const gate = deferred();
  let runs = 0;
  let entered = false;
  await withHandlers({ 'test.kind': async () => { runs++; entered = true; await gate.promise; } }, async () => {
    const action = admin.recoverNow(row.id, ACTOR, REASON, h.deps() as never);
    while (!entered) await new Promise((r) => setImmediate(r));
    const stats = await outbox.recoverInFlight({ server: fakeServer({}) as never, store: h.store, now: () => NOW_SECS, leaseRedis: h.redis as never });
    assert.equal(stats.handled, 0, 'the worker skipped the leased row');
    assert.equal(runs, 1);
    gate.resolve();
    await action;
  });
  assert.equal(runs, 1);
  assert.ok(h.store.rows.get(row.id)!.handledAt);
});

test('actions fail closed with 503 when Redis is down; the worker proceeds unleased', async () => {
  const admin = await loadAdmin();
  const outbox = await loadOutbox();
  const h = harness();
  h.redis.failAll = true;
  const row = h.store.seed({ kind: 'test.kind', status: 'FAILED', hash: 'd4'.repeat(32) });
  let runs = 0;
  await withHandlers({ 'test.kind': async () => void runs++ }, async () => {
    await rejectsWith(admin.recoverNow(row.id, ACTOR, REASON, h.deps() as never), 503, 'OUTBOX_LEASE_UNAVAILABLE');
    assert.equal(runs, 0);
    const stats = await outbox.recoverInFlight({ server: fakeServer({}) as never, store: h.store, now: () => NOW_SECS, leaseRedis: h.redis as never });
    assert.equal(stats.handled, 1);
    assert.equal(runs, 1);
  });
});

test('withRowLease renews the lease while a long action runs', async () => {
  const outbox = await loadOutbox();
  const redis = new FakeRedis();
  let renewed = 0;
  const realEval = redis.eval.bind(redis);
  redis.eval = async (script: string, numKeys: number, ...rest: string[]) => {
    if (script.includes('PEXPIRE')) renewed++;
    return realEval(script, numKeys, ...rest);
  };
  const result = await outbox.withRowLease('r-long', async () => {
    await new Promise((r) => setTimeout(r, 400));
    return 'done';
  }, { redis: redis as never, ttlMs: 300 });
  assert.equal(result, 'done');
  assert.ok(renewed >= 1, 'renewLock ran while the action outlived its TTL');
  assert.ok(!redis.store.has(outbox.rowLeaseKey('r-long')), 'released afterwards');
});
