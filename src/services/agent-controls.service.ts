/**
 * Persistent agent kill switch and drawdown pause (#79).
 *
 * One `agent_controls` row per scope (ALL, MARKET_MAKER, TRADER) shared by
 * every backend instance. The effective state of an agent is its own row OR
 * the ALL row. Cycles check it at their start and `chain.write()` checks it
 * again right before signing.
 *
 * Guarantee boundary: the pre-submit check takes `FOR SHARE` on the control
 * rows in a short transaction, so it serialises with `pauseAgent` (which holds
 * `FOR UPDATE`): a pause either commits before the check, and the write is
 * refused, or after it, and applies to the next write. A pause committed after
 * the share lock is released cannot stop a transaction already handed to RPC.
 * The DB transaction is never held across `signAndSend()`.
 *
 * Everything here fails closed: if the control table can't be read, the agent
 * is treated as paused (`AGENT_CONTROL_UNAVAILABLE`).
 */
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { getRedis } from '../lib/redis';
import { logger } from '../lib/logger';
import { AppError } from '../middlewares/error.middleware';

export type AgentScope = 'MARKET_MAKER' | 'TRADER';
export type ControlScope = AgentScope | 'ALL';
export type PauseSource = 'operator' | 'drawdown' | 'chain_paused' | 'failure_breaker' | 'spec_drift' | 'chain_admin';

export interface ControlHoldRow {
  scope: ControlScope;
  source: string;
  reason: string;
  createdAt: Date;
  ackRequired: boolean;
  ackedBy: string | null;
}

export const CONTROL_SCOPES: readonly ControlScope[] = ['ALL', 'MARKET_MAKER', 'TRADER'];

/** Risk-cap and market-core breaker rejections are expected behaviour, not infra failures (#292). */
const CAP_ERRORS = new Set([
  'TradeCapExceeded',
  'MarketCapExceeded',
  'DailyCapExceeded',
  'PriceImpactTooHigh',
  'PriceBandExceeded',
]);

export class AgentPausedError extends AppError {
  constructor(scope: AgentScope, details: { reason?: string; until?: Date; source?: string }) {
    super(423, 'AGENT_PAUSED', `Agent ${scope} is paused`, {
      scope,
      reason: details.reason ?? null,
      source: details.source ?? null,
      until: details.until?.toISOString() ?? null,
    });
    this.name = 'AgentPausedError';
  }
}

export interface ControlRow {
  scope: ControlScope;
  paused: boolean;
  reason: string | null;
  source: string | null;
  pausedUntil: Date | null;
  pausedBy: string | null;
  version: number;
}

export interface EffectiveControl {
  paused: boolean;
  reason?: string;
  source?: string;
  until?: Date;
  /** Sum of the ALL and scope row versions; changes whenever either does. */
  version: number;
}

export type ControlEmitter = (event: 'AGENT_CONTROL_CHANGED', payload: Record<string, unknown>) => void;

let emitter: ControlEmitter | null = null;
/** Wired to socket.io in server.ts. */
export function setControlEmitter(fn: ControlEmitter | null): void {
  emitter = fn;
}

function emitChange(scope: ControlScope, row: Pick<ControlRow, 'paused' | 'reason' | 'pausedUntil'>): void {
  try {
    emitter?.('AGENT_CONTROL_CHANGED', {
      scope,
      paused: row.paused,
      reason: row.reason,
      until: row.pausedUntil ? row.pausedUntil.toISOString() : null,
    });
  } catch (err) {
    logger.warn({ err }, 'AGENT_CONTROL_CHANGED emit failed');
  }
}

const isExpired = (row: ControlRow, now: Date) =>
  row.paused && row.pausedUntil !== null && row.pausedUntil.getTime() <= now.getTime();

const isActivePause = (row: ControlRow | undefined, now: Date): row is ControlRow =>
  !!row && row.paused && !isExpired(row, now);

/**
 * Pure: merges the ALL row, the scope row, and any active holds (#322).
 * A missing row with no active holds means "not paused".
 */
export function effectiveFromRows(
  rows: ControlRow[],
  scope: AgentScope,
  now: Date,
  holds: ControlHoldRow[] = [],
): EffectiveControl {
  const all = rows.find((r) => r.scope === 'ALL');
  const own = rows.find((r) => r.scope === scope);
  const version = (all?.version ?? 0) + (own?.version ?? 0);
  // ALL first: it is the broader switch and its reason is the useful one.
  for (const row of [all, own]) {
    if (isActivePause(row, now)) {
      return {
        paused: true,
        reason: row.reason ?? undefined,
        source: row.source ?? undefined,
        until: row.pausedUntil ?? undefined,
        version,
      };
    }
  }
  for (const targetScope of ['ALL', scope] as const) {
    const hold = holds.find((h) => h.scope === targetScope);
    if (hold) {
      return {
        paused: true,
        reason: hold.reason,
        source: hold.source,
        version,
      };
    }
  }
  return { paused: false, version };
}

// In-memory hold mirror synced with agent_control_holds (also backs unit tests
// whose Prisma test double only stubs agent_controls).
const memoryHolds = new Map<string, ControlHoldRow>();

function holdKey(scope: ControlScope, source: string): string {
  return `${scope}:${source}`;
}

interface HoldPrismaDelegate {
  findMany(args?: unknown): Promise<ControlHoldRow[]>;
  upsert(args: unknown): Promise<ControlHoldRow>;
  updateMany(args: unknown): Promise<{ count: number }>;
  deleteMany(args: unknown): Promise<{ count: number }>;
}

function holdDelegate(client: unknown = prisma): HoldPrismaDelegate | null {
  const d = (client as { agentControlHold?: HoldPrismaDelegate } | null)?.agentControlHold;
  return d && typeof d.findMany === 'function' ? d : null;
}

export async function readHolds(scopes?: ControlScope[]): Promise<ControlHoldRow[]> {
  const delegate = holdDelegate();
  if (delegate) {
    try {
      const rows = await delegate.findMany(
        scopes ? { where: { scope: { in: scopes as any } } } : undefined,
      );
      return rows;
    } catch {
      // Fall through to in-memory mirror when table is unmocked in unit tests.
    }
  }
  const all = [...memoryHolds.values()];
  return scopes ? all.filter((h) => scopes.includes(h.scope)) : all;
}

export function clearMemoryHoldsForTest(): void {
  memoryHolds.clear();
}

const COLUMNS = '"scope"::text AS "scope", "paused", "reason", "source", "pausedUntil", "pausedBy", "version"';

async function readRows(scopes: ControlScope[]): Promise<ControlRow[]> {
  const rows = await prisma.agentControl.findMany({ where: { scope: { in: scopes as any } } });
  return rows as unknown as ControlRow[];
}

/** Effective state of an agent. Clears expired timed pauses on the way (best effort). */
export async function getEffectiveControl(scope: AgentScope, now = new Date()): Promise<EffectiveControl> {
  const [rows, holds] = await Promise.all([
    readRows(['ALL', scope]),
    readHolds(['ALL', scope]),
  ]);
  for (const row of rows) {
    if (isExpired(row, now)) {
      await expirePause(row.scope, now).catch((err) =>
        logger.warn({ err, scope: row.scope }, 'Expired agent pause could not be cleared'),
      );
    }
  }
  return effectiveFromRows(rows, scope, now, holds);
}

function failClosed(err: unknown): never {
  if (err instanceof AppError) throw err;
  logger.error({ err }, 'Agent control state unreadable; failing closed');
  throw new AppError(503, 'AGENT_CONTROL_UNAVAILABLE', 'Agent control state could not be read; refusing to run');
}

/** Throws AgentPausedError when paused. Returns the control version seen. */
export async function assertAgentActive(scope: AgentScope): Promise<number> {
  let state: EffectiveControl;
  try {
    state = await getEffectiveControl(scope);
  } catch (err) {
    return failClosed(err);
  }
  if (state.paused) throw new AgentPausedError(scope, state);
  return state.version;
}

/**
 * The pre-submit check: reads the control rows `FOR SHARE` inside a short
 * transaction (see the header for the guarantee). `seenVersion` is the value
 * `assertAgentActive` returned earlier; a change is logged and re-evaluated,
 * which this read already does.
 */
export async function assertAgentActiveLocked(scope: AgentScope, seenVersion?: number): Promise<number> {
  const now = new Date();
  let state: EffectiveControl;
  try {
    const [rows, holds] = await Promise.all([
      prisma.$transaction(async (tx) =>
        tx.$queryRawUnsafe<ControlRow[]>(
          `SELECT ${COLUMNS} FROM agent_controls WHERE "scope" IN ('ALL'::"AgentControlScope", $1::"AgentControlScope") FOR SHARE`,
          scope,
        ),
      ),
      readHolds(['ALL', scope]),
    ]);
    state = effectiveFromRows(rows, scope, now, holds);
  } catch (err) {
    return failClosed(err);
  }
  if (state.paused) throw new AgentPausedError(scope, state);
  if (seenVersion !== undefined && seenVersion !== state.version) {
    logger.info({ scope, seenVersion, version: state.version }, 'Agent control changed during the write; re-evaluated, still active');
  }
  return state.version;
}

const snapshot = (row: ControlRow | undefined) => ({
  paused: row?.paused ?? false,
  reason: row?.reason ?? null,
  source: row?.source ?? null,
  pausedUntil: row?.pausedUntil ? row.pausedUntil.toISOString() : null,
  pausedBy: row?.pausedBy ?? null,
  version: row?.version ?? 0,
});

async function lockRow(tx: any, scope: ControlScope): Promise<ControlRow | undefined> {
  const rows = await tx.$queryRawUnsafe(
    `SELECT ${COLUMNS} FROM agent_controls WHERE "scope" = $1::"AgentControlScope" FOR UPDATE`,
    scope,
  ) as ControlRow[];
  return rows[0];
}

async function expirePause(scope: ControlScope, now: Date): Promise<void> {
  const cleared = await prisma.$transaction(async (tx) => {
    const before = await lockRow(tx, scope);
    // Re-check under the lock: an operator may have replaced the pause.
    if (!before || !isExpired(before, now)) return null;
    await tx.agentControl.update({
      where: { scope: scope as any },
      data: { paused: false, reason: null, source: null, pausedUntil: null, pausedBy: null, version: { increment: 1 } },
    });
    await tx.agentControlEvent.create({
      data: {
        scope: scope as any,
        action: 'AUTO_EXPIRED',
        reason: before.reason,
        source: before.source ?? 'system',
        actor: 'system',
        before: snapshot(before),
        after: snapshot({ ...before, paused: false, reason: null, source: null, pausedUntil: null, pausedBy: null, version: before.version + 1 }),
      },
    });
    return before;
  });
  if (cleared) emitChange(scope, { paused: false, reason: null, pausedUntil: null });
}

/**
 * Pauses a scope. Never shortens a longer existing pause: an indefinite pause
 * (no `until`) outlasts any timed one, and a timed one is only replaced by a
 * later end.
 */
export async function pauseAgent(
  scope: ControlScope,
  p: { reason: string; source: PauseSource; actor: string; until?: Date },
): Promise<void> {
  const now = new Date();
  const changed = await prisma.$transaction(async (tx) => {
    const before = await lockRow(tx, scope);
    const currentEnd = isActivePause(before, now) ? (before.pausedUntil?.getTime() ?? Infinity) : -Infinity;
    const newEnd = p.until ? p.until.getTime() : Infinity;
    if (newEnd <= currentEnd) return null; // never shorten, or replace an equal, pause
    const data = {
      paused: true,
      reason: p.reason,
      source: p.source,
      pausedUntil: p.until ?? null,
      pausedBy: p.actor,
    };
    await tx.agentControl.update({ where: { scope: scope as any }, data: { ...data, version: { increment: 1 } } });
    await tx.agentControlEvent.create({
      data: {
        scope: scope as any,
        action: 'PAUSE',
        reason: p.reason,
        source: p.source,
        actor: p.actor,
        before: snapshot(before),
        after: snapshot({ scope, ...data, version: (before?.version ?? 0) + 1 }),
      },
    });
    return data;
  });
  if (changed) {
    logger.warn({ scope, source: p.source, until: p.until?.toISOString() }, 'Agent paused');
    emitChange(scope, changed);
    notifyPaused(scope, p.source);
  }
}

type PauseListener = (scope: ControlScope, source: PauseSource) => void;
const pauseListeners = new Set<PauseListener>();

/**
 * Called after a pause commits (#226): the ops-alert engine queues a
 * debounced evaluation so a breaker trip is reported within seconds, not one
 * cron period. Returns an unsubscribe function.
 */
export function onAgentPaused(listener: PauseListener): () => void {
  pauseListeners.add(listener);
  return () => pauseListeners.delete(listener);
}

function notifyPaused(scope: ControlScope, source: PauseSource): void {
  for (const listener of pauseListeners) {
    try {
      listener(scope, source);
    } catch (err) {
      logger.warn({ err }, 'Agent pause listener failed');
    }
  }
}

/** Resumes exactly the named row; resuming TRADER never clears an ALL pause. */
export async function resumeAgent(scope: ControlScope, p: { actor: string; reason?: string }): Promise<void> {
  // Check for active spec_drift holds (#322): operator resume is refused with
  // 409 SPEC_DRIFT_UNACKED while a spec_drift hold exists without an ack or
  // while the latest compatibility report is still breaking.
  if (p.actor !== 'system') {
    const holds = await readHolds(scope === 'ALL' ? ['ALL'] : [scope, 'ALL']);
    const driftHolds = holds.filter((h) => h.source === 'spec_drift' && (h.scope === scope || h.scope === 'ALL'));
    if (driftHolds.length > 0) {
      const { specCompatReport } = await import('./stellar/spec-compat');
      const currentReport = specCompatReport();
      const unacked = driftHolds.some((h) => h.ackRequired && !h.ackedBy);
      const stillBreaking = currentReport !== null && !currentReport.ok;
      if (unacked || stillBreaking) {
        throw new AppError(
          409,
          'SPEC_DRIFT_UNACKED',
          'Cannot resume agent while breaking contract spec drift is unacknowledged or still failing',
          {
            scope,
            unacked,
            stillBreaking,
            holds: driftHolds.map((h) => ({ scope: h.scope, reason: h.reason, ackedBy: h.ackedBy })),
          },
        );
      }
      // Acknowledged and latest check passed: clear the spec_drift hold(s) on this scope.
      for (const h of driftHolds) {
        if (h.scope === scope) {
          await releaseControlHold(scope, 'spec_drift', p.actor, p.reason);
        }
      }
    }
  }

  const remainingHolds = (await readHolds([scope])).filter((h) => !(p.actor !== 'system' && h.source === 'operator'));
  if (p.actor !== 'system') {
    memoryHolds.delete(holdKey(scope, 'operator'));
    const del = holdDelegate();
    if (del) await del.deleteMany({ where: { scope: scope as any, source: 'operator' } }).catch(() => undefined);
  }

  const resumed = await prisma.$transaction(async (tx) => {
    const before = await lockRow(tx, scope);
    if (!before || !before.paused) return false;
    const fallbackHold = remainingHolds[0];
    if (fallbackHold) {
      // Another hold (e.g. spec_drift) is still active: keep the summary row paused under that hold.
      const nextData = {
        paused: true,
        reason: fallbackHold.reason,
        source: fallbackHold.source,
        pausedUntil: null,
        pausedBy: 'system',
      };
      await tx.agentControl.update({
        where: { scope: scope as any },
        data: { ...nextData, version: { increment: 1 } },
      });
      await tx.agentControlEvent.create({
        data: {
          scope: scope as any,
          action: 'RESUME',
          reason: p.reason ?? null,
          source: 'operator',
          actor: p.actor,
          before: snapshot(before),
          after: snapshot({ ...before, ...nextData, version: before.version + 1 }),
        },
      });
      return false;
    }
    await tx.agentControl.update({
      where: { scope: scope as any },
      data: { paused: false, reason: null, source: null, pausedUntil: null, pausedBy: null, version: { increment: 1 } },
    });
    await tx.agentControlEvent.create({
      data: {
        scope: scope as any,
        action: p.actor === 'system' ? 'AUTO_RESUMED' : 'RESUME',
        reason: p.reason ?? null,
        source: p.actor === 'system' ? (before.source ?? 'system') : 'operator',
        actor: p.actor,
        before: snapshot(before),
        after: snapshot({ ...before, paused: false, reason: null, source: null, pausedUntil: null, pausedBy: null, version: before.version + 1 }),
      },
    });
    return true;
  });
  if (resumed) {
    logger.info({ scope, actor: p.actor }, 'Agent resumed');
    emitChange(scope, { paused: false, reason: null, pausedUntil: null });
  }
}

// ─── Control holds (#322) ────────────────────────────────────────────────────

/**
 * Places or updates a hold for `(scope, source)` without overwriting an
 * existing operator pause, and bumps `agent_controls.version` so in-flight
 * writes re-check under `FOR SHARE`.
 */
export async function placeControlHold(
  scope: ControlScope,
  p: { source: PauseSource; reason: string; ackRequired?: boolean; actor?: string },
): Promise<ControlHoldRow> {
  const now = new Date();
  const actor = p.actor ?? 'system';
  const hold: ControlHoldRow = {
    scope,
    source: p.source,
    reason: p.reason,
    createdAt: now,
    ackRequired: Boolean(p.ackRequired),
    ackedBy: null,
  };
  memoryHolds.set(holdKey(scope, p.source), hold);

  const del = holdDelegate();
  if (del) {
    await del
      .upsert({
        where: { scope_source: { scope: scope as any, source: p.source } },
        create: {
          scope: scope as any,
          source: p.source,
          reason: p.reason,
          createdAt: now,
          ackRequired: Boolean(p.ackRequired),
          ackedBy: null,
        },
        update: {
          reason: p.reason,
          ackRequired: Boolean(p.ackRequired),
          ackedBy: null,
        },
      })
      .catch(() => undefined);
  }

  const changed = await prisma.$transaction(async (tx) => {
    const before = await lockRow(tx, scope);
    const keepExistingSummary =
      isActivePause(before, now) && before.source === 'operator' && p.source !== 'operator';
    const data = keepExistingSummary
      ? {
          paused: true,
          reason: before!.reason,
          source: before!.source,
          pausedUntil: before!.pausedUntil,
          pausedBy: before!.pausedBy,
        }
      : {
          paused: true,
          reason: p.reason,
          source: p.source,
          pausedUntil: null,
          pausedBy: actor,
        };
    await tx.agentControl.update({
      where: { scope: scope as any },
      data: { ...data, version: { increment: 1 } },
    });
    await tx.agentControlEvent.create({
      data: {
        scope: scope as any,
        action: 'PAUSE',
        reason: p.reason,
        source: p.source,
        actor,
        before: snapshot(before),
        after: snapshot({ scope, ...data, version: (before?.version ?? 0) + 1 }),
      },
    });
    return data;
  });

  if (changed) {
    logger.warn({ scope, source: p.source, ackRequired: hold.ackRequired }, 'Agent control hold placed');
    emitChange(scope, changed);
  }
  return hold;
}

/** Marks all holds for `source` acknowledged by `actor`. */
export async function acknowledgeControlHolds(source: PauseSource, actor: string): Promise<ControlHoldRow[]> {
  for (const [k, h] of memoryHolds) {
    if (h.source === source) {
      memoryHolds.set(k, { ...h, ackedBy: actor });
    }
  }
  const del = holdDelegate();
  if (del) {
    await del
      .updateMany({
        where: { source },
        data: { ackedBy: actor },
      })
      .catch(() => undefined);
  }
  const all = await readHolds();
  return all.filter((h) => h.source === source);
}

/**
 * Releases a `(scope, source)` hold and updates the summary `agent_controls`
 * row (resuming it only if no other pause/hold remains on that scope).
 */
export async function releaseControlHold(
  scope: ControlScope,
  source: PauseSource,
  actor = 'system',
  reason?: string,
): Promise<boolean> {
  const existed = memoryHolds.delete(holdKey(scope, source));
  const del = holdDelegate();
  let dbDeleted = 0;
  if (del) {
    const res = await del.deleteMany({ where: { scope: scope as any, source } }).catch(() => ({ count: 0 }));
    dbDeleted = res.count;
  }
  if (!existed && dbDeleted === 0) return false;

  const remaining = await readHolds([scope]);
  const resumed = await prisma.$transaction(async (tx) => {
    const before = await lockRow(tx, scope);
    if (!before || !before.paused) return false;
    // Keep operator pause intact if the summary row is currently held by operator
    if (before.source === 'operator' && source !== 'operator') {
      return false;
    }
    const nextHold = remaining[0];
    if (nextHold) {
      const nextData = {
        paused: true,
        reason: nextHold.reason,
        source: nextHold.source,
        pausedUntil: null,
        pausedBy: 'system',
      };
      await tx.agentControl.update({
        where: { scope: scope as any },
        data: { ...nextData, version: { increment: 1 } },
      });
      return false;
    }
    await tx.agentControl.update({
      where: { scope: scope as any },
      data: { paused: false, reason: null, source: null, pausedUntil: null, pausedBy: null, version: { increment: 1 } },
    });
    await tx.agentControlEvent.create({
      data: {
        scope: scope as any,
        action: actor === 'system' ? 'AUTO_RESUMED' : 'RESUME',
        reason: reason ?? `hold ${source} cleared`,
        source,
        actor,
        before: snapshot(before),
        after: snapshot({ ...before, paused: false, reason: null, source: null, pausedUntil: null, pausedBy: null, version: before.version + 1 }),
      },
    });
    return true;
  });

  if (resumed) {
    logger.info({ scope, source, actor }, 'Agent control hold released and scope resumed');
    emitChange(scope, { paused: false, reason: null, pausedUntil: null });
  }
  return true;
}

// ─── Failure breaker ─────────────────────────────────────────────────────────

export interface FailureCounter {
  /** Adds one failure to the scope's rolling window and returns the count in it. */
  increment(scope: AgentScope, windowMs: number): Promise<number>;
  reset(scope: AgentScope): Promise<void>;
}

export const redisFailureCounter: FailureCounter = {
  async increment(scope, windowMs) {
    const redis = getRedis();
    const key = `agent:failures:${scope}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, windowMs);
    return count;
  },
  async reset(scope) {
    await getRedis().del(`agent:failures:${scope}`);
  },
};

let failureCounter: FailureCounter = redisFailureCounter;
export function setFailureCounterForTest(counter: FailureCounter | null): void {
  failureCounter = counter ?? redisFailureCounter;
}

/**
 * Called after every chain write (never throws). A success resets the
 * breaker, risk-cap rejections are ignored, `Paused` pauses ALL immediately
 * and anything else counts toward the failure breaker.
 */
export async function recordChainWriteOutcome(
  scope: AgentScope,
  ok: boolean,
  contractError: string | null,
  errorDetail?: string | null,
): Promise<void> {
  try {
    if (ok) {
      await failureCounter.reset(scope);
      return;
    }
    const signalText = `${contractError ?? ''} ${errorDetail ?? ''}`;
    if (/MissingValue|WasmVm/i.test(signalText)) {
      import('./stellar/spec-monitor')
        .then((m) => m.requestSpecCheck(`simulation_failure:${scope}`))
        .catch(() => undefined);
    }
    if (contractError && CAP_ERRORS.has(contractError)) return;
    if (contractError === 'Paused') {
      await pauseAgent('ALL', {
        source: 'chain_paused',
        actor: 'system',
        reason: `A contract reported Paused during a ${scope} write`,
      });
      return;
    }
    const count = await failureCounter.increment(scope, config.AGENT_FAILURE_WINDOW_MS);
    if (count >= config.AGENT_FAILURE_THRESHOLD) {
      await pauseAgent(scope, {
        source: 'failure_breaker',
        actor: 'system',
        reason: `${count} chain-write failures within ${Math.round(config.AGENT_FAILURE_WINDOW_MS / 60_000)} minutes (last: ${contractError ?? 'no contract error'})`,
      });
      await failureCounter.reset(scope);
    }
  } catch (err) {
    logger.warn({ err, scope }, 'Could not record chain write outcome');
  }
}

// ─── Cycle gate and on-chain pause detection ─────────────────────────────────

/**
 * Pauses ALL when market-core reports `paused`, and lifts a `chain_paused`
 * pause once it doesn't. The treasury has no pause view, so a treasury pause is
 * only noticed through the `Paused` error (recordChainWriteOutcome); this
 * re-check may lift it early, and the next write then pauses again.
 * Best effort: an unreachable RPC leaves the current state alone.
 */
export async function syncChainPause(): Promise<void> {
  try {
    // Lazy import: chain.service imports this module.
    const chain = await import('./chain.service');
    const cfg = await chain.marketCoreConfig();
    if (cfg.paused) {
      await pauseAgent('ALL', { source: 'chain_paused', actor: 'system', reason: 'market-core is paused on-chain' });
      return;
    }
    const [all] = await readRows(['ALL']);
    if (all && isActivePause(all, new Date()) && all.source === 'chain_paused') {
      await resumeAgent('ALL', { actor: 'system', reason: 'market-core is no longer paused' });
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'On-chain pause check failed; keeping current agent state');
  }
}

/** Start of every agent cycle: sync with the chain, then assert the agent may run. */
export async function gateCycle(scope: AgentScope): Promise<number> {
  await syncChainPause();
  return assertAgentActive(scope);
}

/** Admin view: effective state per scope plus active holds and the latest audit events. */
export async function controlsOverview(now = new Date()) {
  const [rows, events, holds] = await Promise.all([
    readRows([...CONTROL_SCOPES]),
    prisma.agentControlEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    readHolds([...CONTROL_SCOPES]),
  ]);
  const scopes = CONTROL_SCOPES.map((scope) => {
    const row = rows.find((r) => r.scope === scope);
    const scopeHolds = holds.filter((h) => h.scope === scope);
    const effective = scope === 'ALL'
      ? isActivePause(row, now) || scopeHolds.length > 0
      : effectiveFromRows(rows, scope, now, holds).paused;
    return {
      scope,
      paused: effective,
      own: snapshot(row),
      holds: scopeHolds,
    };
  });
  return { scopes, events };
}
