/**
 * Verifies a premium payment on-chain: a successful SEP-41 `transfer` on the
 * USDC contract, from the logged-in user, to PAYMENTS_RECIPIENT, for at least
 * the tier price. There is no bypass: if this can't prove the payment, the
 * payment grants nothing. Tests inject a fake RPC client.
 *
 * #51: the source of truth is the SAC `transfer` events the token contract
 * actually emitted, decoded from the transaction meta. The envelope is only a
 * secondary invariant for a simple direct call.
 *
 * #46: a login can be a sub-identity of a pooled base account (an M… muxed
 * address, or a G… account with an id memo). Such a payment must additionally
 * prove that sub-identity, or another sub-user of the same pool could claim it.
 *
 * #305: verification is split into immutable chain facts (`fetchTxFacts` /
 * `getTxFacts`, cached in a bounded LRU + `chain_tx_facts` Postgres table with
 * in-process single-flight) and pure evaluation (`evaluateTransfer`), so
 * payment claims verify before taking Postgres advisory locks.
 */
import { Address, MuxedAccount, rpc, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';
import { AppError } from '../middlewares/error.middleware';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import {
  innerTransaction,
  TransactionReader,
  getTransactionReader,
  setTransactionReader as setSharedTransactionReader,
} from './stellar/tx-inspect';
import { sacTransfersFromMeta, SacTransfer } from './stellar/sac-events';
import { withTimeout, TimeoutError, SaturatedError } from '../lib/resilience';

export { innerTransaction, TransactionReader };

export interface TxMemo {
  type: 'none' | 'id' | 'text' | 'hash' | 'return';
  value: string | null;
}

/** The recipient/amount a single direct-call envelope requested, if any. */
export interface DirectCall {
  contract: string;
  from: string;
  to: string;
  amount: bigint;
  rawFrom: string;
}

/**
 * Immutable chain facts extracted from a finalised Stellar transaction
 * (`SUCCESS` or `FAILED`). Independent of caller expectations so it can be
 * cached safely by `txHash` (#305).
 */
export interface TxFacts {
  txHash: string;
  status: 'SUCCESS' | 'FAILED';
  ledger: number;
  createdAt: number | null;
  transfers: SacTransfer[];
  txSource: { base: string; id: string; muxed: boolean };
  memo: TxMemo;
  direct: DirectCall | null;
}

export interface VerifiedTransfer {
  txHash: string;
  /** Base G…/C… account the transfer is from. */
  from: string;
  to: string;
  amount: bigint;
  ledger: number;
  /** Base G… account of the (inner) transaction source. */
  txSource: string;
  memo: TxMemo;
  /** Qualifying transfers (from → to) that were summed. */
  transfers: SacTransfer[];
  /** Recipient muxed id from a CAP-67 transfer, when present. */
  toMuxedId: string | null;
  createdAt: number | null;
  /** Set when a single direct-call envelope disagreed with the events. */
  envelopeMismatch: boolean;
}

export interface ExpectedTransfer {
  txHash: string;
  token: string;
  from: string;
  to: string;
  minAmount: bigint;
  /** Sub-identity id (muxed or memo) that the payment must prove, if any. */
  subId?: string | null;
  subIdKind?: 'MUXED' | 'MEMO' | null;
  /** Exact transaction memo required by a payment intent (#52). */
  memo?: { type: 'id' | 'text'; value: string } | null;
}

const fail = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(402, code, message, details);

interface MuxedParts {
  base: string;
  id: string;
}

/** Parses an M… address into its base account and id, or null if not muxed. */
function parseMuxed(address: string): MuxedParts | null {
  if (!StrKey.isValidMed25519PublicKey(address)) return null;
  try {
    const muxed = MuxedAccount.fromAddress(address, '0');
    return { base: muxed.baseAccount().accountId(), id: muxed.id() };
  } catch {
    return null;
  }
}

/** The inner transaction's source account, unwrapping any muxed form. */
function readTxSource(tx: ReturnType<typeof innerTransaction>): MuxedParts & { muxed: boolean } {
  const source = tx.sourceAccount();
  if (source.switch().name === 'keyTypeMuxedEd25519') {
    const m = source.med25519();
    return { base: StrKey.encodeEd25519PublicKey(m.ed25519()), id: m.id().toString(), muxed: true };
  }
  return { base: StrKey.encodeEd25519PublicKey(source.ed25519()), id: '0', muxed: false };
}

/** Reads the inner transaction memo into a stable shape. */
function readMemo(tx: ReturnType<typeof innerTransaction>): TxMemo {
  try {
    const memo = tx.memo();
    switch (memo.switch().name) {
      case 'memoId':
        return { type: 'id', value: memo.id().toString() };
      case 'memoText':
        return { type: 'text', value: memo.text().toString() };
      case 'memoHash':
        return { type: 'hash', value: memo.hash().toString('hex') };
      case 'memoReturn':
        return { type: 'return', value: memo.retHash().toString('hex') };
      default:
        return { type: 'none', value: null };
    }
  } catch {
    return { type: 'none', value: null };
  }
}

/** Reads a single direct `transfer` invocation from the envelope, or null. */
function readDirectTransfer(tx: ReturnType<typeof innerTransaction>): DirectCall | null {
  try {
    const ops = tx.operations();
    if (ops.length !== 1 || ops[0].body().switch().name !== 'invokeHostFunction') return null;
    const fn = ops[0].body().invokeHostFunctionOp().hostFunction();
    if (fn.switch().name !== 'hostFunctionTypeInvokeContract') return null;
    const call = fn.invokeContract();
    const method = call.functionName().toString();
    const args = call.args();
    if (method !== 'transfer' || args.length !== 3) return null;
    const contract = Address.fromScAddress(call.contractAddress()).toString();
    const rawFrom = Address.fromScVal(args[0]).toString();
    const to = Address.fromScVal(args[1]).toString();
    const amount = scValToNative(args[2]) as bigint;
    if (typeof amount !== 'bigint') return null;
    const fromMuxed = parseMuxed(rawFrom);
    return { contract, from: fromMuxed ? fromMuxed.base : rawFrom, to, amount, rawFrom };
  } catch {
    return null;
  }
}

// ─── Facts Cache (LRU + Single-Flight + Postgres chain_tx_facts) (#305) ─────

const TX_FACTS_LRU_MAX = 5_000;
const txFactsLru = new Map<string, TxFacts>();
const inFlightFacts = new Map<string, Promise<TxFacts>>();

function lruGet(hash: string): TxFacts | undefined {
  const existing = txFactsLru.get(hash);
  if (!existing) return undefined;
  txFactsLru.delete(hash);
  txFactsLru.set(hash, existing);
  return existing;
}

function lruSet(hash: string, facts: TxFacts): void {
  if (txFactsLru.has(hash)) {
    txFactsLru.delete(hash);
  } else if (txFactsLru.size >= TX_FACTS_LRU_MAX) {
    const oldest = txFactsLru.keys().next().value;
    if (oldest !== undefined) txFactsLru.delete(oldest);
  }
  txFactsLru.set(hash, facts);
}

/** Clears the in-process transaction facts LRU cache (used by tests). */
export function clearTxFactsCache(): void {
  txFactsLru.clear();
  inFlightFacts.clear();
}

/**
 * Installs a replacement TransactionReader and clears the in-process facts
 * cache so test fixtures reusing the same txHash never observe stale facts.
 */
export function setTransactionReader(next: TransactionReader): TransactionReader {
  clearTxFactsCache();
  return setSharedTransactionReader(next);
}

interface SerializedTxFacts {
  createdAt: number | null;
  transfers: Array<Omit<SacTransfer, 'amount'> & { amount: string }>;
  txSource: { base: string; id: string; muxed: boolean };
  memo: TxMemo;
  direct: (Omit<DirectCall, 'amount'> & { amount: string }) | null;
}

function serializeFactsPayload(facts: TxFacts): SerializedTxFacts {
  return {
    createdAt: facts.createdAt,
    transfers: facts.transfers.map((t) => ({ ...t, amount: t.amount.toString() })),
    txSource: facts.txSource,
    memo: facts.memo,
    direct: facts.direct ? { ...facts.direct, amount: facts.direct.amount.toString() } : null,
  };
}

function deserializeFactsRow(row: {
  txHash: string;
  status: string;
  ledger: number;
  facts: unknown;
}): TxFacts | null {
  if (row.status !== 'SUCCESS' && row.status !== 'FAILED') return null;
  const payload = row.facts as Partial<SerializedTxFacts> | null;
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.transfers)) return null;
  try {
    return {
      txHash: row.txHash,
      status: row.status,
      ledger: Number(row.ledger),
      createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : null,
      transfers: payload.transfers.map((t) => ({
        contractId: t.contractId,
        from: t.from,
        to: t.to,
        amount: BigInt(t.amount),
        toMuxedId: t.toMuxedId ?? null,
        opIndex: t.opIndex ?? null,
        asset: t.asset ?? null,
      })),
      txSource: payload.txSource ?? { base: '', id: '0', muxed: false },
      memo: payload.memo ?? { type: 'none', value: null },
      direct: payload.direct
        ? {
            contract: payload.direct.contract,
            from: payload.direct.from,
            to: payload.direct.to,
            amount: BigInt(payload.direct.amount),
            rawFrom: payload.direct.rawFrom,
          }
        : null,
    };
  } catch {
    return null;
  }
}

export interface TxFactsDbStore {
  read(txHash: string): Promise<TxFacts | null>;
  write(facts: TxFacts): Promise<void>;
}

const defaultTxFactsDbStore: TxFactsDbStore = {
  async read(txHash: string): Promise<TxFacts | null> {
    if (typeof (prisma as any)?.$queryRaw !== 'function') return null;
    try {
      const rows = await prisma.$queryRaw<Array<{ txHash: string; status: string; ledger: number; facts: unknown }>>`
        SELECT "txHash", "status", "ledger", "facts"
        FROM "chain_tx_facts"
        WHERE "txHash" = ${txHash}
        LIMIT 1
      `;
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return deserializeFactsRow(rows[0]);
    } catch {
      return null;
    }
  },
  async write(facts: TxFacts): Promise<void> {
    if (typeof (prisma as any)?.$executeRaw !== 'function') return;
    try {
      const json = JSON.stringify(serializeFactsPayload(facts));
      await prisma.$executeRaw`
        INSERT INTO "chain_tx_facts" ("txHash", "status", "ledger", "facts", "fetchedAt")
        VALUES (${facts.txHash}, ${facts.status}, ${facts.ledger}, ${json}::jsonb, NOW())
        ON CONFLICT ("txHash") DO NOTHING
      `;
    } catch (err) {
      logger.debug(
        { err: err instanceof Error ? err.message : String(err), txHash: facts.txHash },
        'chain_tx_facts cache write skipped',
      );
    }
  },
};

let txFactsDbStore: TxFactsDbStore = defaultTxFactsDbStore;

/** Test seam (#305): inject an in-memory or fake DB store for `chain_tx_facts`. */
export function setTxFactsStoreForTest(store: TxFactsDbStore | null): TxFactsDbStore {
  const prev = txFactsDbStore;
  txFactsDbStore = store ?? defaultTxFactsDbStore;
  return prev;
}

// ─── Phase 1: Fetch Immutable Chain Facts (RPC, bounded by rpc-read) ────────

/**
 * Fetches immutable transaction facts from Stellar RPC.
 * Bounded by the `rpc-read` bulkhead: throws `SaturatedError` (503 + Retry-After)
 * when saturated, `PAYMENT_NOT_FOUND` (402) when not yet indexed, and
 * `CHAIN_READ_FAILED` / `CHAIN_READ_INCOMPLETE` (502) on RPC failures.
 */
export async function fetchTxFacts(
  txHash: string,
  opts?: { signal?: AbortSignal },
): Promise<TxFacts> {
  const hash = txHash.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'txHash must be a 64-character lowercase hex Stellar transaction hash');
  }

  let response: rpc.Api.GetTransactionResponse;
  try {
    response = await withTimeout(
      'rpc-read',
      async () => getTransactionReader().getTransaction(hash),
      { signal: opts?.signal },
    );
  } catch (err: any) {
    if (err instanceof SaturatedError || err?.code === 'UPSTREAM_SATURATED') {
      throw err;
    }
    if (err instanceof TimeoutError || err?.code === 'UPSTREAM_TIMEOUT') {
      throw new AppError(502, 'CHAIN_READ_FAILED', 'Stellar RPC read timed out', { timeout: true });
    }
    throw new AppError(502, 'CHAIN_READ_FAILED', 'Could not reach Stellar RPC to verify the payment', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (response.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    throw fail('PAYMENT_NOT_FOUND', 'Payment transaction not found. If you just paid, wait a few seconds and retry.');
  }

  const anyResponse = response as any;
  const ledger = typeof anyResponse.ledger === 'number' ? anyResponse.ledger : 0;
  const createdAt = typeof anyResponse.createdAt === 'number' ? anyResponse.createdAt : null;

  if (response.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    return {
      txHash: hash,
      status: 'FAILED',
      ledger,
      createdAt,
      transfers: [],
      txSource: { base: '', id: '0', muxed: false },
      memo: { type: 'none', value: null },
      direct: null,
    };
  }

  const resultMetaXdr = anyResponse.resultMetaXdr as xdr.TransactionMeta | string | undefined;
  const contractEventsXdr = anyResponse.events?.contractEventsXdr as xdr.ContractEvent[][] | undefined;
  const hasContractEvents =
    Array.isArray(contractEventsXdr) && contractEventsXdr.some((ops) => Array.isArray(ops) && ops.length > 0);

  // Fail closed: never fall back to envelope-only verification when the node
  // did not return the meta that records value movement.
  if (!resultMetaXdr && !hasContractEvents) {
    throw new AppError(502, 'CHAIN_READ_INCOMPLETE', 'Stellar RPC returned no transaction meta; cannot verify the payment');
  }

  const transfers = sacTransfersFromMeta({ resultMetaXdr, contractEventsXdr });

  // Envelope reads are best-effort: the events above already proved the
  // payment. The envelope only supplies secondary signals (memo, source) and
  // the direct-call invariant.
  let tx: ReturnType<typeof innerTransaction> | null = null;
  try {
    tx = innerTransaction(response.envelopeXdr);
  } catch {
    tx = null;
  }

  const txSource = tx ? readTxSource(tx) : { base: '', id: '0', muxed: false };
  const memo = tx ? readMemo(tx) : { type: 'none' as const, value: null };
  const direct = tx ? readDirectTransfer(tx) : null;

  return {
    txHash: hash,
    status: 'SUCCESS',
    ledger,
    createdAt,
    transfers,
    txSource,
    memo,
    direct,
  };
}

/**
 * Returns immutable transaction facts from LRU → Postgres `chain_tx_facts` →
 * RPC (`fetchTxFacts`), coalescing concurrent in-process lookups via a
 * single-flight map. Only finalised (`SUCCESS` or `FAILED`) results are cached;
 * `PAYMENT_NOT_FOUND`, timeouts, saturation, and `CHAIN_READ_INCOMPLETE` are
 * never cached.
 */
export async function getTxFacts(
  txHash: string,
  opts?: { signal?: AbortSignal },
): Promise<TxFacts> {
  const hash = txHash.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'txHash must be a 64-character lowercase hex Stellar transaction hash');
  }

  const memHit = lruGet(hash);
  if (memHit) return memHit;

  const existingFlight = inFlightFacts.get(hash);
  if (existingFlight) return existingFlight;

  const flight = (async (): Promise<TxFacts> => {
    const dbHit = await txFactsDbStore.read(hash);
    if (dbHit) {
      lruSet(hash, dbHit);
      return dbHit;
    }

    const fetched = await fetchTxFacts(hash, opts);
    lruSet(hash, fetched);
    // Persist outside any transaction so Postgres connections are never pinned
    // during RPC and replicas/restarts share finalised facts.
    await txFactsDbStore.write(fetched);
    return fetched;
  })().finally(() => {
    if (inFlightFacts.get(hash) === flight) {
      inFlightFacts.delete(hash);
    }
  });

  inFlightFacts.set(hash, flight);
  return flight;
}

// ─── Phase 2: Pure Evaluation Against Caller Expectations ───────────────────

export function evaluateTransfer(
  facts: TxFacts,
  expected: ExpectedTransfer,
): VerifiedTransfer {
  if (facts.status !== 'SUCCESS') {
    throw fail('PAYMENT_FAILED', 'The payment transaction failed on-chain');
  }

  const transfers = facts.transfers.filter((t) => t.contractId === expected.token);
  if (transfers.length === 0) {
    throw fail('PAYMENT_WRONG_TOKEN', 'No transfer of the expected token in this transaction', {
      contract: expected.token,
    });
  }

  const matching = transfers.filter((t) => t.from === expected.from && t.to === expected.to);
  if (matching.length === 0) {
    if (!transfers.some((t) => t.to === expected.to)) {
      throw fail('PAYMENT_WRONG_RECIPIENT', 'The payment was sent to the wrong recipient');
    }
    throw fail('PAYMENT_WRONG_SENDER', 'The payment was not sent from your connected wallet');
  }

  const paid = matching.reduce((sum, t) => sum + t.amount, 0n);
  const refunded = transfers
    .filter((t) => t.from === expected.to && t.to === expected.from)
    .reduce((sum, t) => sum + t.amount, 0n);
  const net = paid - refunded;
  if (net < expected.minAmount) {
    throw fail('PAYMENT_INSUFFICIENT', 'Payment amount is less than the required tier price', {
      paidRaw: paid.toString(),
      refundedRaw: refunded.toString(),
      netRaw: net.toString(),
      requiredRaw: expected.minAmount.toString(),
    });
  }

  const txSourceBase = facts.txSource.base || expected.from;
  const memo = facts.memo;
  const direct = facts.direct;

  // Secondary invariant: for a simple direct `transfer` call the envelope must
  // agree with the events. The events are authoritative, so a disagreement is
  // logged (and surfaced to callers) but never rejects an events-proven
  // payment: an honest network cannot produce one, and failing here would
  // reintroduce the envelope-first behaviour #51 removes.
  let envelopeMismatch = false;
  if (direct && direct.contract === expected.token) {
    envelopeMismatch =
      direct.from !== expected.from ||
      direct.to !== expected.to ||
      direct.amount !== paid;
    if (envelopeMismatch) {
      logger.error(
        {
          txHash: expected.txHash,
          envelope: { from: direct.from, to: direct.to, amount: direct.amount.toString() },
          events: matching.map((t) => ({ from: t.from, to: t.to, amount: t.amount.toString() })),
        },
        'Payment envelope disagrees with SAC transfer events; trusting the events',
      );
    }
  }

  if (expected.memo) {
    if (memo.type !== expected.memo.type || memo.value !== expected.memo.value) {
      throw fail('PAYMENT_MEMO_MISMATCH', 'The payment memo does not match this payment intent', {
        expectedType: expected.memo.type,
        expectedValue: expected.memo.value,
        actualType: memo.type,
        actualValue: memo.value,
      });
    }
  }

  // A sub-user of a pooled account must prove which sub-identity paid.
  if (expected.subIdKind === 'MUXED' && expected.subId != null) {
    const directMuxed = direct ? parseMuxed(direct.rawFrom) : null;
    const fromProves = directMuxed != null && directMuxed.base === expected.from && directMuxed.id === expected.subId;
    const sourceProves = facts.txSource.muxed && facts.txSource.base === expected.from && facts.txSource.id === expected.subId;
    const eventProves = matching.some((t) => t.toMuxedId === expected.subId);
    if (!fromProves && !sourceProves && !eventProves) {
      throw fail('PAYMENT_SUBACCOUNT_UNPROVEN', 'The payment does not prove this muxed sub-account');
    }
  } else if (expected.subIdKind === 'MEMO' && expected.subId != null) {
    if (memo.type !== 'id' || memo.value !== expected.subId) {
      throw fail('PAYMENT_SUBACCOUNT_UNPROVEN', 'The payment does not carry the memo id for this sub-account');
    }
  }

  const toMuxedId = matching.find((t) => t.toMuxedId != null)?.toMuxedId ?? null;

  return {
    txHash: expected.txHash,
    from: expected.from,
    to: expected.to,
    amount: net,
    ledger: facts.ledger,
    txSource: txSourceBase,
    memo,
    transfers: matching,
    toMuxedId,
    createdAt: facts.createdAt,
    envelopeMismatch,
  };
}

/**
 * Deterministically orders and selects the transfer events consumed by a
 * settlement. Events are sorted by `(opIndex ?? 0, eventIndex)` so every
 * channel claims the exact same canonical subset.
 */
export function selectClaimableTransfers(
  transfer: Pick<VerifiedTransfer, 'transfers'>,
  requiredAmount?: bigint,
): SacTransfer[] {
  const sorted = [...transfer.transfers].sort(
    (a, b) => (a.opIndex ?? 0) - (b.opIndex ?? 0) || (a.eventIndex ?? 0) - (b.eventIndex ?? 0),
  );
  if (requiredAmount === undefined) return sorted;
  const selected: SacTransfer[] = [];
  let sum = 0n;
  for (const t of sorted) {
    selected.push(t);
    sum += t.amount;
    if (sum >= requiredAmount) break;
  }
  return selected;
}
