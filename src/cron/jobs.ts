/**
 * Static registry of every scheduled cron job in the backend (#336).
 *
 * This is the single source of truth for "what should run", independent of
 * which schedules a particular instance happened to start. Freshness checks
 * compare persisted `cron_runs` and `cron_registrations` against these specs
 * so unstarted jobs show up as `NOT_SCHEDULED` and late jobs as `overdue`.
 */
import { config } from '../config';

export type CronExpressionConfigKey =
  | 'PAYMENT_INTENT_CONFIRM_CRON'
  | 'TRACE_PUBLISH_CRON'
  | 'TRACE_AUDIT_CRON'
  | 'REPORT_CRON';

export type CronEnabledConfigKey =
  | 'RECONCILE_ENABLED'
  | 'PAYMENT_INTENT_CONFIRM_ENABLED'
  | 'TRACE_PUBLISH_ENABLED'
  | 'TRACE_AUDIT_ENABLED'
  | 'REPORTS_ENABLED'
  | 'DISPUTE_MONITOR_ENABLED';

export interface CronJobSpec {
  readonly name: JobName;
  /** Fixed cron expression, when not configurable via env. */
  readonly expression?: string;
  /** Config key holding the cron expression, when configurable via env. */
  readonly expressionKey?: CronExpressionConfigKey;
  /** IANA timezone passed to node-cron and cron-parser (default Etc/UTC). */
  readonly timezone: string;
  /** Optional boolean config flag gating this job. */
  readonly enabledBy?: CronEnabledConfigKey;
  /** Whether overdue/NOT_SCHEDULED fails the `crons` readiness probe. */
  readonly critical: boolean;
  /** Multiplier applied to the schedule's period when computing overdue threshold. */
  readonly graceFactor: number;
}

export const JOB_NAMES = [
  'ingestion',
  'saga-resume',
  'correlation-snapshot',
  'portfolio-risk',
  'trader',
  'calibration',
  'signal-retention',
  'subscription-expiry',
  'pass-expiry-notify',
  'idempotency-purge',
  'reservation-expiry',
  'copy-trade-sweep',
  'ipfs-eviction',
  'market-reconciler',
  'price-resolution',
  'payment-intent-confirmer',
  'trace-publication',
  'trace-audit',
  'transparency-report',
  'dispute-escalation',
  'dispute-polling',
  'cron-runs-purge',
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export const CRON_JOBS: readonly CronJobSpec[] = [
  { name: 'ingestion', expression: '0,15,30,45 * * * *', timezone: 'Etc/UTC', critical: true, graceFactor: 2 },
  { name: 'saga-resume', expression: '* * * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 3 },
  { name: 'correlation-snapshot', expression: '2,17,32,47 * * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 2 },
  { name: 'portfolio-risk', expression: '4,19,34,49 * * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 2 },
  { name: 'trader', expression: '5,20,35,50 * * * *', timezone: 'Etc/UTC', critical: true, graceFactor: 2 },
  { name: 'calibration', expression: '10 3 * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 1.5 },
  { name: 'signal-retention', expression: '41 3 * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 1.5 },
  { name: 'subscription-expiry', expression: '0 * * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 2 },
  { name: 'pass-expiry-notify', expression: '*/10 * * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 2 },
  { name: 'idempotency-purge', expression: '10 * * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 2 },
  { name: 'reservation-expiry', expression: '*/5 * * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 2 },
  { name: 'copy-trade-sweep', expression: '*/5 * * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 2 },
  { name: 'ipfs-eviction', expression: '30 * * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 2 },
  {
    name: 'market-reconciler',
    expression: '3,13,23,33,43,53 * * * *',
    timezone: 'Etc/UTC',
    enabledBy: 'RECONCILE_ENABLED',
    critical: true,
    graceFactor: 2,
  },
  { name: 'price-resolution', expression: '*/5 * * * *', timezone: 'Etc/UTC', critical: true, graceFactor: 2 },
  {
    name: 'payment-intent-confirmer',
    expressionKey: 'PAYMENT_INTENT_CONFIRM_CRON',
    timezone: 'Etc/UTC',
    enabledBy: 'PAYMENT_INTENT_CONFIRM_ENABLED',
    critical: true,
    graceFactor: 3,
  },
  {
    name: 'trace-publication',
    expressionKey: 'TRACE_PUBLISH_CRON',
    timezone: 'Etc/UTC',
    enabledBy: 'TRACE_PUBLISH_ENABLED',
    critical: false,
    graceFactor: 3,
  },
  {
    name: 'trace-audit',
    expressionKey: 'TRACE_AUDIT_CRON',
    timezone: 'Etc/UTC',
    enabledBy: 'TRACE_AUDIT_ENABLED',
    critical: false,
    graceFactor: 2,
  },
  {
    name: 'transparency-report',
    expressionKey: 'REPORT_CRON',
    timezone: 'Etc/UTC',
    enabledBy: 'REPORTS_ENABLED',
    critical: false,
    graceFactor: 1.5,
  },
  {
    name: 'dispute-escalation',
    expression: '*/5 * * * *',
    timezone: 'Etc/UTC',
    enabledBy: 'DISPUTE_MONITOR_ENABLED',
    critical: true,
    graceFactor: 2,
  },
  {
    name: 'dispute-polling',
    expression: '*/30 * * * *',
    timezone: 'Etc/UTC',
    enabledBy: 'DISPUTE_MONITOR_ENABLED',
    critical: true,
    graceFactor: 2,
  },
  { name: 'cron-runs-purge', expression: '25 4 * * *', timezone: 'Etc/UTC', critical: false, graceFactor: 1.5 },
] as const;

export const CRON_JOBS_BY_NAME: Record<JobName, CronJobSpec> = Object.fromEntries(
  CRON_JOBS.map((spec) => [spec.name, spec]),
) as Record<JobName, CronJobSpec>;

export function resolveJobExpression(spec: CronJobSpec): string {
  if (spec.expressionKey) {
    switch (spec.expressionKey) {
      case 'PAYMENT_INTENT_CONFIRM_CRON':
        return config.PAYMENT_INTENT_CONFIRM_CRON;
      case 'TRACE_PUBLISH_CRON':
        return config.TRACE_PUBLISH_CRON;
      case 'TRACE_AUDIT_CRON':
        return config.TRACE_AUDIT_CRON;
      case 'REPORT_CRON':
        return config.REPORT_CRON;
    }
  }
  return spec.expression!;
}

export function resolveJobEnabled(spec: CronJobSpec): boolean {
  if (!spec.enabledBy) return true;
  switch (spec.enabledBy) {
    case 'RECONCILE_ENABLED':
      return config.RECONCILE_ENABLED;
    case 'PAYMENT_INTENT_CONFIRM_ENABLED':
      return config.PAYMENT_INTENT_CONFIRM_ENABLED;
    case 'TRACE_PUBLISH_ENABLED':
      return config.TRACE_PUBLISH_ENABLED;
    case 'TRACE_AUDIT_ENABLED':
      return config.TRACE_AUDIT_ENABLED;
    case 'REPORTS_ENABLED':
      return config.REPORTS_ENABLED;
    case 'DISPUTE_MONITOR_ENABLED':
      return config.DISPUTE_MONITOR_ENABLED;
  }
}

export function isJobName(name: string): name is JobName {
  return Object.prototype.hasOwnProperty.call(CRON_JOBS_BY_NAME, name);
}
