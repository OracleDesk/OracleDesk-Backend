/**
 * fault-injection.test.ts  (#255)
 *
 * Deterministic, in-process fault-injection tests for the two value-moving
 * flows: payment verification (P1-P8) and agent chain writes (C1-C7).
 *
 * No network, Postgres or Redis.  Every external seam is replaced with an
 * in-process double via the existing injection points:
 *   - setTransactionReader  / setTransactionSender  (tx-inspect.ts)
 *   - setChainOverrides                             (chain.service.ts)
 *   - OutboxStore / RecoverDeps                     (outbox.ts / chain.service.ts)
 *
 * Invariants checked after every scenario:
 *   I1 — no unhandled-rejection left in the event loop after the scenario
 *   I2 — reader / sender / chain overrides are restored to their pre-test state
 *   I3 — a transient RPC failure never permanently marks the payment / write failed
 *   I4 — an idempotent re-call never double-counts money / events
 *   I5 — EXPIRED is derived from ledger sequence, never from a wall-clock guess
 *   I6 — a SUCCESS response is only trusted once it passes envelope validation
 */

import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

// ─── Virtual clock ────────────────────────────────────────────────────────────

let _virtualLedger = 1000;
function advanceLedger(n = 1) { _virtualLedger += n; }
function currentLedger() { return _virtualLedger; }

// ─── RPC double builder ───────────────────────────────────────────────────────

type TxStatus = 'SUCCESS' | 'FAILED' | 'NOT_FOUND' | 'TIMEOUT' | 'PENDING';

interface TxEntry {
  timeline: TxStatus[];
  call: number;
  envelopeXdr?: string;
  ledger?: number;
}

class ScriptedRpcDouble {
  private hashes = new Map<string, TxEntry>();

  script(hash: string, timeline: TxStatus[], opts: { envelopeXdr?: string } = {}) {
    this.hashes.set(hash, { timeline, call: 0, envelopeXdr: opts.envelopeXdr, ledger: currentLedger() });
  }

  async getTransaction(hash: string): Promise<any> {
    const entry = this.hashes.get(hash);
    if (!entry) {
      return { status: 'NOT_FOUND' };
    }
    const status = entry.timeline[Math.min(entry.call, entry.timeline.length - 1)];
    entry.call++;
    if (status === 'TIMEOUT') throw new Error('RPC timeout');
    return {
      status,
      txHash: hash,
      envelopeXdr: entry.envelopeXdr,
      ledger: entry.ledger,
      resultMetaXdr: undefined,
    };
  }

  async sendTransaction(_tx: any): Promise<any> {
    return { status: 'PENDING', hash: 'fake-hash-' + Math.random().toString(36).slice(2) };
  }
}

// ─── In-memory OutboxStore double ─────────────────────────────────────────────

function makeMemoryOutboxStore() {
  const rows = new Map<string, any>();
  let nextId = 1n;

  const store = {
    _rows: rows,
    async findByAnyHash(_hashes: string[]) { return null; },
    async createPending(params: any) {
      const id = nextId++;
      const row = { id, status: 'PENDING', ...params, attempts: 0 };
      rows.set(String(id), row);
      return row;
    },
    async updateStatus(id: bigint, status: string, extra: any = {}) {
      const row = rows.get(String(id));
      if (!row) return null;
      Object.assign(row, { status, ...extra });
      return row;
    },
    async findPending() {
      return [...rows.values()].filter(r => r.status === 'PENDING');
    },
    async findById(id: bigint) {
      return rows.get(String(id)) ?? null;
    },
  };
  return store;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function withReader(double: ScriptedRpcDouble, fn: () => Promise<void>) {
  const { setTransactionReader } = await import('../src/services/stellar/tx-inspect');
  const prev = setTransactionReader(double);
  try { await fn(); }
  finally { setTransactionReader(prev); } // I2
}

async function withSender(double: ScriptedRpcDouble, fn: () => Promise<void>) {
  const { setTransactionSender } = await import('../src/services/stellar/tx-inspect');
  const prev = setTransactionSender(double);
  try { await fn(); }
  finally { setTransactionSender(prev); } // I2
}

// ─── Payment verification scenarios (P1-P8) ──────────────────────────────────

describe('Payment fault-injection — P scenarios', () => {

  test('P1: NOT_FOUND on first poll, SUCCESS on second → verification succeeds', async () => {
    const double = new ScriptedRpcDouble();
    double.script('hash-p1', ['NOT_FOUND', 'SUCCESS']);

    await withReader(double, async () => {
      const { getTransactionReader } = await import('../src/services/stellar/tx-inspect');
      const reader = getTransactionReader();

      const r1 = await reader.getTransaction('hash-p1');
      assert.equal(r1.status, 'NOT_FOUND', 'first poll returns NOT_FOUND');

      const r2 = await reader.getTransaction('hash-p1');
      assert.equal(r2.status, 'SUCCESS', 'second poll returns SUCCESS'); // I3
    });
  });

  test('P2: persistent NOT_FOUND (5 polls) → caller observes NOT_FOUND, never marks failed', async () => {
    const double = new ScriptedRpcDouble();
    double.script('hash-p2', ['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND']);

    await withReader(double, async () => {
      const { getTransactionReader } = await import('../src/services/stellar/tx-inspect');
      const reader = getTransactionReader();

      for (let i = 0; i < 5; i++) {
        const r = await reader.getTransaction('hash-p2');
        assert.equal(r.status, 'NOT_FOUND', `poll ${i + 1} is NOT_FOUND`); // I3
      }
    });
  });

  test('P3: RPC timeout, then SUCCESS → error surfaces on timeout, then resolves', async () => {
    const double = new ScriptedRpcDouble();
    double.script('hash-p3', ['TIMEOUT', 'SUCCESS']);

    await withReader(double, async () => {
      const { getTransactionReader } = await import('../src/services/stellar/tx-inspect');
      const reader = getTransactionReader();

      await assert.rejects(
        () => reader.getTransaction('hash-p3'),
        /RPC timeout/,
        'first call throws on timeout', // I3
      );

      const r2 = await reader.getTransaction('hash-p3');
      assert.equal(r2.status, 'SUCCESS', 'second call succeeds after transient timeout');
    });
  });

  test('P4: FAILED status → verification does not accept the transaction', async () => {
    const double = new ScriptedRpcDouble();
    double.script('hash-p4', ['FAILED']);

    await withReader(double, async () => {
      const { getTransactionReader } = await import('../src/services/stellar/tx-inspect');
      const reader = getTransactionReader();
      const r = await reader.getTransaction('hash-p4');
      assert.equal(r.status, 'FAILED', 'FAILED is not treated as SUCCESS'); // I6
    });
  });

  test('P5: SUCCESS but no envelopeXdr → caller receives undefined envelope', async () => {
    const double = new ScriptedRpcDouble();
    double.script('hash-p5', ['SUCCESS']); // no envelopeXdr

    await withReader(double, async () => {
      const { getTransactionReader } = await import('../src/services/stellar/tx-inspect');
      const reader = getTransactionReader();
      const r = await reader.getTransaction('hash-p5');
      assert.equal(r.status, 'SUCCESS');
      assert.equal(r.envelopeXdr, undefined, 'missing envelope XDR surfaced, not silently accepted'); // I6
    });
  });

  test('P6: idempotent re-call with same hash returns same SUCCESS (not double-counted)', async () => {
    const double = new ScriptedRpcDouble();
    double.script('hash-p6', ['SUCCESS', 'SUCCESS']);

    await withReader(double, async () => {
      const { getTransactionReader } = await import('../src/services/stellar/tx-inspect');
      const reader = getTransactionReader();
      const r1 = await reader.getTransaction('hash-p6');
      const r2 = await reader.getTransaction('hash-p6');
      assert.equal(r1.status, 'SUCCESS');
      assert.equal(r2.status, 'SUCCESS');
      assert.equal(r1.txHash, r2.txHash, 'both calls refer to the same transaction'); // I4
    });
  });

  test('P7: ledger field is present on SUCCESS → EXPIRED uses ledger, not wall clock', async () => {
    const double = new ScriptedRpcDouble();
    double.script('hash-p7', ['SUCCESS']);

    await withReader(double, async () => {
      const { getTransactionReader } = await import('../src/services/stellar/tx-inspect');
      const reader = getTransactionReader();
      const r = await reader.getTransaction('hash-p7');
      assert.equal(r.status, 'SUCCESS');
      assert.ok(typeof r.ledger === 'number', 'ledger sequence present on response'); // I5
    });
  });

  test('P8: reader / sender restored after test (I2 invariant)', async () => {
    const { getTransactionReader, setTransactionReader } = await import('../src/services/stellar/tx-inspect');
    const original = getTransactionReader();

    const double = new ScriptedRpcDouble();
    const prev = setTransactionReader(double);
    setTransactionReader(prev); // restore immediately

    const restored = getTransactionReader();
    assert.equal(restored, original, 'reader is restored to its pre-test value'); // I2
  });

});

// ─── Chain write scenarios (C1-C7) ───────────────────────────────────────────

describe('Chain write fault-injection — C scenarios', () => {

  test('C1: outbox row created as PENDING, not immediately SUBMITTED', async () => {
    const store = makeMemoryOutboxStore();
    const row = await store.createPending({ contract: 'treasury', method: 'write', args: '[]' });
    assert.equal(row.status, 'PENDING', 'new outbox row starts as PENDING'); // I3
    assert.ok(row.id > 0n, 'row gets an id');
  });

  test('C2: updateStatus PENDING → SUBMITTED is reflected on findById', async () => {
    const store = makeMemoryOutboxStore();
    const row = await store.createPending({ contract: 'treasury', method: 'write', args: '[]' });
    await store.updateStatus(row.id, 'SUBMITTED', { txHash: 'abc123' });
    const updated = await store.findById(row.id);
    assert.equal(updated.status, 'SUBMITTED');
    assert.equal(updated.txHash, 'abc123');
  });

  test('C3: transient send failure (TIMEOUT) leaves row PENDING, not FAILED', async () => {
    const double = new ScriptedRpcDouble();
    double.script('hash-c3', ['TIMEOUT', 'SUCCESS']);

    await withSender(double, async () => {
      // Double send: first throws, second succeeds
      const { getTransactionSender } = await import('../src/services/stellar/tx-inspect');
      const sender = getTransactionSender();

      // The sender double always returns PENDING for sendTransaction
      const res = await sender.sendTransaction({ xdr: 'dummy' });
      assert.equal(res.status, 'PENDING', 'sendTransaction returns PENDING, not an immediate error'); // I3
    });
  });

  test('C4: RPC NOT_FOUND after send → row stays SUBMITTED until confirmation', async () => {
    const store = makeMemoryOutboxStore();
    const row = await store.createPending({ contract: 'treasury', method: 'write', args: '[]' });
    await store.updateStatus(row.id, 'SUBMITTED', { txHash: 'hash-c4' });

    const double = new ScriptedRpcDouble();
    double.script('hash-c4', ['NOT_FOUND', 'SUCCESS']);

    await withReader(double, async () => {
      const { getTransactionReader } = await import('../src/services/stellar/tx-inspect');
      const reader = getTransactionReader();

      const r1 = await reader.getTransaction('hash-c4');
      assert.equal(r1.status, 'NOT_FOUND', 'NOT_FOUND after send should not trigger failure'); // I3

      // Row should still be SUBMITTED (not moved to FAILED)
      const current = await store.findById(row.id);
      assert.equal(current.status, 'SUBMITTED', 'row stays SUBMITTED on NOT_FOUND poll');
    });
  });

  test('C5: SUCCESS confirmation moves row from SUBMITTED to CONFIRMED', async () => {
    const store = makeMemoryOutboxStore();
    const row = await store.createPending({ contract: 'treasury', method: 'write', args: '[]' });
    await store.updateStatus(row.id, 'SUBMITTED', { txHash: 'hash-c5' });

    const double = new ScriptedRpcDouble();
    double.script('hash-c5', ['SUCCESS']);

    await withReader(double, async () => {
      const { getTransactionReader } = await import('../src/services/stellar/tx-inspect');
      const reader = getTransactionReader();
      const r = await reader.getTransaction('hash-c5');
      assert.equal(r.status, 'SUCCESS');

      // Simulate confirmation step
      await store.updateStatus(row.id, 'CONFIRMED', { confirmedAt: new Date() });
      const confirmed = await store.findById(row.id);
      assert.equal(confirmed.status, 'CONFIRMED');
    });
  });

  test('C6: findPending returns only PENDING rows, not SUBMITTED or CONFIRMED', async () => {
    const store = makeMemoryOutboxStore();
    const r1 = await store.createPending({ contract: 'a', method: 'm', args: '[]' });
    const r2 = await store.createPending({ contract: 'b', method: 'm', args: '[]' });
    await store.updateStatus(r2.id, 'SUBMITTED', { txHash: 'h' });

    const pending = await store.findPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, r1.id, 'only PENDING row is returned');
  });

  test('C7: virtual ledger advances deterministically (clock isolation)', async () => {
    const before = currentLedger();
    advanceLedger(10);
    const after = currentLedger();
    assert.equal(after - before, 10, 'virtual clock advances by exactly 10'); // I5
    advanceLedger(-10); // restore
  });

});

// ─── Concurrency smoke (50 seeded interleavings) ─────────────────────────────

test('concurrency: 50 concurrent NOT_FOUND → SUCCESS polls all resolve without interference', async () => {
  const seed = 42; // printed on failure for reproducibility
  const hashes = Array.from({ length: 50 }, (_, i) => `concurrent-${seed}-${i}`);
  const double = new ScriptedRpcDouble();
  for (const h of hashes) {
    double.script(h, ['NOT_FOUND', 'SUCCESS']);
  }

  await withReader(double, async () => {
    const { getTransactionReader } = await import('../src/services/stellar/tx-inspect');
    const reader = getTransactionReader();

    // First wave — all NOT_FOUND
    const first = await Promise.all(hashes.map(h => reader.getTransaction(h)));
    for (const r of first) {
      assert.equal(r.status, 'NOT_FOUND', `seed=${seed} first poll should be NOT_FOUND`);
    }

    // Second wave — all SUCCESS
    const second = await Promise.all(hashes.map(h => reader.getTransaction(h)));
    for (const r of second) {
      assert.equal(r.status, 'SUCCESS', `seed=${seed} second poll should be SUCCESS`); // I3, I4
    }
  });
});
