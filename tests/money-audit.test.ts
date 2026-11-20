import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';

setupTestEnv();
const ADMIN = Keypair.random().publicKey();
process.env.ADMIN_ADDRESSES = ADMIN; // read once when config loads

// Load resilience first: entering the module graph at error.middleware hits a
// require cycle (response.util → cache.middleware → … → resilience) in which
// AppError is not defined yet.
test.before(async () => {
  await import('../src/lib/resilience');
});

const NOW = new Date('2026-11-20T12:00:00Z');
const OLD = new Date(NOW.getTime() - 24 * 3600_000);
const TREASURY = 'CTREASURY';
const H = (c: string) => c.repeat(64);

// ─── In-memory world ─────────────────────────────────────────────────────────

interface World {
  trades: any[];
  positions: any[];
  exits: any[];
  outbox: any[];
  pubs: any[];
  markets: Map<string, bigint>;
  events: Array<{ onChainMarketId: bigint; ledger: number }>;
  cursor: number | null;
}

function world(over: Partial<World> = {}): World {
  return { trades: [], positions: [], exits: [], outbox: [], pubs: [], markets: new Map([['m1', 1n]]), events: [], cursor: 1000, ...over };
}

const trade = (over: Record<string, unknown> = {}) => ({
  id: 't1', marketId: 'm1', direction: 'YES', status: 'EXECUTED', txHash: H('a'), innerTxHash: H('a'),
  amount: 10, createdAt: OLD, updatedAt: OLD, ...over,
});
const outboxRow = (over: Record<string, unknown> = {}) => ({
  id: 'o1', kind: 'trade.buy', refId: 't1', status: 'SUCCESS', hash: H('a'), landedHash: null, feeBumpHashes: [],
  handledAt: OLD, updatedAt: OLD, args: { collateral_in: '10000000', feeRaw: '100000' }, returnValue: '19000000',
  error: null, contract: 'treasury', method: 'agent_buy', ...over,
});
const position = (over: Record<string, unknown> = {}) => ({
  id: 'p1', marketId: 'm1', tradeId: 't1', direction: 'YES', status: 'OPEN', closeReason: null, sharesRaw: '100',
  updatedAt: OLD, ...over,
});

const ref = (r: any) => ({
  id: r.id, kind: r.kind, refId: r.refId ?? null, status: r.status, hash: r.hash ?? null, landedHash: r.landedHash ?? null,
  feeBumpHashes: r.feeBumpHashes ?? [], handledAt: r.handledAt ?? null, updatedAt: r.updatedAt ?? OLD,
});
const IN_FLIGHT = ['BUILT', 'SIGNED', 'SUBMITTED', 'PENDING'];

/** A fake snapshot: coarse prefilters only, so the invariants' own checks are exercised. */
function snapshotOf(w: World): any {
  const withOutbox = (kind: string) => (t: any) => ({ ...t, outbox: w.outbox.filter((r) => r.kind === kind).map(ref) });
  return {
    executedTradesWithoutBuySuccess: async () =>
      w.trades
        .filter((t) => t.status === 'EXECUTED' && t.txHash && !w.outbox.some((r) => r.kind === 'trade.buy' && r.refId === t.id && r.status === 'SUCCESS'))
        .map(withOutbox('trade.buy')),
    positionsWithNonExecutedTrade: async () =>
      w.positions.map((p) => {
        const t = w.trades.find((x) => x.id === p.tradeId);
        return { ...p, positionStatus: p.status, tradeStatus: t.status, tradeUpdatedAt: t.updatedAt };
      }),
    executedTradesWithoutPosition: async () =>
      w.trades.filter((t) => t.status === 'EXECUTED' && !w.positions.some((p) => p.tradeId === t.id)).map(withOutbox('trade.buy')),
    unhandledTerminalOutbox: async () => w.outbox.map(ref),
    pendingTradesCreatedBefore: async () => w.trades.map(withOutbox('trade.buy')),
    confirmedExitsWithoutSellSuccess: async () => w.exits.map(withOutbox('trade.sell')),
    sidePositions: async () =>
      w.positions.map((p) => ({
        ...p,
        onChainMarketId: w.markets.get(p.marketId)!,
        tradeUpdatedAt: w.trades.find((t) => t.id === p.tradeId)?.updatedAt ?? OLD,
        exits: w.exits.filter((e) => e.positionId === p.id).map((e) => ({ id: e.id, status: e.status, createdAt: e.createdAt })),
      })),
    confirmedBuyTracesWithoutTrade: async () =>
      w.pubs.map((p) => ({
        ...p,
        trades: w.trades.filter((t) => t.marketId === p.marketId && t.status === 'EXECUTED').map((t) => ({ id: t.id, direction: t.direction, createdAt: t.createdAt })),
      })),
    inFlightRefIds: async (ids: string[]) =>
      new Set(w.outbox.filter((r) => ids.includes(r.refId) && IN_FLIGHT.includes(r.status)).map((r) => r.refId)),
    indexerCursor: async () => w.cursor,
  };
}

// ─── Stubbed Prisma (audit tables, agent logs, and what applyBuySuccess touches) ─

async function setup(w: World) {
  const { prisma } = await import('../src/lib/prisma');
  const { Prisma } = await import('@prisma/client');
  const db = { runs: [] as any[], findings: [] as any[], logs: [] as any[], alerts: [] as any[], applyCalls: 0 };
  let seq = 0;

  (prisma.moneyAuditRun.create as any) = async ({ data }: any) => { db.runs.push({ finishedAt: null, error: null, ...data }); return data; };
  (prisma.moneyAuditRun.update as any) = async ({ where, data }: any) => Object.assign(db.runs.find((r) => r.id === where.id), data);
  (prisma.moneyAuditRun.findFirst as any) = async ({ where }: any) =>
    db.runs.filter((r) => r.id !== where.id.not && r.finishedAt && !r.error).slice(-1)[0] ?? null;
  (prisma.moneyAuditFinding.createMany as any) = async ({ data }: any) => {
    for (const d of data) db.findings.push({ id: `f${++seq}`, createdAt: new Date(), ...d });
    return { count: data.length };
  };
  (prisma.moneyAuditFinding.findFirst as any) = async ({ where }: any) =>
    db.findings.filter((f) => f.runId === where.runId && f.invariant === where.invariant && f.subjectId === where.subjectId).slice(-1)[0] ?? null;
  (prisma.moneyAuditFinding.findMany as any) = async ({ where }: any) =>
    db.findings.filter((f) => where.fingerprint.in.includes(f.fingerprint) && f.runId !== where.runId.not);
  (prisma.agentLog.create as any) = async ({ data }: any) => { db.logs.push(data); return data; };

  (prisma.trade.findUnique as any) = async ({ where }: any) => w.trades.find((t) => t.id === where.id) ?? null;
  (prisma.trade.updateMany as any) = async ({ where, data }: any) => {
    const t = w.trades.find((x) => x.id === where.id && where.status.in.includes(x.status));
    if (t) Object.assign(t, data, { updatedAt: NOW });
    return { count: t ? 1 : 0 };
  };
  (prisma.position.create as any) = async ({ data }: any) => {
    db.applyCalls++;
    if (w.positions.some((p) => p.tradeId === data.tradeId)) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
    }
    const p = { id: `p-${data.tradeId}`, closeReason: null, updatedAt: NOW, ...data };
    w.positions.push(p);
    return p;
  };

  const { applyBuySuccess } = await import('../src/services/trade.service');
  const { runCompletionHandler } = await import('../src/services/stellar/outbox');
  const store: any = { markHandled: async (id: string) => { const r = w.outbox.find((x) => x.id === id); if (r && !r.handledAt) r.handledAt = NOW; } };
  const txStatus = new Map<string, string>();
  const { defaultChain } = await import('../src/services/money-audit/run');
  const txReads: string[] = [];

  const deps: any = {
    snapshot: snapshotOf(w),
    chain: {
      getPositionWithLedger: defaultChain.getPositionWithLedger, // through setChainOverrides
      getTransaction: async (hash: string) => { txReads.push(hash); return { status: txStatus.get(hash) ?? 'NOT_FOUND' }; },
    },
    repair: {
      now: () => NOW,
      graceMs: 120_000,
      applyBuySuccess,
      runCompletionHandler: (row: any, outcome: any) => runCompletionHandler(row, outcome, store),
      loadTrade: async (id: string) => w.trades.find((t) => t.id === id) ?? null,
      positionExists: async (tradeId: string) => w.positions.some((p) => p.tradeId === tradeId),
      loadOutboxRow: async (id: string) => w.outbox.find((r) => r.id === id) ?? null,
      inFlightRefIds: async (ids: string[]) =>
        new Set(w.outbox.filter((r) => ids.includes(r.refId) && IN_FLIGHT.includes(r.status)).map((r) => r.refId)),
    },
    sinks: [{ name: 'test', send: async (a: unknown) => { db.alerts.push(a); } }],
    liveMode: true,
    treasury: TREASURY,
    indexerEnabled: true,
    treasuryTradeEvents: async (id: bigint, after: number, upTo: number) =>
      w.events.filter((e) => e.onChainMarketId === id && e.ledger > after && e.ledger <= upTo).length,
  };

  const inv = await import('../src/services/money-audit/invariants');
  const { auditMoney } = await import('../src/services/money-audit/run');
  const run = (only: string[] | null, over: Record<string, unknown> = {}) =>
    auditMoney(
      { dryRun: false, now: NOW, autoRepair: false, maxRpcCalls: 50, graceMs: 120_000, pendingGraceMs: 3600_000, ...over },
      { ...deps, invariants: only ? inv.INVARIANTS.filter((i) => only.includes(i.id)) : inv.INVARIANTS },
    );
  const lastRun = () => db.findings.filter((f) => f.runId === db.runs.slice(-1)[0].id);
  return { db, deps, run, lastRun, txStatus, txReads, inv };
}

async function withPosition(position: { yes: bigint; no: bigint }, ledger: number, fn: () => Promise<void>) {
  const { setChainOverrides } = await import('../src/services/chain.service');
  const reads: bigint[] = [];
  const prev = setChainOverrides({ getPositionWithLedger: async (id: bigint) => { reads.push(id); return { position, ledger }; } });
  try {
    await fn();
  } finally {
    setChainOverrides(prev);
  }
  return reads;
}

// ─── getPositionWithLedger ───────────────────────────────────────────────────

test('getPositionWithLedger returns the simulation ledger, throws without one, and is overridable', async () => {
  const { readClients } = await import('../src/services/stellar/clients');
  const { getPositionWithLedger, setChainOverrides } = await import('../src/services/chain.service');
  const { ChainError } = await import('../src/services/stellar/errors');
  const orig = readClients.marketCore;
  let simulation: any = { latestLedger: 4242 };
  (readClients as any).marketCore = () => ({ get_position: async () => ({ result: { yes: 7n, no: 3n }, simulation }) });
  try {
    const res = await getPositionWithLedger(5n, TREASURY);
    assert.equal(res.ledger, 4242);
    assert.equal(res.position.yes, 7n);
    simulation = {};
    await assert.rejects(getPositionWithLedger(5n, TREASURY), (err: unknown) => err instanceof ChainError);
    const prev = setChainOverrides({ getPositionWithLedger: async () => ({ position: { yes: 1n, no: 2n }, ledger: 9 }) });
    assert.equal((await getPositionWithLedger(5n, TREASURY)).ledger, 9);
    setChainOverrides(prev);
  } finally {
    (readClients as any).marketCore = orig;
  }
});

// ─── TRADE_EXECUTED_WITHOUT_OUTBOX ───────────────────────────────────────────

test('TRADE_EXECUTED_WITHOUT_OUTBOX flags an EXECUTED trade without a SUCCESS outbox row', async () => {
  const w = world({ trades: [trade()], positions: [position()] });
  const { run, lastRun, txReads } = await setup(w);
  await run(['TRADE_EXECUTED_WITHOUT_OUTBOX']);
  const [f] = lastRun();
  assert.equal(f.invariant, 'TRADE_EXECUTED_WITHOUT_OUTBOX');
  assert.equal(f.severity, 'HIGH');
  assert.equal(f.action, 'REPORTED');
  assert.equal(f.evidence.chainStatus, 'NOT_FOUND');
  assert.deepEqual(txReads, [H('a')], 'chain read only because no outbox row exists');
});

test('TRADE_EXECUTED_WITHOUT_OUTBOX: a fee-bumped SUCCESS row matched by hash clears it; in-flight is skipped', async () => {
  // Outer (bumped) hash on the trade, inner hash on the row, different refId.
  const bumped = world({
    trades: [trade({ txHash: H('b'), innerTxHash: H('a') })],
    outbox: [outboxRow({ refId: 'attempt-2', hash: H('a'), landedHash: H('b') })],
  });
  const a = await setup(bumped);
  await a.run(['TRADE_EXECUTED_WITHOUT_OUTBOX']);
  assert.equal(a.lastRun().length, 0);

  const pending = world({ trades: [trade()], outbox: [outboxRow({ status: 'PENDING', handledAt: null })] });
  const b = await setup(pending);
  const summary = await b.run(['TRADE_EXECUTED_WITHOUT_OUTBOX']);
  assert.equal(b.lastRun()[0].action, 'SKIPPED_IN_FLIGHT');
  assert.equal(summary.skippedInFlight, 1);
  assert.equal(b.txReads.length, 0, 'in-flight subjects are not read from chain');
});

// ─── POSITION_WITHOUT_EXECUTED_TRADE ─────────────────────────────────────────

test('POSITION_WITHOUT_EXECUTED_TRADE flags a position whose trade is FAILED as CRITICAL and alerts once', async () => {
  const w = world({ trades: [trade({ status: 'FAILED', txHash: null })], positions: [position()] });
  const { run, lastRun, db } = await setup(w);
  await run(['POSITION_WITHOUT_EXECUTED_TRADE']);
  const [f] = lastRun();
  assert.equal(f.severity, 'CRITICAL');
  assert.equal(f.subjectType, 'position');
  assert.equal(f.evidence.tradeStatus, 'FAILED');
  assert.equal(db.alerts.length, 1);
  assert.equal(db.alerts[0].level, 'CRITICAL');
  assert.equal(db.logs[0].action, 'MONEY_AUDIT_FINDING');
  assert.equal(db.logs[0].agentType, 'TRADER');

  await run(['POSITION_WITHOUT_EXECUTED_TRADE']);
  assert.equal(lastRun()[0].fingerprint, f.fingerprint);
  assert.equal(lastRun()[0].firstSeenRunId, f.runId, 'the fingerprint carries the finding across runs');
  assert.equal(db.alerts.length, 1, 'no re-alert for a known fingerprint');
});

test('POSITION_WITHOUT_EXECUTED_TRADE ignores positions with an EXECUTED trade; acked findings stay quiet', async () => {
  const ok = await setup(world({ trades: [trade()], positions: [position()] }));
  await ok.run(['POSITION_WITHOUT_EXECUTED_TRADE']);
  assert.equal(ok.lastRun().length, 0);

  const w = world({ trades: [trade({ status: 'PENDING', txHash: null })], positions: [position()] });
  const { run, lastRun, db } = await setup(w);
  await run(['POSITION_WITHOUT_EXECUTED_TRADE']);
  Object.assign(db.findings[0], { action: 'ACKED', ackedBy: ADMIN, ackedAt: NOW });
  await run(['POSITION_WITHOUT_EXECUTED_TRADE']);
  assert.equal(lastRun()[0].action, 'ACKED');
  assert.equal(lastRun()[0].ackedBy, ADMIN);
  assert.equal(db.alerts.length, 1);
});

// ─── EXECUTED_TRADE_WITHOUT_POSITION ─────────────────────────────────────────

test('EXECUTED_TRADE_WITHOUT_POSITION re-runs applyBuySuccess from the SUCCESS row and is idempotent', async () => {
  const w = world({ trades: [trade()], outbox: [outboxRow()] });
  const { run, lastRun, db, deps, inv } = await setup(w);
  const summary = await run(['EXECUTED_TRADE_WITHOUT_POSITION'], { autoRepair: true });
  assert.equal(lastRun()[0].action, 'REPAIRED');
  assert.equal(summary.repaired, 1);
  assert.equal(w.positions.length, 1);
  assert.equal(w.positions[0].sharesRaw, '19000000');
  assert.equal(w.positions[0].costBasisRaw, '10000000');
  assert.equal(w.trades[0].status, 'EXECUTED');

  await run(['EXECUTED_TRADE_WITHOUT_POSITION'], { autoRepair: true });
  assert.equal(lastRun().length, 0, 'nothing left to repair');
  // Re-running the repair itself is a no-op (it re-reads and finds the position).
  const again = await inv.executedTradeWithoutPosition.repair!(
    { invariant: 'EXECUTED_TRADE_WITHOUT_POSITION', severity: 'HIGH', subjectType: 'trade', subjectId: 't1', evidence: {}, core: {}, repairInput: { outboxId: 'o1' } },
    deps.repair,
  );
  assert.equal(again, 'SKIPPED');
  // applyBuySuccess on its own swallows the duplicate (P2002).
  await deps.repair.applyBuySuccess('t1', { sharesOut: 1n, collateralIn: 1n, feeRaw: 0n, txHash: H('a'), innerTxHash: H('a') });
  assert.equal(w.positions.length, 1);
  assert.equal(db.applyCalls, 2);
});

test('EXECUTED_TRADE_WITHOUT_POSITION: dry-run mode is not checked; no SUCCESS row means report only', async () => {
  const w = world({ trades: [trade()] });
  const a = await setup(w);
  await a.run(['EXECUTED_TRADE_WITHOUT_POSITION'], { autoRepair: true });
  assert.equal(a.lastRun()[0].action, 'REPORTED');
  assert.equal(a.lastRun()[0].suggestedRepair, null);
  assert.equal(w.positions.length, 0);

  const b = await setup(world({ trades: [trade()], outbox: [outboxRow()] }));
  b.deps.liveMode = false;
  await b.run(['EXECUTED_TRADE_WITHOUT_POSITION']);
  assert.equal(b.lastRun().length, 0);
});

// ─── OUTBOX_TERMINAL_UNHANDLED ───────────────────────────────────────────────

test('OUTBOX_TERMINAL_UNHANDLED repair calls the registered handler once', async () => {
  await import('../src/services/trace-publish.service'); // its own handler registers first
  const { registerHandler } = await import('../src/services/stellar/outbox');
  const calls: any[] = [];
  registerHandler('trace.publish', async (row, outcome) => { calls.push([row.id, outcome.status]); });

  const w = world({ outbox: [outboxRow({ id: 'o9', kind: 'trace.publish', refId: 'trace-1', handledAt: null })] });
  const { run, lastRun } = await setup(w);
  await run(['OUTBOX_TERMINAL_UNHANDLED'], { autoRepair: true });
  assert.equal(lastRun()[0].action, 'REPAIRED');
  assert.equal(lastRun()[0].severity, 'HIGH');
  await run(['OUTBOX_TERMINAL_UNHANDLED'], { autoRepair: true });
  assert.equal(lastRun().length, 0);
  assert.deepEqual(calls, [['o9', 'SUCCESS']]);
  assert.equal(w.outbox[0].handledAt, NOW);
});

test('OUTBOX_TERMINAL_UNHANDLED: inside the grace, handled, or with the refId in flight it is left alone', async () => {
  const { registerHandler } = await import('../src/services/stellar/outbox');
  const calls: string[] = [];
  registerHandler('trace.publish', async (row) => { calls.push(row.id); });
  const w = world({
    outbox: [
      outboxRow({ id: 'young', kind: 'trace.publish', refId: 'a', handledAt: null, updatedAt: new Date(NOW.getTime() - 10_000) }),
      outboxRow({ id: 'done', kind: 'trace.publish', refId: 'b', handledAt: OLD }),
      outboxRow({ id: 'old', kind: 'trace.publish', refId: 'c', status: 'EXPIRED', handledAt: null }),
      outboxRow({ id: 'retry', kind: 'trace.publish', refId: 'c', status: 'SUBMITTED', handledAt: null, updatedAt: NOW }),
      outboxRow({ id: 'misc', kind: 'treasury.set_paused', refId: null, handledAt: null }),
    ],
  });
  const { run, lastRun } = await setup(w);
  await run(['OUTBOX_TERMINAL_UNHANDLED'], { autoRepair: true });
  assert.deepEqual(lastRun().map((f: any) => [f.subjectId, f.action]), [['old', 'SKIPPED_IN_FLIGHT']]);
  assert.deepEqual(calls, [], 'in-flight subjects are never repaired');
});

// ─── TRADE_STUCK_PENDING ─────────────────────────────────────────────────────

test('TRADE_STUCK_PENDING flags an old PENDING trade with nothing in flight only', async () => {
  const w = world({
    trades: [
      trade({ id: 'stuck', status: 'PENDING', txHash: null, innerTxHash: null }),
      trade({ id: 'working', status: 'PENDING', txHash: null, innerTxHash: null }),
      trade({ id: 'young', status: 'PENDING', txHash: null, innerTxHash: null, createdAt: new Date(NOW.getTime() - 60_000) }),
    ],
    outbox: [outboxRow({ id: 'ow', refId: 'working', status: 'PENDING', hash: H('c'), handledAt: null })],
  });
  const { run, lastRun } = await setup(w);
  await run(['TRADE_STUCK_PENDING']);
  assert.deepEqual(lastRun().map((f: any) => [f.subjectId, f.severity]), [['stuck', 'MEDIUM']]);
});

// ─── EXIT_CONFIRMED_NOT_LANDED ───────────────────────────────────────────────

const exit = (over: Record<string, unknown> = {}) => ({ id: 'e1', positionId: 'p1', status: 'CONFIRMED', txHash: H('e'), createdAt: OLD, ...over });

test('EXIT_CONFIRMED_NOT_LANDED reports a CONFIRMED exit whose sale is NOT_FOUND on chain', async () => {
  const w = world({ trades: [trade()], positions: [position()], exits: [exit()] });
  const { run, lastRun, db } = await setup(w);
  await run(['EXIT_CONFIRMED_NOT_LANDED']);
  const [f] = lastRun();
  assert.equal(f.severity, 'CRITICAL');
  assert.equal(f.subjectType, 'exit');
  assert.equal(f.evidence.chainStatus, 'NOT_FOUND');
  assert.equal(db.alerts.length, 1);
});

test('EXIT_CONFIRMED_NOT_LANDED: a landed sale or a SUCCESS trade.sell row clears it; the RPC budget bounds reads', async () => {
  const landed = await setup(world({ exits: [exit()] }));
  landed.txStatus.set(H('e'), 'SUCCESS');
  await landed.run(['EXIT_CONFIRMED_NOT_LANDED']);
  assert.equal(landed.lastRun().length, 0);

  const recorded = await setup(world({ exits: [exit()], outbox: [outboxRow({ id: 'os', kind: 'trade.sell', refId: 'x', hash: H('f'), landedHash: H('e') })] }));
  await recorded.run(['EXIT_CONFIRMED_NOT_LANDED']);
  assert.equal(recorded.lastRun().length, 0);
  assert.equal(recorded.txReads.length, 0);

  const budget = await setup(world({ exits: [exit(), exit({ id: 'e2', txHash: H('d') })] }));
  const summary = await budget.run(['EXIT_CONFIRMED_NOT_LANDED'], { maxRpcCalls: 1 });
  assert.equal(summary.rpcCalls, 1);
  assert.equal(summary.budgetSkipped, 1);
  assert.equal(budget.lastRun().length, 1);
});

// ─── SHARES_MISMATCH ─────────────────────────────────────────────────────────

const sharesWorld = () =>
  world({
    trades: [trade(), trade({ id: 't2' }), trade({ id: 't3' })],
    positions: [
      position({ sharesRaw: '100' }),
      position({ id: 'p2', tradeId: 't2', status: 'CLOSED', closeReason: 'YES_RESOLVED', sharesRaw: '50' }),
      // Closed by a confirmed exit: only the dust it did not sell is left.
      position({ id: 'p3', tradeId: 't3', status: 'CLOSED', closeReason: 'EDGE_DEGRADED', sharesRaw: '7' }),
    ],
  });

test('SHARES_MISMATCH sums OPEN and finality-closed positions against get_position', async () => {
  const ok = await setup(sharesWorld());
  const reads = await withPosition({ yes: 157n, no: 0n }, 1005, async () => { await ok.run(['SHARES_MISMATCH']); });
  assert.deepEqual(reads, [1n]);
  assert.equal(ok.lastRun().length, 0);

  // Chain holds less than the database: reported CRITICAL only once two runs agree.
  const short = await setup(sharesWorld());
  await withPosition({ yes: 100n, no: 0n }, 1005, async () => {
    const first = await short.run(['SHARES_MISMATCH']);
    assert.equal(short.lastRun()[0].action, 'DEFERRED');
    assert.equal(short.lastRun()[0].evidence.deferReason, 'UNCONFIRMED');
    assert.equal(first.deferred, 1);
    await short.run(['SHARES_MISMATCH']);
  });
  const [f] = short.lastRun();
  assert.equal(f.action, 'REPORTED');
  assert.equal(f.severity, 'CRITICAL');
  assert.equal(f.subjectId, '1:YES');
  assert.equal(f.evidence.dbShares, '157');
  assert.equal(f.evidence.chainShares, '100');
  assert.equal(f.evidence.observedLedger, 1005);
  assert.equal(short.db.alerts.length, 1);
  assert.equal(short.db.runs.slice(-1)[0].observedLedger, 1005);

  // Chain holds more: HIGH.
  const extra = await setup(sharesWorld());
  await withPosition({ yes: 200n, no: 0n }, 1005, async () => {
    await extra.run(['SHARES_MISMATCH']);
    await extra.run(['SHARES_MISMATCH']);
  });
  assert.equal(extra.lastRun()[0].severity, 'HIGH');

  // Two runs that disagree (the numbers moved) keep deferring.
  const moving = await setup(sharesWorld());
  await withPosition({ yes: 100n, no: 0n }, 1005, async () => { await moving.run(['SHARES_MISMATCH']); });
  await withPosition({ yes: 90n, no: 0n }, 1006, async () => { await moving.run(['SHARES_MISMATCH']); });
  assert.equal(moving.lastRun()[0].action, 'DEFERRED');
});

test('SHARES_MISMATCH deferred when treasury Trade events exist after the snapshot cursor', async () => {
  const w = sharesWorld();
  w.events.push({ onChainMarketId: 1n, ledger: 1003 }); // cursor 1000, observation 1005
  const { run, lastRun } = await setup(w);
  await withPosition({ yes: 100n, no: 0n }, 1005, async () => {
    await run(['SHARES_MISMATCH']);
    assert.equal(lastRun()[0].action, 'DEFERRED');
    assert.equal(lastRun()[0].evidence.deferReason, 'TRADES_AFTER_SNAPSHOT');
    await run(['SHARES_MISMATCH']);
    assert.equal(lastRun()[0].action, 'DEFERRED', 'a race defers even when the previous run agreed');
    await run(['SHARES_MISMATCH']);
  });
  // Not forever: after MAX_CONSECUTIVE_DEFERRALS race deferrals it is reported, flagged forced.
  assert.equal(lastRun()[0].action, 'REPORTED');
  assert.equal(lastRun()[0].evidence.forced, true);

  // Events outside (cursor, observed] do not count; an indexer far behind defers.
  const late = sharesWorld();
  late.events.push({ onChainMarketId: 1n, ledger: 999 }, { onChainMarketId: 2n, ledger: 1003 });
  const b = await setup(late);
  await withPosition({ yes: 100n, no: 0n }, 1005, async () => { await b.run(['SHARES_MISMATCH']); });
  assert.equal(b.lastRun()[0].evidence.deferReason, 'UNCONFIRMED');
  const behind = await setup(sharesWorld());
  await withPosition({ yes: 100n, no: 0n }, 5000, async () => { await behind.run(['SHARES_MISMATCH']); });
  assert.equal(behind.lastRun()[0].evidence.deferReason, 'INDEXER_BEHIND');
});

test('SHARES_MISMATCH: a legacy null sharesRaw reports SHARES_UNKNOWN_LEGACY and skips the side; in-flight sides are skipped', async () => {
  const w = sharesWorld();
  w.positions[1].sharesRaw = null;
  const a = await setup(w);
  const reads = await withPosition({ yes: 1n, no: 0n }, 1005, async () => { await a.run(['SHARES_MISMATCH']); });
  assert.deepEqual(reads, []);
  assert.deepEqual(a.lastRun().map((f: any) => [f.invariant, f.severity, f.action]), [['SHARES_UNKNOWN_LEGACY', 'INFO', 'REPORTED']]);

  const busy = sharesWorld();
  busy.exits.push(exit({ status: 'SUBMITTED', txHash: null }));
  const b = await setup(busy);
  const busyReads = await withPosition({ yes: 1n, no: 0n }, 1005, async () => { await b.run(['SHARES_MISMATCH']); });
  assert.deepEqual(busyReads, []);
  assert.equal(b.lastRun()[0].action, 'SKIPPED_IN_FLIGHT');
});

// ─── TRACE_WITHOUT_TRADE ─────────────────────────────────────────────────────

test('TRACE_WITHOUT_TRADE matches buy_no only against NO trades created before it', async () => {
  const pub = (over: Record<string, unknown> = {}) => ({
    id: 'tp1', traceId: 'tr1', marketId: 'm1', action: 'buy_no', status: 'CONFIRMED', createdAt: OLD, updatedAt: OLD, ...over,
  });
  const earlier = new Date(OLD.getTime() - 60_000);
  const yesOnly = await setup(world({ trades: [trade({ createdAt: earlier })], pubs: [pub()] }));
  await yesOnly.run(['TRACE_WITHOUT_TRADE']);
  assert.equal(yesOnly.lastRun()[0].severity, 'MEDIUM');
  assert.equal(yesOnly.lastRun()[0].evidence.expectedDirection, 'NO');
  assert.deepEqual(yesOnly.lastRun()[0].evidence.otherSideTrades, ['t1']);

  const matched = await setup(world({ trades: [trade({ direction: 'NO', createdAt: earlier })], pubs: [pub()] }));
  await matched.run(['TRACE_WITHOUT_TRADE']);
  assert.equal(matched.lastRun().length, 0);

  const after = await setup(world({ trades: [trade({ direction: 'NO', createdAt: NOW })], pubs: [pub()] }));
  await after.run(['TRACE_WITHOUT_TRADE']);
  assert.equal(after.lastRun().length, 1, 'a trade created after the trace does not count');

  const yes = await setup(world({ trades: [trade({ createdAt: earlier })], pubs: [pub({ action: 'buy_yes' })] }));
  await yes.run(['TRACE_WITHOUT_TRADE']);
  assert.equal(yes.lastRun().length, 0);
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('dryRun writes no repairs even with auto-repair on', async () => {
  const { registerHandler } = await import('../src/services/stellar/outbox');
  const calls: string[] = [];
  registerHandler('trace.publish', async (row) => { calls.push(row.id); });
  const w = world({
    trades: [trade()],
    outbox: [outboxRow(), outboxRow({ id: 'o9', kind: 'trace.publish', refId: 'trace-1', handledAt: null })],
  });
  const { run, lastRun, db } = await setup(w);
  const summary = await run(['EXECUTED_TRADE_WITHOUT_POSITION', 'OUTBOX_TERMINAL_UNHANDLED'], { autoRepair: true, dryRun: true });
  assert.equal(summary.repaired, 0);
  assert.deepEqual(lastRun().map((f: any) => f.action), ['REPORTED', 'REPORTED']);
  assert.equal(w.positions.length, 0);
  assert.equal(db.applyCalls, 0);
  assert.deepEqual(calls, []);
  assert.equal(w.outbox[1].handledAt, null);

  // Without MONEY_AUDIT_AUTO_REPAIR nothing is repaired either.
  await run(['EXECUTED_TRADE_WITHOUT_POSITION', 'OUTBOX_TERMINAL_UNHANDLED'], { autoRepair: false });
  assert.equal(w.positions.length, 0);
  assert.deepEqual(calls, []);
});

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function withServer(fn: (base: string) => Promise<void>) {
  const { default: app } = await import('../src/app');
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

const ROUTES: Array<[string, string]> = [
  ['GET', '/admin/money-audit/runs'],
  ['GET', '/admin/money-audit/runs/abc/findings'],
  ['POST', '/admin/money-audit/run'],
  ['POST', '/admin/money-audit/findings/abc/ack'],
];

test('HTTP: money-audit routes return 403 without reconciliation.run', async () => {
  const { signToken } = await import('../src/middlewares/auth.middleware');
  const { prisma } = await import('../src/lib/prisma');
  const auditorLike = Keypair.random().publicKey();
  (prisma.adminRoleAssignment.findUnique as any) = async ({ where }: any) =>
    where.walletAddress === auditorLike
      ? { roleName: 'custom', role: { permissions: [{ permissionKey: 'admin.read' }, { permissionKey: 'treasury.read' }] } }
      : null;
  await withServer(async (base) => {
    for (const token of [signToken('u1', Keypair.random().publicKey()), signToken('u2', auditorLike)]) {
      for (const [method, path] of ROUTES) {
        const anon = await fetch(`${base}/api/v1${path}`, { method });
        assert.equal(anon.status, 401, `${method} ${path}`);
        const res = await fetch(`${base}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
        assert.equal(res.status, 403, `${method} ${path}`);
        assert.equal((await res.json()).error.code, 'FORBIDDEN');
      }
    }
  });
});

test('HTTP: ack requires step-up; the routes exist only once and all are guarded', async () => {
  const { signToken } = await import('../src/middlewares/auth.middleware');
  const { prisma } = await import('../src/lib/prisma');
  (prisma.moneyAuditFinding.findUnique as any) = async () => null;
  await withServer(async (base) => {
    const stale = signToken('admin', ADMIN, { authTime: Math.floor(Date.now() / 1000) - 3600 });
    const res = await fetch(`${base}/api/v1/admin/money-audit/findings/abc/ack`, { method: 'POST', headers: { authorization: `Bearer ${stale}` } });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 'STEP_UP_REQUIRED');
    const fresh = signToken('admin', ADMIN);
    const ok = await fetch(`${base}/api/v1/admin/money-audit/findings/abc/ack`, { method: 'POST', headers: { authorization: `Bearer ${fresh}` } });
    assert.equal(ok.status, 404, 'a fresh admin token reaches the handler');

    const bad = await fetch(`${base}/api/v1/admin/money-audit/run`, {
      method: 'POST', headers: { authorization: `Bearer ${fresh}`, 'content-type': 'application/json' }, body: '{"dryRun":"yes"}',
    });
    assert.equal(bad.status, 400);
  });

  const { default: router } = await import('../src/routes/admin.routes');
  const layers = (router as any).stack.filter((l: any) => l.route && String(l.route.path).startsWith('/money-audit'));
  assert.equal(layers.length, 4, 'no unguarded duplicate routes');
  for (const l of layers) assert.ok(l.route.stack.length >= 2, `${l.route.path} has a permission guard`);
});
