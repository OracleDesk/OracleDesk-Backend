import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export type CronOutcome = 'success' | 'failure';

export type CronRunOutcome =
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILURE'
  | 'SKIPPED_OVERLAP'
  | 'SKIPPED_LOCK_HELD'
  | 'SKIPPED_DISABLED'
  | 'SKIPPED_PAUSED'
  | 'TIMEOUT'
  | 'ABORTED_SHUTDOWN';

export const CRON_RUN_OUTCOMES: readonly CronRunOutcome[] = [
  'RUNNING',
  'SUCCESS',
  'FAILURE',
  'SKIPPED_OVERLAP',
  'SKIPPED_LOCK_HELD',
  'SKIPPED_DISABLED',
  'SKIPPED_PAUSED',
  'TIMEOUT',
  'ABORTED_SHUTDOWN',
];

export interface JobResult {
  outcome?: 'SUCCESS' | 'SKIPPED_LOCK_HELD' | 'SKIPPED_PAUSED';
  counters?: Record<string, number>;
}

export interface ScheduleJobOptions {
  timeoutMs?: number;
}

export interface CronRunRecord {
  id: string;
  job: string;
  instanceId: string;
  cycleId: string;
  scheduledAt: Date;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: CronRunOutcome;
  errorClass: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  counters: Record<string, number> | null;
}

export interface CronRegistrationRecord {
  instanceId: string;
  job: string;
  expression: string;
  timezone: string;
  enabled: boolean;
  heartbeatAt: Date;
}

export interface CronPersistenceStore {
  insertRun(row: CronRunRecord): Promise<void>;
  finishRun(row: CronRunRecord, inserted: boolean): Promise<void>;
  upsertRegistration(reg: CronRegistrationRecord): Promise<void>;
}

interface LegacyCronRun {
  startedAt: string;
  finishedAt: string;
  error?: string;
}

const DB_WRITE_TIMEOUT_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const MAX_BUFFER_SIZE = 500;
const MAX_ERROR_MESSAGE_LEN = 500;
const PURGE_BATCH_SIZE = 5_000;
const PURGE_KEEP_LATEST_PER_JOB = 50;
const REGISTRATION_STALE_MS = 24 * 60 * 60_000;

const lastRuns = new Map<string, { lastSuccess?: LegacyCronRun; lastFailure?: LegacyCronRun }>();
const runningJobs = new Map<JobName, string>();
const scheduledTasks: ScheduledTask[] = [];
const registeredJobs = new Map<JobName, { expression: string; timezone: string; enabled: boolean }>();
const pendingBuffer: CronRunRecord[] = [];
let droppedCount = 0;
let heartbeatTimer: NodeJS.Timeout | null = null;
let storeOverride: CronPersistenceStore | null = null;

// ─── Prisma Store Adapter ───────────────────────────────────────────────────

interface CronPrismaClient {
  cronRun: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    upsert(args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  cronRegistration: {
    upsert(args: {
      where: { instanceId_job: { instanceId: string; job: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

function cronPrisma(): CronPrismaClient {
  return prisma as unknown as CronPrismaClient;
}

function toPrismaRunData(row: CronRunRecord): Record<string, unknown> {
  return {
    id: row.id,
    job: row.job,
    instanceId: row.instanceId,
    cycleId: row.cycleId,
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    outcome: row.outcome,
    errorClass: row.errorClass,
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
    counters: row.counters ?? undefined,
  };
}

const defaultStore: CronPersistenceStore = {
  async insertRun(row) {
    await cronPrisma().cronRun.create({ data: toPrismaRunData(row) });
  },
  async finishRun(row, inserted) {
    const data = toPrismaRunData(row);
    if (inserted) {
      await cronPrisma().cronRun.update({
        where: { id: row.id },
        data: {
          finishedAt: row.finishedAt,
          outcome: row.outcome,
          errorClass: row.errorClass,
          errorMessage: row.errorMessage,
          durationMs: row.durationMs,
          counters: row.counters ?? undefined,
        },
      });
    } else {
      await cronPrisma().cronRun.upsert({
        where: { id: row.id },
        create: data,
        update: {
          finishedAt: row.finishedAt,
          outcome: row.outcome,
          errorClass: row.errorClass,
          errorMessage: row.errorMessage,
          durationMs: row.durationMs,
          counters: row.counters ?? undefined,
        },
      });
    }
  },
  async upsertRegistration(reg) {
    await cronPrisma().cronRegistration.upsert({
      where: { instanceId_job: { instanceId: reg.instanceId, job: reg.job } },
      create: { ...reg },
      update: {
        expression: reg.expression,
        timezone: reg.timezone,
        enabled: reg.enabled,
        heartbeatAt: reg.heartbeatAt,
      },
    });
  },
};

function activeStore(): CronPersistenceStore {
  return storeOverride ?? defaultStore;
}

/** Test seam: replace persistence store and reset buffer state. */
export function setCronStoreForTest(store: CronPersistenceStore | null): void {
  storeOverride = store;
  pendingBuffer.length = 0;
  droppedCount = 0;
  runningJobs.clear();
  registeredJobs.clear();
}

// ─── Error Classification & Scrubbing ───────────────────────────────────────

export function classifyCronError(err: unknown): string {
  if (err instanceof AppError && err.code) return err.code;
  if (err instanceof Error && err.name) return err.name;
  return 'Unknown';
}

/**
 * Scrubs secret-like tokens (Bearer headers, API keys, Stellar S-seeds,
 * URL passwords, secret query/kv pairs) and truncates to 500 characters.
 */
export function scrubCronErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const scrubbed = raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(https?|postgres(?:ql)?|redis(?:s)?):\/\/[^:@/\s]+:[^@/\s]+@/gi, '$1://[REDACTED]@')
    .replace(/\bS[A-Z2-7]{55}\b/g, '[REDACTED_SECRET]')
    .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
    .replace(/\b(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;'"&]+/gi, '$1=[REDACTED]')
    .replace(/\b[0-9a-f]{40,}\b/gi, '[REDACTED_HEX]');
  if (scrubbed.length <= MAX_ERROR_MESSAGE_LEN) return scrubbed;
  return `${scrubbed.slice(0, MAX_ERROR_MESSAGE_LEN - 1)}…`;
}

// ─── Best-Effort Persistence + Bounded Buffer ───────────────────────────────

async function withWriteTimeout<T>(fn: () => Promise<T>, ms = DB_WRITE_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('cron_db_write_timeout')), ms);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function enqueueBuffered(row: CronRunRecord): void {
  if (pendingBuffer.length >= MAX_BUFFER_SIZE) {
    pendingBuffer.shift();
    droppedCount++;
  }
  pendingBuffer.push(row);
}

async function flushBuffered(): Promise<void> {
  while (pendingBuffer.length > 0) {
    const head = pendingBuffer[0];
    try {
      await withWriteTimeout(() => activeStore().finishRun(head, false));
      pendingBuffer.shift();
    } catch {
      break;
    }
  }
}

async function persistStart(row: CronRunRecord): Promise<boolean> {
  try {
    await withWriteTimeout(() => activeStore().insertRun(row));
    return true;
  } catch (err) {
    logger.debug({ job: row.job, err: err instanceof Error ? err.message : err }, 'cron: failed to insert RUNNING row');
    return false;
  }
}

/**
 * Records a cron run: in memory per instance (#111), and in cron_runs so the
 * failure streak is cluster-wide (#226). The database write is fire-and-forget:
 * a cron job never fails or waits because its bookkeeping could not be saved.
 */
export function recordCronRun(job: string, outcome: CronOutcome, startedAt: Date, finishedAt: Date, error?: unknown): void {
  const entry = lastRuns.get(job) ?? {};
  const run: LegacyCronRun = { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() };
  if (outcome === 'success') {
    entry.lastSuccess = run;
  } else {
    run.error = scrubCronErrorMessage(error);
    entry.lastFailure = run;
  }
  lastRuns.set(job, entry);
  void persistCronRun(job, outcome, finishedAt, run.error).catch((err) =>
    logger.warn({ err, job }, 'cron_runs write failed'));
}

const MAX_ERROR_CHARS = 500;

/** Upsert into cron_runs; the streak increments atomically across instances. */
export async function persistCronRun(job: string, outcome: CronOutcome, at: Date, error?: string): Promise<void> {
  if (outcome === 'success') {
    await prisma.cronRunStatus.upsert({
      where: { job },
      create: { job, lastSuccessAt: at, failureStreak: 0 },
      update: { lastSuccessAt: at, failureStreak: 0 },
    });
    return;
  }
  const lastError = (error ?? 'error').slice(0, MAX_ERROR_CHARS);
  await prisma.cronRunStatus.upsert({
    where: { job },
    create: { job, lastFailureAt: at, failureStreak: 1, lastError },
    update: { lastFailureAt: at, failureStreak: { increment: 1 }, lastError },
  });
}

export function getCronStatus(): Record<string, { lastSuccess?: LegacyCronRun; lastFailure?: LegacyCronRun }> {
  return Object.fromEntries(lastRuns);
}

export function getCronBufferStats(): { buffered: number; dropped: number } {
  return { buffered: pendingBuffer.length, dropped: droppedCount };
}

export function getRunningCycleIdForJob(job: JobName): string | null {
  return runningJobs.get(job) ?? null;
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

/**
 * Executes a single tick of a scheduled job: enters correlated context,
 * enforces the per-job overlap guard, writes RUNNING/finished rows best-effort,
 * enforces timeout and shutdown signals, and updates the in-memory fallback.
 */
export async function executeJobTick(
  name: JobName,
  fn: (ctx: { signal: AbortSignal; cycleId: string }) => Promise<JobResult | void>,
  opts?: ScheduleJobOptions,
  scheduledAt: Date = new Date(),
): Promise<CronRunRecord> {
  const cycleId = newId('cyc');
  return runWithContext({ requestId: cycleId, cycleId, kind: 'cron', job: name }, async () => {
    const startedAt = new Date();
    const id = crypto.randomUUID();

    if (runningJobs.has(name)) {
      logger.warn({ skippedJob: name, runningCycleId: runningJobs.get(name) }, `Cron ${name}: previous tick still running — skipping`);
      const skippedRow: CronRunRecord = {
        id,
        job: name,
        instanceId: config.INSTANCE_ID,
        cycleId,
        scheduledAt,
        startedAt,
        finishedAt: startedAt,
        outcome: 'SKIPPED_OVERLAP',
        errorClass: null,
        errorMessage: null,
        durationMs: 0,
        counters: null,
      };
      await persistFinish(skippedRow, false);
      return skippedRow;
    }

    runningJobs.set(name, cycleId);
    const startRow: CronRunRecord = {
      id,
      job: name,
      instanceId: config.INSTANCE_ID,
      cycleId,
      scheduledAt,
      startedAt,
      finishedAt: null,
      outcome: 'RUNNING',
      errorClass: null,
      errorMessage: null,
      durationMs: null,
      counters: null,
    };

    const inserted = await persistStart(startRow);
    const handle = opts?.timeoutMs !== undefined
      ? deadline('rpc-write', shutdownController.signal, opts.timeoutMs)
      : null;
    const signal = handle ? handle.signal : shutdownController.signal;

    let outcome: CronRunOutcome = 'SUCCESS';
    let errorClass: string | null = null;
    let errorMessage: string | null = null;
    let counters: Record<string, number> | null = null;

    try {
      signal.throwIfAborted();
      let res: JobResult | void;
      if (handle) {
        let onAbort: (() => void) | undefined;
        const abortPromise = new Promise<never>((_, reject) => {
          onAbort = () => reject(signal.reason ?? new TimeoutError('rpc-write', handle.ms));
          signal.addEventListener('abort', onAbort, { once: true });
        });
        try {
          res = await Promise.race([fn({ signal, cycleId }), abortPromise]);
        } finally {
          if (onAbort) signal.removeEventListener('abort', onAbort);
        }
      } else {
        res = await fn({ signal, cycleId });
      }
      if (res && typeof res === 'object') {
        if (res.outcome) outcome = res.outcome;
        if (res.counters && Object.keys(res.counters).length > 0) counters = res.counters;
      }
    } catch (err) {
      if (shutdownController.signal.aborted) {
        outcome = 'ABORTED_SHUTDOWN';
      } else if (err instanceof TimeoutError || (handle?.signal.aborted && handle.signal.reason instanceof TimeoutError)) {
        outcome = 'TIMEOUT';
      } else {
        outcome = 'FAILURE';
      }
      errorClass = classifyCronError(err);
      errorMessage = scrubCronErrorMessage(err);
      logger.error({ err, job: name, outcome, errorClass }, `Cron ${name}: tick failed`);
    } finally {
      handle?.cleanup?.();
      runningJobs.delete(name);
    }

    const finishedAt = new Date();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    const finishedRow: CronRunRecord = {
      ...startRow,
      finishedAt,
      outcome,
      errorClass,
      errorMessage,
      durationMs,
      counters,
    };

    if (outcome === 'SUCCESS') {
      recordCronRun(name, 'success', startedAt, finishedAt);
    } else if (outcome === 'FAILURE' || outcome === 'TIMEOUT') {
      recordCronRun(name, 'failure', startedAt, finishedAt, errorMessage ?? errorClass ?? 'failure');
    }

    await persistFinish(finishedRow, inserted);
    return finishedRow;
  });
}

/**
 * Registers and schedules a cron job from the static `CRON_JOBS` table.
 * No module should call `node-cron`'s `cron.schedule` directly.
 */
export function scheduleJob(
  name: JobName,
  fn: (ctx: { signal: AbortSignal; cycleId: string }) => Promise<JobResult | void>,
  opts?: ScheduleJobOptions,
): void {
  const spec = CRON_JOBS_BY_NAME[name];
  const expression = resolveJobExpression(spec);
  const timezone = spec.timezone || 'Etc/UTC';
  const enabled = resolveJobEnabled(spec);

  registeredJobs.set(name, { expression, timezone, enabled });
  void persistRegistration(name, expression, timezone, enabled);
  ensureHeartbeatLoop();

  if (!enabled) {
    const now = new Date();
    const disabledRow: CronRunRecord = {
      id: crypto.randomUUID(),
      job: name,
      instanceId: config.INSTANCE_ID,
      cycleId: newId('cyc'),
      scheduledAt: now,
      startedAt: now,
      finishedAt: now,
      outcome: 'SKIPPED_DISABLED',
      errorClass: null,
      errorMessage: null,
      durationMs: 0,
      counters: null,
    };
    void persistFinish(disabledRow, false);
    logger.info({ job: name, enabledBy: spec.enabledBy }, `Cron ${name} is disabled by config`);
    return;
  }

  const task = cron.schedule(
    expression,
    () => {
      void executeJobTick(name, fn, opts, new Date());
    },
    { timezone },
  );
  scheduledTasks.push(task);
  logger.info({ job: name, expression, timezone }, `Cron ${name} scheduled`);
}

/** Stops all scheduled cron tasks and the registration heartbeat loop. */
export function stopAllScheduledJobs(): void {
  while (scheduledTasks.length > 0) {
    const task = scheduledTasks.pop();
    try {
      task?.stop();
    } catch {}
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── Retention Purge (#336) ─────────────────────────────────────────────────

/**
 * Deletes cron_runs older than CRON_RUNS_RETENTION_DAYS in batches of 5 000,
 * always keeping the latest 50 rows per job, and deletes stale registrations
 * that have not heartbeated in 24 hours.
 */
export async function purgeCronRuns(now: Date = new Date()): Promise<{ deletedRuns: number; deletedRegistrations: number }> {
  const cutoff = new Date(now.getTime() - config.CRON_RUNS_RETENTION_DAYS * 24 * 60 * 60_000);
  const regCutoff = new Date(now.getTime() - REGISTRATION_STALE_MS);

  let deletedRuns = 0;
  for (let batch = 0; batch < 100; batch++) {
    const count = await prisma.$executeRaw`
      WITH doomed AS (
        SELECT id FROM (
          SELECT id, "startedAt", ROW_NUMBER() OVER (PARTITION BY job ORDER BY "startedAt" DESC) AS rn
          FROM cron_runs
        ) ranked
        WHERE rn > ${PURGE_KEEP_LATEST_PER_JOB} AND "startedAt" < ${cutoff}
        LIMIT ${PURGE_BATCH_SIZE}
      )
      DELETE FROM cron_runs WHERE id IN (SELECT id FROM doomed)
    `;
    const n = Number(count) || 0;
    deletedRuns += n;
    if (n < PURGE_BATCH_SIZE) break;
  }

  const regRes = await cronPrisma().cronRegistration.deleteMany({
    where: { heartbeatAt: { lt: regCutoff } },
  });

  return { deletedRuns, deletedRegistrations: regRes.count };
}

/** Schedules the daily cron-runs retention purge through `scheduleJob`. */
export function startCronRetentionJob(): void {
  scheduleJob('cron-runs-purge', async () => {
    const res = await purgeCronRuns();
    if (res.deletedRuns > 0 || res.deletedRegistrations > 0) {
      logger.info(res, 'Cron runs retention purge completed');
    }
    return { outcome: 'SUCCESS', counters: res };
  });
}
