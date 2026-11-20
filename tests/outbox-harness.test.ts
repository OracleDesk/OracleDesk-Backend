/**
 * Unit tier for the outbox crash harness (#229): freshModules() is a real
 * restart of module state, and the chain.service crash seam only works under
 * NODE_ENV=test. No database or Redis: stores and Prisma are stubbed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

type Harness = typeof import('./helpers/outbox-harness');
type Row = import('../src/services/stellar/outbox').ChainTransactionRow;
type Store = import('../src/services/stellar/outbox').OutboxStore;
type ModuleContext = import('./helpers/outbox-harness').ModuleContext;
type CrashPoint = import('../src/services/chain.service').CrashPoint;

const harness = (): Promise<Harness> => import('./helpers/outbox-harness');

const row = (kind: string): Row => ({ id: 'ob1', kind, refId: null, handledAt: null }) as unknown as Row;
const noopStore = { markHandled: async () => undefined } as unknown as Store;

test('freshModules() is a restart: the handler map is reset and the domain handlers re-register', async () => {
  const h = await harness();
  const a = h.loadContext();
  let runs = 0;
  a.outbox.registerHandler('probe.kind', async () => void runs++);
  await a.outbox.runCompletionHandler(row('probe.kind'), { status: 'SUCCESS' }, noopStore);
  assert.equal(runs, 1);

  const b = await h.freshModules(a, { redis: false });
  assert.notEqual(b.outbox, a.outbox, 'a new copy of the outbox module');
  assert.notEqual(b.prisma, a.prisma, 'a new Prisma client');
  assert.notEqual(b.chain, a.chain);

  await b.outbox.runCompletionHandler(row('probe.kind'), { status: 'SUCCESS' }, noopStore);
  assert.equal(runs, 1, 'the new process does not know the old process handler');

  // The four domain kinds registered again when their modules loaded (refId
  // null: each handler returns before touching the database).
  for (const kind of ['market.create', 'trade.buy', 'trade.sell', 'trace.publish']) {
    await b.outbox.runCompletionHandler(row(kind), { status: 'FAILED' }, noopStore);
  }
  b.outbox.clearHandlersForTest();
  await assert.rejects(
    b.outbox.runCompletionHandler(row('trade.buy'), { status: 'FAILED' }, noopStore),
    /no completion handler registered for trade.buy/,
  );

  // The old context's map is its own.
  await a.outbox.runCompletionHandler(row('probe.kind'), { status: 'SUCCESS' }, noopStore);
  assert.equal(runs, 2);
  await h.abandonContext(b);
});

test('setCrashHookForTest throws outside NODE_ENV=test', async () => {
  const h = await harness();
  const c = h.loadContext();
  const cfg = c.config as Record<string, unknown>;
  for (const env of ['production', 'development']) {
    cfg.NODE_ENV = env;
    assert.throws(() => c.chain.setCrashHookForTest(async () => undefined), /test only/);
  }
  cfg.NODE_ENV = 'test';
  assert.doesNotThrow(() => c.chain.setCrashHookForTest(null));
});

/** A live agent-account write with every dependency stubbed in context `c`. */
function stubLiveWrite(h: Harness, c: ModuleContext) {
  const agent = Keypair.random();
  const cfg = c.config as Record<string, unknown>;
  Object.assign(cfg, { CHAIN_EXECUTION_MODE: 'live', AGENT_SECRET_KEY: agent.secret(), CHAIN_RETRY_MAX_ATTEMPTS: 1 });

  const rows = new Map<string, Record<string, unknown>>();
  let n = 0;
  (c.prisma as unknown as Record<string, unknown>).chainTransaction = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const r = { id: `ob${++n}`, status: 'BUILT', handledAt: null, feeBumpHashes: [], ...data };
      rows.set(r.id, r);
      return { ...r };
    },
    updateMany: async ({ where, data }: { where: { id: string; status?: { in: string[] } }; data: object }) => {
      const r = rows.get(where.id);
      if (!r || (where.status && !where.status.in.includes(r.status as string))) return { count: 0 };
      Object.assign(r, data);
      return { count: 1 };
    },
    findUnique: async ({ where }: { where: { id: string } }) => ({ ...rows.get(where.id) }),
  };
  (c.prisma as unknown as Record<string, unknown>).chainSubmission = { upsert: async () => ({}) };
  (c.prisma as unknown as Record<string, unknown>).chainFee = { upsert: async () => ({}) };

  const controls = h.requireSrc<Record<string, unknown>>('services/agent-controls.service');
  controls.assertAgentActive = async () => 1;
  controls.assertAgentActiveLocked = async () => 1;
  controls.recordChainWriteOutcome = async () => undefined;
  const sequence = c.sequence as unknown as Record<string, unknown>;
  sequence.withSourceAccount = async (_account: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ account: null, assertHeld: () => undefined, advanceSequence: async () => undefined, resync: async () => undefined });
  sequence.rebuildWithSequence = (built: unknown) => built;
  (h.requireSrc<Record<string, unknown>>('services/stellar/channels')).getChannelPool = () => ({ size: 0 });
  c.chain.setChainCache(c.chain.memoryChainCache());

  const chain = h.fakeChain({ ledger: 100, closeTime: Math.floor(Date.now() / 1000) });
  chain.onSend((tx) => {
    chain.land(h.hashOf(tx), { status: 'SUCCESS', ledger: 101 });
    return 'PENDING';
  });
  c.txInspect.setTransactionSender(chain.sender);
  c.txInspect.setTransactionReader(chain.reader);
  h.installBindings(c, agent, chain, () => ({ agent_buy: 5n }));

  return () =>
    c.chain.agentBuy(
      { market_id: 1n, outcome: c.chain.Outcomes.Yes, collateral_in: 10n, min_shares_out: 1n },
      undefined,
      {},
      { kind: 'test.kind', refId: 'r1' },
    );
}

test('the crash hook sees every point in order under NODE_ENV=test and is inert otherwise', async () => {
  const h = await harness();
  const c = await h.freshModules(null, { redis: false });
  const write = stubLiveWrite(h, c);

  const seen: CrashPoint[] = [];
  c.chain.setCrashHookForTest(async (p) => void seen.push(p));
  const live = await write();
  assert.equal(live.mode, 'live');
  assert.deepEqual(seen, ['after-built', 'after-signed', 'after-send-accepted', 'after-advance']);

  // Set while in test mode, then the process is not a test any more: never consulted.
  (c.config as Record<string, unknown>).NODE_ENV = 'development';
  seen.length = 0;
  const again = await write();
  assert.equal(again.mode, 'live');
  assert.deepEqual(seen, []);
  (c.config as Record<string, unknown>).NODE_ENV = 'test';
  c.chain.setCrashHookForTest(null);
  await h.abandonContext(c);
});
