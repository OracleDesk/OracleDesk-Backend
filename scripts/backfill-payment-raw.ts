/**
 * Fills and verifies the exact base-unit amounts on payments before the Float
 * money columns are dropped (#224, phase A/B of the expand/contract rollout).
 *
 *   payment_events.amountRaw IS NULL      candidate = usdcFromNumber(amount);
 *                                         the SAC transfer read from the
 *                                         transaction meta is authoritative.
 *   subscriptions.amountPaidRaw IS NULL   copied from payment_events.amountRaw
 *                                         (joined by txHash), else from the
 *                                         event's backfill result.
 *   spending_allowances (pre-#55 rows)    dailyLimitRaw / perTraceLimitRaw
 *                                         compared with the floats; divergences
 *                                         are reported only, raw wins.
 *
 * Every payment row gets an outcome in payment_raw_backfill:
 *   VERIFIED    the chain (or the exact event amount) equals the float.
 *   FLOAT_ONLY  no exact source left (outside RPC retention, no txHash, no
 *               payment event); the float candidate is written and recorded.
 *   MISMATCH    the exact source disagrees with the float. Nothing is written;
 *               the run exits 1 until an operator resolves it.
 *   NOT_FOUND   the transaction should be retrievable but carries no matching
 *               transfer (or is missing inside retention). Nothing is written.
 *
 * Dry-run by default: nothing is written, not even the side table. --apply
 * writes raw values and outcomes. Rows are read in keyset batches by id, and a
 * MISMATCH/NOT_FOUND already recorded is reused instead of re-querying RPC
 * (pass --recheck to query again), so an interrupted run can simply be rerun.
 *
 * Usage: npm run backfill:payment-raw -- [--apply] [--recheck] [--batch-size 500] [--json out.json]
 */
import 'dotenv/config';
import fs from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { rpc, xdr } from '@stellar/stellar-sdk';
import { decimalToBigint, usdcFromNumber } from '../src/lib/amounts';
import { CONTRACTS, PAYMENTS_RECIPIENT } from '../src/config/contracts';
import { sacTransfersFromMeta } from '../src/services/stellar/sac-events';
import type { TransactionReader } from '../src/services/stellar/tx-inspect';

export type BackfillStatus = 'VERIFIED' | 'FLOAT_ONLY' | 'MISMATCH' | 'NOT_FOUND';
export type BackfillSource = 'CHAIN' | 'FLOAT' | 'PAYMENT_EVENT' | 'BACKFILL';
export type BackfillTable = 'payment_events' | 'subscriptions';

export interface BackfillRecord {
  table: BackfillTable;
  rowId: string;
  source: BackfillSource;
  floatValue: number | null;
  rawValue: bigint | null;
  chainValue: bigint | null;
  status: BackfillStatus;
  detail: string | null;
  applied: boolean;
}

export interface PaymentEventRow {
  id: string;
  txHash: string;
  amount: number;
  fromAddress: string | null;
  ledger: number | null;
}

export interface SubscriptionRow {
  id: string;
  txHash: string | null;
  amountPaid: number;
  /** The payment event with the same txHash, if any. */
  eventId: string | null;
  eventAmountRaw: string | null;
}

export interface AllowanceRow {
  id: string;
  dailyLimit: number;
  perTraceLimit: number;
  dailyLimitRaw: string;
  perTraceLimitRaw: string;
}

export type ChainLookup =
  | { kind: 'found'; amount: bigint }
  | { kind: 'not_found' }
  | { kind: 'no_transfer'; detail: string };

/** Everything the backfill touches. Tests pass in-memory fakes. */
export interface BackfillDeps {
  paymentEventsMissingRaw(afterId: string | null, limit: number): Promise<PaymentEventRow[]>;
  subscriptionsMissingRaw(afterId: string | null, limit: number): Promise<SubscriptionRow[]>;
  /** Allowances created before `before` (the #55 accounting migration). */
  legacyAllowances(afterId: string | null, limit: number, before: Date): Promise<AllowanceRow[]>;
  findRecord(table: BackfillTable, rowId: string): Promise<BackfillRecord | null>;
  saveRecord(record: BackfillRecord): Promise<void>;
  /** Conditional on the column still being NULL; returns whether it wrote. */
  writePaymentEventRaw(id: string, raw: bigint): Promise<boolean>;
  writeSubscriptionRaw(id: string, raw: bigint): Promise<boolean>;
  lookupTransfer(event: PaymentEventRow): Promise<ChainLookup>;
  /** Oldest ledger the RPC still serves, or null if unknown. */
  oldestLedger(): Promise<number | null>;
}

export interface BackfillOptions {
  apply: boolean;
  recheck?: boolean;
  batchSize?: number;
}

type Counts = Record<BackfillStatus, number>;

export interface BackfillSummary {
  apply: boolean;
  paymentEvents: Counts;
  subscriptions: Counts;
  applied: { paymentEvents: number; subscriptions: number };
  mismatches: Array<{ table: BackfillTable; rowId: string; floatValue: number | null; rawValue: string | null; chainValue: string | null }>;
  notFound: Array<{ table: BackfillTable; rowId: string; detail: string | null }>;
  /** Legacy subscriptions with no txHash: filled from the float, listed for review. */
  subscriptionsWithoutTxHash: string[];
  allowanceDivergences: Array<{ id: string; field: 'dailyLimit' | 'perTraceLimit'; floatValue: number; floatRaw: string; raw: string }>;
  exitCode: 0 | 1;
}

/** Created by 20261019120000_allowance_accounting (#55); rows before it had floats only. */
export const ALLOWANCE_ACCOUNTING_MIGRATED_AT = new Date('2026-10-19T12:00:00Z');
export const DEFAULT_BATCH_SIZE = 500;

const UNRESOLVED: BackfillStatus[] = ['MISMATCH', 'NOT_FOUND'];

function emptyCounts(): Counts {
  return { VERIFIED: 0, FLOAT_ONLY: 0, MISMATCH: 0, NOT_FOUND: 0 };
}

/** Float → candidate base units; only ever compared against an exact source. */
function candidateOf(value: number): bigint | null {
  try {
    return usdcFromNumber(value);
  } catch {
    return null;
  }
}

async function* keyset<T extends { id: string }>(
  fetch: (afterId: string | null, limit: number) => Promise<T[]>,
  batchSize: number,
): AsyncGenerator<T> {
  let afterId: string | null = null;
  for (;;) {
    const rows = await fetch(afterId, batchSize);
    if (rows.length === 0) return;
    yield* rows;
    afterId = rows[rows.length - 1].id;
    if (rows.length < batchSize) return;
  }
}

async function classifyEvent(
  deps: BackfillDeps,
  row: PaymentEventRow,
  oldest: () => Promise<number | null>,
): Promise<Omit<BackfillRecord, 'applied'>> {
  const base = { table: 'payment_events' as const, rowId: row.id, floatValue: row.amount };
  const candidate = candidateOf(row.amount);
  const lookup = await deps.lookupTransfer(row);

  if (lookup.kind === 'found') {
    const matches = candidate !== null && candidate === lookup.amount;
    return {
      ...base,
      source: 'CHAIN',
      rawValue: lookup.amount,
      chainValue: lookup.amount,
      status: matches ? 'VERIFIED' : 'MISMATCH',
      detail: matches ? null : 'on-chain transfer differs from the float amount',
    };
  }
  if (lookup.kind === 'no_transfer') {
    return { ...base, source: 'FLOAT', rawValue: candidate, chainValue: null, status: 'NOT_FOUND', detail: lookup.detail };
  }
  // Not returned by RPC: expected for rows older than its retention window.
  const oldestLedger = await oldest();
  const insideRetention = row.ledger !== null && oldestLedger !== null && row.ledger >= oldestLedger;
  if (insideRetention) {
    return {
      ...base,
      source: 'FLOAT',
      rawValue: candidate,
      chainValue: null,
      status: 'NOT_FOUND',
      detail: `transaction missing although ledger ${row.ledger} is inside RPC retention (oldest ${oldestLedger})`,
    };
  }
  return {
    ...base,
    source: 'FLOAT',
    rawValue: candidate,
    chainValue: null,
    status: candidate === null ? 'NOT_FOUND' : 'FLOAT_ONLY',
    detail: row.ledger === null ? 'outside RPC retention (ledger unknown)' : `outside RPC retention (ledger ${row.ledger})`,
  };
}

function classifySubscription(
  row: SubscriptionRow,
  eventRaw: { raw: bigint | null; source: BackfillSource; status: BackfillStatus } | null,
): Omit<BackfillRecord, 'applied'> {
  const base = { table: 'subscriptions' as const, rowId: row.id, floatValue: row.amountPaid, chainValue: null };
  const candidate = candidateOf(row.amountPaid);
  if (row.txHash === null || row.eventId === null) {
    return {
      ...base,
      source: 'FLOAT',
      rawValue: candidate,
      status: candidate === null ? 'NOT_FOUND' : 'FLOAT_ONLY',
      detail: row.txHash === null ? 'legacy row without txHash' : 'no payment event for txHash',
    };
  }
  if (!eventRaw) {
    return { ...base, source: 'FLOAT', rawValue: candidate, status: 'NOT_FOUND', detail: `payment event ${row.eventId} has no raw amount or backfill result` };
  }
  if (UNRESOLVED.includes(eventRaw.status) || eventRaw.raw === null) {
    return { ...base, source: eventRaw.source, rawValue: eventRaw.raw, status: eventRaw.status, detail: `payment event ${row.eventId} is ${eventRaw.status}` };
  }
  if (candidate !== eventRaw.raw) {
    return { ...base, source: eventRaw.source, rawValue: eventRaw.raw, status: 'MISMATCH', detail: `payment event ${row.eventId} amount differs from amountPaid` };
  }
  // VERIFIED when the event amount is exact; FLOAT_ONLY propagates.
  return { ...base, source: eventRaw.source, rawValue: eventRaw.raw, status: eventRaw.status, detail: null };
}

/**
 * Runs the backfill. Pure apart from `deps`; returns the summary and the exit
 * code the CLI should use (1 on any MISMATCH).
 */
export async function runPaymentRawBackfill(deps: BackfillDeps, options: BackfillOptions): Promise<BackfillSummary> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const summary: BackfillSummary = {
    apply: options.apply,
    paymentEvents: emptyCounts(),
    subscriptions: emptyCounts(),
    applied: { paymentEvents: 0, subscriptions: 0 },
    mismatches: [],
    notFound: [],
    subscriptionsWithoutTxHash: [],
    allowanceDivergences: [],
    exitCode: 0,
  };

  let oldestCache: Promise<number | null> | null = null;
  const oldest = () => (oldestCache ??= deps.oldestLedger());
  /** This run's event outcomes; the only source for subscriptions in dry-run. */
  const eventResults = new Map<string, BackfillRecord>();

  const record = async (rec: Omit<BackfillRecord, 'applied'>, write: (raw: bigint) => Promise<boolean>) => {
    const counts = rec.table === 'payment_events' ? summary.paymentEvents : summary.subscriptions;
    counts[rec.status]++;
    if (rec.status === 'MISMATCH') {
      summary.mismatches.push({
        table: rec.table,
        rowId: rec.rowId,
        floatValue: rec.floatValue,
        rawValue: rec.rawValue?.toString() ?? null,
        chainValue: rec.chainValue?.toString() ?? null,
      });
    } else if (rec.status === 'NOT_FOUND') {
      summary.notFound.push({ table: rec.table, rowId: rec.rowId, detail: rec.detail });
    }
    const writable = (rec.status === 'VERIFIED' || rec.status === 'FLOAT_ONLY') && rec.rawValue !== null;
    let applied = false;
    if (options.apply && writable) {
      applied = await write(rec.rawValue!);
      if (applied) summary.applied[rec.table === 'payment_events' ? 'paymentEvents' : 'subscriptions']++;
    }
    const full: BackfillRecord = { ...rec, applied };
    if (options.apply) await deps.saveRecord(full);
    return full;
  };

  for await (const row of keyset((a, l) => deps.paymentEventsMissingRaw(a, l), batchSize)) {
    const previous = options.recheck ? null : await deps.findRecord('payment_events', row.id);
    const outcome = previous && UNRESOLVED.includes(previous.status)
      ? { ...previous }
      : await classifyEvent(deps, row, oldest);
    eventResults.set(row.id, await record(outcome, (raw) => deps.writePaymentEventRaw(row.id, raw)));
  }

  for await (const row of keyset((a, l) => deps.subscriptionsMissingRaw(a, l), batchSize)) {
    if (row.txHash === null) summary.subscriptionsWithoutTxHash.push(row.id);
    // An event this backfill filled carries its outcome (FLOAT_ONLY must
    // propagate); an event written exactly at settlement, or resolved by an
    // operator after a MISMATCH/NOT_FOUND, is VERIFIED as is.
    let eventRaw: Parameters<typeof classifySubscription>[1] = null;
    const result = row.eventId === null
      ? null
      : eventResults.get(row.eventId) ?? (await deps.findRecord('payment_events', row.eventId));
    const resolvedByOperator = result !== null && UNRESOLVED.includes(result.status) && row.eventAmountRaw !== null;
    if (result && !resolvedByOperator) {
      eventRaw = { raw: result.rawValue, source: 'BACKFILL', status: result.status };
    } else if (row.eventAmountRaw !== null) {
      eventRaw = { raw: decimalToBigint(row.eventAmountRaw), source: 'PAYMENT_EVENT', status: 'VERIFIED' };
    }
    await record(classifySubscription(row, eventRaw), (raw) => deps.writeSubscriptionRaw(row.id, raw));
  }

  for await (const row of keyset((a, l) => deps.legacyAllowances(a, l, ALLOWANCE_ACCOUNTING_MIGRATED_AT), batchSize)) {
    for (const field of ['dailyLimit', 'perTraceLimit'] as const) {
      const floatValue = row[field];
      const raw = decimalToBigint(row[`${field}Raw`]);
      const floatRaw = candidateOf(floatValue);
      if (floatRaw !== raw) {
        summary.allowanceDivergences.push({ id: row.id, field, floatValue, floatRaw: floatRaw?.toString() ?? 'invalid', raw: raw.toString() });
      }
    }
  }

  summary.exitCode = summary.mismatches.length > 0 ? 1 : 0;
  return summary;
}

/**
 * Reads the authoritative amount of a recorded payment from the chain: the
 * SAC `transfer` events of the USDC contract from the event's fromAddress to
 * `recipient`, net of same-transaction refunds — the same rule as
 * verifyUsdcTransfer. RPC errors propagate so the run stops and can resume.
 */
export function chainTransferLookup(
  reader: TransactionReader,
  opts: { token: string; recipient: string } = { token: CONTRACTS.usdc, recipient: PAYMENTS_RECIPIENT },
): (event: PaymentEventRow) => Promise<ChainLookup> {
  return async (event) => {
    const response = await reader.getTransaction(event.txHash);
    if (response.status === rpc.Api.GetTransactionStatus.NOT_FOUND) return { kind: 'not_found' };
    if (response.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      return { kind: 'no_transfer', detail: 'transaction failed on-chain' };
    }
    const anyResponse = response as any;
    const transfers = sacTransfersFromMeta({
      resultMetaXdr: anyResponse.resultMetaXdr as xdr.TransactionMeta | string | undefined,
      contractEventsXdr: anyResponse.events?.contractEventsXdr as xdr.ContractEvent[][] | undefined,
    }).filter((t) => t.contractId === opts.token);
    const from = event.fromAddress;
    const paid = transfers
      .filter((t) => t.to === opts.recipient && (from === null || t.from === from))
      .reduce((sum, t) => sum + t.amount, 0n);
    if (paid === 0n) {
      return { kind: 'no_transfer', detail: `no USDC transfer from ${from ?? 'any sender'} to the payments recipient` };
    }
    const refunded = transfers
      .filter((t) => t.from === opts.recipient && (from === null || t.to === from))
      .reduce((sum, t) => sum + t.amount, 0n);
    return { kind: 'found', amount: paid - refunded };
  };
}

/** Production deps: Prisma for the database, Stellar RPC for the chain. */
export function prismaBackfillDeps(
  prisma: PrismaClient,
  chain: { reader: TransactionReader; getHealth(): Promise<{ oldestLedger?: number }> },
): BackfillDeps {
  const fromRecord = (r: any): BackfillRecord => ({
    table: r.table,
    rowId: r.rowId,
    source: r.source,
    floatValue: r.floatValue,
    rawValue: r.rawValue == null ? null : decimalToBigint(r.rawValue),
    chainValue: r.chainValue == null ? null : decimalToBigint(r.chainValue),
    status: r.status,
    detail: r.detail,
    applied: r.applied,
  });
  return {
    paymentEventsMissingRaw: (afterId, limit) =>
      prisma.paymentEvent.findMany({
        where: { amountRaw: null, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: 'asc' },
        take: limit,
        select: { id: true, txHash: true, amount: true, fromAddress: true, ledger: true },
      }),
    subscriptionsMissingRaw: (afterId, limit) =>
      prisma.$queryRaw<SubscriptionRow[]>`
        SELECT s."id", s."txHash", s."amountPaid", e."id" AS "eventId", e."amountRaw" AS "eventAmountRaw"
        FROM "subscriptions" s
        LEFT JOIN "payment_events" e ON e."txHash" = s."txHash"
        WHERE s."amountPaidRaw" IS NULL AND (${afterId}::text IS NULL OR s."id" > ${afterId})
        ORDER BY s."id"
        LIMIT ${limit}`,
    legacyAllowances: async (afterId, limit, before) => {
      const rows = await prisma.spendingAllowance.findMany({
        where: { createdAt: { lt: before }, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: 'asc' },
        take: limit,
        select: { id: true, dailyLimit: true, perTraceLimit: true, dailyLimitRaw: true, perTraceLimitRaw: true },
      });
      return rows.map((r) => ({ ...r, dailyLimitRaw: r.dailyLimitRaw.toFixed(), perTraceLimitRaw: r.perTraceLimitRaw.toFixed() }));
    },
    findRecord: async (table, rowId) => {
      const row = await prisma.paymentRawBackfill.findUnique({ where: { table_rowId: { table, rowId } } });
      return row ? fromRecord(row) : null;
    },
    saveRecord: async (rec) => {
      const data = {
        source: rec.source,
        floatValue: rec.floatValue,
        rawValue: rec.rawValue?.toString() ?? null,
        chainValue: rec.chainValue?.toString() ?? null,
        status: rec.status,
        detail: rec.detail,
        applied: rec.applied,
        checkedAt: new Date(),
      };
      await prisma.paymentRawBackfill.upsert({
        where: { table_rowId: { table: rec.table, rowId: rec.rowId } },
        create: { table: rec.table, rowId: rec.rowId, ...data },
        update: data,
      });
    },
    writePaymentEventRaw: async (id, raw) =>
      (await prisma.paymentEvent.updateMany({ where: { id, amountRaw: null }, data: { amountRaw: raw.toString() } })).count === 1,
    writeSubscriptionRaw: async (id, raw) =>
      (await prisma.subscription.updateMany({ where: { id, amountPaidRaw: null }, data: { amountPaidRaw: raw.toString() } })).count === 1,
    lookupTransfer: chainTransferLookup(chain.reader),
    oldestLedger: async () => (await chain.getHealth()).oldestLedger ?? null,
  };
}

export function formatSummary(summary: BackfillSummary): string {
  const counts = (c: Counts) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ');
  const lines = [
    `Payment raw backfill (${summary.apply ? 'apply' : 'dry-run; pass --apply to write'})`,
    `  payment_events: ${counts(summary.paymentEvents)} (written ${summary.applied.paymentEvents})`,
    `  subscriptions:  ${counts(summary.subscriptions)} (written ${summary.applied.subscriptions})`,
    `  subscriptions without txHash (filled from float): ${summary.subscriptionsWithoutTxHash.length}`,
    `  allowance float/raw divergences (raw kept): ${summary.allowanceDivergences.length}`,
  ];
  for (const m of summary.mismatches) {
    lines.push(`  MISMATCH ${m.table}/${m.rowId}: float=${m.floatValue} raw=${m.rawValue} chain=${m.chainValue}`);
  }
  for (const n of summary.notFound) lines.push(`  NOT_FOUND ${n.table}/${n.rowId}: ${n.detail ?? ''}`);
  for (const d of summary.allowanceDivergences) {
    lines.push(`  allowance ${d.id}.${d.field}: float=${d.floatValue} (${d.floatRaw}) raw=${d.raw}`);
  }
  return lines.join('\n');
}

function parseArgs(argv: string[]): BackfillOptions & { json?: string } {
  const args: BackfillOptions & { json?: string } = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--recheck') args.recheck = true;
    else if (arg === '--batch-size') args.batchSize = Number(argv[++i]);
    else if (arg === '--json') args.json = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.batchSize !== undefined && !(Number.isInteger(args.batchSize) && args.batchSize > 0)) {
    throw new Error('--batch-size must be a positive integer');
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { prisma } = await import('../src/lib/prisma');
  const { rpcServer } = await import('../src/services/stellar/clients');
  try {
    const summary = await runPaymentRawBackfill(
      prismaBackfillDeps(prisma, { reader: rpcServer, getHealth: () => rpcServer.getHealth() }),
      args,
    );
    console.log(formatSummary(summary));
    if (args.json) fs.writeFileSync(args.json, JSON.stringify(summary, null, 2));
    process.exitCode = summary.exitCode;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Payment raw backfill failed:', err);
    process.exitCode = 1;
  });
}
