import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestEnv } from './helpers/env';
import { AppError } from '../src/middlewares/error.middleware';
import {
  CRON_JOBS,
  CRON_JOBS_BY_NAME,
  resolveJobExpression,
} from '../src/cron/jobs';
import {
  executeJobTick,
  getCronBufferStats,
  scheduleJob,
  scrubCronErrorMessage,
  setCronStoreForTest,
  stopAllScheduledJobs,
  type CronPersistenceStore,
  type CronRegistrationRecord,
  type CronRunRecord,
} from '../src/cron/registry';
import {
  computeExpectedSchedule,
  evaluateJobFreshness,
} from '../src/cron/freshness';

setupTestEnv();

function memoryCronStore(opts?: { failFinish?: boolean }) {
  const runs = new Map<string, CronRunRecord>();
  const history: Array<{ op: 'insert' | 'finish'; id: string; outcome: string }> = [];
  const registrations = new Map<string, CronRegistrationRecord>();
  let failFinish = opts?.failFinish ?? false;

  const store: CronPersistenceStore & {
    runs: Map<string, CronRunRecord>;
    history: typeof history;
    registrations: Map<string, CronRegistrationRecord>;
    setFailFinish(v: boolean): void;
  } = {
    runs,
    history,
    registrations,
    setFailFinish(v: boolean) {
      failFinish = v;
    },
    async insertRun(row) {
      runs.set(row.id, { ...row });
      history.push({ op: 'insert', id: row.id, outcome: row.outcome });
    },
    async finishRun(row) {
      if (failFinish) throw new Error('db unavailable');
      runs.set(row.id, { ...row });
      history.push({ op: 'finish', id: row.id, outcome: row.outcome });
    },
    async upsertRegistration(reg) {
      registrations.set(`${reg.instanceId}:${reg.job}`, { ...reg });
    },
  };
  return store;
}

test('no direct cron.schedule calls exist outside src/cron/registry.ts', () => {
  const cronDir = path.resolve(__dirname, '..', 'src', 'cron');
  for (const entry of fs.readdirSync(cronDir)) {
    if (!entry.endsWith('.ts') || entry === 'registry.ts') continue;
    const text = fs.readFileSync(path.join(cronDir, entry), 'utf8');
    assert.ok(!/\bcron\.schedule\s*\(/.test(text), `${entry} must use scheduleJob instead of cron.schedule`);
  }
});

test('every job in CRON_JOBS has a valid cron expression', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  for (const spec of CRON_JOBS) {
    const expr = resolveJobExpression(spec);
    const sched = computeExpectedSchedule(expr, spec.timezone, spec.graceFactor, now);
    assert.ok(sched, `Failed to parse schedule for ${spec.name} (${expr})`);
    assert.ok(sched!.periodMs > 0, `Period for ${spec.name} must be positive`);
  }
});

test('executeJobTick writes RUNNING at start and updates to SUCCESS with counters at finish', async () => {
  const store = memoryCronStore();
  setCronStoreForTest(store);
  try {
    const row = await executeJobTick('idempotency-purge', async ({ cycleId }) => {
      assert.ok(cycleId.startsWith('cyc_'));
      return { outcome: 'SUCCESS', counters: { deleted: 42 } };
    });

    assert.equal(row.outcome, 'SUCCESS');
    assert.deepEqual(row.counters, { deleted: 42 });
    assert.ok(typeof row.durationMs === 'number' && row.durationMs >= 0);
    assert.deepEqual(
      store.history.map((h) => `${h.op}:${h.outcome}`),
      ['insert:RUNNING', 'finish:SUCCESS'],
    );
  } finally {
    setCronStoreForTest(null);
  }
});

test('executeJobTick records SKIPPED_OVERLAP when a tick of the same job is already in flight', async () => {
  const store = memoryCronStore();
  setCronStoreForTest(store);
  try {
    let release!: () => void;
    let started!: () => void;
    const onStarted = new Promise<void>((r) => { started = r; });

    const first = executeJobTick('trader', async () => {
      started();
      await new Promise<void>((r) => { release = r; });
      return { outcome: 'SUCCESS' };
    });

    await onStarted;
    const overlap = await executeJobTick('trader', async () => ({ outcome: 'SUCCESS' }));
    assert.equal(overlap.outcome, 'SKIPPED_OVERLAP');
    assert.equal(overlap.durationMs, 0);

    release();
    const firstDone = await first;
    assert.equal(firstDone.outcome, 'SUCCESS');
  } finally {
    setCronStoreForTest(null);
  }
});

test('executeJobTick records SKIPPED_LOCK_HELD, SKIPPED_PAUSED, TIMEOUT, and scrubbed FAILURE', async () => {
  const store = memoryCronStore();
  setCronStoreForTest(store);
  try {
    const lockHeld = await executeJobTick('market-reconciler', async () => ({ outcome: 'SKIPPED_LOCK_HELD' }));
    assert.equal(lockHeld.outcome, 'SKIPPED_LOCK_HELD');

    const paused = await executeJobTick('trader', async () => ({ outcome: 'SKIPPED_PAUSED' }));
    assert.equal(paused.outcome, 'SKIPPED_PAUSED');

    const timedOut = await executeJobTick(
      'calibration',
      async () => {
        await new Promise((r) => setTimeout(r, 120));
      },
      { timeoutMs: 25 },
    );
    assert.equal(timedOut.outcome, 'TIMEOUT');
    assert.equal(timedOut.errorClass, 'UPSTREAM_TIMEOUT');

    const failed = await executeJobTick('ingestion', async () => {
      throw new AppError(
        502,
        'RPC_DOWN',
        'Failed with Bearer eyJhbGciOiJIUzI1NiJ9.secret and password=supersecret and sk-ant-api03-1234567890abcdef',
      );
    });
    assert.equal(failed.outcome, 'FAILURE');
    assert.equal(failed.errorClass, 'RPC_DOWN');
    assert.ok(failed.errorMessage);
    assert.ok(!failed.errorMessage!.includes('eyJhbGciOiJIUzI1NiJ9'));
    assert.ok(!failed.errorMessage!.includes('supersecret'));
    assert.ok(!failed.errorMessage!.includes('1234567890abcdef'));
  } finally {
    setCronStoreForTest(null);
  }
});

test('bounded in-memory buffer queues failed writes, tracks overflow drops, and flushes on recovery', async () => {
  const store = memoryCronStore({ failFinish: true });
  setCronStoreForTest(store);
  try {
    for (let i = 0; i < 505; i++) {
      await executeJobTick('saga-resume', async () => ({ outcome: 'SUCCESS', counters: { i } }));
    }
    const statsDuringOutage = getCronBufferStats();
    assert.equal(statsDuringOutage.buffered, 500);
    assert.equal(statsDuringOutage.dropped, 5);

    // Recover DB and run one more tick -> flushes all 500 buffered rows
    store.setFailFinish(false);
    await executeJobTick('saga-resume', async () => ({ outcome: 'SUCCESS', counters: { final: 1 } }));

    const statsAfterRecovery = getCronBufferStats();
    assert.equal(statsAfterRecovery.buffered, 0);
    assert.equal(statsAfterRecovery.dropped, 5);
  } finally {
    setCronStoreForTest(null);
  }
});

test('scheduleJob records SKIPPED_DISABLED and upserts registration when disabled by config', async () => {
  const { config } = await import('../src/config');
  const prev = config.RECONCILE_ENABLED;
  (config as Record<string, unknown>).RECONCILE_ENABLED = false;
  const store = memoryCronStore();
  setCronStoreForTest(store);
  try {
    scheduleJob('market-reconciler', async () => ({ outcome: 'SUCCESS' }));
    // Allow best-effort async persistence to settle
    await new Promise((r) => setTimeout(r, 15));

    const runs = [...store.runs.values()];
    assert.equal(runs.length, 1);
    assert.equal(runs[0].job, 'market-reconciler');
    assert.equal(runs[0].outcome, 'SKIPPED_DISABLED');

    const regs = [...store.registrations.values()];
    assert.equal(regs.length, 1);
    assert.equal(regs[0].job, 'market-reconciler');
    assert.equal(regs[0].enabled, false);
  } finally {
    stopAllScheduledJobs();
    setCronStoreForTest(null);
    (config as Record<string, unknown>).RECONCILE_ENABLED = prev;
  }
});

test('evaluateJobFreshness detects OVERDUE, NOT_SCHEDULED, FAILING, DISABLED and OK', () => {
  const spec = CRON_JOBS_BY_NAME['market-reconciler']; // '3,13,23,33,43,53 * * * *', period = 10m, graceFactor = 2
  const now = new Date('2026-11-19T12:25:00.000Z'); // prev = 12:23, prevPrev = 12:13, period = 10m, deadline = 12:03

  const ok = evaluateJobFreshness({
    spec,
    expression: spec.expression!,
    enabled: true,
    lastRun: { startedAt: '2026-11-19T12:23:01.000Z', finishedAt: '2026-11-19T12:23:05.000Z', outcome: 'SKIPPED_LOCK_HELD' },
    lastSuccess: { startedAt: '2026-11-19T12:13:01.000Z', finishedAt: '2026-11-19T12:13:04.000Z', outcome: 'SUCCESS' },
    lastFailure: null,
    consecutiveFailures: 0,
    activeInstances: ['inst-1', 'inst-2'],
    now,
  });
  assert.equal(ok.overdue, false);
  assert.equal(ok.state, 'OK');
  assert.equal(ok.expected.periodMs, 10 * 60_000);

  const overdue = evaluateJobFreshness({
    spec,
    expression: spec.expression!,
    enabled: true,
    lastRun: { startedAt: '2026-11-19T12:23:01.000Z', finishedAt: '2026-11-19T12:23:02.000Z', outcome: 'SKIPPED_LOCK_HELD' },
    lastSuccess: { startedAt: '2026-11-19T11:50:00.000Z', finishedAt: '2026-11-19T11:50:05.000Z', outcome: 'SUCCESS' },
    lastFailure: null,
    consecutiveFailures: 0,
    activeInstances: ['inst-1'],
    now,
  });
  assert.equal(overdue.overdue, true);
  assert.equal(overdue.state, 'OVERDUE');

  const notScheduled = evaluateJobFreshness({
    spec,
    expression: spec.expression!,
    enabled: true,
    lastRun: null,
    lastSuccess: null,
    lastFailure: null,
    consecutiveFailures: 0,
    activeInstances: [],
    now,
  });
  assert.equal(notScheduled.overdue, false);
  assert.equal(notScheduled.state, 'NOT_SCHEDULED');

  const disabled = evaluateJobFreshness({
    spec,
    expression: spec.expression!,
    enabled: false,
    lastRun: null,
    lastSuccess: null,
    lastFailure: null,
    consecutiveFailures: 0,
    activeInstances: [],
    now,
  });
  assert.equal(disabled.state, 'DISABLED');
});

test('scrubCronErrorMessage truncates to 500 chars and strips secrets', () => {
  const msg = scrubCronErrorMessage(new Error(`postgres://admin:topSecret123@db.internal:5432/app ${'x'.repeat(600)}`));
  assert.ok(!msg.includes('topSecret123'));
  assert.ok(msg.includes('postgres://[REDACTED]@db.internal:5432/app'));
  assert.equal(msg.length, 500);
});
