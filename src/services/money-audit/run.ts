/**
 * Continuous audit of the agent's money records (#222): Trade, Position,
 * PositionExit and ChainTransaction rows against each other and against the
 * treasury's on-chain shares. Distinct from the market lifecycle reconciler
 * (#83) and treasury event reconciliation (#18).
 *
 * One run is one REPEATABLE READ transaction behind the `money-audit` advisory
 * lock, so every invariant query sees the same snapshot. Subjects with work in
 * flight (a non-terminal outbox row, a SUBMITTED exit, an update inside
 * MONEY_AUDIT_GRACE_MS) are recorded SKIPPED_IN_FLIGHT, never treated as drift
 * and never repaired. Chain reads happen after the snapshot, are bounded by
 * MONEY_AUDIT_MAX_RPC_CALLS and carry the ledger they observed.
 *
 * Repairs never fight the outbox handlers: they only re-run the existing
 * idempotent functions (applyBuySuccess, runCompletionHandler) after
 * re-reading the row outside the snapshot, and only with
 * MONEY_AUDIT_AUTO_REPAIR=true on a non-dry run.
 */
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { config } from '../../config';
import { CONTRACTS } from '../../config/contracts';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { writeAgentLog } from '../../lib/agent-log';
import { withAdvisoryLock } from '../../lib/advisory-lock';
import { pool } from '../market-reconciler.service';
import { CURSOR_ID } from '../indexer.service';
import { getPositionWithLedger } from '../chain.service';
import { getTransactionReader } from '../stellar/tx-inspect';
import { DOMAIN_KINDS, prismaOutboxStore, type ChainTransactionRow } from '../stellar/outbox';
import { sinksFromConfig, type Alert, type AlertSink } from '../alerts.service';
import {
  INVARIANTS,
  IN_FLIGHT_STATUSES,
  fingerprintOf,
  outboxMatches,
  type AuditChain,
  type AuditContext,
  type AuditSnapshot,
  type Candidate,
  type Finding,
  type FindingAction,
  type Invariant,
  type OutboxRef,
  type PositionTradeRow,
  type RepairDeps,
  type TradeRow,
} from './invariants';

export const MONEY_AUDIT_LOCK = 'money-audit';

export interface MoneyAuditOptions {
  dryRun: boolean;
  /** Snapshot time. */
  now: Date;
  /** Pre-assigned run id (the admin endpoint returns it before the run finishes). */
  runId?: string;
  maxRpcCalls?: number;
  graceMs?: number;
  pendingGraceMs?: number;
  autoRepair?: boolean;
  concurrency?: number;
}

export interface MoneyAuditSummary {
  runId: string;
  snapshotAt: Date;
  observedLedger: number | null;
  checked: number;
  findings: number;
  repaired: number;
  deferred: number;
  skippedInFlight: number;
  rpcCalls: number;
  rpcErrors: number;
  /** Candidates left unconfirmed because the RPC budget ran out (re-checked next run). */
  budgetSkipped: number;
}

export interface MoneyAuditDeps {
  snapshot: AuditSnapshot;
  chain: AuditChain;
  repair: RepairDeps;
  sinks: AlertSink[];
  liveMode: boolean;
  treasury: string;
  indexerEnabled: boolean;
  treasuryTradeEvents: AuditContext['treasuryTradeEvents'];
  invariants?: readonly Invariant[];
}

class RpcBudgetExhausted extends Error {}

interface Recorded {
  finding: Finding;
  action: FindingAction;
  fingerprint: string;
  firstSeenRunId: string;
  ackedBy: string | null;
  ackedAt: Date | null;
  isNew: boolean;
}

/** Whether a candidate's subject has work in flight at the snapshot. */
function inFlight(c: Candidate, inFlightRefs: Set<string>, cutoff: Date): boolean {
  const h = c.inFlight;
  if (!h) return false;
  if (h.outboxInFlight || h.exitSubmitted) return true;
  if ((h.refIds ?? []).some((id) => inFlightRefs.has(id))) return true;
  return (h.updatedAt ?? []).some((d) => d instanceof Date && d > cutoff);
}

/** The audit itself, over an injected snapshot and chain (tests drive this directly). */
export async function auditMoney(opts: MoneyAuditOptions, deps: MoneyAuditDeps): Promise<MoneyAuditSummary> {
  const runId = opts.runId ?? uuidv4();
  const graceMs = opts.graceMs ?? config.MONEY_AUDIT_GRACE_MS;
  const maxRpc = opts.maxRpcCalls ?? config.MONEY_AUDIT_MAX_RPC_CALLS;
  const autoRepair = !opts.dryRun && (opts.autoRepair ?? config.MONEY_AUDIT_AUTO_REPAIR);
  const invariants = deps.invariants ?? INVARIANTS;
  const summary: MoneyAuditSummary = {
    runId, snapshotAt: opts.now, observedLedger: null, checked: 0, findings: 0, repaired: 0,
    deferred: 0, skippedInFlight: 0, rpcCalls: 0, rpcErrors: 0, budgetSkipped: 0,
  };
  await prisma.moneyAuditRun.create({ data: { id: runId, startedAt: new Date(), snapshotAt: opts.now } });

  let failure: string | undefined;
  try {
    const previousRun = await prisma.moneyAuditRun.findFirst({
      where: { id: { not: runId }, finishedAt: { not: null }, error: null },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    const ctx: AuditContext = {
      runId,
      now: opts.now,
      graceMs,
      pendingGraceMs: opts.pendingGraceMs ?? config.MONEY_AUDIT_PENDING_GRACE_MS,
      liveMode: deps.liveMode,
      treasury: deps.treasury,
      indexerEnabled: deps.indexerEnabled,
      indexerCursorAtSnapshot: await deps.snapshot.indexerCursor(),
      indexerLagLedgers: config.RECONCILE_INDEXER_LAG_LEDGERS,
      treasuryTradeEvents: deps.treasuryTradeEvents,
      previousFinding: async (invariant, subjectId) => {
        if (!previousRun) return null;
        return prisma.moneyAuditFinding.findFirst({
          where: { runId: previousRun.id, invariant, subjectId },
          orderBy: { createdAt: 'desc' },
          select: { fingerprint: true, action: true, evidence: true },
        });
      },
    };

    // 1. Every query against the one snapshot.
    const candidates: Array<{ inv: Invariant; c: Candidate }> = [];
    for (const inv of invariants) {
      for (const c of await inv.find(deps.snapshot, ctx)) candidates.push({ inv, c });
    }
    summary.checked = candidates.length;
    const refIds = [...new Set(candidates.flatMap(({ c }) => c.inFlight?.refIds ?? []))];
    const inFlightRefs = refIds.length > 0 ? await deps.snapshot.inFlightRefIds(refIds) : new Set<string>();
    const cutoff = new Date(opts.now.getTime() - graceMs);

    // 2. Bounded chain confirmation, after the snapshot.
    const chain: AuditChain = {
      getPositionWithLedger: async (id, holder) => {
        if (summary.rpcCalls >= maxRpc) throw new RpcBudgetExhausted();
        summary.rpcCalls++;
        const res = await deps.chain.getPositionWithLedger(id, holder);
        summary.observedLedger = Math.max(summary.observedLedger ?? 0, res.ledger);
        return res;
      },
      getTransaction: async (hash) => {
        if (summary.rpcCalls >= maxRpc) throw new RpcBudgetExhausted();
        summary.rpcCalls++;
        return deps.chain.getTransaction(hash);
      },
    };
    const findings: Array<{ inv: Invariant; f: Finding; skipped: boolean }> = [];
    await pool(candidates, config.RECONCILE_CONCURRENCY, async ({ inv, c }) => {
      if (inFlight(c, inFlightRefs, cutoff)) {
        findings.push({ inv, f: c, skipped: true });
        return;
      }
      if (!inv.confirm) {
        findings.push({ inv, f: c, skipped: false });
        return;
      }
      try {
        const f = await inv.confirm(c, chain, ctx);
        if (f) findings.push({ inv, f, skipped: false });
      } catch (err) {
        if (err instanceof RpcBudgetExhausted) {
          summary.budgetSkipped++; // re-checked next run
          return;
        }
        summary.rpcErrors++;
        logger.warn({ invariant: c.invariant, subjectId: c.subjectId, err: err instanceof Error ? err.message : err }, 'Money audit: chain confirmation failed; skipping subject');
      }
    });

    // 3. Carry fingerprints across runs, repair, record.
    const prints = findings.map(({ f }) => fingerprintOf(f));
    const prior = prints.length > 0
      ? await prisma.moneyAuditFinding.findMany({
          where: { fingerprint: { in: [...new Set(prints)] }, runId: { not: runId } },
          orderBy: { createdAt: 'asc' },
          select: { fingerprint: true, runId: true, firstSeenRunId: true, action: true, ackedBy: true, ackedAt: true },
        })
      : [];
    const recorded: Recorded[] = [];
    for (let i = 0; i < findings.length; i++) {
      const { inv, f, skipped } = findings[i];
      const fingerprint = prints[i];
      const history = prior.filter((p) => p.fingerprint === fingerprint);
      const acked = history.find((p) => p.ackedAt) ?? null;
      let action: FindingAction;
      if (skipped) action = 'SKIPPED_IN_FLIGHT';
      else if (f.deferReason) action = 'DEFERRED';
      else if (autoRepair && inv.repair && f.invariant === inv.id) {
        let outcome: 'REPAIRED' | 'SKIPPED' = 'SKIPPED';
        try {
          outcome = await inv.repair(f, deps.repair);
        } catch (err) {
          logger.error({ err, invariant: f.invariant, subjectId: f.subjectId }, 'Money audit: repair failed');
          f.evidence = { ...f.evidence, repairError: err instanceof Error ? err.message : String(err) };
        }
        if (outcome === 'REPAIRED') action = 'REPAIRED';
        else {
          f.evidence = { ...f.evidence, repair: 'SKIPPED' };
          action = acked ? 'ACKED' : 'REPORTED';
        }
      } else action = acked ? 'ACKED' : 'REPORTED';
      recorded.push({
        finding: f,
        action,
        fingerprint,
        firstSeenRunId: history[0]?.firstSeenRunId ?? runId,
        ackedBy: action === 'ACKED' ? acked?.ackedBy ?? null : null,
        ackedAt: action === 'ACKED' ? acked?.ackedAt ?? null : null,
        // Alerted before means reported (or acked) before; deferrals and skips do not count.
        isNew: !history.some((p) => p.action === 'REPORTED' || p.action === 'ACKED' || p.action === 'REPAIRED'),
      });
    }

    if (recorded.length > 0) {
      await prisma.moneyAuditFinding.createMany({
        data: recorded.map((r) => ({
          runId,
          invariant: r.finding.invariant,
          severity: r.finding.severity,
          subjectType: r.finding.subjectType,
          subjectId: r.finding.subjectId,
          evidence: JSON.parse(JSON.stringify(r.finding.evidence, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
          suggestedRepair: r.finding.suggestedRepair ?? null,
          action: r.action,
          fingerprint: r.fingerprint,
          firstSeenRunId: r.firstSeenRunId,
          ackedBy: r.ackedBy,
          ackedAt: r.ackedAt,
        })),
      });
    }
    for (const r of recorded) {
      if (r.action === 'REPAIRED') summary.repaired++;
      if (r.action === 'DEFERRED') summary.deferred++;
      else if (r.action === 'SKIPPED_IN_FLIGHT') summary.skippedInFlight++;
      else summary.findings++;
    }

    // 4. CRITICAL findings alert once per new fingerprint.
    for (const r of recorded.filter((x) => x.finding.severity === 'CRITICAL' && x.isNew && (x.action === 'REPORTED' || x.action === 'REPAIRED'))) {
      await notifyCritical(runId, r, deps.sinks);
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await prisma.moneyAuditRun.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(), observedLedger: summary.observedLedger, checked: summary.checked,
        findings: summary.findings, repaired: summary.repaired, rpcCalls: summary.rpcCalls, error: failure ?? null,
      },
    }).catch((err) => logger.error({ err }, 'Money audit: failed to close the run record'));
  }

  logger.info({ ...summary, dryRun: opts.dryRun, autoRepair }, 'Money audit finished');
  return summary;
}

async function notifyCritical(runId: string, r: Recorded, sinks: AlertSink[]): Promise<void> {
  const f = r.finding;
  const ev = f.evidence as { marketId?: unknown; onChainMarketId?: unknown };
  await writeAgentLog({
    agentType: 'TRADER',
    level: 'ERROR',
    action: 'MONEY_AUDIT_FINDING',
    marketId: typeof ev.marketId === 'string' ? ev.marketId : undefined,
    data: {
      runId, invariant: f.invariant, severity: f.severity, subjectType: f.subjectType, subjectId: f.subjectId,
      fingerprint: r.fingerprint, action: r.action, evidence: JSON.parse(JSON.stringify(f.evidence, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
    },
  }).catch((err) => logger.error({ err }, 'Money audit: failed to write the finding log'));

  // The sinks carry the dispute alert shape (#92); the fields map onto it.
  const alert: Alert = {
    level: 'CRITICAL',
    title: `Money audit: ${f.invariant}`,
    marketId: typeof ev.marketId === 'string' ? ev.marketId : '',
    onChainMarketId: ev.onChainMarketId != null ? String(ev.onChainMarketId) : '',
    proposedOutcome: '-',
    verdict: f.invariant,
    windowRemainingSecs: null,
    links: { market: '', cancelTx: '' },
    detail: `${f.subjectType} ${f.subjectId} (run ${runId}, fingerprint ${r.fingerprint.slice(0, 12)})`,
  };
  for (const sink of sinks) {
    try {
      await sink.send(alert);
    } catch (err) {
      logger.warn({ sink: sink.name, invariant: f.invariant, reason: err instanceof Error ? err.message : String(err) }, 'Money audit alert not delivered');
    }
  }
  if (sinks.length === 0) logger.warn({ invariant: f.invariant, subjectId: f.subjectId }, 'Money audit CRITICAL finding: no alert sinks configured');
}

// ─── Production wiring ───────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;
const IN_FLIGHT = [...IN_FLIGHT_STATUSES];

interface RawTrade {
  id: string; marketId: string; direction: 'YES' | 'NO'; status: string;
  txHash: string | null; innerTxHash: string | null; createdAt: Date; updatedAt: Date;
}

const epochMs = (v: unknown) => new Date(Number(v));

/** chain_transactions rows of `kind` matching any of the ids by refId or any hash by inner/landed/bump hash. */
async function outboxFor(tx: Tx, kind: string, ids: string[], hashes: string[]): Promise<OutboxRef[]> {
  if (ids.length === 0 && hashes.length === 0) return [];
  return tx.$queryRaw<OutboxRef[]>`
    SELECT id, kind, "refId", status::text AS status, hash, "landedHash", "feeBumpHashes", "handledAt", "updatedAt"
    FROM chain_transactions
    WHERE kind = ${kind}
      AND ("refId" = ANY(${ids}::text[]) OR hash = ANY(${hashes}::text[]) OR "landedHash" = ANY(${hashes}::text[]) OR "feeBumpHashes" && ${hashes}::text[])`;
}

async function withTradeOutbox(tx: Tx, trades: RawTrade[]): Promise<TradeRow[]> {
  const hashes = trades.flatMap((t) => [t.txHash, t.innerTxHash]).filter((h): h is string => !!h);
  const rows = await outboxFor(tx, 'trade.buy', trades.map((t) => t.id), hashes);
  return trades.map((t) => ({ ...t, outbox: rows.filter((r) => outboxMatches(r, t.id, [t.txHash, t.innerTxHash])) }));
}

/** The snapshot surface over a REPEATABLE READ transaction client. */
export function prismaSnapshot(tx: Tx): AuditSnapshot {
  return {
    async executedTradesWithoutBuySuccess() {
      const trades = await tx.$queryRaw<RawTrade[]>`
        SELECT t.id, t."marketId", t.direction::text AS direction, t.status::text AS status, t."txHash", t."innerTxHash", t."createdAt", t."updatedAt"
        FROM trades t
        WHERE t.status = 'EXECUTED' AND t."txHash" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM chain_transactions c WHERE c.kind = 'trade.buy' AND c."refId" = t.id AND c.status = 'SUCCESS')`;
      return withTradeOutbox(tx, trades);
    },
    async positionsWithNonExecutedTrade() {
      return tx.$queryRaw<PositionTradeRow[]>`
        SELECT p.id, p."tradeId", p."marketId", p.direction::text AS direction, p.status::text AS "positionStatus",
               t.status::text AS "tradeStatus", p."updatedAt", t."updatedAt" AS "tradeUpdatedAt"
        FROM positions p JOIN trades t ON t.id = p."tradeId"
        WHERE t.status <> 'EXECUTED'`;
    },
    async executedTradesWithoutPosition() {
      const trades = await tx.$queryRaw<RawTrade[]>`
        SELECT t.id, t."marketId", t.direction::text AS direction, t.status::text AS status, t."txHash", t."innerTxHash", t."createdAt", t."updatedAt"
        FROM trades t
        WHERE t.status = 'EXECUTED' AND NOT EXISTS (SELECT 1 FROM positions p WHERE p."tradeId" = t.id)`;
      return withTradeOutbox(tx, trades);
    },
    async unhandledTerminalOutbox(updatedBefore) {
      return tx.$queryRaw<OutboxRef[]>`
        SELECT id, kind, "refId", status::text AS status, hash, "landedHash", "feeBumpHashes", "handledAt", "updatedAt"
        FROM chain_transactions
        WHERE status IN ('SUCCESS', 'FAILED', 'EXPIRED') AND "handledAt" IS NULL
          AND "updatedAt" < ${updatedBefore} AND kind = ANY(${[...DOMAIN_KINDS]}::text[])
        ORDER BY "createdAt" ASC
        LIMIT 500`;
    },
    async pendingTradesCreatedBefore(createdBefore) {
      const trades = await tx.$queryRaw<RawTrade[]>`
        SELECT t.id, t."marketId", t.direction::text AS direction, t.status::text AS status, t."txHash", t."innerTxHash", t."createdAt", t."updatedAt"
        FROM trades t
        WHERE t.status = 'PENDING' AND t."createdAt" < ${createdBefore}`;
      return withTradeOutbox(tx, trades);
    },
    async confirmedExitsWithoutSellSuccess() {
      const exits = await tx.$queryRaw<Array<{ id: string; positionId: string; status: string; txHash: string | null; createdAt: Date }>>`
        SELECT e.id, e."positionId", e.status, e."txHash", e."createdAt"
        FROM position_exits e
        WHERE e.status = 'CONFIRMED' AND e.mode = 'live' AND e."txHash" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM chain_transactions c WHERE c.kind = 'trade.sell' AND c."refId" = e.id AND c.status = 'SUCCESS')`;
      const rows = await outboxFor(tx, 'trade.sell', exits.map((e) => e.id), exits.map((e) => e.txHash!).filter(Boolean));
      return exits.map((e) => ({ ...e, outbox: rows.filter((r) => outboxMatches(r, e.id, [e.txHash])) }));
    },
    async sidePositions() {
      const rows = await tx.$queryRaw<Array<{
        id: string; marketId: string; onChainMarketId: bigint; direction: 'YES' | 'NO'; status: string; closeReason: string | null;
        sharesRaw: string | null; tradeId: string; updatedAt: Date; tradeUpdatedAt: Date;
        exits: Array<{ id: string; status: string; createdAtMs: number }>;
      }>>`
        SELECT p.id, p."marketId", m."onChainMarketId", p.direction::text AS direction, p.status::text AS status, p."closeReason",
               p."sharesRaw"::text AS "sharesRaw", p."tradeId", p."updatedAt", t."updatedAt" AS "tradeUpdatedAt",
               COALESCE((SELECT json_agg(json_build_object('id', e.id, 'status', e.status, 'createdAtMs', floor(extract(epoch FROM e."createdAt") * 1000)))
                         FROM position_exits e WHERE e."positionId" = p.id), '[]'::json) AS exits
        FROM positions p
        JOIN markets m ON m.id = p."marketId"
        JOIN trades t ON t.id = p."tradeId"
        WHERE m."onChainMarketId" IS NOT NULL`;
      return rows.map((r) => ({ ...r, exits: r.exits.map((e) => ({ id: e.id, status: e.status, createdAt: epochMs(e.createdAtMs) })) }));
    },
    async confirmedBuyTracesWithoutTrade() {
      const rows = await tx.$queryRaw<Array<{
        id: string; traceId: string; marketId: string; action: string; status: string; createdAt: Date; updatedAt: Date;
        trades: Array<{ id: string; direction: 'YES' | 'NO'; createdAtMs: number }>;
      }>>`
        SELECT tp.id, tp."traceId", rt."marketId", tp.action, tp.status::text AS status, tp."createdAt", tp."updatedAt",
               COALESCE((SELECT json_agg(json_build_object('id', t.id, 'direction', t.direction, 'createdAtMs', floor(extract(epoch FROM t."createdAt") * 1000)))
                         FROM trades t WHERE t."marketId" = rt."marketId" AND t.status = 'EXECUTED'), '[]'::json) AS trades
        FROM trace_publications tp
        JOIN reasoning_traces rt ON rt.id = tp."traceId"
        WHERE tp.status = 'CONFIRMED' AND tp.action IN ('buy_yes', 'buy_no')
          AND NOT EXISTS (
            SELECT 1 FROM trades t2
            WHERE t2."marketId" = rt."marketId" AND t2.status = 'EXECUTED' AND t2."createdAt" <= tp."createdAt"
              AND t2.direction::text = CASE tp.action WHEN 'buy_yes' THEN 'YES' ELSE 'NO' END)`;
      return rows.map((r) => ({ ...r, trades: r.trades.map((t) => ({ id: t.id, direction: t.direction, createdAt: epochMs(t.createdAtMs) })) }));
    },
    async inFlightRefIds(refIds) {
      const rows = await tx.$queryRaw<Array<{ refId: string }>>`
        SELECT DISTINCT "refId" FROM chain_transactions
        WHERE "refId" = ANY(${refIds}::text[]) AND status::text = ANY(${IN_FLIGHT}::text[])`;
      return new Set(rows.map((r) => r.refId));
    },
    async indexerCursor() {
      return (await tx.indexerCursor.findUnique({ where: { id: CURSOR_ID } }))?.lastLedger ?? null;
    },
  };
}

export const defaultChain: AuditChain = {
  getPositionWithLedger: async (id, holder) => {
    const { position, ledger } = await getPositionWithLedger(id, holder);
    return { position: { yes: BigInt(position.yes), no: BigInt(position.no) }, ledger };
  },
  getTransaction: async (hash) => {
    const resp = await getTransactionReader().getTransaction(hash);
    return { status: String(resp.status), ledger: (resp as { ledger?: number }).ledger ?? null };
  },
};

/** Completion handlers register at module load; the outbox imports them lazily for the same reason. */
async function loadCompletionHandlers(): Promise<void> {
  await Promise.all([
    import('../market-chain.service'),
    import('../trade.service'),
    import('../exit.service'),
    import('../trace-publish.service'),
  ]);
}

/** Fresh reads (global client, outside the snapshot) and the idempotent functions repairs re-run. */
export function defaultRepairDeps(graceMs = config.MONEY_AUDIT_GRACE_MS): RepairDeps {
  return {
    now: () => new Date(),
    graceMs,
    applyBuySuccess: async (tradeId, fill) => (await import('../trade.service')).applyBuySuccess(tradeId, fill),
    runCompletionHandler: async (row, outcome) => {
      await loadCompletionHandlers();
      const { runCompletionHandler } = await import('../stellar/outbox');
      await runCompletionHandler(row, outcome);
    },
    loadTrade: (id) => prisma.trade.findUnique({ where: { id }, select: { id: true, status: true, updatedAt: true } }),
    positionExists: async (tradeId) => (await prisma.position.findUnique({ where: { tradeId }, select: { id: true } })) !== null,
    loadOutboxRow: (id) => prismaOutboxStore().findById(id) as Promise<ChainTransactionRow | null>,
    inFlightRefIds: async (refIds) => {
      const rows = await prisma.chainTransaction.findMany({
        where: { refId: { in: refIds }, status: { in: [...IN_FLIGHT] } },
        select: { refId: true },
      });
      return new Set(rows.map((r) => r.refId).filter((r): r is string => r !== null));
    },
  };
}

/** Indexed treasury Trade events for one market in (afterLedger, upToLedger], read fresh. */
async function treasuryTradeEvents(onChainMarketId: bigint, afterLedger: number, upToLedger: number): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM chain_events
    WHERE "contractName" = 'marketCore' AND "eventName" = 'Trade'
      AND params->>'trader' = ${CONTRACTS.treasury} AND params->>'market_id' = ${onChainMarketId.toString()}
      AND ledger > ${afterLedger} AND ledger <= ${upToLedger}`;
  return rows[0]?.n ?? 0;
}

/**
 * One audit run behind the cross-instance advisory lock, in a REPEATABLE READ
 * transaction. A run that cannot take the lock records itself as skipped, so
 * a pre-assigned run id always resolves.
 */
export async function runMoneyAudit(
  overrides: Partial<MoneyAuditOptions> = {},
  extra: Partial<MoneyAuditDeps> = {},
): Promise<MoneyAuditSummary | null> {
  const runId = overrides.runId ?? uuidv4();
  const result = await withAdvisoryLock(
    MONEY_AUDIT_LOCK,
    async (tx) => {
      // The lock statement opened the snapshot; its transaction time is the snapshot time.
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT transaction_timestamp() AS now`;
      return auditMoney(
        { dryRun: false, ...overrides, now: overrides.now ?? now, runId },
        {
          snapshot: prismaSnapshot(tx),
          chain: defaultChain,
          repair: defaultRepairDeps(overrides.graceMs),
          sinks: sinksFromConfig(),
          liveMode: config.CHAIN_EXECUTION_MODE === 'live',
          treasury: CONTRACTS.treasury,
          indexerEnabled: config.INDEXER_ENABLED,
          treasuryTradeEvents,
          ...extra,
        },
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  if (result.acquired) return result.value;
  const now = new Date();
  await prisma.moneyAuditRun.create({
    data: { id: runId, startedAt: now, snapshotAt: now, finishedAt: now, error: 'another instance is auditing; run skipped' },
  }).catch(() => undefined);
  return null;
}
