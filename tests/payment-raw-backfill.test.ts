import test from 'node:test';
import assert from 'node:assert/strict';
import { Address, Keypair, rpc, xdr } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';
import { transferEventData } from './helpers/sac-meta';

setupTestEnv();

type Backfill = typeof import('../scripts/backfill-payment-raw');

async function load() {
  const backfill: Backfill = await import('../scripts/backfill-payment-raw');
  const { CONTRACTS, PAYMENTS_RECIPIENT } = await import('../src/config/contracts');
  return { backfill, CONTRACTS, PAYMENTS_RECIPIENT };
}

/**
 * A SAC `transfer` event as the RPC `events.contractEventsXdr` field carries
 * it, in the event-object shape sac-events.ts decodes.
 */
function transferEvent(t: { contract: string; from: string; to: string; amount: bigint }) {
  return {
    type: () => ({ name: 'contract' }),
    contractId: () => new Address(t.contract).toScAddress(),
    topics: [xdr.ScVal.scvSymbol('transfer'), new Address(t.from).toScVal(), new Address(t.to).toScVal()],
    data: transferEventData(t.amount),
  };
}

const hash = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const OLDEST_LEDGER = 1_000;

interface FakeEvent { id: string; txHash: string; amount: number; amountRaw: string | null; fromAddress: string | null; ledger: number | null }
interface FakeSub { id: string; txHash: string | null; amountPaid: number; amountPaidRaw: string | null }
interface FakeAllowance { id: string; createdAt: Date; dailyLimit: number; perTraceLimit: number; dailyLimitRaw: string; perTraceLimitRaw: string }

/**
 * In-memory database plus a fixture RPC reader serving SAC transfer meta for
 * the hashes in `chain`; any other hash is NOT_FOUND (outside retention).
 */
function fakeWorld(
  backfill: Backfill,
  opts: {
    events: FakeEvent[];
    subs?: FakeSub[];
    allowances?: FakeAllowance[];
    chain: Map<string, { from: string; to: string; amount: bigint; contract: string }[]>;
  },
) {
  const events = new Map(opts.events.map((e) => [e.id, { ...e }]));
  const subs = new Map((opts.subs ?? []).map((s) => [s.id, { ...s }]));
  const records = new Map<string, import('../scripts/backfill-payment-raw').BackfillRecord>();
  const calls = { getTransaction: 0, writes: 0, saves: 0 };
  const page = <T extends { id: string }>(rows: T[], afterId: string | null, limit: number) =>
    rows.filter((r) => afterId === null || r.id > afterId).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);

  const reader = {
    async getTransaction(txHash: string) {
      calls.getTransaction++;
      const transfers = opts.chain.get(txHash);
      if (!transfers) return { status: rpc.Api.GetTransactionStatus.NOT_FOUND, txHash } as any;
      return {
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        txHash,
        ledger: OLDEST_LEDGER + 10,
        events: { contractEventsXdr: [transfers.map((t) => transferEvent(t))] },
      } as any;
    },
  };

  const deps: import('../scripts/backfill-payment-raw').BackfillDeps = {
    async paymentEventsMissingRaw(afterId, limit) {
      return page([...events.values()].filter((e) => e.amountRaw === null), afterId, limit);
    },
    async subscriptionsMissingRaw(afterId, limit) {
      return page([...subs.values()].filter((s) => s.amountPaidRaw === null), afterId, limit).map((s) => {
        const event = s.txHash ? [...events.values()].find((e) => e.txHash === s.txHash) : undefined;
        return { id: s.id, txHash: s.txHash, amountPaid: s.amountPaid, eventId: event?.id ?? null, eventAmountRaw: event?.amountRaw ?? null };
      });
    },
    async legacyAllowances(afterId, limit, before) {
      return page((opts.allowances ?? []).filter((a) => a.createdAt < before), afterId, limit);
    },
    async findRecord(table, rowId) {
      const rec = records.get(`${table}/${rowId}`);
      return rec ? { ...rec } : null;
    },
    async saveRecord(rec) {
      calls.saves++;
      records.set(`${rec.table}/${rec.rowId}`, { ...rec });
    },
    async writePaymentEventRaw(id, raw) {
      const e = events.get(id)!;
      if (e.amountRaw !== null) return false;
      calls.writes++;
      e.amountRaw = raw.toString();
      return true;
    },
    async writeSubscriptionRaw(id, raw) {
      const s = subs.get(id)!;
      if (s.amountPaidRaw !== null) return false;
      calls.writes++;
      s.amountPaidRaw = raw.toString();
      return true;
    },
    lookupTransfer: backfill.chainTransferLookup(reader),
    async oldestLedger() { return OLDEST_LEDGER; },
  };
  return { deps, events, subs, records, calls };
}

test('payment raw backfill: VERIFIED, MISMATCH, FLOAT_ONLY and NOT_FOUND per row', async () => {
  const { backfill, CONTRACTS, PAYMENTS_RECIPIENT } = await load();
  const user = Keypair.random().publicKey();
  const other = Keypair.random().publicKey();
  const t = (amount: bigint, from = user) => ({ contract: CONTRACTS.usdc, from, to: PAYMENTS_RECIPIENT, amount });
  const world = fakeWorld(backfill, {
    events: [
      // 0.1 + 0.2 is not exact as a float; the candidate is only compared, and the chain agrees.
      { id: 'e1', txHash: hash(1), amount: 0.1 + 0.2, amountRaw: null, fromAddress: user, ledger: OLDEST_LEDGER + 5 },
      // The chain moved 0.5 but the float says 0.4.
      { id: 'e2', txHash: hash(2), amount: 0.4, amountRaw: null, fromAddress: user, ledger: OLDEST_LEDGER + 6 },
      // Outside RPC retention (and a legacy row without a ledger).
      { id: 'e3', txHash: hash(3), amount: 0.5, amountRaw: null, fromAddress: user, ledger: OLDEST_LEDGER - 1 },
      { id: 'e4', txHash: hash(4), amount: 0.5, amountRaw: null, fromAddress: null, ledger: null },
      // Inside retention but the transaction is gone: suspicious, not trusted.
      { id: 'e5', txHash: hash(5), amount: 0.5, amountRaw: null, fromAddress: user, ledger: OLDEST_LEDGER + 7 },
      // On chain, but the transfer came from someone else.
      { id: 'e6', txHash: hash(6), amount: 0.5, amountRaw: null, fromAddress: user, ledger: OLDEST_LEDGER + 8 },
      // Already exact: never touched.
      { id: 'e7', txHash: hash(7), amount: 0.5, amountRaw: '5000000', fromAddress: user, ledger: OLDEST_LEDGER + 9 },
    ],
    chain: new Map([
      [hash(1), [t(3_000_000n)]],
      [hash(2), [t(5_000_000n)]],
      [hash(6), [t(5_000_000n, other)]],
    ]),
  });

  // Dry-run (the default) reports but writes nothing, not even outcomes.
  const dry = await backfill.runPaymentRawBackfill(world.deps, { apply: false, batchSize: 2 });
  assert.deepEqual(dry.paymentEvents, { VERIFIED: 1, FLOAT_ONLY: 2, MISMATCH: 1, NOT_FOUND: 2 });
  assert.equal(dry.exitCode, 1, 'a MISMATCH fails the run');
  assert.equal(world.calls.writes, 0);
  assert.equal(world.calls.saves, 0);

  const applied = await backfill.runPaymentRawBackfill(world.deps, { apply: true, batchSize: 2 });
  assert.equal(applied.exitCode, 1);
  assert.deepEqual(applied.mismatches, [
    { table: 'payment_events', rowId: 'e2', floatValue: 0.4, rawValue: '5000000', chainValue: '5000000' },
  ]);
  assert.deepEqual(applied.notFound.map((n) => n.rowId), ['e5', 'e6']);
  assert.equal(world.events.get('e1')!.amountRaw, '3000000');
  assert.equal(world.events.get('e2')!.amountRaw, null, 'a mismatch is left for an operator');
  assert.equal(world.events.get('e3')!.amountRaw, '5000000');
  assert.equal(world.events.get('e4')!.amountRaw, '5000000');
  assert.equal(world.events.get('e5')!.amountRaw, null);
  assert.equal(world.events.get('e6')!.amountRaw, null);
  assert.equal(world.events.get('e7')!.amountRaw, '5000000');
  assert.equal(applied.applied.paymentEvents, 3);

  const rec = (id: string) => world.records.get(`payment_events/${id}`)!;
  assert.deepEqual(
    { status: rec('e1').status, source: rec('e1').source, chain: rec('e1').chainValue, applied: rec('e1').applied },
    { status: 'VERIFIED', source: 'CHAIN', chain: 3_000_000n, applied: true },
  );
  assert.equal(rec('e3').status, 'FLOAT_ONLY');
  assert.equal(rec('e3').source, 'FLOAT');
  assert.match(rec('e3').detail!, /outside RPC retention/);
  assert.equal(rec('e5').status, 'NOT_FOUND');
  assert.equal(rec('e5').applied, false);
  assert.equal(world.records.has('payment_events/e7'), false);
});

test('payment raw backfill: rerun is idempotent and resumes from recorded outcomes', async () => {
  const { backfill, CONTRACTS, PAYMENTS_RECIPIENT } = await load();
  const user = Keypair.random().publicKey();
  const t = (amount: bigint) => ({ contract: CONTRACTS.usdc, from: user, to: PAYMENTS_RECIPIENT, amount });
  const world = fakeWorld(backfill, {
    events: [
      { id: 'a', txHash: hash(11), amount: 0.5, amountRaw: null, fromAddress: user, ledger: OLDEST_LEDGER + 1 },
      { id: 'b', txHash: hash(12), amount: 0.4, amountRaw: null, fromAddress: user, ledger: OLDEST_LEDGER + 2 },
      { id: 'c', txHash: hash(13), amount: 0.5, amountRaw: null, fromAddress: user, ledger: null },
    ],
    chain: new Map([[hash(11), [t(5_000_000n)]], [hash(12), [t(5_000_000n)]]]),
  });

  const first = await backfill.runPaymentRawBackfill(world.deps, { apply: true, batchSize: 1 });
  assert.equal(first.applied.paymentEvents, 2);
  const writes = world.calls.writes;
  const rpcCalls = world.calls.getTransaction;
  const snapshot = JSON.stringify([...world.events.values()]);

  const second = await backfill.runPaymentRawBackfill(world.deps, { apply: true, batchSize: 1 });
  assert.equal(world.calls.writes, writes, 'nothing is written twice');
  assert.equal(JSON.stringify([...world.events.values()]), snapshot);
  assert.equal(world.calls.getTransaction, rpcCalls, 'a recorded MISMATCH is reused, not re-queried');
  assert.deepEqual(second.paymentEvents, { VERIFIED: 0, FLOAT_ONLY: 0, MISMATCH: 1, NOT_FOUND: 0 });
  assert.equal(second.exitCode, 1, 'an unresolved mismatch keeps failing');

  // --recheck queries the chain again; once an operator fixes the row it is gone.
  await backfill.runPaymentRawBackfill(world.deps, { apply: true, recheck: true });
  assert.equal(world.calls.getTransaction, rpcCalls + 1);
  world.events.get('b')!.amountRaw = '5000000';
  const clean = await backfill.runPaymentRawBackfill(world.deps, { apply: true });
  assert.equal(clean.exitCode, 0);
  assert.deepEqual(clean.paymentEvents, { VERIFIED: 0, FLOAT_ONLY: 0, MISMATCH: 0, NOT_FOUND: 0 });
});

test('payment raw backfill: subscriptions copy the exact event amount, then the event backfill', async () => {
  const { backfill, CONTRACTS, PAYMENTS_RECIPIENT } = await load();
  const user = Keypair.random().publicKey();
  const world = fakeWorld(backfill, {
    events: [
      { id: 'e1', txHash: hash(21), amount: 0.5, amountRaw: '5000000', fromAddress: user, ledger: 5 },
      { id: 'e2', txHash: hash(22), amount: 0.5, amountRaw: null, fromAddress: user, ledger: OLDEST_LEDGER + 1 },
      { id: 'e3', txHash: hash(23), amount: 0.5, amountRaw: null, fromAddress: user, ledger: null },
      { id: 'e4', txHash: hash(24), amount: 0.4, amountRaw: null, fromAddress: user, ledger: OLDEST_LEDGER + 2 },
    ],
    subs: [
      { id: 's1', txHash: hash(21), amountPaid: 0.5, amountPaidRaw: null },
      { id: 's2', txHash: hash(22), amountPaid: 0.5, amountPaidRaw: null },
      { id: 's3', txHash: hash(23), amountPaid: 0.5, amountPaidRaw: null },
      { id: 's4', txHash: hash(24), amountPaid: 0.4, amountPaidRaw: null },
      { id: 's5', txHash: null, amountPaid: 0.25, amountPaidRaw: null },
      { id: 's6', txHash: hash(21), amountPaid: 0.5, amountPaidRaw: '5000000' },
    ],
    chain: new Map([
      [hash(22), [{ contract: CONTRACTS.usdc, from: user, to: PAYMENTS_RECIPIENT, amount: 5_000_000n }]],
      [hash(24), [{ contract: CONTRACTS.usdc, from: user, to: PAYMENTS_RECIPIENT, amount: 5_000_000n }]],
    ]),
  });

  // Dry-run: s2/s3 can only be resolved from this run's in-memory event results.
  const dry = await backfill.runPaymentRawBackfill(world.deps, { apply: false });
  assert.deepEqual(dry.subscriptions, { VERIFIED: 2, FLOAT_ONLY: 2, MISMATCH: 1, NOT_FOUND: 0 });

  const summary = await backfill.runPaymentRawBackfill(world.deps, { apply: true });
  assert.equal(world.subs.get('s1')!.amountPaidRaw, '5000000');
  assert.equal(world.subs.get('s2')!.amountPaidRaw, '5000000');
  assert.equal(world.subs.get('s3')!.amountPaidRaw, '5000000');
  assert.equal(world.subs.get('s4')!.amountPaidRaw, null, 'its event is a MISMATCH');
  assert.equal(world.subs.get('s5')!.amountPaidRaw, '2500000');
  assert.deepEqual(summary.subscriptionsWithoutTxHash, ['s5']);
  const rec = (id: string) => world.records.get(`subscriptions/${id}`)!;
  assert.equal(rec('s1').source, 'PAYMENT_EVENT');
  assert.equal(rec('s1').status, 'VERIFIED');
  assert.equal(rec('s2').source, 'BACKFILL');
  assert.equal(rec('s2').status, 'VERIFIED');
  assert.equal(rec('s3').status, 'FLOAT_ONLY');
  assert.equal(rec('s4').status, 'MISMATCH');
  assert.equal(rec('s5').status, 'FLOAT_ONLY');
  assert.match(rec('s5').detail!, /without txHash/);
  assert.equal(world.records.has('subscriptions/s6'), false);

  // Once an operator resolves the event's MISMATCH, its subscription follows.
  world.events.get('e4')!.amountRaw = '4000000';
  const resolved = await backfill.runPaymentRawBackfill(world.deps, { apply: true });
  assert.equal(resolved.exitCode, 0);
  assert.equal(world.subs.get('s4')!.amountPaidRaw, '4000000');
  assert.equal(rec('s4').source, 'PAYMENT_EVENT');
});

test('payment raw backfill: allowance float/raw divergences are reported, never written', async () => {
  const { backfill } = await load();
  const before = new Date('2026-10-01T00:00:00Z');
  const world = fakeWorld(backfill, {
    events: [],
    allowances: [
      { id: 'a1', createdAt: before, dailyLimit: 5, perTraceLimit: 0.5, dailyLimitRaw: '50000000', perTraceLimitRaw: '5000000' },
      { id: 'a2', createdAt: before, dailyLimit: 5, perTraceLimit: 0.5, dailyLimitRaw: '50000001', perTraceLimitRaw: '5000000' },
      // Created after #55: raw was always authoritative, not compared.
      { id: 'a3', createdAt: new Date('2026-11-01T00:00:00Z'), dailyLimit: 0, perTraceLimit: 0, dailyLimitRaw: '1', perTraceLimitRaw: '1' },
    ],
    chain: new Map(),
  });
  const summary = await backfill.runPaymentRawBackfill(world.deps, { apply: true });
  assert.deepEqual(summary.allowanceDivergences, [
    { id: 'a2', field: 'dailyLimit', floatValue: 5, floatRaw: '50000000', raw: '50000001' },
  ]);
  assert.equal(summary.exitCode, 0, 'divergences are reported only; raw wins');
  assert.equal(world.calls.writes, 0);
  assert.match(backfill.formatSummary(summary), /allowance a2\.dailyLimit/);
});
