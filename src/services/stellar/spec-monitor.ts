/**
 * Runtime contract spec compatibility monitor (#322).
 *
 * Re-runs the spec-compat + wiring check on an interval (under a Postgres
 * advisory lock so one instance queries RPC per interval) and on suspicious
 * runtime signals (event decode failures, unknown contract error codes,
 * MissingValue/WasmVm simulation failures) with debouncing.
 *
 * Policy:
 *   - unchanged:    record run, clear any acknowledged spec_drift holds if ok.
 *   - compatible:   log + WARN alert once per distinct drift key, update baseline.
 *   - unverifiable: retry with exponential backoff; only escalate after
 *                   SPEC_COMPAT_UNVERIFIABLE_RUNS consecutive runs.
 *   - breaking:     place `spec_drift` holds (`ackRequired: true`) on affected
 *                   scopes and send a CRITICAL alert once per distinct drift key.
 */
import crypto from 'node:crypto';
import { config } from '../../config';
import { withAdvisoryLock } from '../../lib/advisory-lock';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import {
  acknowledgeControlHolds,
  placeControlHold,
  readHolds,
  releaseControlHold,
  type AgentScope,
  type ControlHoldRow,
} from '../agent-controls.service';
import { AlertService, type Alert, type AlertLevel } from '../alerts.service';
import {
  applyReport,
  bootSpecCompatReport,
  classify,
  computeSpecCompat,
  effectiveMode,
  specCompatReport,
  type CompatAgentScope,
  type DriftClass,
  type SpecCompatDeps,
  type SpecCompatReport,
  type SpecDiff,
} from './spec-compat';

export interface SpecCompatRunRecord {
  id: string;
  checkedAt: Date;
  trigger: string;
  cls: DriftClass;
  ok: boolean;
  report: SpecCompatReport;
  affected: CompatAgentScope[];
}

export interface SpecMonitorDeps extends SpecCompatDeps {
  alertService?: Pick<AlertService, 'send'>;
  unverifiableRunsThreshold?: number;
  baseBackoffMs?: number;
  minGapMs?: number;
  now?: () => number;
  useAdvisoryLock?: boolean;
}

const LOCK_KEY = 'spec-compat';
const DEFAULT_BASE_BACKOFF_MS = 2_000;

let baselineReport: SpecCompatReport | null = null;
let consecutiveUnverifiable = 0;
let lastCheckAt = 0;
let debounceTimer: NodeJS.Timeout | null = null;
let backoffTimer: NodeJS.Timeout | null = null;
let monitorDepsOverride: SpecMonitorDeps | null = null;
const memoryHistory: SpecCompatRunRecord[] = [];
const alertedKeys = new Set<string>();

interface SpecCompatRunPrismaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findFirst(args: { orderBy: { checkedAt: 'desc' } }): Promise<SpecCompatRunRecord | null>;
  findMany(args: { orderBy: { checkedAt: 'desc' }; skip: number; take: number }): Promise<SpecCompatRunRecord[]>;
  count(): Promise<number>;
}

function runDelegate(): SpecCompatRunPrismaDelegate | null {
  const d = (prisma as unknown as { specCompatRun?: SpecCompatRunPrismaDelegate }).specCompatRun;
  return d && typeof d.create === 'function' ? d : null;
}

export function resetSpecMonitorForTest(deps: SpecMonitorDeps | null = null): void {
  baselineReport = null;
  consecutiveUnverifiable = 0;
  lastCheckAt = 0;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
  monitorDepsOverride = deps;
  memoryHistory.length = 0;
  alertedKeys.clear();
}

function driftDedupeKey(report: SpecCompatReport, diffs: SpecDiff[]): string {
  const wiringPart = report.wiring
    ? `wiring:${report.wiring.resolver.actual ?? 'null'}:${report.wiring.treasury.actual ?? 'null'}`
    : '';
  const wasmPart = report.contracts
    .map((c) => `${c.contract}:${c.wasmHash ?? c.kind}`)
    .sort()
    .join('|');
  const diffPart = diffs
    .map((d) => `${d.contract}:${d.item}:${d.change}`)
    .sort()
    .join('|');
  const digest = crypto
    .createHash('sha256')
    .update(`${wasmPart}#${wiringPart}#${diffPart}`)
    .digest('hex')
    .slice(0, 16);
  const hasWiring = diffs.some((d) => d.item === 'wiring');
  return hasWiring ? `spec:wiring:${digest}` : `spec:${digest}`;
}

async function emitSpecAlert(
  level: AlertLevel,
  key: string,
  title: string,
  diffs: SpecDiff[],
  affected: CompatAgentScope[],
  deps: SpecMonitorDeps,
): Promise<void> {
  if (alertedKeys.has(`${key}:${level}`)) return;
  alertedKeys.add(`${key}:${level}`);

  const detailLines = diffs.map((d) => `${d.contract} ${d.item}: ${d.change} [${d.severity}]`);
  if (affected.length > 0) {
    detailLines.push(`Affected scopes: ${affected.join(', ')}`);
  }
  const alert: Alert = {
    level,
    title,
    marketId: 'spec-compat',
    onChainMarketId: 'spec-compat',
    proposedOutcome: 'N/A',
    verdict: level === 'CRITICAL' ? 'BREAKING_SPEC_DRIFT' : 'SPEC_DRIFT',
    windowRemainingSecs: null,
    links: {
      market: '/api/v1/admin/chain/spec-compat',
      cancelTx: '/api/v1/admin/chain/spec-compat/ack',
    },
    detail: detailLines.join('\n'),
  };

  try {
    const svc = deps.alertService ?? new AlertService();
    await svc.send(key, alert);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, key, level }, 'spec-monitor: alert delivery failed');
  }
}

async function persistRun(record: SpecCompatRunRecord): Promise<void> {
  memoryHistory.unshift(record);
  if (memoryHistory.length > 200) memoryHistory.length = 200;

  const del = runDelegate();
  if (!del) return;
  try {
    await del.create({
      data: {
        id: record.id,
        checkedAt: record.checkedAt,
        trigger: record.trigger,
        cls: record.cls,
        ok: record.ok,
        report: record.report as unknown as Record<string, unknown>,
        affected: record.affected,
      },
    });
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : err }, 'spec-monitor: could not persist spec_compat_runs row');
  }
}

async function releaseAckedDriftHolds(reason: string): Promise<boolean> {
  const holds = await readHolds();
  const ackedDrift = holds.filter((h) => h.source === 'spec_drift' && (!h.ackRequired || Boolean(h.ackedBy)));
  let releasedAny = false;
  for (const h of ackedDrift) {
    const rel = await releaseControlHold(h.scope, 'spec_drift', h.ackedBy ?? 'system', reason);
    if (rel) releasedAny = true;
  }
  return releasedAny;
}

/**
 * Syncs process-local `specCompatReport()` and `disabledEventProjections()`
 * from the newest `spec_compat_runs` row written by the lock holder instance.
 */
export async function syncLatestSpecReportFromDb(): Promise<SpecCompatReport | null> {
  const del = runDelegate();
  if (!del) return specCompatReport();
  try {
    const latest = await del.findFirst({ orderBy: { checkedAt: 'desc' } });
    if (latest?.report) {
      return applyReport(latest.report);
    }
  } catch {}
  return specCompatReport();
}

/**
 * Executes one spec compatibility check, classifies drift against the baseline
 * report, enforces the pause/hold policy, persists a `spec_compat_runs` row,
 * and sends deduplicated alerts.
 */
export async function runSpecCheck(
  trigger: string,
  deps: SpecMonitorDeps = monitorDepsOverride ?? {},
): Promise<SpecCompatRunRecord> {
  const nowFn = deps.now ?? Date.now;
  lastCheckAt = nowFn();

  const baseline = baselineReport ?? bootSpecCompatReport() ?? specCompatReport();
  const report = await computeSpecCompat(deps);
  const { cls, affected, diffs } = classify(baseline, report);

  const record: SpecCompatRunRecord = {
    id: crypto.randomUUID(),
    checkedAt: new Date(nowFn()),
    trigger,
    cls,
    ok: report.ok,
    report,
    affected,
  };

  const threshold = deps.unverifiableRunsThreshold ?? config.SPEC_COMPAT_UNVERIFIABLE_RUNS;
  const baseBackoffMs = deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;

  if (cls === 'unverifiable') {
    consecutiveUnverifiable++;
    await persistRun(record);

    if (consecutiveUnverifiable < threshold) {
      const delayMs = baseBackoffMs * 2 ** (consecutiveUnverifiable - 1);
      logger.warn(
        { trigger, consecutiveUnverifiable, threshold, delayMs, diffs },
        'spec-monitor: contract spec unverifiable; scheduling backoff retry',
      );
      if (!backoffTimer) {
        backoffTimer = setTimeout(() => {
          backoffTimer = null;
          void runSpecCheck(`retry:${consecutiveUnverifiable}`, deps).catch(() => undefined);
        }, delayMs);
        backoffTimer.unref();
      }
      return record;
    }

    // Persistent unverifiable result escalates to pause + WARN alert.
    applyReport(report);
    const reason = `Persistent unverifiable contract spec (${consecutiveUnverifiable} consecutive checks): ${diffs.map((d) => `${d.contract} ${d.change}`).join('; ')}`;
    for (const scope of affected) {
      await placeControlHold(scope as AgentScope, {
        source: 'spec_drift',
        reason,
        ackRequired: true,
        actor: 'system',
      });
    }
    const key = driftDedupeKey(report, diffs);
    await emitSpecAlert('WARN', key, 'Persistent unverifiable contract spec', diffs, affected, deps);
    return record;
  }

  consecutiveUnverifiable = 0;
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }

  if (cls === 'breaking') {
    applyReport(report);
    await persistRun(record);

    const reason = `Breaking contract spec drift (${trigger}): ${diffs.map((d) => `${d.contract} ${d.item} ${d.change}`).join('; ')}`;
    for (const scope of affected) {
      await placeControlHold(scope as AgentScope, {
        source: 'spec_drift',
        reason,
        ackRequired: true,
        actor: 'system',
      });
    }
    const key = driftDedupeKey(report, diffs);
    await emitSpecAlert('CRITICAL', key, 'Breaking contract spec or wiring drift detected', diffs, affected, deps);
    return record;
  }

  if (cls === 'compatible') {
    applyReport(report);
    baselineReport = report;
    await persistRun(record);
    await releaseAckedDriftHolds('spec-compat check passed (compatible)');

    logger.warn({ trigger, diffs }, 'spec-monitor: compatible contract spec drift detected');
    const key = driftDedupeKey(report, diffs);
    await emitSpecAlert('WARN', key, 'Compatible contract spec drift detected', diffs, affected, deps);
    return record;
  }

  // cls === 'unchanged'
  applyReport(report);
  if (!baselineReport && report.ok) {
    baselineReport = report;
  }
  await persistRun(record);
  if (report.ok) {
    await releaseAckedDriftHolds('spec-compat check passed');
  }
  return record;
}

/**
 * Debounced on-demand check triggered by suspicious runtime signals
 * (`decode_failure:<contract>`, `unknown_contract_error:<contract>:<n>`,
 * `simulation_failure:<scope>`). Runs at most once per `SPEC_COMPAT_MIN_GAP_MS`.
 */
export function requestSpecCheck(
  reason: string,
  deps: SpecMonitorDeps = monitorDepsOverride ?? {},
): boolean {
  if (effectiveMode() === 'off') return false;
  const nowFn = deps.now ?? Date.now;
  const minGapMs = deps.minGapMs ?? config.SPEC_COMPAT_MIN_GAP_MS;
  const elapsed = nowFn() - lastCheckAt;

  if (lastCheckAt === 0 || elapsed >= minGapMs) {
    lastCheckAt = nowFn();
    void runSpecCheck(reason, deps).catch((err) =>
      logger.warn({ err: err instanceof Error ? err.message : err, reason }, 'spec-monitor: on-demand check failed'),
    );
    return true;
  }

  if (!debounceTimer) {
    const remaining = Math.max(10, minGapMs - elapsed);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runSpecCheck(reason, deps).catch((err) =>
        logger.warn({ err: err instanceof Error ? err.message : err, reason }, 'spec-monitor: debounced check failed'),
      );
    }, remaining);
    debounceTimer.unref();
  }
  return false;
}

/**
 * Starts the periodic runtime spec compatibility monitor (#322).
 * Runs under the `spec-compat` Postgres advisory lock so one instance checks
 * RPC per interval while peer instances sync from `spec_compat_runs`.
 */
export function startSpecMonitor(deps: SpecMonitorDeps = {}): () => void {
  if (effectiveMode() === 'off') {
    return () => undefined;
  }

  const tick = async () => {
    try {
      if (deps.useAdvisoryLock === false) {
        await runSpecCheck('periodic', deps);
        return;
      }
      const locked = await withAdvisoryLock(LOCK_KEY, async () => {
        await runSpecCheck('periodic', deps);
      });
      if (!locked.acquired) {
        await syncLatestSpecReportFromDb();
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'spec-monitor: periodic check failed');
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, config.SPEC_COMPAT_INTERVAL_MS);
  timer.unref();

  return () => {
    clearInterval(timer);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (backoffTimer) {
      clearTimeout(backoffTimer);
      backoffTimer = null;
    }
  };
}

/**
 * Operator acknowledgement for `POST /admin/chain/spec-compat/ack` (#322).
 * Marks active `spec_drift` holds acknowledged by `actor`, triggers a fresh
 * check, and clears the holds immediately if the check passes.
 */
export async function acknowledgeSpecDrift(
  actor: string,
  deps: SpecMonitorDeps = monitorDepsOverride ?? {},
): Promise<{
  acknowledged: boolean;
  actor: string;
  cleared: boolean;
  holds: ControlHoldRow[];
  run: SpecCompatRunRecord;
}> {
  await acknowledgeControlHolds('spec_drift', actor);
  const run = await runSpecCheck(`ack:${actor}`, deps);
  let cleared = false;
  if (run.ok) {
    for (const scope of ['ALL', 'MARKET_MAKER', 'TRADER'] as const) {
      const rel = await releaseControlHold(scope, 'spec_drift', actor, 'acknowledged and spec-compat check passed');
      if (rel) cleared = true;
    }
  }
  const holds = (await readHolds()).filter((h) => h.source === 'spec_drift');
  return {
    acknowledged: true,
    actor,
    cleared: run.ok || holds.length === 0 || cleared,
    holds,
    run,
  };
}

/** Paginated status and run history for `GET /admin/chain/spec-compat`. */
export async function getSpecCompatHistory(params: {
  skip: number;
  take: number;
}): Promise<{
  mode: ReturnType<typeof effectiveMode>;
  report: SpecCompatReport | null;
  boot: SpecCompatReport | null;
  current: SpecCompatReport | null;
  history: SpecCompatRunRecord[];
  total: number;
}> {
  let history: SpecCompatRunRecord[] = [];
  let total = 0;

  const del = runDelegate();
  if (del) {
    try {
      const [rows, count] = await Promise.all([
        del.findMany({
          orderBy: { checkedAt: 'desc' },
          skip: params.skip,
          take: params.take,
        }),
        del.count(),
      ]);
      history = rows;
      total = count;
    } catch {
      history = memoryHistory.slice(params.skip, params.skip + params.take);
      total = memoryHistory.length;
    }
  } else {
    history = memoryHistory.slice(params.skip, params.skip + params.take);
    total = memoryHistory.length;
  }

  const current = specCompatReport();
  const boot = bootSpecCompatReport() ?? current;
  return {
    mode: effectiveMode(),
    report: current,
    boot,
    current,
    history,
    total,
  };
}
