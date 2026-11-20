import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

// #242 — saga engine semantics against an in-memory MarketGenerationRun table:
// fencing, lease handling, legacy-state mapping, cancel/retry rules. Steps
// that only touch run state (TRACE_ENQUEUED → COMPLETED) are used so no
// LLM, chain or IPFS dependency is exercised here.

type Row = Record<string, any>;

async function installFakeRuns() {
  const { prisma } = await import('../src/lib/prisma');
  const rows = new Map<string, Row>();
  let seq = 0;

  const matches = (row: Row, where: any = {}): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (k === 'OR') {
        if (!(v as any[]).some((w) => matches(row, w))) return false;
      } else if (k === 'AND') {
        if (!(v as any[]).every((w) => matches(row, w))) return false;
      } else if (v && typeof v === 'object' && !(v instanceof Date)) {
        const cond = v as any;
        if ('notIn' in cond && cond.notIn.includes(row[k])) return false;
        if ('lt' in cond && !(row[k] instanceof Date && row[k] < cond.lt)) return false;
        if ('lte' in cond && !(row[k] instanceof Date && row[k] <= cond.lte)) return false;
      } else if (row[k] !== v) {
        return false;
      }
    }
    return true;
  };

  const apply = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (v && typeof v === 'object' && 'increment' in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
      else if (v && typeof v === 'object' && (v as any).constructor?.name?.includes('Null')) row[k] = null;
      else row[k] = v;
    }
    row.updatedAt = new Date();
  };

  const runs: any = prisma.marketGenerationRun;
  runs.create = async ({ data }: any) => {
    const row: Row = {
      id: `run-${++seq}`,
      state: 'STARTED',
      attempts: 0,
      nextAttemptAt: null,
      lockedBy: null,
      lockedUntil: null,
      fence: 0,
      cycleId: null,
      inputs: null,
      outputs: {},
      marketId: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };
    rows.set(row.id, row);
    return { ...row };
  };
  runs.findUnique = async ({ where }: any) => (rows.has(where.id) ? { ...rows.get(where.id)! } : null);
  runs.update = async ({ where, data }: any) => {
    const row = rows.get(where.id);
    if (!row) throw new Error('not found');
    apply(row, data);
    return { ...row };
  };
  runs.updateMany = async ({ where, data }: any) => {
    let count = 0;
    for (const row of rows.values()) {
      if (matches(row, where)) {
        apply(row, data);
        count++;
      }
    }
    return { count };
  };
  return { rows };
}

test('legacy TRACE_PINNED run resumes into TRACE_ENQUEUED and completes', async () => {
  const { rows } = await installFakeRuns();
  const saga = await import('../src/services/market-saga.service');
  const id = await saga.startRun('admin');
  rows.get(id)!.state = 'TRACE_PINNED';

  const run = await saga.advance(id);
  assert.equal(run.state, 'COMPLETED');
  assert.equal(saga.normalizeState('TRACE_PUBLISHED'), 'TRACE_ENQUEUED');
  assert.equal(saga.normalizeState('QUESTION_PINNED'), 'CHAIN_SUBMITTED');
  // The lease is released afterwards.
  assert.equal(rows.get(id)!.lockedBy, null);
});

test('claimRun increments the fence and refuses a live lease', async () => {
  const { rows } = await installFakeRuns();
  const saga = await import('../src/services/market-saga.service');
  const id = await saga.startRun('cron');

  const a = await saga.claimRun(id, 'worker-a');
  assert.equal(a?.fence, 1);
  assert.equal(await saga.claimRun(id, 'worker-b'), null, 'lease still held');

  rows.get(id)!.lockedUntil = new Date(Date.now() - 1);
  const b = await saga.claimRun(id, 'worker-b');
  assert.equal(b?.fence, 2);
  assert.equal(b?.lockedBy, 'worker-b');
});

test('stale fence: a worker whose lease was taken over cannot write its step result', async () => {
  const { rows } = await installFakeRuns();
  const saga = await import('../src/services/market-saga.service');
  const id = await saga.startRun('cron');
  rows.get(id)!.state = 'TRACE_ENQUEUED';

  saga.setSagaFaultHook('TRACE_ENQUEUED', async () => {
    // Simulate an expired lease re-claimed by another instance mid-step.
    rows.get(id)!.lockedUntil = new Date(Date.now() - 1);
    await saga.claimRun(id, 'usurper');
  });
  try {
    await saga.advance(id, { workerId: 'original' });
  } finally {
    saga.setSagaFaultHook('TRACE_ENQUEUED', null);
  }
  const row = rows.get(id)!;
  assert.equal(row.state, 'TRACE_ENQUEUED', 'the stale worker must not advance the run');
  assert.equal(row.lockedBy, 'usurper', 'the new owner keeps its lease');
});

test('a failing step records lastError and backs off; SAGA_MAX_ATTEMPTS parks it in NEEDS_ATTENTION', async () => {
  const { rows } = await installFakeRuns();
  const saga = await import('../src/services/market-saga.service');
  const { config } = await import('../src/config');
  const id = await saga.startRun('cron');
  rows.get(id)!.state = 'TRACE_ENQUEUED';

  saga.setSagaFaultHook('TRACE_ENQUEUED', async () => {
    throw Object.assign(new Error('transient'), { code: 'RPC_DOWN' });
  });
  try {
    let run = await saga.advance(id);
    assert.equal(run.state, 'TRACE_ENQUEUED');
    assert.equal(run.attempts, 1);
    assert.ok(run.nextAttemptAt instanceof Date);
    assert.deepEqual((run.lastError as any).step, 'TRACE_ENQUEUED');

    rows.get(id)!.attempts = config.SAGA_MAX_ATTEMPTS - 1;
    run = await saga.advance(id);
    assert.equal(run.state, 'NEEDS_ATTENTION');

    // Retry resets it to the failed step.
    const retried = await saga.retryRun(id);
    assert.equal(retried.state, 'TRACE_ENQUEUED');
    assert.equal(retried.attempts, 0);
  } finally {
    saga.setSagaFaultHook('TRACE_ENQUEUED', null);
  }
  const run = await saga.advance(id);
  assert.equal(run.state, 'COMPLETED');
});

test('retry refuses runs that are not NEEDS_ATTENTION', async () => {
  await installFakeRuns();
  const saga = await import('../src/services/market-saga.service');
  const id = await saga.startRun('cron');
  await assert.rejects(() => saga.retryRun(id), /NEEDS_ATTENTION/);
});

test('cancel before anything is pinned succeeds; after the market step it is refused', async () => {
  const { rows } = await installFakeRuns();
  const { prisma } = await import('../src/lib/prisma');
  (prisma as any).$transaction = async (fn: any) => fn(prisma);
  const saga = await import('../src/services/market-saga.service');

  const early = await saga.startRun('admin');
  rows.get(early)!.state = 'SIGNALS_READY';
  const cancelled = await saga.cancelRun(early);
  assert.equal(cancelled.state, 'CANCELLED');

  const late = await saga.startRun('admin');
  rows.get(late)!.state = 'CHAIN_SUBMITTED';
  await assert.rejects(() => saga.cancelRun(late), /CANNOT_CANCEL_AFTER_PIN|pinned or submitted/);

  const parked = await saga.startRun('admin');
  Object.assign(rows.get(parked)!, { state: 'NEEDS_ATTENTION', lastError: { step: 'MARKET_PERSISTED' } });
  await assert.rejects(() => saga.cancelRun(parked), /pinned or submitted/);
});

test('jsonSafe stores bigints as strings and redactRun reduces the proposal to its question', async () => {
  const saga = await import('../src/services/market-saga.service');
  assert.deepEqual(saga.jsonSafe({ seedRaw: 12n, nested: { x: 1n } }), { seedRaw: '12', nested: { x: '1' } });
  const redacted = saga.redactRun({
    id: 'r',
    outputs: { proposal: { market_question: 'Will X?', initial_yes_probability: 0.4 }, tracePayload: { big: true }, gate: 1 },
  } as any);
  assert.deepEqual(redacted.outputs, { gate: 1, question: 'Will X?' });
});
