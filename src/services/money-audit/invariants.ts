/**
 * Money-audit invariant catalogue (#222).
 *
 * Each invariant is a cheap query over one database snapshot (`find`), an
 * optional bounded chain read that confirms or clears a candidate (`confirm`),
 * and, for the unambiguous cases only, a guarded repair that re-runs an
 * existing idempotent function (`repair`). The snapshot query is a coarse
 * prefilter; the checks below re-apply the precise rule to the rows it
 * returns, so they hold on their own and tests can drive them with fakes.
 *
 * Amounts are base-unit integers carried as decimal strings and compared as
 * bigint, never Number.
 */
import crypto from 'node:crypto';
import type { ChainTransactionRow, CompletionOutcome } from '../stellar/outbox';
import { DOMAIN_KINDS } from '../stellar/outbox';
import { TRACE_ACTIONS } from '../../lib/trace-actions';
import { MAX_CONSECUTIVE_DEFERRALS } from '../market-reconciler.service';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
export type SubjectType = 'trade' | 'position' | 'exit' | 'outbox' | 'market_side' | 'trace';
export type FindingAction = 'REPORTED' | 'REPAIRED' | 'SKIPPED_IN_FLIGHT' | 'DEFERRED' | 'ACKED';

export const IN_FLIGHT_STATUSES = ['BUILT', 'SIGNED', 'SUBMITTED', 'PENDING'] as const;
export const TERMINAL_STATUSES = ['SUCCESS', 'FAILED', 'EXPIRED'] as const;
const inFlightStatus = (s: string) => (IN_FLIGHT_STATUSES as readonly string[]).includes(s);
const terminalStatus = (s: string) => (TERMINAL_STATUSES as readonly string[]).includes(s);

/** Market-finality close reasons (applyMarketFinality): the shares stay on chain. */
export const FINALITY_CLOSE_REASONS = ['YES_RESOLVED', 'NO_RESOLVED', 'VOIDED'] as const;

// ─── Snapshot rows ───────────────────────────────────────────────────────────

export interface OutboxRef {
  id: string;
  kind: string;
  refId: string | null;
  status: string;
  hash: string | null;
  landedHash: string | null;
  feeBumpHashes: string[];
  handledAt: Date | null;
  updatedAt: Date;
}

export interface TradeRow {
  id: string;
  marketId: string;
  direction: 'YES' | 'NO';
  status: string;
  /** Outer (landed) hash after a fee bump (#38). */
  txHash: string | null;
  /** Inner hash: the outbox row's identity. */
  innerTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** trade.buy outbox rows matching the trade by refId or any of its hashes. */
  outbox: OutboxRef[];
}

export interface PositionTradeRow {
  id: string;
  tradeId: string;
  marketId: string;
  direction: 'YES' | 'NO';
  positionStatus: string;
  tradeStatus: string;
  updatedAt: Date;
  tradeUpdatedAt: Date;
}

export interface ExitRow {
  id: string;
  positionId: string;
  status: string;
  txHash: string | null;
  createdAt: Date;
  /** trade.sell outbox rows matching the exit by refId or hash. */
  outbox: OutboxRef[];
}

export interface SidePositionRow {
  id: string;
  marketId: string;
  onChainMarketId: bigint;
  direction: 'YES' | 'NO';
  status: string;
  closeReason: string | null;
  /** Decimal(39,0) as a decimal string; null for a pre-#78 row. */
  sharesRaw: string | null;
  tradeId: string;
  updatedAt: Date;
  tradeUpdatedAt: Date;
  exits: Array<{ id: string; status: string; createdAt: Date }>;
}

export interface TracePublicationRow {
  id: string;
  traceId: string;
  marketId: string;
  action: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  /** EXECUTED trades on the trace's market. */
  trades: Array<{ id: string; direction: 'YES' | 'NO'; createdAt: Date }>;
}

/**
 * The database surface of one audit run. In production every method reads
 * through the same REPEATABLE READ transaction, so all of them see one
 * snapshot.
 */
export interface AuditSnapshot {
  executedTradesWithoutBuySuccess(): Promise<TradeRow[]>;
  positionsWithNonExecutedTrade(): Promise<PositionTradeRow[]>;
  executedTradesWithoutPosition(): Promise<TradeRow[]>;
  unhandledTerminalOutbox(updatedBefore: Date): Promise<OutboxRef[]>;
  pendingTradesCreatedBefore(createdBefore: Date): Promise<TradeRow[]>;
  confirmedExitsWithoutSellSuccess(): Promise<ExitRow[]>;
  sidePositions(): Promise<SidePositionRow[]>;
  confirmedBuyTracesWithoutTrade(): Promise<TracePublicationRow[]>;
  /** The subset of `refIds` with a non-terminal chain_transactions row. */
  inFlightRefIds(refIds: string[]): Promise<Set<string>>;
  /** Indexer cursor (last fully indexed ledger) as of the snapshot. */
  indexerCursor(): Promise<number | null>;
}

/** Chain reads; every call counts against MONEY_AUDIT_MAX_RPC_CALLS. */
export interface AuditChain {
  getPositionWithLedger(onChainMarketId: bigint, holder: string): Promise<{ position: { yes: bigint; no: bigint }; ledger: number }>;
  /** Status as returned by RPC getTransaction: SUCCESS | FAILED | NOT_FOUND. */
  getTransaction(hash: string): Promise<{ status: string; ledger?: number | null }>;
}

export interface PriorFinding {
  fingerprint: string;
  action: string;
  evidence: unknown;
}

export interface AuditContext {
  runId: string;
  /** Snapshot time; grace windows are measured from it. */
  now: Date;
  graceMs: number;
  pendingGraceMs: number;
  liveMode: boolean;
  treasury: string;
  indexerEnabled: boolean;
  indexerCursorAtSnapshot: number | null;
  indexerLagLedgers: number;
  /** Fresh (post-snapshot) count of indexed treasury Trade events in (afterLedger, upToLedger]. */
  treasuryTradeEvents(onChainMarketId: bigint, afterLedger: number, upToLedger: number): Promise<number>;
  /** The same subject's finding in the previous completed run, if any. */
  previousFinding(invariant: string, subjectId: string): Promise<PriorFinding | null>;
}

/** Fresh reads and the idempotent functions a repair may re-run. */
export interface RepairDeps {
  now(): Date;
  graceMs: number;
  applyBuySuccess(
    tradeId: string,
    fill: { sharesOut: bigint; collateralIn: bigint; feeRaw: bigint; txHash: string | null; innerTxHash: string | null },
  ): Promise<void>;
  runCompletionHandler(row: ChainTransactionRow, outcome: CompletionOutcome): Promise<void>;
  loadTrade(id: string): Promise<{ id: string; status: string; updatedAt: Date } | null>;
  positionExists(tradeId: string): Promise<boolean>;
  loadOutboxRow(id: string): Promise<ChainTransactionRow | null>;
  inFlightRefIds(refIds: string[]): Promise<Set<string>>;
}

export interface InFlightHints {
  /** Domain ids whose outbox rows must all be terminal. */
  refIds?: string[];
  /** Subject rows' update times; any inside the grace window means in flight. */
  updatedAt?: Array<Date | null | undefined>;
  /** A matching outbox row is already known to be non-terminal. */
  outboxInFlight?: boolean;
  /** An exit on the subject is SUBMITTED. */
  exitSubmitted?: boolean;
}

export interface Candidate {
  invariant: string;
  severity: Severity;
  subjectType: SubjectType;
  subjectId: string;
  evidence: Record<string, unknown>;
  /** What identifies this violation across runs (fingerprint input). */
  core: Record<string, unknown>;
  suggestedRepair?: string | null;
  inFlight?: InFlightHints;
  /** Data a repair needs; never persisted. */
  repairInput?: Record<string, unknown>;
}

export interface Finding extends Candidate {
  /** Set when the finding must wait for another run (DEFERRED). */
  deferReason?: string;
}

export interface Invariant {
  id: string;
  severity: Severity;
  find(db: AuditSnapshot, ctx: AuditContext): Promise<Candidate[]>;
  confirm?(c: Candidate, chain: AuditChain, ctx: AuditContext): Promise<Finding | null>;
  repair?(f: Finding, deps: RepairDeps): Promise<'REPAIRED' | 'SKIPPED'>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** JSON with bigints as decimal strings and sorted keys: stable across runs. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}

/** sha256(invariant|subjectId|evidence-core). */
export function fingerprintOf(c: Pick<Candidate, 'invariant' | 'subjectId' | 'core'>): string {
  return crypto.createHash('sha256').update(`${c.invariant}|${c.subjectId}|${stable(c.core)}`).digest('hex');
}

const toBig = (v: string | null | undefined): bigint => (v == null || v === '' ? 0n : BigInt(v.split('.')[0]));

/** Whether an outbox row belongs to a domain row: by refId, or by any of its hashes (fee bumps, #38). */
export function outboxMatches(row: OutboxRef, refId: string, hashes: Array<string | null | undefined>): boolean {
  if (row.refId === refId) return true;
  const known = hashes.filter((h): h is string => typeof h === 'string' && h.length > 0);
  return known.some((h) => row.hash === h || row.landedHash === h || (row.feeBumpHashes ?? []).includes(h));
}

const tradeOutbox = (t: TradeRow) =>
  t.outbox.filter((r) => r.kind === 'trade.buy' && outboxMatches(r, t.id, [t.txHash, t.innerTxHash]));

const outboxSummary = (rows: OutboxRef[]) => rows.map((r) => ({ id: r.id, status: r.status, hash: r.hash, landedHash: r.landedHash }));

/** Native shares from a SUCCESS row's printable return value (an i128 as a decimal string). */
function sharesFromReturnValue(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  return null;
}

// ─── Invariants ──────────────────────────────────────────────────────────────

/** EXECUTED trade with a txHash and no SUCCESS trade.buy outbox row. */
export const tradeExecutedWithoutOutbox: Invariant = {
  id: 'TRADE_EXECUTED_WITHOUT_OUTBOX',
  severity: 'HIGH',
  async find(db) {
    const out: Candidate[] = [];
    for (const t of await db.executedTradesWithoutBuySuccess()) {
      if (t.status !== 'EXECUTED' || !t.txHash) continue;
      const rows = tradeOutbox(t);
      if (rows.some((r) => r.status === 'SUCCESS')) continue; // landed under a bumped hash or another attempt
      out.push({
        invariant: this.id,
        severity: this.severity,
        subjectType: 'trade',
        subjectId: t.id,
        evidence: { marketId: t.marketId, direction: t.direction, txHash: t.txHash, innerTxHash: t.innerTxHash, outbox: outboxSummary(rows) },
        core: { txHash: t.txHash },
        suggestedRepair: null,
        inFlight: { refIds: [t.id], updatedAt: [t.updatedAt], outboxInFlight: rows.some((r) => inFlightStatus(r.status)) },
        repairInput: { hasOutboxRow: rows.length > 0 },
      });
    }
    return out;
  },
  async confirm(c, chain) {
    // The chain is asked only when there is no outbox row at all to go by.
    if (c.repairInput?.hasOutboxRow) return c;
    const tx = await chain.getTransaction(String(c.evidence.txHash));
    return { ...c, evidence: { ...c.evidence, chainStatus: tx.status, chainLedger: tx.ledger ?? null } };
  },
};

/** A position whose trade is not EXECUTED: shares that may not exist. */
export const positionWithoutExecutedTrade: Invariant = {
  id: 'POSITION_WITHOUT_EXECUTED_TRADE',
  severity: 'CRITICAL',
  async find(db) {
    return (await db.positionsWithNonExecutedTrade())
      .filter((p) => p.tradeStatus !== 'EXECUTED')
      .map((p) => ({
        invariant: this.id,
        severity: this.severity,
        subjectType: 'position' as const,
        subjectId: p.id,
        evidence: { tradeId: p.tradeId, tradeStatus: p.tradeStatus, positionStatus: p.positionStatus, marketId: p.marketId, direction: p.direction },
        core: { tradeId: p.tradeId, tradeStatus: p.tradeStatus },
        suggestedRepair: null,
        inFlight: { refIds: [p.tradeId], updatedAt: [p.updatedAt, p.tradeUpdatedAt] },
      }));
  },
};

/** EXECUTED trade with no position (live mode only). Repair: applyBuySuccess from the SUCCESS row. */
export const executedTradeWithoutPosition: Invariant = {
  id: 'EXECUTED_TRADE_WITHOUT_POSITION',
  severity: 'HIGH',
  async find(db, ctx) {
    if (!ctx.liveMode) return [];
    const out: Candidate[] = [];
    for (const t of await db.executedTradesWithoutPosition()) {
      if (t.status !== 'EXECUTED') continue;
      const rows = tradeOutbox(t);
      const success = rows.find((r) => r.status === 'SUCCESS') ?? null;
      out.push({
        invariant: this.id,
        severity: this.severity,
        subjectType: 'trade',
        subjectId: t.id,
        evidence: { marketId: t.marketId, direction: t.direction, txHash: t.txHash, successOutboxId: success?.id ?? null, outbox: outboxSummary(rows) },
        core: { status: t.status },
        suggestedRepair: success ? `re-run applyBuySuccess from outbox row ${success.id}` : null,
        inFlight: { refIds: [t.id], updatedAt: [t.updatedAt], outboxInFlight: rows.some((r) => inFlightStatus(r.status)) },
        repairInput: { outboxId: success?.id ?? null },
      });
    }
    return out;
  },
  async repair(f, deps) {
    const outboxId = f.repairInput?.outboxId;
    if (typeof outboxId !== 'string') return 'SKIPPED';
    // Re-read everything outside the snapshot: the handler may have run since.
    const trade = await deps.loadTrade(f.subjectId);
    if (!trade || trade.status !== 'EXECUTED') return 'SKIPPED';
    if (deps.now().getTime() - trade.updatedAt.getTime() < deps.graceMs) return 'SKIPPED';
    if (await deps.positionExists(f.subjectId)) return 'SKIPPED';
    if ((await deps.inFlightRefIds([f.subjectId])).size > 0) return 'SKIPPED';
    const row = await deps.loadOutboxRow(outboxId);
    if (!row || row.kind !== 'trade.buy' || row.status !== 'SUCCESS') return 'SKIPPED';
    const sharesOut = sharesFromReturnValue(row.returnValue);
    const args = (row.args ?? {}) as { collateral_in?: string; feeRaw?: string };
    if (sharesOut === null || sharesOut <= 0n || !args.collateral_in) return 'SKIPPED';
    // Same mapping as handleTradeBuyOutcome; applyBuySuccess is guarded
    // (PENDING CAS, unique tradeId), so a concurrent handler run is harmless.
    await deps.applyBuySuccess(f.subjectId, {
      sharesOut,
      collateralIn: BigInt(args.collateral_in),
      feeRaw: BigInt(args.feeRaw ?? '0'),
      txHash: row.landedHash ?? row.hash,
      innerTxHash: row.hash,
    });
    return (await deps.positionExists(f.subjectId)) ? 'REPAIRED' : 'SKIPPED';
  },
};

/** Terminal domain outbox row whose completion handler never ran. Repair: runCompletionHandler. */
export const outboxTerminalUnhandled: Invariant = {
  id: 'OUTBOX_TERMINAL_UNHANDLED',
  severity: 'HIGH',
  async find(db, ctx) {
    const cutoff = new Date(ctx.now.getTime() - ctx.graceMs);
    return (await db.unhandledTerminalOutbox(cutoff))
      .filter((r) => DOMAIN_KINDS.has(r.kind) && terminalStatus(r.status) && r.handledAt == null && r.updatedAt < cutoff)
      .map((r) => ({
        invariant: this.id,
        severity: this.severity,
        subjectType: 'outbox' as const,
        subjectId: r.id,
        evidence: { kind: r.kind, refId: r.refId, status: r.status, hash: r.hash, landedHash: r.landedHash, updatedAt: r.updatedAt.toISOString() },
        core: { kind: r.kind, status: r.status },
        suggestedRepair: 'runCompletionHandler',
        // Another attempt for the same domain row may still be in flight (a rebuild).
        inFlight: { refIds: r.refId ? [r.refId] : [], updatedAt: [r.updatedAt] },
      }));
  },
  async repair(f, deps) {
    const row = await deps.loadOutboxRow(f.subjectId);
    if (!row || row.handledAt || !terminalStatus(row.status) || !DOMAIN_KINDS.has(row.kind)) return 'SKIPPED';
    if (row.updatedAt && deps.now().getTime() - row.updatedAt.getTime() < deps.graceMs) return 'SKIPPED';
    if (row.refId && (await deps.inFlightRefIds([row.refId])).size > 0) return 'SKIPPED';
    // Same outcome the recovery worker builds for an unhandled terminal row.
    await deps.runCompletionHandler(row, {
      status: row.status as 'SUCCESS' | 'FAILED' | 'EXPIRED',
      value: row.status === 'SUCCESS' ? row.returnValue : undefined,
      txHash: row.landedHash ?? row.hash,
      error: row.error,
    });
    return 'REPAIRED';
  },
};

/** PENDING trade past MONEY_AUDIT_PENDING_GRACE_MS with nothing in the outbox working on it. */
export const tradeStuckPending: Invariant = {
  id: 'TRADE_STUCK_PENDING',
  severity: 'MEDIUM',
  async find(db, ctx) {
    const cutoff = new Date(ctx.now.getTime() - ctx.pendingGraceMs);
    const out: Candidate[] = [];
    for (const t of await db.pendingTradesCreatedBefore(cutoff)) {
      if (t.status !== 'PENDING' || t.createdAt >= cutoff) continue;
      const rows = tradeOutbox(t);
      if (rows.some((r) => inFlightStatus(r.status))) continue;
      out.push({
        invariant: this.id,
        severity: this.severity,
        subjectType: 'trade',
        subjectId: t.id,
        evidence: { marketId: t.marketId, direction: t.direction, createdAt: t.createdAt.toISOString(), outbox: outboxSummary(rows) },
        core: { status: t.status },
        suggestedRepair: null,
        inFlight: { refIds: [t.id], updatedAt: [t.updatedAt] },
      });
    }
    return out;
  },
};

/** CONFIRMED exit whose agent_sell has no SUCCESS trade.sell row and is not on chain. */
export const exitConfirmedNotLanded: Invariant = {
  id: 'EXIT_CONFIRMED_NOT_LANDED',
  severity: 'CRITICAL',
  async find(db) {
    const out: Candidate[] = [];
    for (const e of await db.confirmedExitsWithoutSellSuccess()) {
      if (e.status !== 'CONFIRMED' || !e.txHash) continue;
      const rows = e.outbox.filter((r) => r.kind === 'trade.sell' && outboxMatches(r, e.id, [e.txHash]));
      if (rows.some((r) => r.status === 'SUCCESS')) continue;
      out.push({
        invariant: this.id,
        severity: this.severity,
        subjectType: 'exit',
        subjectId: e.id,
        evidence: { positionId: e.positionId, txHash: e.txHash, outbox: outboxSummary(rows) },
        core: { txHash: e.txHash },
        suggestedRepair: null,
        inFlight: { refIds: [e.id], updatedAt: [e.createdAt], outboxInFlight: rows.some((r) => inFlightStatus(r.status)) },
      });
    }
    return out;
  },
  async confirm(c, chain) {
    const tx = await chain.getTransaction(String(c.evidence.txHash));
    if (tx.status === 'SUCCESS') return null; // the sale landed; only the outbox bookkeeping is missing
    return { ...c, evidence: { ...c.evidence, chainStatus: tx.status } };
  },
};

/**
 * Treasury shares per (market, side) in the database vs market_core.get_position.
 *
 * Shares leave the treasury only through a confirmed agent_sell (which lowers
 * the position's sharesRaw to what is left), never through a database-only
 * close: applyMarketFinality and closePosition keep the shares on chain and
 * redeem is never called. So the expected balance is the sum of sharesRaw
 * over every position on the side, whatever its status.
 */
export const sharesMismatch: Invariant = {
  id: 'SHARES_MISMATCH',
  severity: 'CRITICAL',
  async find(db) {
    const sides = new Map<string, SidePositionRow[]>();
    for (const p of await db.sidePositions()) {
      const key = `${p.onChainMarketId}:${p.direction}`;
      sides.set(key, [...(sides.get(key) ?? []), p]);
    }
    const out: Candidate[] = [];
    for (const [key, rows] of sides) {
      const first = rows[0];
      const base = { marketId: first.marketId, onChainMarketId: first.onChainMarketId.toString(), direction: first.direction };
      const legacy = rows.filter((r) => r.sharesRaw == null).map((r) => r.id).sort();
      if (legacy.length > 0) {
        // A pre-#78 row has no share count: the side cannot be compared.
        out.push({
          invariant: 'SHARES_UNKNOWN_LEGACY',
          severity: 'INFO',
          subjectType: 'market_side',
          subjectId: key,
          evidence: { ...base, legacyPositionIds: legacy },
          core: { legacyPositionIds: legacy },
          suggestedRepair: 'scripts/backfill-position-shares.ts',
        });
        continue;
      }
      const dbShares = rows.reduce((acc, r) => acc + toBig(r.sharesRaw), 0n);
      const exits = rows.flatMap((r) => r.exits);
      out.push({
        invariant: this.id,
        severity: this.severity,
        subjectType: 'market_side',
        subjectId: key,
        evidence: {
          ...base,
          dbShares: dbShares.toString(),
          positions: rows.map((r) => ({ id: r.id, status: r.status, closeReason: r.closeReason, sharesRaw: r.sharesRaw })),
        },
        core: { dbShares: dbShares.toString() },
        suggestedRepair: null,
        inFlight: {
          refIds: [...rows.map((r) => r.tradeId), ...exits.map((e) => e.id)],
          updatedAt: [...rows.flatMap((r) => [r.updatedAt, r.tradeUpdatedAt]), ...exits.map((e) => e.createdAt)],
          exitSubmitted: exits.some((e) => e.status === 'SUBMITTED'),
        },
      });
    }
    return out;
  },
  async confirm(c, chain, ctx) {
    if (c.invariant !== this.id) return c; // SHARES_UNKNOWN_LEGACY: nothing to read
    const onChainMarketId = BigInt(String(c.evidence.onChainMarketId));
    // Read after the snapshot; the ledger it ran against bounds the race check below.
    const { position, ledger } = await chain.getPositionWithLedger(onChainMarketId, ctx.treasury);
    const chainShares = BigInt(c.evidence.direction === 'YES' ? position.yes : position.no);
    const dbShares = BigInt(String(c.evidence.dbShares));
    if (chainShares === dbShares) return null;

    const cursor = ctx.indexerCursorAtSnapshot;
    const evidence: Record<string, unknown> = {
      ...c.evidence,
      chainShares: chainShares.toString(),
      delta: (chainShares - dbShares).toString(),
      observedLedger: ledger,
      indexerCursor: cursor,
    };
    const finding: Finding = {
      ...c,
      severity: chainShares < dbShares ? 'CRITICAL' : 'HIGH',
      evidence,
      core: { dbShares: dbShares.toString(), chainShares: chainShares.toString() },
    };

    // A treasury trade between the snapshot and the read explains a difference.
    let race: string | null = null;
    if (ctx.indexerEnabled && cursor !== null) {
      if (ledger - cursor > ctx.indexerLagLedgers) race = 'INDEXER_BEHIND';
      else if (ledger > cursor && (await ctx.treasuryTradeEvents(onChainMarketId, cursor, ledger)) > 0) race = 'TRADES_AFTER_SNAPSHOT';
    }
    const prev = await ctx.previousFinding(this.id, c.subjectId);
    if (race) {
      // Not forever (#83's idea): past MAX_CONSECUTIVE_DEFERRALS it is reported, flagged forced.
      const prevRaces = prev?.action === 'DEFERRED' ? Number((prev.evidence as { raceDeferrals?: number } | null)?.raceDeferrals ?? 0) : 0;
      evidence.deferReason = race;
      evidence.raceDeferrals = prevRaces + 1;
      if (prevRaces < MAX_CONSECUTIVE_DEFERRALS) return { ...finding, deferReason: race };
      evidence.forced = true;
      return finding;
    }
    // Reported only when two consecutive runs agree on both numbers.
    if (!prev || prev.action === 'SKIPPED_IN_FLIGHT' || prev.fingerprint !== fingerprintOf(finding)) {
      evidence.deferReason = 'UNCONFIRMED';
      return { ...finding, deferReason: 'UNCONFIRMED' };
    }
    return finding;
  },
};

/** CONFIRMED buy_yes / buy_no trace whose market has no EXECUTED trade on that side created before it. */
export const traceWithoutTrade: Invariant = {
  id: 'TRACE_WITHOUT_TRADE',
  severity: 'MEDIUM',
  async find(db) {
    const out: Candidate[] = [];
    for (const p of await db.confirmedBuyTracesWithoutTrade()) {
      if (p.status !== 'CONFIRMED') continue;
      const side = p.action === TRACE_ACTIONS.buyYes ? 'YES' : p.action === TRACE_ACTIONS.buyNo ? 'NO' : null;
      if (!side) continue;
      // The publication is queued after the trade executes, so the trade predates it.
      if (p.trades.some((t) => t.direction === side && t.createdAt <= p.createdAt)) continue;
      out.push({
        invariant: this.id,
        severity: this.severity,
        subjectType: 'trace',
        subjectId: p.traceId,
        evidence: {
          publicationId: p.id,
          marketId: p.marketId,
          action: p.action,
          expectedDirection: side,
          otherSideTrades: p.trades.filter((t) => t.direction !== side).map((t) => t.id),
        },
        core: { action: p.action },
        suggestedRepair: null,
        inFlight: { updatedAt: [p.updatedAt] },
      });
    }
    return out;
  },
};

export const INVARIANTS: readonly Invariant[] = [
  tradeExecutedWithoutOutbox,
  positionWithoutExecutedTrade,
  executedTradeWithoutPosition,
  outboxTerminalUnhandled,
  tradeStuckPending,
  exitConfirmedNotLanded,
  sharesMismatch,
  traceWithoutTrade,
];
