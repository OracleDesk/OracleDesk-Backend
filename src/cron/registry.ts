import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export type CronOutcome = 'success' | 'failure';

interface CronRun {
  startedAt: string;
  finishedAt: string;
  error?: string;
}

const lastRuns = new Map<string, { lastSuccess?: CronRun; lastFailure?: CronRun }>();

/**
 * Records a cron run: in memory per instance (#111), and in cron_runs so the
 * failure streak is cluster-wide (#226). The database write is fire-and-forget:
 * a cron job never fails or waits because its bookkeeping could not be saved.
 */
export function recordCronRun(job: string, outcome: CronOutcome, startedAt: Date, finishedAt: Date, error?: unknown): void {
  const entry = lastRuns.get(job) ?? {};
  const run: CronRun = { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() };
  if (outcome === 'success') {
    entry.lastSuccess = run;
  } else {
    run.error = error instanceof Error ? error.message : String(error);
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

export function getCronStatus(): Record<string, { lastSuccess?: CronRun; lastFailure?: CronRun }> {
  return Object.fromEntries(lastRuns);
}
