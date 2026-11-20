/**
 * Admin outbox console (#221): read and repair the chain_transactions outbox
 * (#35) without hand-written SQL.
 *
 * Reads decode the stored envelope (never returning signature bytes or any
 * XDR), list the fee bumps without their envelopes, ask RPC for every known
 * hash and load the domain rows the write belongs to.
 *
 * The three actions reuse the recovery worker's own compare-and-set
 * transitions and run under the per-row lease the worker also takes
 * (withRowLease), so an operator and the worker never process one row at the
 * same moment. They fail closed (503) when Redis is down.
 *
 *   recover        non-terminal → recoverRow; terminal + unhandled → handler
 *   rerun-handler  terminal only; clears handledAt by CAS, re-runs the handler
 *                  from the stored outcome (handlers are idempotent, #35)
 *   abandon        SIGNED | SUBMITTED | PENDING → EXPIRED, only when no hash
 *                  landed and ledgerExpiry() proves the envelope can no longer
 *                  land (ledger close time past maxTime and the submission
 *                  inside RPC retention)
 *
 * Sequence note: abandoning an envelope the agent's Redis sequence counter
 * (stellar/sequence.ts) already advanced past leaves the cache one ahead of
 * the account. The next live write is rejected with tx_bad_seq before it is
 * submitted; chain.service classifies that as BAD_SEQUENCE (submitted: false),
 * resyncs the counter from RPC and the retry loop rebuilds on the right
 * sequence ('resync-rebuild' in stellar/failures.ts), so no manual repair is
 * needed.
 */
import { Address, FeeBumpTransaction, Transaction, TransactionBuilder, scValToNative, xdr } from '@stellar/stellar-sdk';
import { config } from '../config';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { RedisUnavailableError } from '../lib/redis';
import { AppError } from '../middlewares/error.middleware';
import { rpcServer } from './stellar/clients';
import { contractErrorName } from './stellar/errors';
import {
  SIGNED_GRACE_MS,
  TERMINAL_STATUSES,
  completionOutcomeFor,
  ledgerExpiry,
  prismaOutboxStore,
  recoverRow,
  runCompletionHandler,
  withRowLease,
  type ChainTransactionRow,
  type LeaseRedis,
  type LedgerExpiry,
  type OutboxStatus,
  type OutboxStore,
  type RecoveryRpc,
  type RecoveryStats,
  type RetentionFields,
} from './stellar/outbox';

export const OUTBOX_STATUSES: readonly OutboxStatus[] = ['BUILT', 'SIGNED', 'SUBMITTED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED'];

/** Statuses abandon accepts. A SIGNED row may already have been sent, so it is treated like SUBMITTED. */
const ABANDONABLE: readonly OutboxStatus[] = ['SIGNED', 'SUBMITTED', 'PENDING'];

const isTerminal = (status: string) => TERMINAL_STATUSES.includes(status as OutboxStatus);

// ─── List ────────────────────────────────────────────────────────────────────

export interface OutboxListFilter {
  status?: OutboxStatus[];
  kind?: string;
  refId?: string;
  /** Matches the inner hash, the landed hash or any fee-bump hash. */
  hash?: string;
  /** true: terminal rows whose handler has not run; false: everything else. */
  unhandled?: boolean;
  /** Only rows created more than this many seconds ago. */
  olderThanSecs?: number;
  page: number;
  limit: number;
}

export interface OutboxSummary {
  id: string;
  kind: string;
  refId: string | null;
  contract: string | null;
  method: string | null;
  status: string;
  hash: string | null;
  landedHash: string | null;
  feeBumpHashes: string[];
  bumpAttempts: number;
  attempts: number;
  submitLedger: number | null;
  ledger: number | null;
  minTime: string | null;
  maxTime: string | null;
  error: string | null;
  handledAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

type Row = ChainTransactionRow & { createdAt?: Date };

/** Prisma `where` for a list filter. Pure; exported for tests. */
export function outboxListWhere(f: Omit<OutboxListFilter, 'page' | 'limit'>, now: Date = new Date()): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  if (f.status && f.status.length > 0) and.push({ status: { in: f.status } });
  if (f.kind) and.push({ kind: f.kind });
  if (f.refId) and.push({ refId: f.refId });
  if (f.hash) {
    const hash = f.hash.toLowerCase();
    and.push({ OR: [{ hash }, { landedHash: hash }, { feeBumpHashes: { has: hash } }] });
  }
  if (f.unhandled === true) {
    and.push({ status: { in: [...TERMINAL_STATUSES] } }, { handledAt: null });
  } else if (f.unhandled === false) {
    and.push({ OR: [{ status: { notIn: [...TERMINAL_STATUSES] } }, { handledAt: { not: null } }] });
  }
  if (f.olderThanSecs != null) {
    and.push({ createdAt: { lt: new Date(now.getTime() - f.olderThanSecs * 1000) } });
  }
  return and.length > 0 ? { AND: and } : {};
}

/** The list/summary view: no envelope, no simulation, no fee-bump XDR. */
export function summarize(row: Row): OutboxSummary {
  return {
    id: row.id,
    kind: row.kind,
    refId: row.refId,
    contract: row.contract,
    method: row.method,
    status: row.status,
    hash: row.hash,
    landedHash: row.landedHash,
    feeBumpHashes: row.feeBumpHashes ?? [],
    bumpAttempts: row.bumpAttempts,
    attempts: row.attempts,
    submitLedger: row.submitLedger,
    ledger: row.ledger,
    minTime: row.minTime != null ? row.minTime.toString() : null,
    maxTime: row.maxTime != null ? row.maxTime.toString() : null,
    error: row.error,
    handledAt: row.handledAt,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export interface OutboxListDb {
  findMany(args: unknown): Promise<Row[]>;
  count(args: unknown): Promise<number>;
}

const chainTransactions = () => (prisma as unknown as { chainTransaction: OutboxListDb }).chainTransaction;

export async function listOutbox(
  f: OutboxListFilter,
  deps: { db?: OutboxListDb; now?: Date } = {},
): Promise<{ rows: OutboxSummary[]; total: number }> {
  const db = deps.db ?? chainTransactions();
  const where = outboxListWhere(f, deps.now);
  const [rows, total] = await Promise.all([
    db.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (f.page - 1) * f.limit, take: f.limit }),
    db.count({ where }),
  ]);
  return { rows: rows.map(summarize), total };
}

// ─── Detail ──────────────────────────────────────────────────────────────────

export interface DecodedOperation {
  type: string;
  contract?: string;
  function?: string;
  args?: unknown[];
}

export interface DecodedAuthEntry {
  /** Credential address, or 'source_account' for source-account credentials. */
  address: string;
  nonce: string | null;
  signatureExpirationLedger: number | null;
}

export interface DecodedEnvelope {
  source: string;
  sequence: string;
  fee: string;
  timeBounds: { minTime: string; maxTime: string } | null;
  operations: DecodedOperation[];
  authEntries: DecodedAuthEntry[];
  /** How many decorated signatures the envelope carries; the bytes are never returned. */
  signatureCount: number;
}

const SIGNATURE_KEY = /^(sig|sigs|signature|signatures)$/i;

/** JSON-safe view of a decoded ScVal: BigInt as string, bytes as hex, signature-named fields redacted. */
function printable(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return value.map(printable);
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([k, v]) => [String(k), SIGNATURE_KEY.test(String(k)) ? '[redacted]' : printable(v)]));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SIGNATURE_KEY.test(k) ? '[redacted]' : printable(v)]),
    );
  }
  return value;
}

function safeNative(val: xdr.ScVal): unknown {
  try {
    return printable(scValToNative(val));
  } catch {
    return { undecodable: val.switch().name };
  }
}

function decodeAuth(entry: xdr.SorobanAuthorizationEntry): DecodedAuthEntry {
  const credentials = entry.credentials();
  if (credentials.switch().name !== 'sorobanCredentialsAddress') {
    return { address: 'source_account', nonce: null, signatureExpirationLedger: null };
  }
  // Only the address, nonce and expiry: credentials.signature() is never read.
  const address = credentials.address();
  return {
    address: Address.fromScAddress(address.address()).toString(),
    nonce: address.nonce().toString(),
    signatureExpirationLedger: address.signatureExpirationLedger(),
  };
}

/**
 * Decodes a stored envelope for display. Signature bytes, auth-entry
 * signatures and the raw XDR are never part of the result.
 */
export function decodeEnvelope(envelopeXdr: string, passphrase: string = config.STELLAR_NETWORK_PASSPHRASE): DecodedEnvelope {
  const parsed = TransactionBuilder.fromXDR(envelopeXdr, passphrase);
  const tx: Transaction = parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : (parsed as Transaction);
  const operations: DecodedOperation[] = [];
  const authEntries: DecodedAuthEntry[] = [];
  for (const op of tx.operations) {
    if (op.type !== 'invokeHostFunction') {
      operations.push({ type: op.type });
      continue;
    }
    const func = op.func;
    if (func.switch().name === 'hostFunctionTypeInvokeContract') {
      const invoke = func.invokeContract();
      operations.push({
        type: op.type,
        contract: Address.fromScAddress(invoke.contractAddress()).toString(),
        function: invoke.functionName().toString(),
        args: invoke.args().map(safeNative),
      });
    } else {
      operations.push({ type: func.switch().name });
    }
    for (const entry of op.auth ?? []) authEntries.push(decodeAuth(entry));
  }
  return {
    source: tx.source,
    sequence: tx.sequence,
    fee: String(parsed.fee),
    timeBounds: tx.timeBounds ? { minTime: String(tx.timeBounds.minTime), maxTime: String(tx.timeBounds.maxTime) } : null,
    operations,
    authEntries,
    signatureCount: parsed.signatures.length,
  };
}

export interface FeeBumpSummary {
  hash: string;
  fee: string | null;
  inclusionPerOp: string | null;
  at: string | null;
}

/** Fee-bump history without the outer envelopes (they carry fee-payer signatures). */
export function feeBumpHistory(row: Pick<ChainTransactionRow, 'feeBumpHashes' | 'feeBumpEnvelopes'>): FeeBumpSummary[] {
  const envelopes = Array.isArray(row.feeBumpEnvelopes) ? (row.feeBumpEnvelopes as Array<Record<string, unknown>>) : [];
  const hashes = row.feeBumpHashes ?? [];
  return hashes.map((hash, i) => {
    const env = envelopes.find((e) => e?.hash === hash) ?? envelopes[i] ?? {};
    return {
      hash,
      fee: env.fee != null ? String(env.fee) : null,
      inclusionPerOp: env.inclusionPerOp != null ? String(env.inclusionPerOp) : null,
      at: env.at != null ? String(env.at) : null,
    };
  });
}

export interface RpcHashStatus {
  hash: string;
  role: 'inner' | 'fee_bump';
  status: string;
  ledger: number | null;
  latestLedger: number | null;
  latestLedgerCloseTime: number | null;
  oldestLedger: number | null;
  oldestLedgerCloseTime: number | null;
  /** Decoded failure (contract error name or result code) for FAILED. */
  error: string | null;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

type BindingContract = 'marketCore' | 'treasury' | 'resolver' | 'reasoningRegistry';

function failureText(row: Pick<ChainTransactionRow, 'contract'>, resp: unknown): string {
  const r = resp as { resultXdr?: { result?: () => { switch?: () => { name?: string } } } };
  let code: string | undefined;
  try {
    code = r.resultXdr?.result?.().switch?.().name;
  } catch {
    code = undefined;
  }
  return contractErrorName((row.contract ?? 'treasury') as BindingContract, resp, code) ?? code ?? 'transaction failed on-chain';
}

/** getTransaction for the inner hash and every fee-bump hash; RPC errors are reported, not thrown. */
export async function rpcStatuses(
  row: Pick<ChainTransactionRow, 'hash' | 'feeBumpHashes' | 'contract'>,
  server: Pick<RecoveryRpc, 'getTransaction'>,
): Promise<RpcHashStatus[]> {
  const out: RpcHashStatus[] = [];
  const hashes: Array<[string, RpcHashStatus['role']]> = [
    ...(row.hash ? [[row.hash, 'inner'] as [string, 'inner']] : []),
    ...(row.feeBumpHashes ?? []).map((h) => [h, 'fee_bump'] as [string, 'fee_bump']),
  ];
  for (const [hash, role] of hashes) {
    try {
      const resp = (await server.getTransaction(hash)) as unknown as RetentionFields & { status: string; ledger?: number };
      out.push({
        hash,
        role,
        status: resp.status,
        ledger: num(resp.ledger),
        latestLedger: num(resp.latestLedger),
        latestLedgerCloseTime: num(resp.latestLedgerCloseTime),
        oldestLedger: num(resp.oldestLedger),
        oldestLedgerCloseTime: num(resp.oldestLedgerCloseTime),
        error: resp.status === 'FAILED' ? failureText(row, resp) : null,
      });
    } catch (err) {
      out.push({
        hash,
        role,
        status: 'RPC_ERROR',
        ledger: null,
        latestLedger: null,
        latestLedgerCloseTime: null,
        oldestLedger: null,
        oldestLedgerCloseTime: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

export interface LinkedRowsDb {
  market: { findUnique(args: unknown): Promise<unknown> };
  marketCreationAttempt: { findUnique(args: unknown): Promise<unknown> };
  trade: { findUnique(args: unknown): Promise<unknown> };
  positionExit: { findUnique(args: unknown): Promise<unknown> };
  reasoningTrace: { findUnique(args: unknown): Promise<unknown> };
  tracePublication: { findUnique(args: unknown): Promise<unknown> };
}

/** The domain rows a write belongs to, with explicit selects (no salts, signatures or payloads). */
export async function linkedRows(
  row: Pick<ChainTransactionRow, 'kind' | 'refId'>,
  db: LinkedRowsDb = prisma as unknown as LinkedRowsDb,
): Promise<Record<string, unknown> | null> {
  const id = row.refId;
  if (!id) return null;
  switch (row.kind) {
    case 'market.create': {
      const [market, creationAttempt] = await Promise.all([
        db.market.findUnique({
          where: { id },
          select: { id: true, question: true, status: true, onChainMarketId: true, creationTxHash: true, creationInnerTxHash: true, createdAt: true },
        }),
        db.marketCreationAttempt.findUnique({
          where: { marketId: id },
          select: { id: true, status: true, attempts: true, txHash: true, onChainMarketId: true, claimedAt: true, updatedAt: true },
        }),
      ]);
      return { market, creationAttempt };
    }
    case 'trade.buy':
      return {
        trade: await db.trade.findUnique({
          where: { id },
          select: { id: true, marketId: true, direction: true, status: true, amount: true, txHash: true, innerTxHash: true, errorMessage: true, executedAt: true, createdAt: true },
        }),
      };
    case 'trade.sell':
      return {
        positionExit: await db.positionExit.findUnique({
          where: { id },
          select: { id: true, positionId: true, mode: true, status: true, sharesSoldRaw: true, collateralOutRaw: true, txHash: true, error: true, createdAt: true },
        }),
      };
    case 'trace.publish': {
      const [reasoningTrace, tracePublication] = await Promise.all([
        db.reasoningTrace.findUnique({
          where: { id },
          select: { id: true, marketId: true, agentType: true, traceHash: true, onChainTraceId: true, publishTxHash: true, publishInnerTxHash: true, verified: true, createdAt: true },
        }),
        db.tracePublication.findUnique({
          where: { traceId: id },
          select: { id: true, status: true, attempts: true, lastError: true, submittedTxHash: true, confirmedAt: true, updatedAt: true },
        }),
      ]);
      return { reasoningTrace, tracePublication };
    }
    default:
      return null;
  }
}

export interface OutboxDetail extends OutboxSummary {
  /** Contract arguments recorded at build time (printable). */
  args: unknown;
  returnValue: unknown;
  innerFee: string | null;
  resourceFee: string | null;
  envelope: DecodedEnvelope | null;
  envelopeError: string | null;
  feeBumps: FeeBumpSummary[];
  rpc: RpcHashStatus[];
  /** For non-terminal rows nothing landed for: whether expiry is provable now. */
  expiry: LedgerExpiry | null;
  linked: Record<string, unknown> | null;
}

export interface OutboxAdminDeps {
  server?: RecoveryRpc;
  store?: OutboxStore;
  db?: LinkedRowsDb;
  leaseRedis?: LeaseRedis;
  /** Clears handledAt only if it still holds the loaded value (CAS). */
  clearHandled?: (id: string, handledAt: Date) => Promise<boolean>;
  audit?: (entry: OutboxAuditEntry) => Promise<void>;
  now?: () => number;
}

async function loadRow(store: OutboxStore, id: string): Promise<Row> {
  const row = (await store.findById(id)) as Row | null;
  if (!row) throw new AppError(404, 'OUTBOX_NOT_FOUND', 'Chain transaction not found');
  return row;
}

export async function outboxDetail(id: string, deps: OutboxAdminDeps = {}): Promise<OutboxDetail> {
  const store = deps.store ?? prismaOutboxStore();
  const server = deps.server ?? rpcServer;
  const row = await loadRow(store, id);

  let envelope: DecodedEnvelope | null = null;
  let envelopeError: string | null = null;
  if (row.envelopeXdr) {
    try {
      envelope = decodeEnvelope(row.envelopeXdr);
    } catch (err) {
      envelopeError = err instanceof Error ? err.message : 'envelope did not decode';
    }
  }

  const rpc = await rpcStatuses(row, server);
  const landed = rpc.some((r) => r.status === 'SUCCESS' || r.status === 'FAILED');
  const latest = [...rpc].reverse().find((r) => r.status === 'NOT_FOUND');
  const expiry = !isTerminal(row.status) && !landed && latest ? ledgerExpiry(row, latest) : null;

  return {
    ...summarize(row),
    args: printable(row.args ?? null),
    returnValue: row.returnValue ?? null,
    innerFee: row.innerFee,
    resourceFee: row.resourceFee,
    envelope,
    envelopeError,
    feeBumps: feeBumpHistory(row),
    rpc,
    expiry,
    linked: await linkedRows(row, deps.db),
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export interface OutboxAuditEntry {
  actor: string;
  action: 'CHAIN_OUTBOX_RECOVER' | 'CHAIN_OUTBOX_RERUN_HANDLER' | 'CHAIN_OUTBOX_ABANDON';
  outboxId: string;
  kind: string;
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  hashes: string[];
  outcome: string;
}

async function prismaAudit(entry: OutboxAuditEntry): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      actor: entry.actor,
      action: entry.action,
      target: entry.outboxId,
      metadata: {
        outboxId: entry.outboxId,
        kind: entry.kind,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        reason: entry.reason,
        hashes: entry.hashes,
        outcome: entry.outcome,
      },
    },
  });
}

async function prismaClearHandled(id: string, handledAt: Date): Promise<boolean> {
  const db = prisma as unknown as { chainTransaction: { updateMany(args: unknown): Promise<{ count: number }> } };
  const moved = await db.chainTransaction.updateMany({ where: { id, handledAt }, data: { handledAt: null } });
  return moved.count > 0;
}

const hashesOf = (row: ChainTransactionRow) => [row.hash, ...(row.feeBumpHashes ?? [])].filter((h): h is string => !!h);

/** Runs an action under the row lease: 409 OUTBOX_ROW_BUSY when held, 503 when Redis is down. */
async function leased<T>(id: string, deps: OutboxAdminDeps, fn: () => Promise<T>): Promise<T> {
  let result: T | 'BUSY';
  try {
    result = await withRowLease(id, fn, { redis: deps.leaseRedis });
  } catch (err) {
    if (err instanceof RedisUnavailableError) {
      throw new AppError(503, 'OUTBOX_LEASE_UNAVAILABLE', 'The outbox row lease is unavailable (Redis down); refusing to act without it');
    }
    throw err;
  }
  if (result === 'BUSY') {
    throw new AppError(409, 'OUTBOX_ROW_BUSY', 'The recovery worker or another operator is processing this row; retry shortly');
  }
  return result;
}

async function writeAudit(deps: OutboxAdminDeps, entry: OutboxAuditEntry): Promise<void> {
  try {
    await (deps.audit ?? prismaAudit)(entry);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err, outboxId: entry.outboxId, action: entry.action }, 'outbox console: audit row not written');
  }
}

async function runHandler(row: ChainTransactionRow, store: OutboxStore): Promise<string | null> {
  try {
    await runCompletionHandler(row, completionOutcomeFor(row), store);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, outboxId: row.id, kind: row.kind }, 'outbox console: completion handler failed');
    return message;
  }
}

function handlerFailed(message: string): AppError {
  return new AppError(500, 'OUTBOX_HANDLER_FAILED', 'The completion handler failed; the row stays unhandled and the worker retries it', { error: message });
}

export interface OutboxActionResult {
  id: string;
  kind: string;
  fromStatus: string;
  toStatus: string;
  handled: boolean;
  stats?: RecoveryStats;
}

/**
 * Resolve one row now. Non-terminal rows go through recoverRow (exactly one
 * worker pass for that row); a terminal row whose handler never ran gets its
 * handler. BUILT/SIGNED rows inside the signing grace are still owned by the
 * live writer and are refused.
 */
export async function recoverNow(id: string, actor: string, reason: string | null, deps: OutboxAdminDeps = {}): Promise<OutboxActionResult> {
  const store = deps.store ?? prismaOutboxStore();
  return leased(id, deps, async () => {
    const row = await loadRow(store, id);
    const stats: RecoveryStats = { resolved: 0, resubmitted: 0, expired: 0, handled: 0, bumped: 0 };
    const nowMs = deps.now ? deps.now() * 1000 : Date.now();

    if (isTerminal(row.status)) {
      if (row.handledAt) {
        throw new AppError(409, 'OUTBOX_INVALID_STATE', 'Row is terminal and its handler already ran; use rerun-handler', { status: row.status });
      }
      const failure = await runHandler(row, store);
      const after = await loadRow(store, id);
      await writeAudit(deps, {
        actor, action: 'CHAIN_OUTBOX_RECOVER', outboxId: id, kind: row.kind, fromStatus: row.status, toStatus: after.status,
        reason, hashes: hashesOf(row), outcome: failure ? `handler failed: ${failure}` : 'handler ran',
      });
      if (failure) throw handlerFailed(failure);
      stats.handled++;
      return { id, kind: row.kind, fromStatus: row.status, toStatus: after.status, handled: !!after.handledAt, stats };
    }

    if ((row.status === 'BUILT' || row.status === 'SIGNED') && row.updatedAt && nowMs - row.updatedAt.getTime() < SIGNED_GRACE_MS) {
      throw new AppError(409, 'OUTBOX_INVALID_STATE', 'Row is still owned by the live writer (inside the signing grace); retry shortly', {
        status: row.status,
        graceMs: SIGNED_GRACE_MS,
      });
    }

    await recoverRow(row, { server: deps.server, store, now: deps.now }, stats);
    const after = await loadRow(store, id);
    await writeAudit(deps, {
      actor, action: 'CHAIN_OUTBOX_RECOVER', outboxId: id, kind: row.kind, fromStatus: row.status, toStatus: after.status,
      reason, hashes: hashesOf(after), outcome: JSON.stringify(stats),
    });
    return { id, kind: row.kind, fromStatus: row.status, toStatus: after.status, handled: !!after.handledAt, stats };
  });
}

/**
 * Re-run a terminal row's completion handler from the stored outcome. A set
 * handledAt is cleared by compare-and-set first; the handler then runs and
 * marks the row handled again. Handlers only update domain rows from the
 * stored outcome (market.create links, never creates, a market), and are
 * idempotent by contract, so a re-run that has nothing to do is a no-op.
 */
export async function rerunHandler(id: string, actor: string, reason: string, deps: OutboxAdminDeps = {}): Promise<OutboxActionResult> {
  const store = deps.store ?? prismaOutboxStore();
  const clearHandled = deps.clearHandled ?? prismaClearHandled;
  return leased(id, deps, async () => {
    let row = await loadRow(store, id);
    if (!isTerminal(row.status)) {
      throw new AppError(409, 'OUTBOX_INVALID_STATE', 'Only terminal rows (SUCCESS, FAILED, EXPIRED) can re-run their handler', { status: row.status });
    }
    if (row.handledAt) {
      if (!(await clearHandled(id, row.handledAt))) {
        throw new AppError(409, 'OUTBOX_INVALID_STATE', 'handledAt changed concurrently; reload the row and retry');
      }
      row = await loadRow(store, id);
    }
    const failure = await runHandler(row, store);
    const after = await loadRow(store, id);
    await writeAudit(deps, {
      actor, action: 'CHAIN_OUTBOX_RERUN_HANDLER', outboxId: id, kind: row.kind, fromStatus: row.status, toStatus: after.status,
      reason, hashes: hashesOf(row), outcome: failure ? `handler failed: ${failure}` : 'handler ran',
    });
    if (failure) throw handlerFailed(failure);
    return { id, kind: row.kind, fromStatus: row.status, toStatus: after.status, handled: !!after.handledAt };
  });
}

/**
 * Give up on an in-flight envelope. Allowed only from SIGNED, SUBMITTED or
 * PENDING, only when no hash (inner or any fee bump) landed, and only when
 * ledgerExpiry() proves it can no longer land. A landed hash resolves the row
 * through normal recovery instead (409 OUTBOX_ROW_LANDED).
 */
export async function abandon(id: string, actor: string, reason: string, deps: OutboxAdminDeps = {}): Promise<OutboxActionResult> {
  const store = deps.store ?? prismaOutboxStore();
  const server = deps.server ?? rpcServer;
  return leased(id, deps, async () => {
    const row = await loadRow(store, id);
    if (!ABANDONABLE.includes(row.status as OutboxStatus)) {
      throw new AppError(409, 'OUTBOX_INVALID_STATE', `Only ${ABANDONABLE.join(', ')} rows can be abandoned`, { status: row.status });
    }
    if (row.maxTime == null) {
      throw new AppError(409, 'OUTBOX_NOT_PROVABLE', 'Row has no maxTime (written before timebounds); expiry can never be proven');
    }
    if (!row.hash) {
      throw new AppError(409, 'OUTBOX_INVALID_STATE', 'Row has no transaction hash');
    }

    // Every hash, inner and outer: a fee bump can land while the inner hash reports NOT_FOUND.
    const statuses = await rpcStatuses(row, server);
    const unreachable = statuses.find((s) => s.status === 'RPC_ERROR');
    if (unreachable) {
      throw new AppError(503, 'OUTBOX_RPC_UNAVAILABLE', 'RPC did not answer for every hash; cannot prove the envelope is dead', { hash: unreachable.hash });
    }
    const landed = statuses.find((s) => s.status === 'SUCCESS' || s.status === 'FAILED');
    if (landed) {
      const stats: RecoveryStats = { resolved: 0, resubmitted: 0, expired: 0, handled: 0, bumped: 0 };
      await recoverRow(row, { server, store, now: deps.now }, stats);
      const after = await loadRow(store, id);
      await writeAudit(deps, {
        actor, action: 'CHAIN_OUTBOX_ABANDON', outboxId: id, kind: row.kind, fromStatus: row.status, toStatus: after.status,
        reason, hashes: hashesOf(row), outcome: `refused: ${landed.hash} landed (${landed.status}); resolved by recovery`,
      });
      throw new AppError(409, 'OUTBOX_ROW_LANDED', 'A hash of this row landed on chain; it was resolved by normal recovery instead', {
        landedHash: landed.hash,
        chainStatus: landed.status,
        status: after.status,
      });
    }

    const latest = statuses[statuses.length - 1];
    const expiry = ledgerExpiry(row, latest);
    if (expiry.decision !== 'EXPIRED') {
      throw new AppError(409, 'OUTBOX_NOT_PROVABLE', `The envelope cannot be proven dead: ${expiry.reason}`, {
        decision: expiry.decision,
        latestLedgerCloseTime: expiry.latestLedgerCloseTime,
        oldestLedger: expiry.oldestLedger,
        maxTime: expiry.maxTime,
        submitLedger: expiry.submitLedger,
      });
    }

    const error = `abandoned by admin: ${reason}`;
    const moved = await store.transition(id, [row.status as OutboxStatus], 'EXPIRED', { error });
    if (!moved) {
      throw new AppError(409, 'OUTBOX_INVALID_STATE', 'Row changed state concurrently; reload and retry');
    }
    let failure: string | null = null;
    try {
      await runCompletionHandler(moved, { status: 'EXPIRED', txHash: row.hash, error }, store);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      logger.error({ err: failure, outboxId: id, kind: row.kind }, 'outbox console: EXPIRED handler failed; the worker retries it');
    }
    await writeAudit(deps, {
      actor, action: 'CHAIN_OUTBOX_ABANDON', outboxId: id, kind: row.kind, fromStatus: row.status, toStatus: 'EXPIRED',
      reason, hashes: hashesOf(row), outcome: failure ? `expired; handler failed: ${failure}` : 'expired; handler ran',
    });
    return { id, kind: row.kind, fromStatus: row.status, toStatus: 'EXPIRED', handled: failure == null };
  });
}
