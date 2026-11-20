import { MuxedAccount, StrKey } from '@stellar/stellar-sdk';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { decimalToBigint } from '../lib/amounts';
import { chargeDayFor, ledgerDay, utcDayKey, utcDayStart } from '../lib/time';
import { AppError } from '../middlewares/error.middleware';
import { identityKeyFor } from './auth.service';
import {
  chargeAllowance,
  lockAllowanceDay,
  remainingFor,
  writeAllowanceDay,
} from './subscription.service';

/**
 * Allowance reservations for x402 per-trace purchases (#219).
 *
 * The x402 trace service (contracts repo) calls reserve before it asks the
 * facilitator to settle, then commit with the settled transaction or release
 * if settlement did not happen. A RESERVED allowance_charges row holds budget
 * in allowance_days.reservedRaw for the reservation day until it is
 * committed, released or expired by the sweep.
 *
 * None of these paths take the per-user advisory lock used by pass claims;
 * they serialise with them on the allowance_days row lock. Lock order, as
 * everywhere: allowance_charges row, buckets by ascending day, then
 * spending_allowances.
 */

const TX_TIMEOUT_MS = 15_000;

export interface PayerIdentity {
  payer: string;
  subId?: string | null;
  subIdKind?: 'MUXED' | 'MEMO' | null;
}

/**
 * The users.identityKey for an x402 payer, derived exactly like a login
 * (identityKeyFor). A muxed M… payer carries its own sub-id. walletAddress is
 * not unique (#46), so it is never used to resolve the payer.
 */
export function payerIdentityKey(identity: PayerIdentity): string {
  let account = identity.payer.trim();
  let subId = identity.subId ?? null;
  let subIdKind = identity.subIdKind ?? null;
  if (StrKey.isValidMed25519PublicKey(account)) {
    const muxed = MuxedAccount.fromAddress(account, '0');
    if (subId != null && subId !== muxed.id()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'subId does not match the muxed payer address');
    }
    account = muxed.baseAccount().accountId();
    subId = muxed.id();
    subIdKind = 'MUXED';
  }
  if (subId != null && subIdKind == null) {
    throw new AppError(400, 'VALIDATION_ERROR', 'subIdKind is required with subId');
  }
  return identityKeyFor({ account, subId, subIdKind });
}

async function resolveUserId(identity: PayerIdentity): Promise<{ identityKey: string; userId: string | null }> {
  const identityKey = payerIdentityKey(identity);
  const user = await prisma.user.findUnique({ where: { identityKey }, select: { id: true } });
  return { identityKey, userId: user?.id ?? null };
}

/** Locks one allowance_charges row for the rest of the transaction. */
async function lockCharge(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "allowance_charges" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.allowanceCharge.findUnique({ where: { id } });
}

/** Decrements reservedRaw on a bucket the caller has not locked yet. */
async function releaseReserved(tx: Prisma.TransactionClient, userId: string, day: Date, amountRaw: bigint): Promise<void> {
  const bucket = await lockAllowanceDay(tx, userId, day);
  await writeAllowanceDay(tx, userId, day, {
    ...bucket,
    reservedRaw: bucket.reservedRaw > amountRaw ? bucket.reservedRaw - amountRaw : 0n,
  });
}

export type ReserveResult =
  | { allowed: true; active: false; reservationId: null }
  | {
      allowed: true;
      active: true;
      reservationId: string;
      dayStart: string;
      expiresAt: string;
      remainingRaw: string | null;
      replay: boolean;
    };

/**
 * POST /x402/allowance/reserve. Holds `amountRaw` against today's bucket if it
 * fits the per-trace and daily limits (spend plus open reservations);
 * otherwise 403 ALLOWANCE_PER_TRACE_LIMIT / ALLOWANCE_DAILY_LIMIT. Idempotent
 * on (payer, nonce): a retry returns the same reservation.
 */
export async function reserveAllowance(
  params: PayerIdentity & { traceId: string; amountRaw: bigint; nonce: string },
  now = new Date(),
): Promise<ReserveResult> {
  const { identityKey, userId } = await resolveUserId(params);
  if (!userId) return { allowed: true, active: false, reservationId: null };
  const allowance = await prisma.spendingAllowance.findUnique({ where: { userId } });
  if (!allowance?.isActive) return { allowed: true, active: false, reservationId: null };

  const reservationKey = `${identityKey}|${params.nonce}`;
  const day = utcDayStart(now);
  const expiresAt = new Date(now.getTime() + config.X402_ALLOWANCE_RESERVATION_TTL_SECONDS * 1000);

  const result = await prisma.$transaction(async (tx) => {
    const bucket = await lockAllowanceDay(tx, userId, day);
    const dailyLimit = decimalToBigint(allowance.dailyLimitRaw);
    const perTraceLimit = decimalToBigint(allowance.perTraceLimitRaw);

    // Reserves for this user and day serialise on the bucket lock, so the
    // idempotency read cannot race another reserve with the same nonce.
    const existing = await tx.allowanceCharge.findUnique({ where: { reservationKey } });
    if (existing) {
      if (existing.userId !== userId || decimalToBigint(existing.amountRaw) !== params.amountRaw || existing.traceId !== params.traceId) {
        throw new AppError(409, 'ALLOWANCE_NONCE_REUSED', 'This nonce was already used for a different reservation');
      }
      return {
        allowed: true as const,
        active: true as const,
        reservationId: existing.id,
        dayStart: ledgerDay(existing.day).toISOString(),
        expiresAt: (existing.expiresAt ?? expiresAt).toISOString(),
        remainingRaw: dailyLimit > 0n ? remainingFor(dailyLimit, bucket).toString() : null,
        replay: true,
      };
    }

    if (perTraceLimit > 0n && params.amountRaw > perTraceLimit) {
      throw new AppError(403, 'ALLOWANCE_PER_TRACE_LIMIT', 'The trace price exceeds the per-trace spending limit', {
        perTraceLimitRaw: perTraceLimit.toString(),
        amountRaw: params.amountRaw.toString(),
      });
    }
    const remaining = remainingFor(dailyLimit, bucket);
    if (dailyLimit > 0n && params.amountRaw > remaining) {
      throw new AppError(403, 'ALLOWANCE_DAILY_LIMIT', 'The trace price exceeds the remaining daily spending limit', {
        dayStart: day.toISOString(),
        dailyLimitRaw: dailyLimit.toString(),
        remainingRaw: remaining.toString(),
        amountRaw: params.amountRaw.toString(),
      });
    }

    const charge = await tx.allowanceCharge.create({
      data: {
        userId,
        day,
        source: 'X402',
        status: 'RESERVED',
        reservationKey,
        traceId: params.traceId,
        amountRaw: params.amountRaw.toString(),
        expiresAt,
      },
    });
    const next = { ...bucket, reservedRaw: bucket.reservedRaw + params.amountRaw };
    await writeAllowanceDay(tx, userId, day, next);
    return {
      allowed: true as const,
      active: true as const,
      reservationId: charge.id,
      dayStart: day.toISOString(),
      expiresAt: expiresAt.toISOString(),
      remainingRaw: dailyLimit > 0n ? remainingFor(dailyLimit, next).toString() : null,
      replay: false,
    };
  }, { timeout: TX_TIMEOUT_MS });

  if (!result.replay) {
    logger.info({ userId, reservationId: result.reservationId, amountRaw: params.amountRaw.toString() }, 'x402 allowance reserved');
  }
  return result;
}

export interface CommitResult {
  committed: boolean;
  /** No user or allowance exists for an unknown reservation's payer. */
  active: boolean;
  reservationId: string | null;
  chargeId: string | null;
  /** Ledger-close UTC day the amount was booked to. */
  day: string | null;
  dayInferred: boolean;
  overageRaw: string;
  perTraceExceeded: boolean;
  /** The reservation had expired or been released before the commit. */
  late: boolean;
  replay: boolean;
}

/** `ledgerCloseTime` as Unix seconds (RPC createdAt) or an ISO-8601 string. */
export function ledgerCloseSeconds(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null;
}

/**
 * POST /x402/allowance/commit. Books a settled x402 payment on the UTC day of
 * its ledger close, which may differ from the reservation day: the
 * reservation's reservedRaw is released from its own day and the amount is
 * charged to the close day through chargeAllowance. The money already moved,
 * so a commit for an expired, released or unknown reservation is still
 * booked, with overage flagged if the day is full. Idempotent per txHash.
 */
export async function commitReservation(
  params: {
    reservationId: string;
    txHash: string;
    ledgerCloseTime?: number | string | null;
    amountRaw: bigint;
    /** Lets an unknown reservation still be attributed to its payer. */
    payer?: PayerIdentity | null;
    traceId?: string | null;
  },
  now = new Date(),
): Promise<CommitResult> {
  const txHash = params.txHash.toLowerCase();
  const { day: closeDay, inferred } = chargeDayFor({ createdAt: ledgerCloseSeconds(params.ledgerCloseTime) }, now);

  // An unknown reservation is resolved through the payer, outside the transaction.
  const known = await prisma.allowanceCharge.findUnique({ where: { id: params.reservationId }, select: { userId: true } });
  let fallbackUserId: string | null = null;
  if (!known) {
    if (!params.payer) {
      throw new AppError(404, 'ALLOWANCE_RESERVATION_NOT_FOUND', 'Reservation not found; include payer to book the payment');
    }
    fallbackUserId = (await resolveUserId(params.payer)).userId;
    if (!fallbackUserId) {
      return {
        committed: false, active: false, reservationId: null, chargeId: null, day: utcDayKey(closeDay),
        dayInferred: inferred, overageRaw: '0', perTraceExceeded: false, late: true, replay: false,
      };
    }
  }

  const result = await prisma.$transaction(async (tx): Promise<CommitResult> => {
    const reservation = known ? await lockCharge(tx, params.reservationId) : null;
    const userId = reservation?.userId ?? fallbackUserId;
    if (!userId) throw new AppError(404, 'ALLOWANCE_RESERVATION_NOT_FOUND', 'Reservation not found');

    if (reservation && reservation.status === 'COMMITTED') {
      if (reservation.txHash !== txHash) {
        throw new AppError(409, 'ALLOWANCE_RESERVATION_COMMITTED', 'This reservation was already committed with another transaction');
      }
      return {
        committed: true, active: true, reservationId: reservation.id, chargeId: reservation.id,
        day: utcDayKey(reservation.day), dayInferred: reservation.dayInferred,
        overageRaw: decimalToBigint(reservation.overageRaw).toString(),
        perTraceExceeded: reservation.perTraceExceeded, late: false, replay: true,
      };
    }

    const late = !reservation || reservation.status !== 'RESERVED';
    // Buckets in ascending day order: the reservation day (if still holding
    // budget) and the close day.
    const reservedDay = reservation && !late ? ledgerDay(reservation.day) : null;
    if (reservedDay && reservedDay.getTime() < closeDay.getTime()) {
      await releaseReserved(tx, userId, reservedDay, decimalToBigint(reservation!.amountRaw));
      await lockAllowanceDay(tx, userId, closeDay);
    } else {
      await lockAllowanceDay(tx, userId, closeDay);
      if (reservedDay) await releaseReserved(tx, userId, reservedDay, decimalToBigint(reservation!.amountRaw));
    }

    // The same transaction was already booked (e.g. by another reservation):
    // close this reservation without charging twice.
    const prior = await tx.allowanceCharge.findUnique({ where: { txHash } });
    if (prior && prior.status === 'COMMITTED' && prior.id !== reservation?.id) {
      if (reservation && !late) {
        await tx.allowanceCharge.update({ where: { id: reservation.id }, data: { status: 'RELEASED', expiresAt: null } });
      }
      return {
        committed: true, active: true, reservationId: reservation?.id ?? null, chargeId: prior.id,
        day: utcDayKey(prior.day), dayInferred: prior.dayInferred,
        overageRaw: decimalToBigint(prior.overageRaw).toString(),
        perTraceExceeded: prior.perTraceExceeded, late, replay: true,
      };
    }

    const charge = await chargeAllowance(tx, {
      userId,
      type: 'PER_TRACE',
      amountRaw: params.amountRaw,
      day: closeDay,
      source: 'X402',
      txHash,
      traceId: reservation?.traceId ?? params.traceId ?? null,
      dayInferred: inferred,
      chargeId: reservation?.id ?? null,
      now,
    });
    return {
      committed: true, active: true, reservationId: reservation?.id ?? null, chargeId: charge.chargeId,
      day: utcDayKey(charge.day), dayInferred: inferred, overageRaw: charge.overageRaw.toString(),
      perTraceExceeded: charge.perTraceExceeded, late, replay: charge.replay,
    };
  }, { timeout: TX_TIMEOUT_MS });

  if (result.committed && !result.replay) {
    logger.info(
      { reservationId: result.reservationId, chargeId: result.chargeId, day: result.day, late: result.late, overageRaw: result.overageRaw },
      'x402 allowance committed',
    );
  }
  return result;
}

/**
 * POST /x402/allowance/release. Returns a RESERVED charge's budget; any other
 * state is reported unchanged, so retries are harmless.
 */
export async function releaseReservation(reservationId: string): Promise<{ reservationId: string; status: string; released: boolean }> {
  return prisma.$transaction(async (tx) => {
    const reservation = await lockCharge(tx, reservationId);
    if (!reservation) throw new AppError(404, 'ALLOWANCE_RESERVATION_NOT_FOUND', 'Reservation not found');
    if (reservation.status !== 'RESERVED') {
      return { reservationId, status: reservation.status, released: false };
    }
    await releaseReserved(tx, reservation.userId, ledgerDay(reservation.day), decimalToBigint(reservation.amountRaw));
    await tx.allowanceCharge.update({ where: { id: reservationId }, data: { status: 'RELEASED', expiresAt: null } });
    return { reservationId, status: 'RELEASED', released: true };
  }, { timeout: TX_TIMEOUT_MS });
}

/**
 * Expires RESERVED charges past expiresAt and returns their budget (#219).
 * Each batch is one transaction that claims rows with FOR UPDATE SKIP LOCKED,
 * so a concurrent commit/release (which locks the row first) is skipped
 * rather than waited on, and several instances can sweep at once.
 */
export async function expireAllowanceReservations(now = new Date(), batchSize = 200, maxBatches = 50): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const expired = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; userId: string; day: Date; amountRaw: Prisma.Decimal }>>`
        SELECT "id", "userId", "day", "amountRaw"
        FROM "allowance_charges"
        WHERE "status" = 'RESERVED' AND "expiresAt" < ${now}
        ORDER BY "userId", "day", "id"
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED`;
      for (const row of rows) {
        await releaseReserved(tx, row.userId, ledgerDay(new Date(row.day)), decimalToBigint(row.amountRaw));
        await tx.allowanceCharge.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
      }
      return rows.length;
    }, { timeout: TX_TIMEOUT_MS });
    total += expired;
    if (expired < batchSize) break;
  }
  if (total > 0) logger.info({ expired: total }, 'Expired x402 allowance reservations');
  return total;
}
