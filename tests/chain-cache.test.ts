import test from 'node:test';
import assert from 'node:assert/strict';
import type Redis from 'ioredis';
import { setupTestEnv } from './helpers/env';
import {
  BEGIN_WRITE_LUA,
  END_WRITE_LUA,
  INVALIDATE_TAG_LUA,
  STORE_IF_GEN_LUA,
  UNLOCK_LUA,
  chainKey,
  decode,
  encode,
  memoryChainCache,
  redisChainCache,
  setChainCache,
  type ChainCache,
} from '../src/lib/chain-cache';
import { ChainError } from '../src/services/stellar/errors';
import { WRITE_OVERRIDE_TO_METHOD, tagsForWrite } from '../src/services/stellar/write-tags';
import {
  beginWriteIntentForRow,
  onConfirmed,
  runCompletionHandler,
  type ChainTransactionRow,
  type OutboxStore,
} from '../src/services/stellar/outbox';

setupTestEnv();

// ─── Faithful in-memory Redis stub for conformance testing ──────────────────

function createFakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  let failNext = false;

  function live(key: string): string | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  function setRaw(key: string, value: string, px?: number) {
    store.set(key, { value, expiresAt: px !== undefined ? Date.now() + px : null });
  }

  function pttl(key: string): number {
    const entry = store.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    const rem = entry.expiresAt - Date.now();
    if (rem <= 0) {
      store.delete(key);
      return -2;
    }
    return rem;
  }

  const client = {
    store,
    setFailNext(v: boolean) {
      failNext = v;
    },
    async get(key: string): Promise<string | null> {
      if (failNext) {
        failNext = false;
        throw new Error('redis down');
      }
      return live(key);
    },
    async mget(...keys: string[]): Promise<Array<string | null>> {
      if (failNext) {
        failNext = false;
        throw new Error('redis down');
      }
      return keys.map((k) => live(k));
    },
    async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
      if (failNext) {
        failNext = false;
        throw new Error('redis down');
      }
      let px: number | undefined;
      let nx = false;
      for (let i = 0; i < args.length; i++) {
        const a = String(args[i]).toUpperCase();
        if (a === 'PX') {
          px = Number(args[++i]);
        } else if (a === 'NX') {
          nx = true;
        }
      }
      if (nx && live(key) !== null) return null;
      setRaw(key, value, px);
      return 'OK';
    },
    async del(...keys: string[]): Promise<number> {
      let n = 0;
      for (const k of keys) {
        if (live(k) !== null) {
          store.delete(k);
          n++;
        }
      }
      return n;
    },
    async eval(script: string, numKeys: number, ...rest: Array<string | number>): Promise<unknown> {
      if (failNext) {
        failNext = false;
        throw new Error('redis down');
      }
      const keys = rest.slice(0, numKeys).map(String);
      const argv = rest.slice(numKeys).map(String);

      if (script === INVALIDATE_TAG_LUA) {
        const curGen = parseInt(live(keys[0]) ?? '0', 10) || 0;
        const newGen = curGen + 1;
        setRaw(keys[0], String(newGen));
        if (argv[0] !== '') {
          const incoming = Number(argv[0]);
          const curMin = Number(live(keys[1]) ?? '0');
          if (incoming > curMin) {
            setRaw(keys[1], argv[0]);
          }
        }
        return newGen;
      }

      if (script === STORE_IF_GEN_LUA) {
        const n = Number(argv[3]);
        const loadedLedger = Number(argv[2]);
        const isNeg = argv[4 + n] === '1';
        for (let i = 0; i < n; i++) {
          const curGen = Number(live(keys[1 + i]) ?? '0');
          const preGen = Number(argv[4 + i]);
          if (curGen !== preGen) return 'GEN_RACE';
          const intentCnt = Number(live(keys[1 + 2 * n + i]) ?? '0');
          if (intentCnt > 0) return 'INTENT';
          if (!isNeg) {
            const minL = Number(live(keys[1 + n + i]) ?? '0');
            if (minL > 0 && loadedLedger < minL) return 'STALE_LEDGER';
          }
        }
        if (!isNeg) {
          const existing = live(keys[0]);
          if (existing) {
            try {
              const parsed = JSON.parse(existing);
              if (parsed && !parsed.isNegativeError && Number(parsed.ledger ?? 0) > loadedLedger) {
                return 'STALE_PREV';
              }
            } catch {}
          }
        }
        setRaw(keys[0], argv[0], Number(argv[1]));
        return 'OK';
      }

      if (script === UNLOCK_LUA) {
        if (live(keys[0]) === argv[0]) {
          store.delete(keys[0]);
          return 1;
        }
        return 0;
      }

      if (script === BEGIN_WRITE_LUA) {
        const ttl = Number(argv[0]);
        const n = Number(argv[2]);
        setRaw(keys[0], argv[1], ttl);
        for (let i = 0; i < n; i++) {
          setRaw(keys[1 + i], '1', ttl);
          const countKey = keys[1 + n + i];
          const next = (Number(live(countKey) ?? '0') || 0) + 1;
          const curPttl = pttl(countKey);
          setRaw(countKey, String(next), Math.max(curPttl, ttl));
        }
        return 1;
      }

      if (script === END_WRITE_LUA) {
        const n = Number(argv[0]);
        store.delete(keys[0]);
        for (let i = 0; i < n; i++) {
          if (live(keys[1 + i]) !== null) {
            store.delete(keys[1 + i]);
            const countKey = keys[1 + n + i];
            const next = (Number(live(countKey) ?? '0') || 0) - 1;
            if (next <= 0) {
              store.delete(countKey);
            } else {
              const curPttl = pttl(countKey);
              setRaw(countKey, String(next), curPttl > 0 ? curPttl : undefined);
            }
          }
        }
        return 1;
      }

      throw new Error(`Unexpected Lua script in fake Redis`);
    },
  };

  return client;
}

// ─── Codec & Key Helper ─────────────────────────────────────────────────────

test('codec round-trips Market, ResolutionState and i128 values losslessly', () => {
  const sample = {
    marketId: 42n,
    reserves: [1000000000n, 2000000000n],
    hash: Buffer.from('f4b58d4ac4068163f34bd9486f0563c70873afa5f64e915ab7e85af7dee15e4e', 'hex'),
    status: { tag: 'Resolved', values: [{ tag: 'Yes' }] },
    name: 'Test Market',
  };

  const encoded = encode(sample);
  const decoded = decode<typeof sample>(encoded);

  assert.equal(decoded.marketId, 42n);
  assert.equal(decoded.reserves[0], 1000000000n);
  assert.equal(decoded.reserves[1], 2000000000n);
  assert.ok(Buffer.isBuffer(decoded.hash));
  assert.equal(decoded.hash.toString('hex'), sample.hash.toString('hex'));
  assert.deepEqual(decoded.status, sample.status);
  assert.equal(decoded.name, sample.name);
});

test('chainKey produces deterministic keys per network, contract, method and args', () => {
  const k1 = chainKey('C1', 'get_market', { id: '1' });
  const k2 = chainKey('C1', 'get_market', { id: '1' });
  const k3 = chainKey('C1', 'get_market', { id: '2' });
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
});

// ─── Shared Conformance Suite (Memory + Redis) ──────────────────────────────

const IMPLS: Array<{ name: string; create: () => ChainCache }> = [
  { name: 'memory', create: () => memoryChainCache() },
  { name: 'redis', create: () => redisChainCache(createFakeRedis() as unknown as Redis) },
];

for (const impl of IMPLS) {
  test(`[${impl.name}] second read within TTL is served from cache with cached true and original ledger`, async () => {
    const cache = impl.create();
    let loadCount = 0;

    const loader = async () => {
      loadCount++;
      return { value: { reserveYes: 100n }, ledger: 12345 };
    };

    const read1 = await cache.get('k1', { ttlMs: 5000, tags: ['market:1'] }, loader);
    assert.equal(read1.cached, false);
    assert.equal(read1.ledger, 12345);
    assert.equal(read1.value.reserveYes, 100n);
    assert.equal(loadCount, 1);

    const read2 = await cache.get('k1', { ttlMs: 5000, tags: ['market:1'] }, loader);
    assert.equal(read2.cached, true);
    assert.equal(read2.ledger, 12345);
    assert.equal(read2.value.reserveYes, 100n);
    assert.equal(loadCount, 1);
  });

  test(`[${impl.name}] 100 concurrent misses trigger exactly one loader call`, async () => {
    const cache = impl.create();
    let loadCount = 0;

    const loader = async () => {
      loadCount++;
      await new Promise((r) => setTimeout(r, 20));
      return { value: 'coalesced-data', ledger: 500 };
    };

    const reads = await Promise.all(
      Array.from({ length: 100 }, () =>
        cache.get('k-concurrent', { ttlMs: 5000, tags: ['market:5'] }, loader),
      ),
    );

    assert.equal(loadCount, 1);
    for (const r of reads) {
      assert.equal(r.value, 'coalesced-data');
      assert.equal(r.ledger, 500);
    }
  });

  test(`[${impl.name}] invalidateTag forces a reload on the next read`, async () => {
    const cache = impl.create();
    let loadCount = 0;

    const loader = async () => {
      loadCount++;
      return { value: `val-${loadCount}`, ledger: 1000 + loadCount };
    };

    const r1 = await cache.get('k-tag', { ttlMs: 5000, tags: ['market:10'] }, loader);
    assert.equal(r1.value, 'val-1');
    assert.equal(loadCount, 1);

    await cache.invalidateTag('market:10');

    const r2 = await cache.get('k-tag', { ttlMs: 5000, tags: ['market:10'] }, loader);
    assert.equal(r2.value, 'val-2');
    assert.equal(r2.cached, false);
    assert.equal(loadCount, 2);
  });

  test(`[${impl.name}] load overlapping an invalidation is never stored as fresh (pre-load generation capture)`, async () => {
    const cache = impl.create();
    let releaseLoad!: () => void;
    let started!: () => void;
    const onStarted = new Promise<void>((r) => { started = r; });

    const inFlightRead = cache.get('k-race', { ttlMs: 5000, tags: ['market:30'] }, async () => {
      started();
      await new Promise<void>((r) => { releaseLoad = r; });
      return { value: 'pre-write-stale', ledger: 300 };
    });

    await onStarted;
    // Invalidation lands while RPC read is still in flight
    await cache.invalidateTag('market:30', 300);
    releaseLoad();

    const r1 = await inFlightRead;
    assert.equal(r1.value, 'pre-write-stale');
    assert.equal(r1.cached, false);
    assert.equal(cache.stats().genRaceRejects, 1);
    assert.ok(cache.stats().staleRejects >= 1);

    // Next read MUST miss and load fresh post-write data
    let secondLoaded = false;
    const r2 = await cache.get('k-race', { ttlMs: 5000, tags: ['market:30'] }, async () => {
      secondLoaded = true;
      return { value: 'post-write-fresh', ledger: 301 };
    });
    assert.equal(secondLoaded, true);
    assert.equal(r2.value, 'post-write-fresh');
    assert.equal(r2.cached, false);
  });

  test(`[${impl.name}] minimum ledger only moves forward even when an older invalidation arrives later`, async () => {
    const cache = impl.create();

    await cache.invalidateTag('market:20', 200);
    // Late indexer invalidation with older ledger must NOT lower minLedger
    await cache.invalidateTag('market:20', 150);

    const r1 = await cache.get(
      'k-stale',
      { ttlMs: 5000, tags: ['market:20'] },
      async () => ({ value: 'stale-180', ledger: 180 }),
    );
    assert.equal(r1.cached, false);
    assert.equal(cache.stats().staleRejects, 1);

    // Must still miss because ledger 180 < monotonic floor 200
    let reloaded = false;
    const r2 = await cache.get(
      'k-stale',
      { ttlMs: 5000, tags: ['market:20'] },
      async () => {
        reloaded = true;
        return { value: 'fresh-205', ledger: 205 };
      },
    );
    assert.equal(reloaded, true);
    assert.equal(r2.value, 'fresh-205');
  });

  test(`[${impl.name}] write intents bypass cache without storing until endWrite`, async () => {
    const cache = impl.create();
    let loads = 0;
    const loader = async () => {
      loads++;
      return { value: `v-${loads}`, ledger: 100 + loads };
    };

    // Prime the cache
    await cache.get('k-intent', { ttlMs: 5000, tags: ['market:7', 'treasury:capital'] }, loader);
    assert.equal(loads, 1);

    // Begin write intent
    const token = await cache.beginWrite(['market:7', 'treasury:capital'], 5000);

    const during = await cache.get('k-intent', { ttlMs: 5000, tags: ['market:7'] }, loader);
    assert.equal(during.cached, false);
    assert.equal(during.intent, true);
    assert.equal(during.value, 'v-2');
    assert.equal(loads, 2);
    assert.equal(cache.stats().intentBypasses, 1);

    // End write intent + invalidate
    await cache.invalidateTag('market:7', 105);
    await cache.endWrite(token);

    // Idempotent second endWrite does not underflow
    await cache.endWrite(token);

    const after1 = await cache.get('k-intent', { ttlMs: 5000, tags: ['market:7'] }, async () => {
      loads++;
      return { value: 'v-post', ledger: 105 };
    });
    assert.equal(after1.cached, false);
    assert.equal(after1.intent, undefined);
    assert.equal(after1.value, 'v-post');

    const after2 = await cache.get('k-intent', { ttlMs: 5000, tags: ['market:7'] }, loader);
    assert.equal(after2.cached, true);
    assert.equal(after2.value, 'v-post');
  });

  test(`[${impl.name}] contract errors are negatively cached only for the negative TTL`, async () => {
    const cache = impl.create();
    let calls = 0;

    const loader = async () => {
      calls++;
      throw new ChainError('MarketNotFound', 'MarketNotFound');
    };

    await assert.rejects(
      async () => cache.get('k-notfound', { ttlMs: 5000, tags: ['market:404'] }, loader),
      (err: any) => err.contractError === 'MarketNotFound',
    );
    assert.equal(calls, 1);

    await assert.rejects(
      async () => cache.get('k-notfound', { ttlMs: 5000, tags: ['market:404'] }, loader),
      (err: any) => err.contractError === 'MarketNotFound',
    );
    assert.equal(calls, 1);
  });
}

// ─── Redis-specific correctness tests ───────────────────────────────────────

test('[redis] waiter ignores stale invalidated entry and reloads when wait expires', async () => {
  const { config } = await import('../src/config');
  const prevWait = config.CHAIN_CACHE_WAIT_MS;
  (config as Record<string, unknown>).CHAIN_CACHE_WAIT_MS = 80;
  try {
    const fake = createFakeRedis();
    const cache = redisChainCache(fake as unknown as Redis);

    // Prime cache with gen 0 entry
    await cache.get('k-wait', { ttlMs: 5000, tags: ['market:99'] }, async () => ({ value: 'old', ledger: 10 }));
    // Invalidate so the cached entry is now stale
    await cache.invalidateTag('market:99', 15);
    // Simulate another instance holding the lock
    await fake.set('chain:lock:k-wait', 'other-instance', 'PX', 5000, 'NX');

    let loads = 0;
    const res = await cache.get('k-wait', { ttlMs: 5000, tags: ['market:99'] }, async () => {
      loads++;
      return { value: 'reloaded-fresh', ledger: 16 };
    });

    assert.equal(loads, 1);
    assert.equal(res.value, 'reloaded-fresh');
    assert.equal(res.cached, false);
    assert.equal(cache.stats().waiterReloads, 1);
  } finally {
    (config as Record<string, unknown>).CHAIN_CACHE_WAIT_MS = prevWait;
  }
});

test('[redis] degradedSince invalidates Redis entries read before a failed invalidateTag', async () => {
  const fake = createFakeRedis();
  const cache = redisChainCache(fake as unknown as Redis);

  await cache.get('k-deg', { ttlMs: 5000, tags: ['market:55'] }, async () => ({ value: 'before-outage', ledger: 10 }));

  // Make readAt slightly older so degradedSince > readAt
  const raw = fake.store.get('k-deg')!;
  const parsed = JSON.parse(raw.value);
  parsed.readAt = Date.now() - 500;
  raw.value = JSON.stringify(parsed);

  // Redis fails during invalidateTag -> marks degradedSince
  fake.setFailNext(true);
  await cache.invalidateTag('market:55', 11);

  // Next read when Redis recovers must NOT serve the pre-outage entry
  let reloaded = false;
  const r2 = await cache.get('k-deg', { ttlMs: 5000, tags: ['market:55'] }, async () => {
    reloaded = true;
    return { value: 'after-outage', ledger: 12 };
  });
  assert.equal(reloaded, true);
  assert.equal(r2.value, 'after-outage');
});

// ─── Tag derivation & outbox confirmation hook ──────────────────────────────

test('tagsForWrite covers every write method in WRITE_OVERRIDE_TO_METHOD', () => {
  assert.deepEqual(
    Object.keys(WRITE_OVERRIDE_TO_METHOD).sort(),
    [
      'agentBuy',
      'agentCreateMarket',
      'agentSell',
      'attest',
      'finalizeSigners',
      'publishTrace',
      'registerPriceSpec',
      'registerSignerSpec',
      'resolvePrice',
    ],
  );

  assert.deepEqual(tagsForWrite('agent_buy', { market_id: 42n }), ['market:42', 'treasury:capital']);
  assert.deepEqual(tagsForWrite('agent_sell', { market_id: '7' }), ['market:7', 'treasury:capital']);
  assert.deepEqual(tagsForWrite('agent_create_market', {}), ['treasury:capital']);
  assert.deepEqual(tagsForWrite('agent_create_market', {}, 99n), ['treasury:capital', 'market:99']);
  assert.deepEqual(tagsForWrite('register_price_spec', { market_id: 5n }), ['resolver:5', 'market:5']);
  assert.deepEqual(tagsForWrite('register_signer_spec', { market_id: 5n }), ['resolver:5', 'market:5']);
  assert.deepEqual(tagsForWrite('resolve_price', { market_id: 5n }), ['resolver:5', 'market:5']);
  assert.deepEqual(tagsForWrite('attest', { market_id: 5n }), ['resolver:5', 'market:5']);
  assert.deepEqual(tagsForWrite('finalize_signers', { market_id: 5n }), ['resolver:5', 'market:5']);
  assert.deepEqual(tagsForWrite('publish_trace', { market_id: 5n }), []);
});

test('outbox onConfirmed invalidates derived tags at ledger and ends write intent on SUCCESS and landed FAILED', async () => {
  const cache = memoryChainCache();
  setChainCache(cache);
  try {
    // Prime market + treasury cache at ledger 100
    await cache.get('m1', { ttlMs: 5000, tags: ['market:1'] }, async () => ({ value: 'pre', ledger: 100 }));
    await cache.get('t1', { ttlMs: 5000, tags: ['treasury:capital'] }, async () => ({ value: 500n, ledger: 100 }));

    // Begin write intent for row ob-1
    await beginWriteIntentForRow('ob-1', 'agent_buy', { market_id: '1' }, 5000);
    const during = await cache.get('m1', { ttlMs: 5000, tags: ['market:1'] }, async () => ({ value: 'live', ledger: 101 }));
    assert.equal(during.intent, true);

    const row: ChainTransactionRow = {
      id: 'ob-1',
      kind: 'test.noop',
      refId: null,
      contract: 'treasury',
      method: 'agent_buy',
      args: { market_id: '1' },
      simulated: null,
      source: null,
      sequence: null,
      hash: 'aa'.repeat(32),
      envelopeXdr: null,
      status: 'SUCCESS',
      submitLedger: 100,
      minTime: null,
      maxTime: null,
      ledger: 105,
      resultXdr: null,
      returnValue: null,
      innerFee: null,
      resourceFee: null,
      feeBumpHashes: [],
      feeBumpEnvelopes: null,
      landedHash: 'aa'.repeat(32),
      bumpAttempts: 0,
      attempts: 0,
      error: null,
      handledAt: null,
    };

    let markedHandled = false;
    const fakeStore = {
      markHandled: async () => { markedHandled = true; },
    } as unknown as OutboxStore;

    await runCompletionHandler(row, { status: 'SUCCESS', txHash: row.hash, ledger: 105 }, fakeStore);
    assert.equal(markedHandled, true);

    // Ledger 104 must be rejected because onConfirmed invalidated at ledger 105
    const stale = await cache.get('m1', { ttlMs: 5000, tags: ['market:1'] }, async () => ({ value: 'stale-104', ledger: 104 }));
    assert.equal(stale.cached, false);
    assert.equal(stale.intent, undefined);
    assert.ok(cache.stats().staleRejects >= 1);

    // Landed FAILED transaction with txHash also invalidates at its ledger
    await cache.get('r2', { ttlMs: 5000, tags: ['resolver:2'] }, async () => ({ value: 'pre-fail', ledger: 200 }));
    await onConfirmed(
      { ...row, id: 'ob-2', method: 'resolve_price', args: { market_id: '2' }, ledger: 210, landedHash: 'bb'.repeat(32) },
      { status: 'FAILED', txHash: 'bb'.repeat(32), ledger: 210 },
    );
    let reloaded = false;
    const afterFail = await cache.get('r2', { ttlMs: 5000, tags: ['resolver:2'] }, async () => {
      reloaded = true;
      return { value: 'post-fail', ledger: 210 };
    });
    assert.equal(reloaded, true);
    assert.equal(afterFail.value, 'post-fail');
  } finally {
    setChainCache(null);
  }
});

test('higher caller class promotes a queued public load to avoid priority inversion (#300)', async () => {
  const cache = memoryChainCache();
  const bh = new Bulkhead('rpc-read', 2, {
    critical: { weight: 8, reserved: 1, maxQueue: 8, maxWaitMs: 15_000 },
    agent: { weight: 4, reserved: 0, maxQueue: 8, maxWaitMs: 15_000 },
    interactive: { weight: 3, reserved: 0, maxQueue: 8, maxWaitMs: 10_000 },
    public: { weight: 2, reserved: 0, maxQueue: 8, maxWaitMs: 5_000 },
    background: { weight: 1, reserved: 0, maxQueue: 8, maxWaitMs: 30_000 },
  });

  // Occupy the single non-reserved slot with an unrelated public call so the next public load queues.
  let releaseBlocker!: () => void;
  const blocker = withCallerClass('public', () =>
    bh.run(() => new Promise<void>((r) => { releaseBlocker = r; })),
  );

  let loadCalls = 0;
  const load = () =>
    bh.run(async () => {
      loadCalls++;
      return { value: `loaded-${loadCalls}`, ledger: 999 };
    });

  // Public caller starts first, queues in bulkhead (not started yet).
  const pubPromise = withCallerClass('public', () => cache.get('k-promote', { ttlMs: 5000, tags: [] }, load));
  await new Promise((r) => setTimeout(r, 10));

  // Critical caller joins: promotes and uses critical's reserved slot immediately.
  const critPromise = withCallerClass('critical', () => cache.get('k-promote', { ttlMs: 5000, tags: [] }, load));

  const [pubRes, critRes] = await Promise.all([pubPromise, critPromise]);
  assert.equal(pubRes.value, 'loaded-1');
  assert.equal(critRes.value, 'loaded-1');
  assert.equal(cache.stats().promoted, 1);

  releaseBlocker();
  await blocker;
});
