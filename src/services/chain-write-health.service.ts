/**
 * Chain-write readiness probes (#220): outbox backlog and age, completion
 * handler failure streaks, signer (agent / fee payer) balances with runway,
 * and channel-pool health.
 *
 * They only matter on an instance that writes. On any other instance
 * (dry-run, or a role without the outbox worker) every probe reports
 * { ok: true, detail: { writer: false } } without querying anything and is
 * never critical, so a dry fee payer cannot make API-only pods unready.
 *
 * Results are tri-state: failing (ok: false), degraded (ok: true, state
 * 'degraded', /readyz still 200) and ok.
 */
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { getRedis } from '../lib/redis';
import { rpcServer } from './stellar/clients';
import { getChannelPool } from './stellar/channels';
import { handlerHealth, outboxWorkerRunning, type HandlerStreak } from './stellar/outbox';
import {
  balanceView,
  configuredSigners,
  createBalanceMonitor,
  readSpend24h,
  xlmToStroops,
  type BalanceMonitor,
  type BalanceSnapshot,
} from './stellar/balances';
import type { Probe, ProbeContext } from './health.service';

type ProbeOutcome = Awaited<ReturnType<Probe['run']>>;

/**
 * Whether this instance lands chain writes. Dry-run never writes, whatever
 * HEALTH_CHAIN_WRITER says; auto means the outbox worker runs here (the
 * PROCESS_ROLE plan's startOutbox, #272).
 */
export function isChainWriter(workerRunning: () => boolean = outboxWorkerRunning): boolean {
  if (config.CHAIN_EXECUTION_MODE !== 'live') return false;
  if (config.HEALTH_CHAIN_WRITER === 'true') return true;
  if (config.HEALTH_CHAIN_WRITER === 'false') return false;
  return workerRunning();
}

// ─── Outbox backlog ──────────────────────────────────────────────────────────

const IN_FLIGHT = new Set(['BUILT', 'SIGNED', 'SUBMITTED', 'PENDING']);

export interface BacklogRow {
  status: string;
  n: number;
  oldest: Date | null;
  past_max_time: number;
  oldest_unhandled: Date | null;
}

/**
 * One grouped query per probe run, served by the partial index
 * chain_transactions_unhandled_idx (status, updatedAt) INCLUDE (maxTime)
 * WHERE handledAt IS NULL. In-flight rows always have handledAt null (it is
 * only set after a terminal transition), so `handledAt IS NULL` selects every
 * in-flight row plus terminal rows whose handler has not run.
 */
export async function queryBacklog(nowSecs: number): Promise<BacklogRow[]> {
  return prisma.$queryRaw<BacklogRow[]>`
    SELECT "status"::text AS status,
           count(*)::int AS n,
           min("updatedAt") AS oldest,
           count(*) FILTER (WHERE "maxTime" IS NOT NULL AND "maxTime" < ${BigInt(nowSecs)} AND "status" IN ('SUBMITTED', 'PENDING'))::int AS past_max_time,
           min("updatedAt") FILTER (WHERE "status" IN ('SUCCESS', 'FAILED', 'EXPIRED')) AS oldest_unhandled
    FROM "chain_transactions"
    WHERE "handledAt" IS NULL
    GROUP BY "status"`;
}

export interface BacklogSummary {
  byStatus: Record<string, number>;
  inFlight: number;
  oldestInFlightMs: number | null;
  pastMaxTime: number;
  oldestUnhandledMs: number | null;
}

export function summariseBacklog(rows: BacklogRow[], nowMs: number): BacklogSummary {
  const byStatus: Record<string, number> = {};
  let inFlight = 0;
  let oldestInFlight: number | null = null;
  let pastMaxTime = 0;
  let oldestUnhandled: number | null = null;
  for (const row of rows) {
    byStatus[row.status] = Number(row.n);
    pastMaxTime += Number(row.past_max_time ?? 0);
    if (IN_FLIGHT.has(row.status)) {
      inFlight += Number(row.n);
      if (row.oldest) oldestInFlight = Math.min(oldestInFlight ?? Infinity, new Date(row.oldest).getTime());
    }
    if (row.oldest_unhandled) oldestUnhandled = Math.min(oldestUnhandled ?? Infinity, new Date(row.oldest_unhandled).getTime());
  }
  return {
    byStatus,
    inFlight,
    oldestInFlightMs: oldestInFlight === null ? null : Math.max(0, nowMs - oldestInFlight),
    pastMaxTime,
    oldestUnhandledMs: oldestUnhandled === null ? null : Math.max(0, nowMs - oldestUnhandled),
  };
}

export interface Thresholds {
  maxInFlight: number;
  maxAgeMs: number;
  maxStreak: number;
  minRunwayHours: number;
}

const configThresholds = (): Thresholds => ({
  maxInFlight: config.HEALTH_OUTBOX_MAX_INFLIGHT,
  maxAgeMs: config.HEALTH_OUTBOX_MAX_AGE_MS,
  maxStreak: config.HEALTH_HANDLER_MAX_STREAK,
  minRunwayHours: config.HEALTH_BALANCE_MIN_RUNWAY_HOURS,
});

/** First failing reason wins the error class; degraded at half of a threshold. */
export function evaluateOutbox(
  summary: BacklogSummary,
  handlers: { kinds: Record<string, HandlerStreak> },
  t: Thresholds,
): ProbeOutcome {
  const failingKinds = Object.entries(handlers.kinds).filter(([, s]) => s.count >= t.maxStreak).map(([k]) => k);
  const detail = { writer: true, ...summary, handlerFailing: failingKinds };
  const age = summary.oldestInFlightMs ?? 0;
  if (summary.inFlight > t.maxInFlight) return { ok: false, detail, error: 'backlog' };
  if (age > t.maxAgeMs || summary.pastMaxTime > 0) return { ok: false, detail, error: 'stuck' };
  // A terminal row nobody handled for longer than the age limit is the
  // cluster-wide view of a failing handler; the streak is this instance's.
  if (failingKinds.length > 0 || (summary.oldestUnhandledMs ?? 0) > t.maxAgeMs) {
    return { ok: false, detail, error: 'handler_failing' };
  }
  if (summary.inFlight > t.maxInFlight / 2) return { ok: true, state: 'degraded', detail, error: 'backlog' };
  if (age > t.maxAgeMs / 2) return { ok: true, state: 'degraded', detail, error: 'stuck' };
  return { ok: true, detail };
}

// ─── Signers ─────────────────────────────────────────────────────────────────

export function evaluateSigners(snapshot: BalanceSnapshot, t: Thresholds): ProbeOutcome {
  const signers = snapshot.accounts.filter((a) => a.role !== 'channel');
  const detail = { writer: true, stale: snapshot.stale, takenAt: snapshot.takenAt, accounts: signers.map(balanceView) };
  if (signers.some((a) => a.error === 'account_missing')) return { ok: false, detail, error: 'account_missing' };
  // bigint comparison: balances are Int64 stroops.
  if (signers.some((a) => a.stroops !== null && a.stroops < a.minStroops)) return { ok: false, detail, error: 'low_balance' };
  if (signers.some((a) => a.runwayHours !== null && a.runwayHours < t.minRunwayHours)) {
    return { ok: true, state: 'degraded', detail, error: 'low_balance' };
  }
  return { ok: true, detail };
}

// ─── Channels ────────────────────────────────────────────────────────────────

export interface ChannelPoolState {
  total: number;
  healthy: number;
  leased: number;
}

export function evaluateChannels(state: ChannelPoolState): ProbeOutcome {
  const detail = { writer: true, configured: state.total > 0, ...state };
  // An empty pool means "not configured": writes go through the agent account.
  if (state.total === 0) return { ok: true, detail };
  if (state.healthy === 0) return { ok: false, detail, error: 'channels_exhausted' };
  if (state.healthy < state.total) return { ok: true, state: 'degraded', detail, error: 'low_balance' };
  return { ok: true, detail };
}

async function defaultChannelState(): Promise<ChannelPoolState> {
  const channels = getChannelPool().getChannels();
  let leased = 0;
  if (channels.length > 0) {
    try {
      leased = await getRedis().exists(...channels.map((c) => `channel:lease:${c.publicKey}`));
    } catch {
      /* redis probe reports this */
    }
  }
  return { total: channels.length, healthy: channels.filter((c) => c.healthy).length, leased };
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

export interface ChainWriteDeps {
  isWriter: () => boolean;
  backlog: (nowSecs: number) => Promise<BacklogRow[]>;
  handlers: () => { kinds: Record<string, HandlerStreak> };
  balances: Pick<BalanceMonitor, 'snapshot'>;
  channels: () => Promise<ChannelPoolState>;
  thresholds: () => Thresholds;
  now?: () => number;
}

const notWriter: ProbeOutcome = { ok: true, detail: { writer: false } };

export function createChainWriteProbes(deps: ChainWriteDeps): Probe[] {
  const now = deps.now ?? Date.now;
  const gate = { critical: () => deps.isWriter() };
  return [
    {
      name: 'outbox',
      ...gate,
      async run() {
        if (!deps.isWriter()) return notWriter;
        const nowMs = now();
        const summary = summariseBacklog(await deps.backlog(Math.floor(nowMs / 1000)), nowMs);
        return evaluateOutbox(summary, deps.handlers(), deps.thresholds());
      },
    },
    {
      name: 'signers',
      ...gate,
      async run(_signal: AbortSignal, ctx: ProbeContext) {
        if (!deps.isWriter()) return notWriter;
        const rpc = await ctx.result('rpc');
        return evaluateSigners(await deps.balances.snapshot(rpc.ok), deps.thresholds());
      },
    },
    {
      name: 'channels',
      ...gate,
      async run() {
        if (!deps.isWriter()) return notWriter;
        return evaluateChannels(await deps.channels());
      },
    },
  ];
}

let monitor: BalanceMonitor | null = null;

export function balanceMonitor(): BalanceMonitor {
  monitor ??= createBalanceMonitor({
    server: rpcServer,
    signers: configuredSigners,
    channels: () =>
      getChannelPool().getChannels().map((c) => ({
        publicKey: c.publicKey,
        lastBalanceStroops: c.lastBalanceStroops ?? null,
        lastCheckedAt: c.lastCheckedAt ?? null,
      })),
    channelMinStroops: () => xlmToStroops(config.CHANNEL_MIN_BALANCE_XLM),
    spend: readSpend24h,
    ttlMs: config.HEALTH_BALANCE_TTL_MS,
  });
  return monitor;
}

export const chainWriteProbes = (): Probe[] =>
  createChainWriteProbes({
    isWriter: () => isChainWriter(),
    backlog: queryBacklog,
    handlers: handlerHealth,
    balances: { snapshot: (rpcOk) => balanceMonitor().snapshot(rpcOk) },
    channels: defaultChannelState,
    thresholds: configThresholds,
  });

/**
 * GET /admin/status chainWrites block: public keys and counts only, never
 * secrets. Balances are the cached snapshot (no RPC call from this route).
 */
export async function chainWritesStatus(): Promise<Record<string, unknown>> {
  const nowMs = Date.now();
  const outbox = await queryBacklog(Math.floor(nowMs / 1000))
    .then((rows) => {
      const s = summariseBacklog(rows, nowMs);
      return { ...s.byStatus, inFlight: s.inFlight, oldestInFlightMs: s.oldestInFlightMs, pastMaxTime: s.pastMaxTime, oldestUnhandledMs: s.oldestUnhandledMs };
    })
    .catch(() => null);
  const snapshot = balanceMonitor().peek();
  const pool = getChannelPool().getChannels();
  return {
    writer: isChainWriter(),
    outbox,
    handlers: handlerHealth(),
    balances: { stale: snapshot.stale, takenAt: snapshot.takenAt, accounts: snapshot.accounts.map(balanceView) },
    channels: await defaultChannelState().then(
      (state) => ({
        ...state,
        accounts: pool.map((c) => ({
          publicKey: c.publicKey,
          healthy: c.healthy,
          stroops: c.lastBalanceStroops?.toString() ?? null,
          checkedAt: c.lastCheckedAt ?? null,
        })),
      }),
      () => null,
    ),
  };
}
