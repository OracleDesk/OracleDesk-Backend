/**
 * Operational alert conditions (#226).
 *
 * Each evaluator reads cluster-wide state (Postgres, never per-instance
 * memory) and returns one observation per subject it considers bad, plus,
 * where it knows them, explicit good observations. A subject that an evaluator
 * which ran successfully did not report counts as good. An evaluator that
 * throws reports nothing, so its open incidents stay open.
 *
 * Subjects are grouped so a backlog never becomes an alert storm: 50 stuck
 * outbox rows of one kind are one subject, `outbox:<kind>`.
 */
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { socketStreamClusterStats } from '../../lib/socket-stream';
import type { AlertLevel } from '../alerts.service';
import { controlsOverview, type PauseSource } from '../agent-controls.service';

export type SubjectType = 'agent_pause' | 'outbox_stuck' | 'outbox_unhandled' | 'cron_failing' | 'reconcile_drift' | 'socket_stream';

export interface Observation {
  subjectKey: string;
  bad: boolean;
  severity: AlertLevel;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface Evaluator {
  subjectType: SubjectType;
  evaluate(now: Date): Promise<Observation[]>;
}

const PAUSE_SEVERITY: Record<PauseSource, AlertLevel> = {
  failure_breaker: 'CRITICAL',
  drawdown: 'CRITICAL',
  chain_paused: 'WARN',
  operator: 'INFO',
};

/** Paused scopes, one subject per scope and pause source. */
export const agentPauses: Evaluator = {
  subjectType: 'agent_pause',
  async evaluate(now) {
    const { scopes } = await controlsOverview(now);
    const out: Observation[] = [];
    for (const { scope, own } of scopes) {
      const active = own.paused && (!own.pausedUntil || Date.parse(own.pausedUntil) > now.getTime());
      if (!active || !own.source) continue;
      const source = own.source as PauseSource;
      if (source === 'operator' && !config.ALERT_OPERATOR_PAUSES) continue;
      out.push({
        subjectKey: `${scope}:${source}`,
        bad: true,
        severity: PAUSE_SEVERITY[source] ?? 'WARN',
        summary: `${scope} agent paused (${source})${own.pausedUntil ? ` until ${own.pausedUntil}` : ''}`,
        detail: { scope, source, reason: own.reason, pausedUntil: own.pausedUntil, pausedBy: own.pausedBy },
      });
    }
    return out;
  },
};

/**
 * In-flight outbox rows that should have resolved: past their maxTime
 * (CRITICAL: the recovery worker should have expired them) or older than
 * ALERT_OUTBOX_STUCK_MS (WARN). One subject per kind.
 */
export const outboxStuck: Evaluator = {
  subjectType: 'outbox_stuck',
  async evaluate(now) {
    const nowSec = BigInt(Math.floor(now.getTime() / 1000));
    const stuckBefore = new Date(now.getTime() - config.ALERT_OUTBOX_STUCK_MS);
    const rows: Array<{ id: string; kind: string; maxTime: bigint | null; createdAt: Date }> = await prisma.chainTransaction.findMany({
      where: {
        status: { in: ['SUBMITTED', 'PENDING'] },
        OR: [{ maxTime: { lt: nowSec } }, { createdAt: { lt: stuckBefore } }],
      },
      select: { id: true, kind: true, maxTime: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const byKind = new Map<string, typeof rows>();
    for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
    return [...byKind.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([kind, list]) => {
      const expired = list.filter((r) => r.maxTime !== null && r.maxTime < nowSec);
      return {
        subjectKey: `outbox:${kind}`,
        bad: true,
        severity: expired.length > 0 ? 'CRITICAL' : 'WARN',
        summary: `${list.length} ${kind} chain write(s) stuck in flight${expired.length > 0 ? `, ${expired.length} past maxTime` : ''}`,
        detail: {
          kind,
          count: list.length,
          pastMaxTime: expired.length,
          oldestCreatedAt: list[0].createdAt.toISOString(),
          sampleIds: list.slice(0, 5).map((r) => r.id),
        },
      };
    });
  },
};

/** Terminal outbox rows whose completion handler has not run. One subject per kind. */
export const outboxUnhandled: Evaluator = {
  subjectType: 'outbox_unhandled',
  async evaluate(now) {
    const before = new Date(now.getTime() - config.ALERT_UNHANDLED_MS);
    const rows: Array<{ id: string; kind: string; status: string }> = await prisma.chainTransaction.findMany({
      where: { status: { in: ['SUCCESS', 'FAILED', 'EXPIRED'] }, handledAt: null, updatedAt: { lt: before } },
      select: { id: true, kind: true, status: true },
      orderBy: { updatedAt: 'asc' },
    });
    const byKind = new Map<string, typeof rows>();
    for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
    return [...byKind.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([kind, list]) => ({
      subjectKey: `outbox:${kind}`,
      bad: true,
      // A landed money movement whose domain effect was never applied.
      severity: list.some((r) => r.status === 'SUCCESS') ? 'CRITICAL' : 'WARN',
      summary: `${list.length} terminal ${kind} chain write(s) with no completion handler run`,
      detail: { kind, count: list.length, sampleIds: list.slice(0, 5).map((r) => r.id) },
    }));
  },
};

/** Cron jobs failing run after run, from cron_runs (all instances). */
export const cronFailing: Evaluator = {
  subjectType: 'cron_failing',
  async evaluate() {
    const threshold = config.ALERT_CRON_FAILURE_STREAK;
    const rows: Array<{ job: string; failureStreak: number; lastError: string | null; lastFailureAt: Date | null; lastSuccessAt: Date | null }> =
      await prisma.cronRunStatus.findMany({ orderBy: { job: 'asc' } });
    return rows.map((r) => ({
      subjectKey: `cron:${r.job}`,
      bad: r.failureStreak >= threshold,
      severity: r.failureStreak >= threshold * 2 ? 'CRITICAL' : 'WARN',
      summary: `Cron job ${r.job} failed ${r.failureStreak} time(s) in a row`,
      detail: {
        job: r.job,
        failureStreak: r.failureStreak,
        lastFailureAt: r.lastFailureAt?.toISOString() ?? null,
        lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
        lastError: r.lastError,
      },
    }));
  },
};

/** Reported (unrepaired) drift in the latest reconciliation run, by drift class. */
export const reconcileDrift: Evaluator = {
  subjectType: 'reconcile_drift',
  async evaluate() {
    const run: { id: string; finishedAt: Date | null; reported: number } | null = await prisma.reconcileRun.findFirst({
      where: { finishedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: { id: true, finishedAt: true, reported: true },
    });
    if (!run || run.reported === 0) return [];
    const reports: Array<{ driftClass: string; marketId: string }> = await prisma.marketDriftReport.findMany({
      where: { runId: run.id, action: 'REPORTED' },
      select: { driftClass: true, marketId: true },
    });
    const byClass = new Map<string, string[]>();
    for (const r of reports) byClass.set(r.driftClass, [...(byClass.get(r.driftClass) ?? []), r.marketId]);
    return [...byClass.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([driftClass, markets]) => ({
      subjectKey: `drift:${driftClass}`,
      bad: true,
      severity: 'WARN' as AlertLevel,
      summary: `Reconciliation reported ${markets.length} market(s) with ${driftClass} drift`,
      detail: { runId: run.id, driftClass, count: markets.length, sampleMarketIds: markets.slice(0, 5) },
    }));
  },
};

/** Socket.io Redis Streams adapter lag, trimmed gaps and read errors (#293). */
export const socketStreamLag: Evaluator = {
  subjectType: 'socket_stream',
  async evaluate() {
    if (!config.EVENT_BUS_ENABLED) return [];
    const stats = await socketStreamClusterStats();
    const out: Observation[] = [];
    for (const inst of stats.instances) {
      const lagHigh =
        inst.lagEntries >= config.SOCKET_ADAPTER_LAG_WARN_ENTRIES ||
        inst.lagMs >= config.SOCKET_ADAPTER_LAG_WARN_MS;
      const hasErrors = inst.trimmedGaps > 0 || inst.readErrors > 0 || inst.shedding;
      if (!lagHigh && !hasErrors) continue;
      const critical = inst.trimmedGaps > 0 || inst.shedding;
      out.push({
        subjectKey: `socket_stream:${inst.instanceId}`,
        bad: true,
        severity: critical ? 'CRITICAL' : 'WARN',
        summary: `Socket stream instance ${inst.instanceId} lagging (lagEntries=${inst.lagEntries}, lagMs=${inst.lagMs}, trimmedGaps=${inst.trimmedGaps}, readErrors=${inst.readErrors})`,
        detail: { ...inst },
      });
    }
    return out;
  },
};

export const DEFAULT_EVALUATORS: readonly Evaluator[] = [
  agentPauses,
  outboxStuck,
  outboxUnhandled,
  cronFailing,
  reconcileDrift,
  socketStreamLag,
];
