import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { setupTestEnv } from './helpers/env';
import {
  Bulkhead,
  ClientAbortedError,
  SaturatedError,
  TimeoutError,
  deadline,
  defaultPoliciesFor,
  parseClassPolicyOverrides,
  sleep,
  withTimeout,
} from '../src/lib/resilience';
import { currentCallerClass, runWithContext, withCallerClass } from '../src/lib/context';
import { setOutsideBulkheadHook, wrapRpcServer } from '../src/services/stellar/clients';

setupTestEnv();

test('withTimeout rejects with UPSTREAM_TIMEOUT and aborts the inner signal', async () => {
  let innerAborted = false;
  await assert.rejects(
    async () => {
      await withTimeout(
        'rpc-read',
        async (innerSignal) => {
          return new Promise<void>((_, reject) => {
            innerSignal.addEventListener('abort', () => {
              innerAborted = true;
              reject(innerSignal.reason);
            });
          });
        },
        { ms: 30 },
      );
    },
    (err: any) => {
      assert.equal(err.code, 'UPSTREAM_TIMEOUT');
      assert.equal(err.statusCode, 504);
      assert.equal(err.details?.dependency, 'rpc-read');
      return true;
    },
  );
  assert.equal(innerAborted, true);
});

test('parent abort propagates and is not reported as timeout', async () => {
  const controller = new AbortController();
  controller.abort(new Error('caller-cancelled'));

  await assert.rejects(
    async () => {
      await withTimeout(
        'rpc-read',
        async () => {
          await new Promise((r) => setTimeout(r, 200));
          return 'ok';
        },
        { signal: controller.signal, ms: 500 },
      );
    },
    (err: any) => {
      assert.equal(err.code, 'CLIENT_ABORTED');
      assert.notEqual(err.code, 'UPSTREAM_TIMEOUT');
      return true;
    },
  );
});

test('bulkhead limits concurrency and rejects when queue is full', async () => {
  const bulkhead = new Bulkhead('llm', 2, 2);

  let unblock1: () => void;
  let unblock2: () => void;
  const p1 = new Promise<void>((r) => { unblock1 = r; });
  const p2 = new Promise<void>((r) => { unblock2 = r; });

  const t1 = bulkhead.run(() => p1);
  const t2 = bulkhead.run(() => p2);

  assert.equal(bulkhead.stats().active, 2);
  assert.equal(bulkhead.stats().queued, 0);

  // Queue 2 tasks
  let unblock3: () => void;
  let unblock4: () => void;
  const p3 = new Promise<void>((r) => { unblock3 = r; });
  const p4 = new Promise<void>((r) => { unblock4 = r; });

  const t3 = bulkhead.run(() => p3);
  const t4 = bulkhead.run(() => p4);

  assert.equal(bulkhead.stats().active, 2);
  assert.equal(bulkhead.stats().queued, 2);

  // 5th task exceeds queue limit of 2 -> rejected
  await assert.rejects(
    async () => {
      await bulkhead.run(async () => 'overflow');
    },
    (err: any) => {
      assert.equal(err.code, 'UPSTREAM_SATURATED');
      assert.equal(err.statusCode, 503);
      return true;
    },
  );
  assert.equal(bulkhead.stats().rejected, 1);

  // Release active tasks
  unblock1!();
  unblock2!();
  await Promise.all([t1, t2]);

  // Next tasks in queue should start
  unblock3!();
  unblock4!();
  await Promise.all([t3, t4]);
});

test('pinJson aborts the pending pin when the caller signal aborts', async () => {
  const { pinJson, setIpfsTransport } = await import('../src/services/ipfs.service');
  let pinSignalAborted = false;

  const fakeTransport = {
    async pin(_bytes: Buffer, _name: string, signal?: AbortSignal) {
      return new Promise<string>((_, reject) => {
        signal?.addEventListener('abort', () => {
          pinSignalAborted = true;
          reject(signal.reason ?? new Error('aborted'));
        });
      });
    },
    async fetch() {
      return Buffer.from('');
    },
  };

  const prev = setIpfsTransport(fakeTransport);
  const controller = new AbortController();

  try {
    const pinPromise = pinJson({ hello: 'world' }, 'test-doc', { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    await assert.rejects(
      async () => {
        await pinPromise;
      },
      (err: any) => {
        assert.equal(err.code, 'CLIENT_ABORTED');
        return true;
      },
    );
    assert.equal(pinSignalAborted, true);
  } finally {
    setIpfsTransport(prev);
  }
});

test('verifyUsdcTransfer maps a hung getTransaction to CHAIN_READ_FAILED with timeout flag', async () => {
  const { verifyUsdcTransfer, setTransactionReader } = await import(
    '../src/services/payment-verification.service'
  );

  const prevReader = setTransactionReader({
    async getTransaction() {
      return new Promise(() => {}); // never resolves
    },
  });

  try {
    const parent = AbortSignal.timeout(30);
    await assert.rejects(
      async () => {
        await verifyUsdcTransfer(
          {
            txHash: 'aa'.repeat(32),
            token: 'test',
            from: 'test',
            to: 'test',
            minAmount: 1n,
          },
          parent,
        );
      },
      (err: any) => {
        assert.equal(err.code, 'CHAIN_READ_FAILED');
        assert.equal(err.statusCode, 502);
        assert.equal(err.details?.timeout, true);
        return true;
      },
    );
  } finally {
    setTransactionReader(prevReader);
  }
});

test('backfillEvents tick is bounded when getEvents hangs', async () => {
  const { backfillEvents } = await import('../src/services/indexer.service');

  const fakeSource = {
    async getHealth() {
      return { oldestLedger: 100, latestLedger: 200 } as any;
    },
    async getEvents() {
      return new Promise(() => {}); // never resolves
    },
  };

  const shortSignal = AbortSignal.timeout(40);
  await assert.rejects(
    async () => {
      await backfillEvents(150, { source: fakeSource as any, emit: () => {} }, { signal: shortSignal });
    },
    (err: any) => {
      assert.ok(err);
      return true;
    },
  );
});

test('callGeminiJSON stops retrying when budget is shorter than retryDelay', async () => {
  const { callGeminiJSON, setGenAI } = await import('../src/lib/gemini');
  const { MemoryGuardStore, setLlmGuardStore } = await import('../src/lib/llm-budget');
  const prevStore = setLlmGuardStore(new MemoryGuardStore());

  const fakeGenAI = {
    getGenerativeModel() {
      return {
        async generateContent() {
          throw new Error('429 RESOURCE_EXHAUSTED: Please retry in 30s.');
        },
      };
    },
  };

  const prev = setGenAI(fakeGenAI);
  try {
    const shortSignal = AbortSignal.timeout(50);
    const start = Date.now();
    await assert.rejects(
      async () => {
        await callGeminiJSON('sys', 'user', 100, { signal: shortSignal });
      },
      (err: any) => {
        assert.equal(err.code, 'UPSTREAM_TIMEOUT');
        return true;
      },
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `Expected fast timeout, took ${elapsed}ms`);
  } finally {
    setGenAI(prev);
    setLlmGuardStore(prevStore);
  }
});

test('GET /portfolio returns 200 with availableCapitalRaw null when RPC read times out', async () => {
  const { readClients } = await import('../src/services/stellar/clients');
  const { default: app } = await import('../src/app');

  const origTreasury = readClients.treasury;
  (readClients as any).treasury = () => ({
    available_capital: async () => new Promise(() => {}), // hung read
  });

  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/portfolio`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.availableCapitalRaw, null);
  } finally {
    (readClients as any).treasury = origTreasury;
    server.close();
  }
});

test('weighted fair bulkhead reserves capacity for critical and sheds background/public first (#300)', async () => {
  const policies = {
    critical: { weight: 8, reserved: 2, maxQueue: 8, maxWaitMs: 15_000 },
    agent: { weight: 4, reserved: 1, maxQueue: 8, maxWaitMs: 15_000 },
    interactive: { weight: 3, reserved: 0, maxQueue: 4, maxWaitMs: 10_000 },
    public: { weight: 2, reserved: 0, maxQueue: 2, maxWaitMs: 5_000 },
    background: { weight: 1, reserved: 0, maxQueue: 1, maxWaitMs: 30_000 },
  };
  const bh = new Bulkhead('rpc-read', 4, policies, { shedAfterMs: 50 });

  // Public can only take 4 - (2 + 1) = 1 shared slot; the 2nd public call queues.
  let releasePub1!: () => void;
  const pub1 = withCallerClass('public', () => bh.run(() => new Promise<void>((r) => { releasePub1 = r; })));
  assert.equal(bh.stats().byClass.public.active, 1);

  let releasePub2!: () => void;
  const pub2 = withCallerClass('public', () => bh.run(() => new Promise<void>((r) => { releasePub2 = r; })));
  assert.equal(bh.stats().byClass.public.queued, 1);

  // Critical enters immediately under its own reserved capacity even while public is queued.
  let critEntered = false;
  let releaseCrit1!: () => void;
  const crit1 = withCallerClass('critical', () =>
    bh.run(async () => {
      critEntered = true;
      await new Promise<void>((r) => { releaseCrit1 = r; });
    }),
  );
  assert.equal(critEntered, true);
  assert.equal(bh.stats().byClass.critical.active, 1);

  // Fill remaining slots (1 more critical + 1 agent) -> bulkhead at maxConcurrent (4).
  let releaseCrit2!: () => void;
  let releaseAgent!: () => void;
  const crit2 = withCallerClass('critical', () => bh.run(() => new Promise<void>((r) => { releaseCrit2 = r; })));
  const agent1 = withCallerClass('agent', () => bh.run(() => new Promise<void>((r) => { releaseAgent = r; })));
  assert.equal(bh.stats().active, 4);

  // Enqueue a background call; overflowing background queue yields 503 with class & retryAfter.
  const bg1 = withCallerClass('background', () => bh.run(async () => 'bg1'));
  await assert.rejects(
    () => withCallerClass('background', () => bh.run(async () => 'bg2')),
    (err: any) => {
      assert.equal(err.code, 'UPSTREAM_SATURATED');
      assert.equal(err.statusCode, 503);
      assert.equal(err.details?.class, 'background');
      assert.ok(typeof err.details?.retryAfter === 'number' && err.details.retryAfter >= 1);
      return true;
    },
  );

  // Sustained saturation past shedAfterMs proactively drops queued background and public entries.
  await new Promise((r) => setTimeout(r, 80));
  await assert.rejects(() => bg1, (err: any) => err instanceof SaturatedError && err.details?.class === 'background');
  await assert.rejects(() => pub2, (err: any) => err instanceof SaturatedError && err.details?.class === 'public');
  assert.equal(bh.stats().byClass.background.shed, 1);
  assert.equal(bh.stats().byClass.public.shed, 1);

  releasePub1();
  releaseCrit1();
  releaseCrit2();
  releaseAgent();
  await Promise.all([pub1, crit1, crit2, agent1]);
});

test('withCallerClass never lowers critical and defaults derive from context kind (#300)', () => {
  assert.equal(currentCallerClass(), 'background');
  runWithContext({ requestId: 'req_1', kind: 'http' }, () => {
    assert.equal(currentCallerClass(), 'public');
  });
  runWithContext({ requestId: 'req_2', kind: 'http', userId: 'u_1' }, () => {
    assert.equal(currentCallerClass(), 'interactive');
  });
  withCallerClass('critical', () => {
    assert.equal(currentCallerClass(), 'critical');
    withCallerClass('public', () => {
      assert.equal(currentCallerClass(), 'critical');
    });
  });
});

test('parseClassPolicyOverrides validates JSON overrides via zod (#300)', () => {
  const flat = parseClassPolicyOverrides('{"critical":{"weight":12,"reserved":5}}');
  assert.equal(flat['rpc-read']?.critical?.weight, 12);
  const byDep = parseClassPolicyOverrides('{"rpc-confirm":{"agent":{"weight":6}}}');
  assert.equal(byDep['rpc-confirm']?.agent?.weight, 6);
  assert.throws(() => parseClassPolicyOverrides('{"unknown-class":{"weight":2}}'));
  assert.throws(() => parseClassPolicyOverrides('{"rpc-read":{"critical":{"weight":-1}}}'));
  assert.ok(defaultPoliciesFor('rpc-read', 16, 32).critical.reserved === 4);
});

test('dev-only RPC guard fires outside bulkhead and never fires inside bulkhead (#300)', async () => {
  const warnings: Array<{ method: string; source: string }> = [];
  const prev = setOutsideBulkheadHook((method, source) => warnings.push({ method, source }));
  const fakeRpc = wrapRpcServer(
    {
      async getLatestLedger() {
        return { sequence: 42 };
      },
    },
    'test-rpc',
  );

  try {
    // Outside bulkhead -> triggers guard.
    await fakeRpc.getLatestLedger();
    assert.deepEqual(warnings, [{ method: 'getLatestLedger', source: 'test-rpc' }]);

    // Inside bulkhead (agent path) -> never triggers guard.
    warnings.length = 0;
    await withCallerClass('agent', () => withTimeout('rpc-read', () => fakeRpc.getLatestLedger()));
    assert.deepEqual(warnings, []);
  } finally {
    setOutsideBulkheadHook(prev);
  }
});
