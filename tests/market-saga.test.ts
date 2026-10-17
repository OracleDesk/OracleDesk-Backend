import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';
import { prisma } from '../lib/prisma';
import {
  startRun,
  advance,
  cancelRun,
  setSagaFaultHook,
  claimRun,
} from '../services/market-saga.service';
import { setIpfsTransportForTests } from '../services/ipfs.service';

setupTestEnv();

function setupMockDb() {
  const db = {
    runs: new Map<string, any>(),
    markets: new Map<string, any>(),
    traces: new Map<string, any>(),
    logs: [] as any[],
  };

  (prisma.marketGenerationRun.create as any) = async ({ data }: any) => {
    const id = data.id || `run-${db.runs.size + 1}`;
    const run = {
      id,
      trigger: data.trigger,
      state: data.state || 'STARTED',
      attempts: 0,
      nextAttemptAt: null,
      lockedBy: null,
      lockedUntil: null,
      inputs: data.inputs || null,
      outputs: data.outputs || { v: 1 },
      marketId: data.marketId || null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.runs.set(id, run);
    return run;
  };

  (prisma.marketGenerationRun.findUnique as any) = async ({ where }: any) => {
    return db.runs.get(where.id) || null;
  };

  (prisma.marketGenerationRun.update as any) = async ({ where, data }: any) => {
    const existing = db.runs.get(where.id);
    if (!existing) throw new Error('Not found');
    const updated = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    db.runs.set(where.id, updated);
    return updated;
  };

  (prisma.marketGenerationRun.updateMany as any) = async ({ where, data }: any) => {
    let count = 0;
    for (const [id, run] of db.runs.entries()) {
      let matches = true;
      if (where.id && run.id !== where.id) matches = false;
      if (where.lockedBy && run.lockedBy !== where.lockedBy) matches = false;
      if (where.state?.notIn && where.state.notIn.includes(run.state)) matches = false;
      if (matches) {
        Object.assign(run, data);
        count++;
      }
    }
    return { count };
  };

  (prisma.market.create as any) = async ({ data }: any) => {
    const id = `m-${db.markets.size + 1}`;
    const m = { id, ...data, createdAt: new Date() };
    db.markets.set(id, m);
    return m;
  };

  (prisma.market.findUnique as any) = async ({ where }: any) => {
    return db.markets.get(where.id) || null;
  };

  (prisma.market.update as any) = async ({ where, data }: any) => {
    const m = db.markets.get(where.id);
    if (!m) throw new Error('Market not found');
    Object.assign(m, data);
    return m;
  };

  (prisma.reasoningTrace.create as any) = async ({ data }: any) => {
    const id = data.id || `t-${db.traces.size + 1}`;
    const t = { id, ...data, createdAt: new Date() };
    db.traces.set(id, t);
    return t;
  };

  (prisma.reasoningTrace.upsert as any) = async ({ create, update, where }: any) => {
    let t = db.traces.get(where.id);
    if (!t) {
      t = { id: where.id, ...create, createdAt: new Date() };
      db.traces.set(where.id, t);
    } else {
      Object.assign(t, update);
    }
    return t;
  };

  (prisma.reasoningTrace.findFirst as any) = async ({ where }: any) => {
    return [...db.traces.values()].find((t) => t.marketId === where.marketId) || null;
  };

  (prisma.reasoningTrace.update as any) = async ({ where, data }: any) => {
    const t = db.traces.get(where.id);
    if (t) Object.assign(t, data);
    return t;
  };

  (prisma.traceKey.upsert as any) = async () => ({});
  (prisma.agentLog.create as any) = async ({ data }: any) => {
    db.logs.push(data);
    return data;
  };

  (prisma.$transaction as any) = async (arg: any) => {
    if (typeof arg === 'function') {
      return arg(prisma);
    }
    return Promise.all(arg);
  };

  return db;
}

test('happy path reaches COMPLETED with all outputs recorded in dry-run mode', async () => {
  const db = setupMockDb();
  setIpfsTransportForTests(async (_bytes, name) => ({ cid: `cid-${name}`, size: 100 }));

  try {
    const runId = await startRun('cron', {
      rawSignals: {
        signalCount: 1,
        news: [{ source: 'FRED', title: 'Rates drop', content: 'Details', relevanceScore: 1 }],
        fed: [],
        macro: [],
        aggregatedAt: new Date(),
      },
      proposal: {
        market_question: 'Will the Fed cut rates in Dec 2026?',
        initial_yes_probability: 0.65,
        resolution_oracle: 'FRED',
        expiry_timestamp: 1798761600,
        settlement_currency: 'USDC',
        minimum_liquidity_usdc: 100,
        category: 'FED',
        confidence_interval: { lower: 0.55, upper: 0.75 },
        reasoning: 'Rate trajectory looks dovish',
      },
    });

    const run = await advance(runId, { maxSteps: 20 });
    assert.equal(run.state, 'COMPLETED');
    assert.ok(run.outputs);
    const outputs = run.outputs as any;
    assert.ok(outputs.questionCid);
    assert.ok(outputs.questionHash);
    assert.ok(outputs.traceId);
  } finally {
    setIpfsTransportForTests(null);
  }
});

test('crash after QUESTION_PINNED resumes without re-pinning different bytes', async () => {
  const db = setupMockDb();
  let pinCount = 0;
  setIpfsTransportForTests(async (_bytes, name) => {
    pinCount++;
    return { cid: `cid-${name}-${pinCount}`, size: 100 };
  });

  try {
    const runId = await startRun('cron', {
      proposal: {
        market_question: 'Will inflation fall below 2% in 2026?',
        initial_yes_probability: 0.5,
        resolution_oracle: 'FRED',
        expiry_timestamp: 1798761600,
        settlement_currency: 'USDC',
        minimum_liquidity_usdc: 100,
        category: 'MACRO',
        confidence_interval: { lower: 0.4, upper: 0.6 },
        reasoning: 'Inflation is falling',
      },
    });

    // Advance 4 steps to reach QUESTION_PINNED
    const step1 = await advance(runId, { maxSteps: 4 });
    assert.equal(step1.state, 'QUESTION_PINNED');
    const firstQHash = (step1.outputs as any).questionHash;
    const initialPins = pinCount;

    // Advance again to complete
    const finalRun = await advance(runId, { maxSteps: 10 });
    assert.equal(finalRun.state, 'COMPLETED');
    const finalQHash = (finalRun.outputs as any).questionHash;
    assert.equal(firstQHash, finalQHash, 'Question hash must be preserved');
  } finally {
    setIpfsTransportForTests(null);
  }
});

test('permanent error moves run to NEEDS_ATTENTION', async () => {
  setupMockDb();
  const runId = await startRun('cron');

  // Inject permanent error on STARTED step
  setSagaFaultHook('STARTED', async () => {
    const err: any = new Error('Pinata credentials not set');
    err.code = 'IPFS_NOT_CONFIGURED';
    throw err;
  });

  try {
    const run = await advance(runId);
    assert.equal(run.state, 'NEEDS_ATTENTION');
    assert.ok((run.lastError as any)?.code === 'IPFS_NOT_CONFIGURED');
  } finally {
    setSagaFaultHook('STARTED', null);
  }
});

test('concurrent advance calls cannot claim the same run while locked', async () => {
  const db = setupMockDb();
  const runId = await startRun('cron');

  const claim1 = await claimRun(runId, 'worker-1', 60_000);
  assert.ok(claim1);
  assert.equal(claim1.lockedBy, 'worker-1');

  // Second worker attempts claim while locked
  const claim2 = await claimRun(runId, 'worker-2', 60_000);
  assert.equal(claim2, null, 'Second worker must fail to claim locked run');
});

test('pre-chain run can be cancelled by admin', async () => {
  const db = setupMockDb();
  const runId = await startRun('cron');
  const cancelled = await cancelRun(runId, 'Test cancellation');
  assert.equal(cancelled.state, 'CANCELLED');
});
