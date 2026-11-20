/**
 * Operational alert engine (#226).
 *
 * One leader per tick: evaluation runs under the `ops-alerts` advisory lock,
 * and an instance that does not get it returns at once. Inside the lock each
 * evaluator's observations move incidents through
 *
 *   (none) → PENDING → OPEN → RESOLVED → OPEN (next episode) …
 *
 * with hysteresis: OPEN after ALERT_OPEN_AFTER consecutive bad evaluations,
 * RESOLVED after ALERT_RESOLVE_AFTER consecutive good ones. A subject absent
 * from a successful evaluator's observations is good; an evaluator that threw
 * changes nothing, so a database timeout can never resolve an incident.
 *
 * Unacknowledged CRITICAL incidents re-notify every ALERT_ESCALATE_EVERY_MS.
 * Silenced incidents notify nothing until silencedUntil, and a subject opens
 * at most once per ALERT_MIN_REOPEN_MS. Notifications are collected in the
 * lock transaction and sent after it commits; their dedupe keys make a retry
 * after a crash safe.
 */
import type { Prisma } from '@prisma/client';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { withAdvisoryLock } from '../../lib/advisory-lock';
import { AlertService, type AlertLevel, type OpsAlert, type OpsNotificationKind } from '../alerts.service';
import { DEFAULT_EVALUATORS, type Evaluator, type Observation } from './conditions';

export const OPS_ALERT_LOCK = 'ops-alerts';

export interface AlertPolicy {
  openAfter: number;
  resolveAfter: number;
  escalateEveryMs: number;
  minReopenMs: number;
}

export function policyFromConfig(): AlertPolicy {
  return {
    openAfter: config.ALERT_OPEN_AFTER,
    resolveAfter: config.ALERT_RESOLVE_AFTER,
    escalateEveryMs: config.ALERT_ESCALATE_EVERY_MS,
    minReopenMs: config.ALERT_MIN_REOPEN_MS,
  };
}

export interface IncidentRow {
  id: string;
  subjectType: string;
  subjectKey: string;
  severity: string;
  state: string;
  episode: number;
  summary: string;
  detail: unknown;
  badStreak: number;
  goodStreak: number;
  openedAt: Date | null;
  resolvedAt: Date | null;
  ackedAt: Date | null;
  ackedBy: string | null;
  silencedUntil: Date | null;
  lastNotifiedAt: Date | null;
  escalations: number;
}

export interface PendingNotification {
  incident: IncidentRow;
  kind: OpsNotificationKind;
  /** Escalation number within the episode; 0 for open/resolve. */
  step: number;
}

type LockRunner = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<{ acquired: true; value: T } | { acquired: false }>;

export interface EngineDeps {
  evaluators?: readonly Evaluator[];
  alerts?: AlertService;
  now?: Date;
  policy?: AlertPolicy;
  lock?: LockRunner;
}

export interface EvaluationResult {
  /** False when another instance held the lock. */
  evaluated: boolean;
  failedEvaluators: string[];
  notifications: Array<{ incidentId: string; subjectKey: string; kind: OpsNotificationKind; severity: string; delivered: string[] }>;
}

const RANK: Record<string, number> = { INFO: 0, WARN: 1, CRITICAL: 2 };

const defaultLock: LockRunner = (fn) => withAdvisoryLock(OPS_ALERT_LOCK, fn, { timeoutMs: 60_000 });

const silenced = (inc: IncidentRow, now: Date) => inc.silencedUntil !== null && inc.silencedUntil.getTime() > now.getTime();

export function opsAlertFor(inc: IncidentRow, kind: OpsNotificationKind): OpsAlert {
  const severity = inc.severity as AlertLevel;
  return {
    kind: 'ops',
    level: severity,
    severity,
    subjectType: inc.subjectType,
    subjectKey: inc.subjectKey,
    summary: inc.summary,
    detail: (inc.detail as Record<string, unknown> | null) ?? null,
    state: kind === 'resolve' ? 'RESOLVED' : 'OPEN',
    incidentId: inc.id,
    episode: inc.episode,
    notification: kind,
    adminUrl: `${config.PUBLIC_API_BASE_URL.replace(/\/+$/, '')}/api/v1/admin/alerts?id=${inc.id}`,
  };
}

/** Incident transitions for one tick. Pure apart from `tx` writes. */
export async function applyObservations(
  tx: Prisma.TransactionClient,
  evaluators: readonly Evaluator[],
  now: Date,
  policy: AlertPolicy,
): Promise<{ notifications: PendingNotification[]; failedEvaluators: string[] }> {
  const db = tx as unknown as typeof prisma;
  const notifications: PendingNotification[] = [];
  const failedEvaluators: string[] = [];

  const save = async (inc: IncidentRow, data: Partial<IncidentRow>): Promise<IncidentRow> =>
    (await db.alertIncident.update({ where: { id: inc.id }, data: data as Prisma.AlertIncidentUpdateInput })) as unknown as IncidentRow;

  const notify = (inc: IncidentRow, kind: OpsNotificationKind, step = 0) => notifications.push({ incident: inc, kind, step });

  const open = async (inc: IncidentRow, o: Observation): Promise<void> => {
    // At most one open notification per subject per ALERT_MIN_REOPEN_MS.
    const quiet = silenced(inc, now)
      || (inc.lastNotifiedAt !== null && now.getTime() - inc.lastNotifiedAt.getTime() < policy.minReopenMs);
    const opened = await save(inc, {
      state: 'OPEN',
      episode: inc.episode + 1,
      openedAt: now,
      resolvedAt: null,
      ackedAt: null,
      ackedBy: null,
      escalations: 0,
      severity: o.severity,
      ...(quiet ? {} : { lastNotifiedAt: now }),
    });
    if (!quiet) notify(opened, 'open');
  };

  const bad = async (existing: IncidentRow | null, subjectType: string, o: Observation): Promise<void> => {
    const previousSeverity = existing?.severity;
    const fields = { severity: o.severity, summary: o.summary, detail: (o.detail ?? null) as unknown };
    let inc: IncidentRow = existing
      ? await save(existing, { ...fields, badStreak: existing.badStreak + 1, goodStreak: 0 })
      : ((await db.alertIncident.create({
          data: { subjectType, subjectKey: o.subjectKey, ...fields, detail: (o.detail ?? undefined) as Prisma.InputJsonValue, state: 'PENDING', badStreak: 1 },
        })) as unknown as IncidentRow);
    if (inc.state !== 'OPEN') {
      if (inc.badStreak >= policy.openAfter) await open(inc, o);
      return;
    }
    // Still open. A severity increase is a new notification (its key differs).
    if (previousSeverity && RANK[o.severity] > RANK[previousSeverity] && !silenced(inc, now)) {
      inc = await save(inc, { lastNotifiedAt: now });
      notify(inc, 'open');
    }
  };

  const good = async (inc: IncidentRow): Promise<void> => {
    const goodStreak = inc.goodStreak + 1;
    const wasOpen = inc.state === 'OPEN';
    if (goodStreak < policy.resolveAfter || inc.state === 'RESOLVED') {
      await save(inc, { goodStreak, badStreak: 0 });
      return;
    }
    const resolved = await save(inc, { state: 'RESOLVED', resolvedAt: now, goodStreak, badStreak: 0 });
    // A PENDING subject never paged, so its recovery doesn't either.
    if (wasOpen && !silenced(resolved, now)) notify(resolved, 'resolve');
  };

  for (const ev of evaluators) {
    let observations: Observation[];
    try {
      observations = await ev.evaluate(now);
    } catch (err) {
      failedEvaluators.push(ev.subjectType);
      logger.warn({ err, subjectType: ev.subjectType }, 'Ops alert evaluator failed; its incidents are left as they are');
      continue;
    }
    const seen = new Set<string>();
    for (const o of observations) {
      seen.add(o.subjectKey);
      const existing = (await db.alertIncident.findUnique({
        where: { subjectType_subjectKey: { subjectType: ev.subjectType, subjectKey: o.subjectKey } },
      })) as unknown as IncidentRow | null;
      if (o.bad) await bad(existing, ev.subjectType, o);
      else if (existing && existing.state !== 'RESOLVED') await good(existing);
    }
    const active = (await db.alertIncident.findMany({
      where: { subjectType: ev.subjectType, state: { in: ['OPEN', 'PENDING'] } },
    })) as unknown as IncidentRow[];
    for (const inc of active) if (!seen.has(inc.subjectKey)) await good(inc);
  }

  // Escalation: unacknowledged CRITICAL incidents, numbered per episode.
  const critical = (await db.alertIncident.findMany({
    where: { state: 'OPEN', severity: 'CRITICAL', ackedAt: null },
  })) as unknown as IncidentRow[];
  for (const inc of critical) {
    if (silenced(inc, now)) continue;
    const last = inc.lastNotifiedAt ?? inc.openedAt;
    if (last && now.getTime() - last.getTime() < policy.escalateEveryMs) continue;
    const step = inc.escalations + 1;
    const updated = await save(inc, { escalations: step, lastNotifiedAt: now });
    notify(updated, 'escalate', step);
  }

  return { notifications, failedEvaluators };
}

/** One evaluation tick. Safe to call from every instance at once. */
export async function runAlertEvaluation(deps: EngineDeps = {}): Promise<EvaluationResult> {
  const now = deps.now ?? new Date();
  const policy = deps.policy ?? policyFromConfig();
  const evaluators = deps.evaluators ?? DEFAULT_EVALUATORS;
  const lock = deps.lock ?? defaultLock;

  const locked = await lock((tx) => applyObservations(tx, evaluators, now, policy));
  if (!locked.acquired) return { evaluated: false, failedEvaluators: [], notifications: [] };

  // The incident writes are committed; sinks are called outside the lock.
  const alerts = deps.alerts ?? new AlertService();
  const sent: EvaluationResult['notifications'] = [];
  for (const n of locked.value.notifications) {
    try {
      const delivered = await alerts.sendOps(opsAlertFor(n.incident, n.kind), n.step);
      sent.push({ incidentId: n.incident.id, subjectKey: n.incident.subjectKey, kind: n.kind, severity: n.incident.severity, delivered });
    } catch (err) {
      logger.warn({ err, incidentId: n.incident.id, kind: n.kind }, 'Ops alert notification failed; it retries on a later tick only for escalations');
    }
  }
  if (sent.length > 0) logger.info({ notifications: sent.length }, 'Ops alerts sent');
  return { evaluated: true, failedEvaluators: locked.value.failedEvaluators, notifications: sent };
}

// ─── Debounced trigger ────────────────────────────────────────────────────────

const DEBOUNCE_MS = 2_000;
let debounceTimer: NodeJS.Timeout | null = null;
let inFlight: Promise<unknown> | null = null;
let rerun = false;

/**
 * Runs an evaluation soon (#226), coalescing bursts: a breaker trip that
 * pauses several scopes evaluates once. Never throws.
 */
export function queueAlertEvaluation(run: () => Promise<unknown> = () => runAlertEvaluation(), delayMs = DEBOUNCE_MS): void {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (inFlight) {
      rerun = true;
      return;
    }
    inFlight = run()
      .catch((err) => logger.warn({ err }, 'Queued ops alert evaluation failed'))
      .finally(() => {
        inFlight = null;
        if (rerun) {
          rerun = false;
          queueAlertEvaluation(run, delayMs);
        }
      });
  }, delayMs);
  debounceTimer.unref?.();
}

/** Test seam: drop a pending debounced run. */
export function cancelQueuedAlertEvaluation(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  rerun = false;
}
