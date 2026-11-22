/**
 * Cluster-wide cron freshness evaluation and run history queries (#336).
 *
 * Computes expected fire times in each job's timezone via `cron-parser`,
 * evaluates overdue/NOT_SCHEDULED state against persisted `cron_runs` and
 * `cron_registrations`, caches the summary for 15 s, and falls back to the
 * process-local registry when Postgres is unavailable.
 */
import { parseExpression } from 'cron-parser';
import { prisma } from '../lib/prisma';
import {
  CRON_JOBS,
  resolveJobEnabled,
  resolveJobExpression,
  type CronJobSpec,
  type JobName,
} from './jobs';
import { getCronBufferStats, getCronStatus, type CronRunOutcome } from './registry';

const CACHE_TTL_MS = 15_000;
const REGISTRATION_WINDOW_MS = 10 * 60_000;

export type CronFreshnessState = 'OK' | 'OVERDUE' | 'FAILING' | 'NOT_SCHEDULED' | 'DISABLED' | 'PENDING';

export interface CronRunSummary {
  id?: string;
  instanceId?: string;
  cycleId?: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: string;
  durationMs?: number | null;
  errorClass?: string | null;
  errorMessage?: string | null;
  counters?: Record<string, number> | null;
}

export interface CronJobFreshness {
  expected: {
    expression: string;
    timezone: string;
    enabled: boolean;
    critical: boolean;
    graceFactor: number;
    prevFireAt: string | null;
    periodMs: number | null;
    deadlineAt: string | null;
  };
  lastRun: CronRunSummary | null;
  lastSuccess: CronRunSummary | null;
  lastFailure: CronRunSummary | null;
  consecutiveFailures: number;
  overdue: boolean;
  state: CronFreshnessState;
  instances: string[];
}

export interface CronFreshnessReport {
  source: 'db' | 'memory';
  dropped: number;
  buffered: number;
  jobs: Record<JobName, CronJobFreshness>;
}

export interface ExpectedSchedule {
  prev: Date;
  prevPrev: Date;
  periodMs: number;
  deadline: Date;
}

/**
 * Computes the previous two expected fire times and overdue deadline for a
 * cron expression in the given timezone. Using `period = prev - prevPrev`
 * handles irregular schedules such as `3,13,23,33,43,53 * * * *`.
 */
export function computeExpectedSchedule(
  expression: string,
  timezone: string,
  graceFactor: number,
  now: Date = new Date(),
): ExpectedSchedule | null {
  try {
    const interval = parseExpression(expression, { currentDate: now, tz: timezone });
    const prev = interval.prev().toDate();
    const prevPrev = interval.prev().toDate();
    const periodMs = Math.max(0, prev.getTime() - prevPrev.getTime());
    const deadline = new Date(prev.getTime() - graceFactor * periodMs);
    return { prev, prevPrev, periodMs, deadline };
  } catch {
    return null;
  }
}

export interface JobFreshnessInput {
  spec: CronJobSpec;
  expression: string;
  enabled: boolean;
  lastRun: CronRunSummary | null;
  lastSuccess: CronRunSummary | null;
  lastFailure: CronRunSummary | null;
  consecutiveFailures: number;
  activeInstances: string[];
  now?: Date;
}

/** Pure freshness calculation for one job (unit-tested directly). */
export function evaluateJobFreshness(input: JobFreshnessInput): CronJobFreshness {
  const now = input.now ?? new Date();
  const schedule = computeExpectedSchedule(input.expression, input.spec.timezone, input.spec.graceFactor, now);

  let overdue = false;
  let state: CronFreshnessState = 'OK';

  if (!input.enabled) {
    state = 'DISABLED';
  } else if (input.activeInstances.length === 0) {
    state = 'NOT_SCHEDULED';
  } else if (schedule && input.lastSuccess) {
    const lastSuccessMs = new Date(input.lastSuccess.startedAt).getTime();
    if (lastSuccessMs < schedule.deadline.getTime()) {
      overdue = true;
      state = 'OVERDUE';
    } else if (input.consecutiveFailures > 0) {
      state = 'FAILING';
    } else {
      state = 'OK';
    }
  } else if (!input.lastSuccess) {
    if (input.consecutiveFailures > 0) {
      if (schedule && input.lastFailure && new Date(input.lastFailure.startedAt).getTime() < schedule.deadline.getTime()) {
        overdue = true;
        state = 'OVERDUE';
      } else {
        state = 'FAILING';
      }
    } else {
      state = 'PENDING';
    }
  }

  return {
    expected: {
      expression: input.expression,
      timezone: input.spec.timezone,
      enabled: input.enabled,
      critical: input.spec.critical,
      graceFactor: input.spec.graceFactor,
      prevFireAt: schedule ? schedule.prev.toISOString() : null,
      periodMs: schedule ? schedule.periodMs : null,
      deadlineAt: schedule ? schedule.deadline.toISOString() : null,
    },
    lastRun: input.lastRun,
    lastSuccess: input.lastSuccess,
    lastFailure: input.lastFailure,
    consecutiveFailures: input.consecutiveFailures,
    overdue,
    state,
    instances: input.activeInstances,
  };
}

// ─── DB Queries (15 s cached) ───────────────────────────────────────────────

interface FreshnessQueryRow {
  job: string;
  last_run: CronRunSummary | null;
  last_success: CronRunSummary | null;
  last_failure: CronRunSummary | null;
  consecutive_failures: number | bigint | null;
}

interface RegQueryRow {
  job: string;
  instance_id: string;
}

let cachedReport: { report: CronFreshnessReport; expiresAt: number } | null = null;

export function clearFreshnessCache(): void {
  cachedReport = null;
}

function buildMemoryFallbackReport(now: Date): CronFreshnessReport {
  const mem = getCronStatus();
  const { buffered, dropped } = getCronBufferStats();
  const jobs = {} as Record<JobName, CronJobFreshness>;

  for (const spec of CRON_JOBS) {
    const entry = mem[spec.name];
    const lastSuccess: CronRunSummary | null = entry?.lastSuccess
      ? { startedAt: entry.lastSuccess.startedAt, finishedAt: entry.lastSuccess.finishedAt, outcome: 'SUCCESS' }
      : null;
    const lastFailure: CronRunSummary | null = entry?.lastFailure
      ? {
          startedAt: entry.lastFailure.startedAt,
          finishedAt: entry.lastFailure.finishedAt,
          outcome: 'FAILURE',
          errorMessage: entry.lastFailure.error ?? null,
        }
      : null;
    let lastRun = lastSuccess;
    if (lastFailure && (!lastSuccess || lastFailure.startedAt > lastSuccess.startedAt)) {
      lastRun = lastFailure;
    }
    const consecutiveFailures =
      lastFailure && (!lastSuccess || lastFailure.startedAt > lastSuccess.startedAt) ? 1 : 0;

    jobs[spec.name] = evaluateJobFreshness({
      spec,
      expression: resolveJobExpression(spec),
      enabled: resolveJobEnabled(spec),
      lastRun,
      lastSuccess,
      lastFailure,
      consecutiveFailures,
      activeInstances: [],
      now,
    });
  }

  return { source: 'memory', dropped, buffered, jobs };
}

/**
 * Returns cluster-wide cron freshness from Postgres (one DISTINCT ON (job)
 * summary query + active registrations, cached 15 s), falling back to the
 * process-local memory map when Postgres is unreachable.
 */
export async function getCronFreshnessSummary(opts?: { now?: Date; bypassCache?: boolean }): Promise<CronFreshnessReport> {
  const now = opts?.now ?? new Date();
  if (!opts?.bypassCache && cachedReport && cachedReport.expiresAt > now.getTime()) {
    return cachedReport.report;
  }

  try {
    const regCutoff = new Date(now.getTime() - REGISTRATION_WINDOW_MS);

    const [runRows, regRows] = await Promise.all([
      prisma.$queryRaw<FreshnessQueryRow[]>`
        WITH latest_run AS (
          SELECT DISTINCT ON (job)
            job,
            jsonb_build_object(
              'id', id,
              'instanceId', "instanceId",
              'cycleId', "cycleId",
              'startedAt', to_char("startedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'finishedAt', CASE WHEN "finishedAt" IS NOT NULL THEN to_char("finishedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
              'outcome', outcome,
              'durationMs', "durationMs",
              'errorClass', "errorClass",
              'errorMessage', "errorMessage",
              'counters', counters
            ) AS row_json
          FROM cron_runs
          ORDER BY job, "startedAt" DESC
        ),
        latest_success AS (
          SELECT DISTINCT ON (job)
            job,
            "startedAt" AS last_success_at,
            jsonb_build_object(
              'id', id,
              'instanceId', "instanceId",
              'cycleId', "cycleId",
              'startedAt', to_char("startedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'finishedAt', CASE WHEN "finishedAt" IS NOT NULL THEN to_char("finishedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
              'outcome', outcome,
              'durationMs', "durationMs",
              'counters', counters
            ) AS row_json
          FROM cron_runs
          WHERE outcome = 'SUCCESS'
          ORDER BY job, "startedAt" DESC
        ),
        latest_failure AS (
          SELECT DISTINCT ON (job)
            job,
            jsonb_build_object(
              'id', id,
              'instanceId', "instanceId",
              'cycleId', "cycleId",
              'startedAt', to_char("startedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'finishedAt', CASE WHEN "finishedAt" IS NOT NULL THEN to_char("finishedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
              'outcome', outcome,
              'durationMs', "durationMs",
              'errorClass', "errorClass",
              'errorMessage', "errorMessage"
            ) AS row_json
          FROM cron_runs
          WHERE outcome IN ('FAILURE', 'TIMEOUT')
          ORDER BY job, "startedAt" DESC
        ),
        failure_streak AS (
          SELECT r.job, COUNT(*)::int AS cnt
          FROM cron_runs r
          LEFT JOIN latest_success ls ON ls.job = r.job
          WHERE r.outcome IN ('FAILURE', 'TIMEOUT')
            AND (ls.last_success_at IS NULL OR r."startedAt" > ls.last_success_at)
          GROUP BY r.job
        )
        SELECT
          lr.job,
          lr.row_json AS last_run,
          ls.row_json AS last_success,
          lf.row_json AS last_failure,
          COALESCE(fs.cnt, 0)::int AS consecutive_failures
        FROM latest_run lr
        LEFT JOIN latest_success ls ON ls.job = lr.job
        LEFT JOIN latest_failure lf ON lf.job = lr.job
        LEFT JOIN failure_streak fs ON fs.job = lr.job
      `,
      prisma.$queryRaw<RegQueryRow[]>`
        SELECT job, "instanceId" AS instance_id
        FROM cron_registrations
        WHERE enabled = true AND "heartbeatAt" >= ${regCutoff}
        ORDER BY job, "instanceId"
      `,
    ]);

    const byJob = new Map<string, FreshnessQueryRow>();
    for (const r of runRows) byJob.set(r.job, r);

    const instancesByJob = new Map<string, string[]>();
    for (const r of regRows) {
      const list = instancesByJob.get(r.job) ?? [];
      list.push(r.instance_id);
      instancesByJob.set(r.job, list);
    }

    const { buffered, dropped } = getCronBufferStats();
    const jobs = {} as Record<JobName, CronJobFreshness>;
    for (const spec of CRON_JOBS) {
      const row = byJob.get(spec.name);
      jobs[spec.name] = evaluateJobFreshness({
        spec,
        expression: resolveJobExpression(spec),
        enabled: resolveJobEnabled(spec),
        lastRun: row?.last_run ?? null,
        lastSuccess: row?.last_success ?? null,
        lastFailure: row?.last_failure ?? null,
        consecutiveFailures: Number(row?.consecutive_failures ?? 0),
        activeInstances: instancesByJob.get(spec.name) ?? [],
        now,
      });
    }

    const report: CronFreshnessReport = { source: 'db', dropped, buffered, jobs };
    cachedReport = { report, expiresAt: now.getTime() + CACHE_TTL_MS };
    return report;
  } catch {
    return buildMemoryFallbackReport(now);
  }
}

/** Formats the freshness report for GET /api/v1/admin/status. */
export async function getAdminCronsStatus(): Promise<Record<string, unknown>> {
  const report = await getCronFreshnessSummary();
  return {
    source: report.source,
    dropped: report.dropped,
    buffered: report.buffered,
    ...report.jobs,
  };
}

/** Paginated run history query for GET /api/v1/admin/crons/:job/runs. */
export async function listCronJobRuns(params: {
  job: string;
  outcome?: CronRunOutcome;
  skip: number;
  take: number;
}): Promise<{ rows: unknown[]; total: number }> {
  const db = prisma as unknown as {
    cronRun: {
      findMany(args: unknown): Promise<unknown[]>;
      count(args: unknown): Promise<number>;
    };
  };
  const where: Record<string, unknown> = { job: params.job };
  if (params.outcome) where.outcome = params.outcome;

  const [rows, total] = await Promise.all([
    db.cronRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: params.skip,
      take: params.take,
    }),
    db.cronRun.count({ where }),
  ]);

  return { rows, total };
}
