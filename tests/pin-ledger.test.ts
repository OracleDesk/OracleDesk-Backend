import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

function memoryContentStore() {
  const map = new Map<string, { sha256: string; bytes: Buffer; origin: string }>();
  return {
    map,
    async put(entry: any) {
      map.set(entry.cid, { sha256: entry.sha256, bytes: Buffer.from(entry.bytes), origin: entry.origin });
    },
    async get(cid: string) {
      return map.get(cid) ?? null;
    },
    async touch() {},
    async evict() {
      return { removed: 0, freedBytes: 0 };
    },
  };
}

/** Records every provider call; pins return the locally computed CID. */
function spyTransport(overrides: Record<string, unknown> = {}) {
  const calls = { pin: [] as string[], unpin: [] as string[] };
  return {
    calls,
    async pin(bytes: Buffer, name: string) {
      const { cidForBytes } = await import('../src/services/ipfs.service');
      calls.pin.push(name);
      return cidForBytes(bytes);
    },
    async fetch() {
      throw new Error('not used');
    },
    async unpin(cid: string) {
      calls.unpin.push(cid);
    },
    ...overrides,
  };
}

async function freshEnv() {
  const ipfs = await import('../src/services/ipfs.service');
  const ledgerMod = await import('../src/services/pin-ledger.service');
  const store = await import('../src/services/content-store.service');
  const ledger = ledgerMod.createMemoryPinLedger();
  ledgerMod.setPinLedger(ledger);
  const content = memoryContentStore();
  store.setContentStore(content as any);
  const transport = spyTransport();
  ipfs.setIpfsTransport(transport as any);
  return { ipfs, ledgerMod, ledger, content, transport };
}

const HOUR = 3_600_000;
const NOW = new Date('2026-11-20T12:00:00Z');

test('cidForBytes matches the well-known CIDv1(raw, sha2-256) of empty input', async () => {
  const { cidForBytes } = await import('../src/services/ipfs.service');
  assert.equal(cidForBytes(Buffer.alloc(0)), 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku');
});

test('pinJson records a pin and a CANDIDATE reference', async () => {
  const { ipfs, ledger } = await freshEnv();
  const pinned = await ipfs.pinJson({ q: 1 }, 'doc', { owner: { kind: 'MARKET_QUESTION', id: 'm1' } });
  const pin = await ledger.get(pinned.cid);
  assert.equal(pin?.status, 'PINNED');
  assert.equal(pin?.sha256, pinned.hash);
  assert.deepEqual(await ledger.refsFor(pinned.cid), [
    { cid: pinned.cid, ownerKind: 'MARKET_QUESTION', ownerId: 'm1', state: 'CANDIDATE', anchor: null },
  ]);
});

test('pinning identical bytes twice calls the provider once and adds a second reference', async () => {
  const { ipfs, ledger, transport } = await freshEnv();
  const a = await ipfs.pinJson({ same: true }, 'doc-a', { owner: { kind: 'MARKET_QUESTION', id: 'm1' } });
  const b = await ipfs.pinJson({ same: true }, 'doc-b', { owner: { kind: 'MARKET_QUESTION', id: 'm2' } });
  assert.equal(a.cid, b.cid);
  assert.equal(transport.calls.pin.length, 1);
  assert.equal((await ledger.refsFor(a.cid)).length, 2);
});

test('a failed provider pin marks the ledger entry FAILED and a retry pins again', async () => {
  const { ipfs, ledger, ledgerMod } = await freshEnv();
  let fail = true;
  ipfs.setIpfsTransport({
    async pin(bytes: Buffer) {
      if (fail) throw new (await import('../src/middlewares/error.middleware')).AppError(503, 'IPFS_NOT_CONFIGURED', 'off');
      return ipfs.cidForBytes(bytes);
    },
    async fetch() {
      throw new Error('x');
    },
  } as any);
  const owner = { kind: 'TRACE' as const, id: 't1' };
  await assert.rejects(() => ipfs.pinJson({ k: 1 }, 'doc', { owner }));
  const cid = ipfs.prepareDocument({ k: 1 }, 'doc').cid;
  assert.equal((await ledger.get(cid))?.status, 'FAILED');
  fail = false;
  await ipfs.pinJson({ k: 1 }, 'doc', { owner });
  assert.equal((await ledger.get(cid))?.status, 'PINNED');
  void ledgerMod;
});

test('pinJson without an owner leaves the ledger untouched', async () => {
  const { ipfs, ledger } = await freshEnv();
  await ipfs.pinJson({ anon: 1 }, 'doc');
  assert.equal(ledger.pins.size, 0);
});

test('dry-run createMarketOnChain never calls transport.pin and uses cidForBytes', async () => {
  const { ipfs, transport } = await freshEnv();
  const idem = await import('../src/services/market-idempotency.service');
  const chain = await import('../src/services/chain.service');
  const marketChain = await import('../src/services/market-chain.service');
  (idem as any).claimCreation = async () => ({ acquired: true, attempt: null });
  (idem as any).discoverLandedMarket = async () => null;
  (idem as any).releaseClaim = async () => undefined;
  let metaUri = '';
  (chain as any).agentCreateMarket = async (args: any) => {
    metaUri = args.meta_uri;
    return { mode: 'dry-run', method: 'agent_create_market', value: 1n, txHash: null };
  };

  const market: any = {
    id: 'mkt-1',
    question: 'Will the Fed cut rates?',
    category: 'FED',
    expiryTimestamp: new Date('2027-01-01T00:00:00Z'),
    resolutionOracle: null,
    resolutionDetails: null,
    questionHash: null,
    minimumLiquidity: 10,
    initialYesProb: 0.5,
  };
  await marketChain.createMarketOnChain(market);

  assert.equal(transport.calls.pin.length, 0, 'no remote pin in dry-run');
  const doc = marketChain.questionDocument(
    market,
    (await import('../src/lib/resolution-spec')).resolutionHash(marketChain.defaultResolutionSpec()).toString('hex'),
    marketChain.defaultResolutionSpec(),
  );
  assert.equal(metaUri, `ipfs://${ipfs.prepareDocument(doc, 'x').cid}`);
});

test('linkLandedMarket anchors the question reference', async () => {
  const { ipfs, ledger } = await freshEnv();
  const { prisma } = await import('../src/lib/prisma');
  const { linkLandedMarket } = await import('../src/services/market-idempotency.service');
  const pinned = await ipfs.pinJson({ q: 'x' }, 'doc', { owner: { kind: 'MARKET_QUESTION', id: 'm9' } });
  (prisma as any).$transaction = async (fn: any) =>
    fn({ market: { update: async () => ({}) }, marketCreationAttempt: { upsert: async () => ({}) } });

  assert.equal(await linkLandedMarket('m9', 42n, '0xabc'), true);
  const [ref] = await ledger.refsFor(pinned.cid);
  assert.equal(ref.state, 'ANCHORED');
  assert.equal(ref.anchor, 'market:42');
});

test('trace confirmation anchors the trace reference', async () => {
  const { ipfs, ledger } = await freshEnv();
  const { prisma } = await import('../src/lib/prisma');
  const { handleTracePublishOutcome } = await import('../src/services/trace-publish.service');
  const pinned = await ipfs.pinJson({ t: 1 }, 'oracledesk-trace-t7', { owner: { kind: 'TRACE', id: 't7' } });
  (prisma as any).reasoningTrace.updateMany = async () => ({ count: 1 });
  (prisma as any).tracePublication.updateMany = async () => ({ count: 1 });

  await handleTracePublishOutcome({ refId: 't7', hash: 'h' } as any, { status: 'SUCCESS', value: 17n, txHash: 'tx' } as any);
  const [ref] = await ledger.refsFor(pinned.cid);
  assert.deepEqual([ref.state, ref.anchor], ['ANCHORED', 'trace:17']);
});

test('GC unpins a pin whose references are all released past the grace period', async () => {
  const { ipfs, ledger, transport } = await freshEnv();
  const { runPinGc } = await import('../src/jobs/pin-gc.job');
  const pinned = await ipfs.pinJson({ doomed: 1 }, 'doc', { owner: { kind: 'MARKET_QUESTION', id: 'gone' } });

  const result = await runPinGc({
    ledger, transport: transport as any, now: NOW, graceMs: 72 * HOUR,
    resolveOwner: async () => ({ verdict: 'RELEASE' }), pause: async () => undefined,
  });
  assert.deepEqual([result.released, result.unpinned], [1, 1]);
  assert.deepEqual(transport.calls.unpin, [pinned.cid]);
  assert.equal((await ledger.get(pinned.cid))?.status, 'UNPINNED');
});

test('GC never unpins an anchored pin, even with other released references', async () => {
  const { ipfs, ledger, transport } = await freshEnv();
  const { runPinGc } = await import('../src/jobs/pin-gc.job');
  const doc = { shared: 1 };
  const a = await ipfs.pinJson(doc, 'a', { owner: { kind: 'MARKET_QUESTION', id: 'abandoned' } });
  await ipfs.pinJson(doc, 'b', { owner: { kind: 'MARKET_QUESTION', id: 'live' } });

  const result = await runPinGc({
    ledger, transport: transport as any, now: NOW, graceMs: 72 * HOUR, pause: async () => undefined,
    resolveOwner: async (ref) =>
      ref.ownerId === 'live' ? { verdict: 'ANCHORED', anchor: 'market:7' } : { verdict: 'RELEASE' },
  });
  assert.deepEqual([result.anchored, result.released, result.unpinned], [1, 1, 0]);
  assert.equal(transport.calls.unpin.length, 0);
  assert.equal((await ledger.get(a.cid))?.status, 'PINNED');
});

test('GC keeps pins whose owner is ambiguous', async () => {
  const { ipfs, ledger, transport } = await freshEnv();
  const { runPinGc } = await import('../src/jobs/pin-gc.job');
  const pinned = await ipfs.pinJson({ maybe: 1 }, 'doc', { owner: { kind: 'TRACE', id: 'pending' } });
  const result = await runPinGc({
    ledger, transport: transport as any, now: NOW, graceMs: 72 * HOUR, pause: async () => undefined,
    resolveOwner: async () => ({ verdict: 'KEEP' }),
  });
  assert.equal(result.unpinned, 0);
  assert.equal((await ledger.refsFor(pinned.cid))[0].state, 'CANDIDATE');
});

test('GC collects an unreferenced pin only after the grace period', async () => {
  const { ledger, transport } = await freshEnv();
  const { runPinGc } = await import('../src/jobs/pin-gc.job');
  await ledger.importPin({ cid: 'bafy-old', sha256: 'a'.repeat(64), size: 10, provider: 'pinata', pinnedAt: new Date(NOW.getTime() - 100 * HOUR) });
  await ledger.importPin({ cid: 'bafy-new', sha256: 'b'.repeat(64), size: 10, provider: 'pinata', pinnedAt: new Date(NOW.getTime() - 1 * HOUR) });
  await runPinGc({
    ledger, transport: transport as any, now: NOW, graceMs: 72 * HOUR, pause: async () => undefined,
    resolveOwner: async () => ({ verdict: 'KEEP' }),
  });
  assert.deepEqual(transport.calls.unpin, ['bafy-old']);
});

test('a pin arriving during UNPIN_PENDING triggers a re-pin', async () => {
  const { ipfs, ledger, content, transport } = await freshEnv();
  const { runPinGc } = await import('../src/jobs/pin-gc.job');
  const doc = { race: 1 };
  const first = await ipfs.pinJson(doc, 'doc', { owner: { kind: 'MARKET_QUESTION', id: 'old' } });

  // While the provider unpin is in flight, the same document is pinned again.
  transport.unpin = async (cid: string) => {
    transport.calls.unpin.push(cid);
    await ipfs.pinJson(doc, 'doc', { owner: { kind: 'MARKET_QUESTION', id: 'new' } });
  };
  const result = await runPinGc({
    ledger, transport: transport as any, now: NOW, graceMs: 72 * HOUR, pause: async () => undefined,
    resolveOwner: async (ref) => (ref.ownerId === 'old' ? { verdict: 'RELEASE' } : { verdict: 'KEEP' }),
  });
  assert.equal(result.repinned, 1);
  assert.equal(transport.calls.pin.length, 2, 'original pin plus the restore');
  assert.equal((await ledger.get(first.cid))?.status, 'PINNED');
  assert.ok(content.map.has(first.cid));
});

test('GC honours the rate limit and backs off on 429', async () => {
  const { ipfs, ledger, transport } = await freshEnv();
  const { runPinGc } = await import('../src/jobs/pin-gc.job');
  const cids: string[] = [];
  for (let i = 0; i < 5; i++) {
    cids.push((await ipfs.pinJson({ n: i }, `d${i}`, { owner: { kind: 'MARKET_QUESTION', id: `m${i}` } })).cid);
  }
  transport.unpin = async () => {
    throw Object.assign(new Error('Too Many Requests'), { response: { status: 429 } });
  };
  const pauses: number[] = [];
  const result = await runPinGc({
    ledger, transport: transport as any, now: NOW, graceMs: 72 * HOUR,
    resolveOwner: async () => ({ verdict: 'RELEASE' }),
    pause: async (ms) => { pauses.push(ms); },
  });
  assert.equal(result.rateLimited, true);
  assert.equal(result.unpinned, 0);
  assert.deepEqual(pauses, [2000, 4000], 'exponential backoff before giving up');
  for (const cid of cids) assert.equal((await ledger.get(cid))?.status, 'PINNED', 'nothing is lost');
});

test('GC spaces unpins to the configured per-minute rate', async () => {
  const { ipfs, ledger, transport } = await freshEnv();
  const { runPinGc } = await import('../src/jobs/pin-gc.job');
  for (let i = 0; i < 3; i++) await ipfs.pinJson({ n: i }, `d${i}`, { owner: { kind: 'MARKET_QUESTION', id: `m${i}` } });
  const pauses: number[] = [];
  const result = await runPinGc({
    ledger, transport: transport as any, now: NOW, graceMs: 72 * HOUR, ratePerMin: 30,
    resolveOwner: async () => ({ verdict: 'RELEASE' }), pause: async (ms) => { pauses.push(ms); },
  });
  assert.equal(result.unpinned, 3);
  assert.deepEqual(pauses, [2000, 2000]);
});

test('a non-429 unpin failure keeps the pin', async () => {
  const { ipfs, ledger, transport } = await freshEnv();
  const { runPinGc } = await import('../src/jobs/pin-gc.job');
  const pinned = await ipfs.pinJson({ x: 1 }, 'doc', { owner: { kind: 'MARKET_QUESTION', id: 'm' } });
  transport.unpin = async () => { throw new Error('boom'); };
  const result = await runPinGc({
    ledger, transport: transport as any, now: NOW, graceMs: 72 * HOUR,
    resolveOwner: async () => ({ verdict: 'RELEASE' }), pause: async () => undefined,
  });
  assert.equal(result.failed, 1);
  const pin = await ledger.get(pinned.cid);
  assert.deepEqual([pin?.status, pin?.lastError], ['PINNED', 'boom']);
});

test('a released reference is revived by a new use of the same document', async () => {
  const { ipfs, ledger } = await freshEnv();
  const owner = { kind: 'MARKET_QUESTION' as const, id: 'm1' };
  const pinned = await ipfs.pinJson({ again: 1 }, 'doc', { owner });
  await ledger.release({ cid: pinned.cid, ownerKind: owner.kind, ownerId: owner.id });
  assert.equal((await ledger.refsFor(pinned.cid))[0].state, 'RELEASED');
  await ipfs.pinJson({ again: 1 }, 'doc', { owner });
  assert.equal((await ledger.refsFor(pinned.cid))[0].state, 'CANDIDATE');
});

test('local transport lists and unpins', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { localIpfsTransport } = await import('../src/services/ipfs.service');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pins-'));
  const t = localIpfsTransport(dir);
  const cid = await t.pin(Buffer.from('hello'), 'n');
  assert.equal((await t.list!({})).total, 1);
  await t.unpin!(cid);
  assert.equal((await t.list!({})).total, 0);
  fs.rmSync(dir, { recursive: true, force: true });
  void crypto;
});
