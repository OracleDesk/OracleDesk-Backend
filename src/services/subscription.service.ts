import {
  PaymentEventStatus,
  PaymentEventType,
  Prisma,
  SettlementCurrency,
  SubscriptionStatus,
  SubscriptionType,
} from '@prisma/client';
import type { VerifiedTransfer } from './payment-verification.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { CONTRACTS, PAYMENTS_RECIPIENT } from '../config/contracts';
import { decimalToBigint, formatUsdc, toDisplayUsdc } from '../lib/amounts';
import { selectClaimableTransfers, verifyUsdcTransfer } from './payment-verification.service';
import { claimTransferEvents } from './payment-claims.service';
import { issueReceiptInTx } from './receipt.service';
import { AppError } from '../middlewares/error.middleware';
import type { SubscriptionAccess } from '../types';
import { summarizeProvenance } from '../lib/llm/provenance';
import { withAdvisoryLocksWait } from '../lib/advisory-lock';
import { DAY_MS, chargeDayFor, ledgerCloseDate, ledgerDay, utcDayKey, utcDayStart } from '../lib/time';
import { notifyUser } from '../lib/socket-auth';
import { discoverTracePrice } from './x402-discovery.service';
import { formatTraceVerdict } from './trace-audit.service';

/** Daily pass price in 7-decimal USDC base units (DAILY_PASS_PRICE_RAW). */
export const DAILY_PASS_PRICE_RAW = BigInt(config.DAILY_PASS_PRICE_RAW);

/**
 * The Float display mirrors (#224 phase B). Returns `fields` only while
 * PAYMENT_FLOAT_WRITES is on; otherwise the columns' DB default of 0 applies.
 * No reader uses the floats, so a 0 written by a newer instance is harmless
 * to an older one.
 */
export function floatMirror<T extends Record<string, number>>(fields: T): Partial<T> {
  return config.PAYMENT_FLOAT_WRITES ? fields : {};
}

type RawLike = { toFixed(): string } | string | bigint;

function rawString(value: RawLike | null | undefined): string | null {
  return value == null ? null : decimalToBigint(value).toString();
}

function displayOf(value: RawLike | null | undefined): string | null {
  return value == null ? null : formatUsdc(decimalToBigint(value));
}

export interface SubscriptionDto {
  id: string;
  userId: string;
  traceId: string | null;
  type: SubscriptionType;
  status: SubscriptionStatus;
  /** Base units; null only for a legacy row the backfill has not reached. */
  amountPaidRaw: string | null;
  amountDisplay: string | null;
  currency: SettlementCurrency;
  txHash: string | null;
  purchaseLedger: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  expiresAt: Date | null;
  paymentIntentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * API shape of a subscription (#224). Fields are listed explicitly so the
 * Float amountPaid (and any future column) never reaches a client.
 */
export function toSubscriptionDto(sub: any): SubscriptionDto {
  return {
    id: sub.id,
    userId: sub.userId,
    traceId: sub.traceId ?? null,
    type: sub.type,
    status: sub.status,
    amountPaidRaw: rawString(sub.amountPaidRaw),
    amountDisplay: displayOf(sub.amountPaidRaw),
    currency: sub.currency,
    txHash: sub.txHash ?? null,
    purchaseLedger: sub.purchaseLedger ?? null,
    startsAt: sub.startsAt ?? null,
    endsAt: sub.endsAt ?? null,
    expiresAt: sub.expiresAt ?? null,
    paymentIntentId: sub.paymentIntentId ?? null,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  };
}

export interface PaymentEventDto {
  id: string;
  userId: string;
  txHash: string;
  type: PaymentEventType;
  /** Base units; null only for a legacy row the backfill has not reached. */
  amountRaw: string | null;
  amountDisplay: string | null;
  fromAddress: string | null;
  currency: SettlementCurrency;
  status: PaymentEventStatus;
  traceId: string | null;
  ledger: number | null;
  ledgerCloseTime: Date | null;
  allowanceOverage: boolean;
  allowanceOverageRaw: string | null;
  paymentIntentId: string | null;
  metadata: unknown;
  createdAt: Date;
  confirmedAt: Date | null;
}

/** API shape of a payment event (#224): raw amount and its display string only. */
export function toPaymentEventDto(event: any): PaymentEventDto {
  return {
    id: event.id,
    userId: event.userId,
    txHash: event.txHash,
    type: event.type,
    amountRaw: rawString(event.amountRaw),
    amountDisplay: displayOf(event.amountRaw),
    fromAddress: event.fromAddress ?? null,
    currency: event.currency,
    status: event.status,
    traceId: event.traceId ?? null,
    ledger: event.ledger ?? null,
    ledgerCloseTime: event.ledgerCloseTime ?? null,
    allowanceOverage: Boolean(event.allowanceOverage),
    allowanceOverageRaw: rawString(event.allowanceOverageRaw),
    paymentIntentId: event.paymentIntentId ?? null,
    metadata: event.metadata ?? null,
    createdAt: event.createdAt,
    confirmedAt: event.confirmedAt ?? null,
  };
}

export interface AllowanceDto {
  id: string;
  userId: string;
  dailyLimitRaw: string;
  perTraceLimitRaw: string;
  spentTodayRaw: string;
  overageRaw: string;
  dailyLimitDisplay: string;
  perTraceLimitDisplay: string;
  spentTodayDisplay: string;
  overageDisplay: string;
  windowStartedAt: Date;
  currency: SettlementCurrency;
  lastResetAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** API shape of a spending allowance (#224): raw counters plus display strings. */
export function toAllowanceDto(allowance: any): AllowanceDto {
  return {
    id: allowance.id,
    userId: allowance.userId,
    dailyLimitRaw: rawString(allowance.dailyLimitRaw)!,
    perTraceLimitRaw: rawString(allowance.perTraceLimitRaw)!,
    spentTodayRaw: rawString(allowance.spentTodayRaw)!,
    overageRaw: rawString(allowance.overageRaw)!,
    dailyLimitDisplay: displayOf(allowance.dailyLimitRaw)!,
    perTraceLimitDisplay: displayOf(allowance.perTraceLimitRaw)!,
    spentTodayDisplay: displayOf(allowance.spentTodayRaw)!,
    overageDisplay: displayOf(allowance.overageRaw)!,
    windowStartedAt: allowance.windowStartedAt,
    currency: allowance.currency,
    lastResetAt: allowance.lastResetAt,
    isActive: allowance.isActive,
    createdAt: allowance.createdAt,
    updatedAt: allowance.updatedAt,
  };
}

/**
 * Checks whether a user has access to a specific reasoning trace.
 *
 * Access tiers:
 * 1. FREE_PREVIEW: Always granted — returns previewSources (first 2 sources)
 * 2. DAILY_PASS: User has an active daily pass → full access
 * 3. PER_TRACE: User paid for this specific trace → full access
 * 4. NO_ACCESS: Must pay
 */
export async function checkAccess(
  userId: string,
  traceId: string,
): Promise<SubscriptionAccess> {
  // Check for active daily pass (covers all traces). New rows use the
  // ledger-anchored [startsAt, endsAt) window (#54); legacy rows fall back to
  // expiresAt after the backfill.
  const now = new Date();
  const dailyPass = await prisma.subscription.findFirst({
    where: {
      userId,
      type:   SubscriptionType.DAILY_PASS,
      status: SubscriptionStatus.ACTIVE,
      AND: [
        { OR: [{ startsAt: { lte: now } }, { startsAt: null }] },
        {
          OR: [
            { endsAt: { gt: now } },
            { endsAt: null, expiresAt: { gt: now } },
          ],
        },
      ],
    },
    orderBy: [{ endsAt: 'desc' }],
  });

  if (dailyPass) {
    return {
      hasAccess: true,
      accessType: 'DAILY_PASS',
      expiresAt: dailyPass.endsAt ?? dailyPass.expiresAt ?? undefined,
    };
  }

  // Check for a per-trace subscription for this trace
  const perTrace = await prisma.subscription.findFirst({
    where: {
      userId,
      traceId,
      type:   SubscriptionType.PER_TRACE,
      status: SubscriptionStatus.ACTIVE,
    },
  });

  if (perTrace) {
    return { hasAccess: true, accessType: 'PER_TRACE' };
  }

  return { hasAccess: false, accessType: 'NO_ACCESS' };
}

/**
 * Records a daily-pass payment and grants access.
 *
 * The transaction must be a successful USDC `transfer` from the user's own
 * wallet to PAYMENTS_RECIPIENT for at least the price, verified on-chain
 * (payment-verification.service.ts). Each transaction hash is used once.
 * Per-trace unlocks go through the x402 service instead.
 */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'P2002';
}

/** How long a request waits for the current claimant of a txHash. */
const CLAIM_WAIT_MS = 30_000;
/** Interactive-transaction budget: DB-only settlement after unlocked verification (#305). */
export const CLAIM_LOCKED_TIMEOUT_MS = 10_000;

/** The advisory-lock key that serializes claims for one transaction hash. */
export function paymentClaimLockKey(txHash: string): string {
  return `payment:claim:${txHash.toLowerCase()}`;
}

/** One lock per user orders allowance and pass-stacking writes (#53/#54). */
export function userPaymentLockKey(userId: string): string {
  return `payment:user:${userId}`;
}

/**
 * Resolves a hash that is already recorded: its owner gets the subscription it
 * bought (idempotent success), anyone else gets 409. Never reveals whose hash
 * it is beyond the comparison with the caller's user id.
 */
async function existingClaimResult(
  db: Prisma.TransactionClient | typeof prisma,
  txHash: string,
  userId: string,
): Promise<any> {
  const existing = await db.paymentEvent.findUnique({ where: { txHash } });
  if (!existing) return null;
  if (existing.userId === userId) {
    const sub = await db.subscription.findFirst({ where: { txHash } });
    if (sub) return sub;
  }
  throw new AppError(409, 'PAYMENT_ALREADY_USED', 'This payment has already been used');
}

export interface ClaimResult {
  subscription: any;
  transfer: { amount: bigint; ledger: number; from: string } | null;
  replay: boolean;
}

export interface Preauthorization {
  active: boolean;
  allowed: boolean;
  reason: 'ALLOWANCE_PER_TRACE_LIMIT' | 'ALLOWANCE_DAILY_LIMIT' | null;
  /**
   * The UTC day checked (today). A transfer is charged to the UTC day its
   * ledger closes, which can be the next day for a payment signed just
   * before midnight (#219).
   */
  dayStart: string;
  dailyLimitRaw: string | null;
  perTraceLimitRaw: string | null;
  spentTodayRaw: string;
  /** Budget held by open x402 reservations today. */
  reservedRaw: string;
  remainingRaw: string | null;
  overageRaw: string;
  wouldOverflowRaw: string;
}

/** Where an allowance charge came from (#219). */
export type AllowanceSource = 'PASS_CLAIM' | 'PAYMENT_INTENT' | 'X402';

export interface AllowanceBucket {
  spentRaw: bigint;
  reservedRaw: bigint;
  overageRaw: bigint;
}

type AllowanceDb = Prisma.TransactionClient | typeof prisma;

/** Reads the (userId, day) bucket without locking; zeros when absent. */
async function readAllowanceDay(db: AllowanceDb, userId: string, day: Date): Promise<AllowanceBucket> {
  const row = await db.allowanceDay.findUnique({ where: { userId_day: { userId, day } } });
  return {
    spentRaw: row ? decimalToBigint(row.spentRaw) : 0n,
    reservedRaw: row ? decimalToBigint(row.reservedRaw) : 0n,
    overageRaw: row ? decimalToBigint(row.overageRaw) : 0n,
  };
}

/**
 * Creates the (userId, day) bucket if needed and takes its row lock for the
 * rest of the transaction (#219). This lock, not the per-user advisory lock,
 * is what serialises pass claims with the x402 endpoints. Lock order
 * everywhere: allowance_charges row, buckets by ascending day, then
 * spending_allowances.
 */
export async function lockAllowanceDay(
  tx: Prisma.TransactionClient,
  userId: string,
  day: Date,
): Promise<AllowanceBucket> {
  const key = utcDayKey(day);
  await tx.$executeRaw`
    INSERT INTO "allowance_days" ("userId", "day", "updatedAt")
    VALUES (${userId}, ${key}::date, CURRENT_TIMESTAMP)
    ON CONFLICT ("userId", "day") DO NOTHING`;
  const rows = await tx.$queryRaw<Array<{ spentRaw: Prisma.Decimal; reservedRaw: Prisma.Decimal; overageRaw: Prisma.Decimal }>>`
    SELECT "spentRaw", "reservedRaw", "overageRaw"
    FROM "allowance_days"
    WHERE "userId" = ${userId} AND "day" = ${key}::date
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new Error(`allowance_days row for ${userId}/${key} vanished under lock`);
  return {
    spentRaw: decimalToBigint(row.spentRaw),
    reservedRaw: decimalToBigint(row.reservedRaw),
    overageRaw: decimalToBigint(row.overageRaw),
  };
}

/** Writes a locked bucket back. Callers must hold its row lock. */
export async function writeAllowanceDay(
  tx: Prisma.TransactionClient,
  userId: string,
  day: Date,
  bucket: AllowanceBucket,
): Promise<void> {
  await tx.allowanceDay.update({
    where: { userId_day: { userId, day: utcDayStart(day) } },
    data: {
      spentRaw: bucket.spentRaw.toString(),
      reservedRaw: bucket.reservedRaw.toString(),
      overageRaw: bucket.overageRaw.toString(),
    },
  });
}

/** Remaining daily budget once spend and open reservations are counted. */
export function remainingFor(dailyLimit: bigint, bucket: AllowanceBucket): bigint {
  const used = bucket.spentRaw + bucket.reservedRaw;
  return dailyLimit > used ? dailyLimit - used : 0n;
}

/** Allowance check against today's bucket. Never writes or reserves budget (#53, #219). */
export async function preauthorizeSpending(
  userId: string,
  type: 'PER_TRACE' | 'DAILY_PASS',
  amountRaw: bigint,
  now = new Date(),
): Promise<Preauthorization> {
  const dayStart = utcDayStart(now);
  const allowance = await prisma.spendingAllowance.findUnique({ where: { userId } });
  if (!allowance?.isActive) {
    return {
      active: false,
      allowed: true,
      reason: null,
      dayStart: dayStart.toISOString(),
      dailyLimitRaw: null,
      perTraceLimitRaw: null,
      spentTodayRaw: '0',
      reservedRaw: '0',
      remainingRaw: null,
      overageRaw: '0',
      wouldOverflowRaw: '0',
    };
  }
  const bucket = await readAllowanceDay(prisma, userId, dayStart);
  const dailyLimit = decimalToBigint(allowance.dailyLimitRaw);
  const perTraceLimit = decimalToBigint(allowance.perTraceLimitRaw);
  const remaining = remainingFor(dailyLimit, bucket);
  const perTraceExceeded = type === 'PER_TRACE' && perTraceLimit > 0n && amountRaw > perTraceLimit;
  const dailyExceeded = dailyLimit > 0n && amountRaw > remaining;
  const reason = perTraceExceeded
    ? 'ALLOWANCE_PER_TRACE_LIMIT'
    : dailyExceeded
      ? 'ALLOWANCE_DAILY_LIMIT'
      : null;
  return {
    active: true,
    allowed: reason === null,
    reason,
    dayStart: dayStart.toISOString(),
    dailyLimitRaw: dailyLimit.toString(),
    perTraceLimitRaw: perTraceLimit.toString(),
    spentTodayRaw: bucket.spentRaw.toString(),
    reservedRaw: bucket.reservedRaw.toString(),
    remainingRaw: remaining.toString(),
    overageRaw: decimalToBigint(allowance.overageRaw).toString(),
    wouldOverflowRaw: (dailyLimit > 0n && amountRaw > remaining ? amountRaw - remaining : 0n).toString(),
  };
}

export interface ChargeParams {
  userId: string;
  type: 'PER_TRACE' | 'DAILY_PASS';
  amountRaw: bigint;
  /** Ledger-close UTC day of the transfer (ledgerDay / chargeDayFor). */
  day: Date;
  source: AllowanceSource;
  txHash?: string | null;
  traceId?: string | null;
  /** The day came from the wall clock because the close time was unknown. */
  dayInferred?: boolean;
  /** Convert this existing row (an x402 reservation) instead of inserting one. */
  chargeId?: string | null;
  now?: Date;
}

export interface ChargeResult {
  chargeId: string;
  day: Date;
  overageRaw: bigint;
  perTraceExceeded: boolean;
  /** The txHash was already charged; the stored result is returned. */
  replay: boolean;
}

/**
 * Books a settled transfer against the bucket for its ledger-close day
 * (#219). Over-limit amounts are accepted (the chain already moved the money)
 * and flagged as overage on that day and in the lifetime counter, never
 * rejected (#53). Idempotent per txHash: a second charge for the same hash
 * returns the stored result without touching any counter. Runs inside the
 * caller's transaction.
 */
export async function chargeAllowance(tx: Prisma.TransactionClient, params: ChargeParams): Promise<ChargeResult> {
  const { userId, type, amountRaw, source } = params;
  const now = params.now ?? new Date();
  const day = ledgerDay(params.day);
  const txHash = params.txHash ? params.txHash.toLowerCase() : null;

  const bucket = await lockAllowanceDay(tx, userId, day);

  // Same user + hash always lands on the same bucket, so this read is
  // serialised by the lock above. A different user's claim of the hash fails
  // on the unique index and aborts that transaction instead.
  if (txHash) {
    const existing = await tx.allowanceCharge.findUnique({ where: { txHash } });
    if (existing && existing.status === 'COMMITTED') {
      return {
        chargeId: existing.id,
        day: existing.day,
        overageRaw: decimalToBigint(existing.overageRaw),
        perTraceExceeded: existing.perTraceExceeded,
        replay: true,
      };
    }
  }

  const allowance = await tx.spendingAllowance.findUnique({ where: { userId } });
  const active = Boolean(allowance?.isActive);
  const dailyLimit = active && allowance ? decimalToBigint(allowance.dailyLimitRaw) : 0n;
  const perTraceLimit = active && allowance ? decimalToBigint(allowance.perTraceLimitRaw) : 0n;

  let booked = amountRaw;
  let excess = 0n;
  if (dailyLimit > 0n) {
    const remaining = remainingFor(dailyLimit, bucket);
    booked = amountRaw < remaining ? amountRaw : remaining;
    excess = amountRaw - booked;
  }
  const perTraceExceeded = type === 'PER_TRACE' && perTraceLimit > 0n && amountRaw > perTraceLimit;

  const data = {
    day,
    source,
    status: 'COMMITTED',
    txHash,
    traceId: params.traceId ?? null,
    amountRaw: amountRaw.toString(),
    overageRaw: excess.toString(),
    perTraceExceeded,
    dayInferred: params.dayInferred ?? false,
    expiresAt: null,
  };
  const charge = params.chargeId
    ? await tx.allowanceCharge.update({ where: { id: params.chargeId }, data })
    : await tx.allowanceCharge.create({ data: { userId, ...data } });

  const spent = bucket.spentRaw + booked;
  await writeAllowanceDay(tx, userId, day, {
    spentRaw: spent,
    reservedRaw: bucket.reservedRaw,
    overageRaw: bucket.overageRaw + excess,
  });

  if (allowance) {
    // Deprecated single-day mirror: only a charge for the current UTC day may
    // move it, so a late claim for yesterday never resets today's counter.
    const today = utcDayStart(now);
    const isToday = day.getTime() === today.getTime();
    if (excess > 0n || isToday) {
      await tx.spendingAllowance.update({
        where: { userId },
        data: {
          ...(excess > 0n ? { overageRaw: { increment: excess.toString() } } : {}),
          ...(isToday
            ? {
                spentTodayRaw: spent.toString(),
                spentToday: toDisplayUsdc(spent),
                windowStartedAt: today,
                ...(allowance.windowStartedAt < today ? { lastResetAt: now } : {}),
              }
            : {}),
        },
      });
    }
  }

  return { chargeId: charge.id, day, overageRaw: excess, perTraceExceeded, replay: false };
}

export interface SettlementResult {
  subscription: any;
  paymentEventId: string;
  overageRaw: bigint;
  perTraceExceeded: boolean;
  ledgerCloseAt: Date;
  granted: boolean;
}

/**
 * Creates the subscription and payment event for an already verified transfer.
 * Callers must hold the payment and user advisory locks and have checked that
 * the txHash is unused.
 */
export async function settleVerifiedTransfer(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    traceId?: string | null;
    type: 'PER_TRACE' | 'DAILY_PASS';
    transfer: VerifiedTransfer;
    paymentIntentId?: string | null;
    now?: Date;
  },
): Promise<SettlementResult> {
  const { userId, traceId, type, transfer, paymentIntentId } = params;
  const txHash = transfer.txHash.toLowerCase();
  const now = params.now ?? new Date();
  const ledgerCloseAt = ledgerCloseDate(transfer.createdAt) ?? now;

  let startsAt = ledgerCloseAt;
  if (type === 'DAILY_PASS') {
    const latest = await tx.subscription.findFirst({
      where: {
        userId,
        type: SubscriptionType.DAILY_PASS,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING_PAYMENT] },
        OR: [
          { endsAt: { gt: ledgerCloseAt } },
          { endsAt: null, expiresAt: { gt: ledgerCloseAt } },
        ],
      },
      orderBy: [{ endsAt: 'desc' }],
    });
    const latestEnd = latest?.endsAt ?? latest?.expiresAt ?? null;
    if (latestEnd && latestEnd > ledgerCloseAt) startsAt = latestEnd;
  }
  const endsAt = new Date(startsAt.getTime() + DAY_MS);
  const granted = endsAt > now;
  const amountRaw = transfer.amount;
  const amount = toDisplayUsdc(amountRaw);
  // Charge the ledger-close day, not the claim day (#219): a transfer that
  // closed at 23:59:50 and is claimed after midnight belongs to yesterday.
  const charge = chargeDayFor(transfer, now);
  const allowance = await chargeAllowance(tx, {
    userId,
    type,
    amountRaw,
    day: charge.day,
    source: paymentIntentId ? 'PAYMENT_INTENT' : 'PASS_CLAIM',
    txHash,
    traceId: traceId ?? null,
    dayInferred: charge.inferred,
    now,
  });

  const created = await tx.subscription.create({
    data: {
      userId,
      traceId: traceId ?? null,
      type: type as SubscriptionType,
      status: granted ? SubscriptionStatus.ACTIVE : SubscriptionStatus.EXPIRED,
      ...floatMirror({ amountPaid: toDisplayUsdc(amountRaw) }),
      amountPaidRaw: amountRaw.toString(),
      currency: SettlementCurrency.USDC,
      txHash,
      purchaseLedger: transfer.ledger,
      startsAt,
      endsAt,
      expiresAt: endsAt,
      paymentIntentId: paymentIntentId ?? null,
    },
  });

  const paymentEvent = await tx.paymentEvent.create({
    data: {
      userId,
      traceId: traceId ?? null,
      txHash,
      type: type as PaymentEventType,
      ...floatMirror({ amount: toDisplayUsdc(amountRaw) }),
      amountRaw: amountRaw.toString(),
      fromAddress: transfer.from,
      currency: SettlementCurrency.USDC,
      status: PaymentEventStatus.CONFIRMED,
      ledger: transfer.ledger,
      ledgerCloseTime: ledgerCloseAt,
      allowanceOverage: allowance.overageRaw > 0n,
      allowanceOverageRaw: allowance.overageRaw.toString(),
      paymentIntentId: paymentIntentId ?? null,
      confirmedAt: now,
      metadata: {
        subscriptionId: created.id,
        ledger: transfer.ledger,
        ledgerCloseTime: ledgerCloseAt.toISOString(),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        granted,
        allowanceOverageRaw: allowance.overageRaw.toString(),
        perTraceExceeded: allowance.perTraceExceeded,
        allowanceDay: utcDayKey(allowance.day),
        allowanceDayInferred: charge.inferred,
      } as any,
    },
  });

  if ((tx as any).paymentClaim?.create) {
    const claimedEvents = selectClaimableTransfers(transfer);
    await claimTransferEvents(tx, {
      txHash,
      channel: paymentIntentId ? 'PAYMENT_INTENT' : 'LEGACY_UNLOCK',
      userId,
      paymentEventId: paymentEvent.id,
      totalAmountRaw: amountRaw,
      transfers: claimedEvents,
    });
  }

  let receiptId: string | undefined;
  if ((tx as any).receipt?.create) {
    const issued = await issueReceiptInTx(tx, {
      userId,
      subscriptionId: created.id,
      paymentEventId: paymentEvent.id,
      type,
      traceId: traceId ?? null,
      transfer,
      startsAt,
      endsAt,
      ledgerCloseAt,
      issuedAt: now,
    });
    receiptId = issued.receiptId;
  }

  return {
    subscription: created,
    paymentEventId: paymentEvent.id,
    overageRaw: allowance.overageRaw,
    perTraceExceeded: allowance.perTraceExceeded,
    ledgerCloseAt,
    granted,
    ...(receiptId ? { receiptId } : {}),
  };
}

export async function recordPayment(params: {
  userId:        string;
  walletAddress: string;
  traceId?:      string;
  type:          'PER_TRACE' | 'DAILY_PASS';
  txHash:        string;
  /** Sub-identity of a pooled account (#46); proven against the payment. */
  subId?:        string | null;
  subIdKind?:    'MUXED' | 'MEMO' | null;
}): Promise<any> {
  const { userId, walletAddress, traceId, type, subId, subIdKind } = params;
  const txHash = params.txHash.toLowerCase();

  if (type !== 'DAILY_PASS') {
    throw new AppError(400, 'USE_X402', 'Per-trace unlocks are paid through the x402 trace service, not this endpoint');
  }

  // Idempotency: a hash is consumed once. Re-submitting your own hash returns
  // the subscription it already bought; anyone else's hash is rejected. This
  // read is only an optimization: the authoritative check happens under the
  // per-hash lock below, after any in-flight claimant has finished.
  const early = await existingClaimResult(prisma, txHash, userId);
  if (early) return early;

  // Phase A (unlocked, #305): fetch immutable chain facts and evaluate against
  // caller expectations before opening any database transaction or taking
  // advisory locks, so RPC slowness can never pin Postgres pool connections.
  const facts = await getTxFacts(txHash);
  const transfer = evaluateTransfer(facts, {
    txHash,
    token:     CONTRACTS.usdc,
    from:      walletAddress,
    to:        PAYMENTS_RECIPIENT,
    minAmount: DAILY_PASS_PRICE_RAW,
    subId,
    subIdKind,
  });

  // Phase B (locked, DB-only): #59 serialises every claim for this hash, and
  // #53/#54 serialise per user so allowance and stacking writes cannot interleave.
  let claim: { acquired: true; value: ClaimResult } | { acquired: false };
  try {
    claim = await withAdvisoryLocksWait<ClaimResult>(
      [paymentClaimLockKey(txHash), userPaymentLockKey(userId)],
      async (tx) => {
        // A racer that waited may now see the committed winner.
        const existing = await existingClaimResult(tx, txHash, userId);
        if (existing) return { subscription: existing, transfer: null, replay: true };

        const settlement = await settleVerifiedTransfer(tx, {
          userId,
          traceId: traceId ?? null,
          type,
          transfer,
        });

        return { subscription: settlement.subscription, transfer, replay: false };
      },
      { waitMs: CLAIM_WAIT_MS, timeoutMs: CLAIM_LOCKED_TIMEOUT_MS },
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await existingClaimResult(prisma, txHash, userId);
      if (winner) return winner;
      throw new AppError(409, 'PAYMENT_ALREADY_USED', 'This payment has already been used');
    }
    throw err;
  }

  if (!claim.acquired) {
    // The holder did not finish in time. Re-read once: it may have committed
    // just after the deadline. Never fall through to a second verification.
    const late = await existingClaimResult(prisma, txHash, userId);
    if (late) return late;
    throw new AppError(409, 'PAYMENT_CLAIM_IN_PROGRESS', 'This payment is being processed; retry shortly');
  }

  const { subscription, transfer, replay } = claim.value;
  if (replay || !transfer) return subscription;

  logger.info(
    {
      subscriptionId: subscription.id,
      type,
      userId,
      amountRaw: transfer.amount.toString(),
      startsAt: subscription.startsAt,
      endsAt: subscription.endsAt,
    },
    'Subscription created',
  );
  // Only after the transaction committed: a rolled-back payment must not be announced.
  // The idempotent re-submit paths above return earlier and never reach this.
  notifyUser(userId, 'PAYMENT_CONFIRMED', {
    subscriptionId: subscription.id,
    type,
    txHash,
    amountRaw: transfer.amount.toString(),
    expiresAt: subscription.endsAt ?? subscription.expiresAt,
  });
  return subscription;
}

/**
 * Retrieves a trace, applying the correct access tier.
 *
 * - Free preview: returns previewSources only (first 2 sources)
 * - Full access: returns complete trace including all sourcesUsed
 */
export async function getTracWithAccessControl(
  traceId: string,
  userId?: string,
  entitlementAccess = false,
): Promise<any> {
  const trace = await prisma.reasoningTrace.findUnique({
    where: { id: traceId },
    include: { market: { select: { question: true, category: true, settlementCurrency: true, onChainMarketId: true } } },
  });

  if (!trace) throw new AppError(404, 'TRACE_NOT_FOUND', 'Reasoning trace not found');

  // Determine access level
  let access: SubscriptionAccess = { hasAccess: false, accessType: 'FREE_PREVIEW' };
  if (entitlementAccess) {
    access = { hasAccess: true, accessType: 'DAILY_PASS' };
  } else if (userId) {
    const fullAccess = await checkAccess(userId, traceId);
    access = fullAccess;
  }

  const audit = trace.lastAuditStatus
    ? { status: trace.lastAuditStatus, checkedAt: trace.lastAuditedAt }
    : null;
  const verdict = formatTraceVerdict(trace as any);

  if (access.hasAccess) {
    return { ...trace, audit, verdict, accessLevel: access.accessType };
  }

  // Discover live x402 trace price (#63)
  const discovered = await discoverTracePrice(trace.onChainTraceId ?? trace.id);
  const isDiscovered = discovered.status === 'discovered';

  // Return free preview — strip full sources
  return {
    id:                  trace.id,
    marketId:            trace.marketId,
    market:              trace.market,
    agentType:           trace.agentType,
    decisionType:        trace.decisionType,
    probabilityEstimate: trace.probabilityEstimate,
    marketProbability:   trace.marketProbability,
    edge:                trace.edge,
    confidenceInterval:  trace.confidenceInterval,
    sourcesUsed:         trace.previewSources,  // Preview: only first 2 sources
    // Reduced provenance (#66): enough to see how it was produced, not the hashes.
    provenance:          { summary: summarizeProvenance(trace.provenance) },
    verified:            trace.verified,
    audit,
    verdict,
    ipfsCid:             trace.ipfsCid,
    traceHash:           trace.traceHash,
    contentMode:         trace.contentMode,
    plaintextHash:       trace.plaintextHash,
    onChainTraceId:      trace.onChainTraceId,
    createdAt:           trace.createdAt,
    accessLevel:         'FREE_PREVIEW',
    lockedFields:        ['fullSources', 'hedgeConditions', 'hedgePredicates', 'betFraction', 'betSizeUsdc', 'provenance.llm', 'provenance.generator'],
    unlockPriceRaw:      isDiscovered ? discovered.amountRaw : null,
    unlockPrice:         isDiscovered ? discovered.amountUsdc : null,
    unlockPriceStatus:   discovered.status,
    paymentRequirements: isDiscovered ? discovered.requirements : null,
    dailyPassPriceRaw:   DAILY_PASS_PRICE_RAW.toString(),
    dailyPassPrice:      formatUsdc(DAILY_PASS_PRICE_RAW),
  };
}

/**
 * Expires overdue subscriptions.
 * Called by a scheduled cron job.
 */
export async function expireStaleSubscriptions(now = new Date()): Promise<number> {
  const { count } = await prisma.subscription.updateMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { endsAt: { lte: now } },
        { endsAt: null, expiresAt: { lte: now } },
      ],
    },
    data: { status: 'EXPIRED' },
  });

  if (count > 0) logger.info({ count }, 'Expired stale subscriptions');
  return count;
}

/**
 * Emits PASS_EXPIRING once per daily pass that expires within `windowMins`.
 * The pass is claimed with a conditional update before emitting, so concurrent
 * instances and repeated runs notify at most once (#94).
 */
export async function notifyExpiringPasses(windowMins = 60, now = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + windowMins * 60_000);
  const passes = await prisma.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      type: SubscriptionType.DAILY_PASS,
      expiryNotifiedAt: null,
      OR: [
        { endsAt: { gt: now, lte: horizon } },
        { endsAt: null, expiresAt: { gt: now, lte: horizon } },
      ],
    },
    select: { id: true, userId: true, endsAt: true, expiresAt: true },
    take: 500,
  });

  let notified = 0;
  for (const pass of passes) {
    const claim = await prisma.subscription.updateMany({
      where: { id: pass.id, expiryNotifiedAt: null },
      data: { expiryNotifiedAt: now },
    });
    if (claim.count !== 1) continue;
    const expiresAt = pass.endsAt ?? pass.expiresAt;
    notifyUser(pass.userId, 'PASS_EXPIRING', { subscriptionId: pass.id, expiresAt });
    notified++;
  }
  if (notified > 0) logger.info({ notified }, 'Notified users of expiring passes');
  return notified;
}

/** Largest value a NUMERIC(39,0) allowance column accepts here (i128 max). */
const MAX_ALLOWANCE_RAW = 2n ** 127n - 1n;

/**
 * Sets the caller's spending approval from exact base units (#224). Callers
 * parse decimal strings with parseUsdc; floats are never accepted here.
 */
export async function upsertSpendingAllowance(params: {
  userId: string;
  dailyLimitRaw: bigint;
  perTraceLimitRaw: bigint;
  currency?: string;
}): Promise<any> {
  const { userId, dailyLimitRaw, perTraceLimitRaw, currency = 'USDC' } = params;

  if (dailyLimitRaw <= 0n || perTraceLimitRaw <= 0n || perTraceLimitRaw > dailyLimitRaw) {
    throw new AppError(400, 'INVALID_ALLOWANCE', 'perTraceLimit and dailyLimit must be positive, and perTraceLimit cannot exceed dailyLimit');
  }
  if (dailyLimitRaw > MAX_ALLOWANCE_RAW) {
    throw new AppError(400, 'INVALID_ALLOWANCE', 'dailyLimitRaw is too large');
  }

  const now = new Date();
  const mirrors = floatMirror({
    dailyLimit: toDisplayUsdc(dailyLimitRaw),
    perTraceLimit: toDisplayUsdc(perTraceLimitRaw),
  });
  return prisma.spendingAllowance.upsert({
    where: { userId },
    create: {
      userId,
      ...mirrors,
      dailyLimitRaw: dailyLimitRaw.toString(),
      perTraceLimitRaw: perTraceLimitRaw.toString(),
      spentTodayRaw: '0',
      overageRaw: '0',
      windowStartedAt: utcDayStart(now),
      currency: currency as 'USDC',
    },
    update: {
      ...mirrors,
      dailyLimitRaw: dailyLimitRaw.toString(),
      perTraceLimitRaw: perTraceLimitRaw.toString(),
      currency: currency as 'USDC',
      isActive: true,
    },
  });
}

/**
 * The user's allowance with today's figures read from the day bucket (#219).
 * spentTodayRaw/spentToday come from allowance_days, not the deprecated
 * single-day columns, and reservedRaw is the budget held by open x402
 * reservations.
 */
export async function getSpendingAllowance(userId: string, now = new Date()): Promise<any> {
  const allowance = await prisma.spendingAllowance.findUnique({ where: { userId } });
  if (!allowance) return null;
  const dayStart = utcDayStart(now);
  const bucket = await readAllowanceDay(prisma, userId, dayStart);
  const dailyLimit = decimalToBigint(allowance.dailyLimitRaw);
  return {
    ...allowance,
    dayStart: dayStart.toISOString(),
    spentTodayRaw: bucket.spentRaw.toString(),
    spentToday: toDisplayUsdc(bucket.spentRaw),
    reservedRaw: bucket.reservedRaw.toString(),
    todayOverageRaw: bucket.overageRaw.toString(),
    remainingRaw: dailyLimit > 0n ? remainingFor(dailyLimit, bucket).toString() : null,
  };
}

export async function listPaymentEvents(userId: string): Promise<PaymentEventDto[]> {
  const events = await prisma.paymentEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return events.map(toPaymentEventDto);
}
