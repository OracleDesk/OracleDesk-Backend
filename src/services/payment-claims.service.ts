/**
 * Cross-channel payment transfer event claim ledger (#312).
 *
 * Every channel that turns an on-chain USDC transfer into an entitlement
 * (legacy unlock, payment intent, x402 settlement ingestion, refunds) inserts
 * into `payment_claims` keyed by `(txHash, opIndex, eventIndex)` inside its
 * settlement transaction. Cross-channel reuse fails with a single stable error
 * (`409 PAYMENT_TRANSFER_ALREADY_CLAIMED`) and records an audit row.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { AppError } from '../middlewares/error.middleware';

export type ClaimChannel =
  | 'LEGACY_UNLOCK'
  | 'PAYMENT_INTENT'
  | 'X402_SETTLEMENT'
  | 'REFUND'
  | 'BACKFILL';

export interface ClaimableEvent {
  opIndex: number | null;
  eventIndex?: number;
  amount: bigint;
}

export interface ClaimParams {
  txHash: string;
  channel: ClaimChannel;
  userId?: string | null;
  paymentEventId?: string | null;
  x402SettlementTxHash?: string | null;
  totalAmountRaw?: bigint;
  transfers: ClaimableEvent[];
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === 'P2002' || code === '23505';
}

async function writeConflictAudit(detail: {
  txHash: string;
  channel: ClaimChannel;
  userId: string | null;
  opIndex: number;
  eventIndex: number;
}): Promise<void> {
  await prisma.agentLog
    .create({
      data: {
        agentType: 'TRADER',
        level: 'WARN',
        action: 'PAYMENT_CLAIM_CONFLICT',
        data: detail as object,
      },
    })
    .catch((err) => logger.warn({ err, ...detail }, 'Failed to write payment claim conflict audit row'));
}

/**
 * Claims the specific transfer events consumed by a settlement inside `tx`.
 * Throws `409 PAYMENT_TRANSFER_ALREADY_CLAIMED` on any `(txHash, opIndex, eventIndex)` collision.
 */
export async function claimTransferEvents(
  tx: Prisma.TransactionClient | PrismaClient,
  params: ClaimParams,
): Promise<Array<{ id: string; txHash: string; opIndex: number; eventIndex: number }>> {
  const txHash = params.txHash.toLowerCase();
  const events: Array<{ opIndex: number; eventIndex: number; amount: bigint }> =
    params.transfers.length > 0
      ? [...params.transfers]
          .map((t) => ({
            opIndex: t.opIndex ?? 0,
            eventIndex: t.eventIndex ?? 0,
            amount: t.amount,
          }))
          .sort((a, b) => a.opIndex - b.opIndex || a.eventIndex - b.eventIndex)
      : [{ opIndex: 0, eventIndex: 0, amount: params.totalAmountRaw ?? 0n }];

  const created: Array<{ id: string; txHash: string; opIndex: number; eventIndex: number }> = [];
  for (const ev of events) {
    try {
      const row = await (tx as any).paymentClaim.create({
        data: {
          txHash,
          opIndex: ev.opIndex,
          eventIndex: ev.eventIndex,
          channel: params.channel,
          userId: params.userId ?? null,
          amountRaw: ev.amount.toString(),
          paymentEventId: params.paymentEventId ?? null,
          x402SettlementTxHash: params.x402SettlementTxHash ?? null,
        },
      });
      created.push({
        id: row.id,
        txHash: row.txHash,
        opIndex: row.opIndex,
        eventIndex: row.eventIndex,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        await writeConflictAudit({
          txHash,
          channel: params.channel,
          userId: params.userId ?? null,
          opIndex: ev.opIndex,
          eventIndex: ev.eventIndex,
        });
        throw new AppError(
          409,
          'PAYMENT_TRANSFER_ALREADY_CLAIMED',
          'This on-chain transfer event has already been claimed by another purchase channel',
          {
            txHash,
            opIndex: ev.opIndex,
            eventIndex: ev.eventIndex,
            channel: params.channel,
          },
        );
      }
      throw err;
    }
  }
  return created;
}

/** Convenience wrapper for x402 settlement ingestion. */
export async function claimX402Settlement(
  tx: Prisma.TransactionClient | PrismaClient,
  params: {
    txHash: string;
    userId: string;
    amountRaw: bigint;
    transfers: ClaimableEvent[];
  },
) {
  return claimTransferEvents(tx, {
    txHash: params.txHash,
    channel: 'X402_SETTLEMENT',
    userId: params.userId,
    x402SettlementTxHash: params.txHash.toLowerCase(),
    totalAmountRaw: params.amountRaw,
    transfers: params.transfers,
  });
}

/** Checks whether any transfer event in `txHash` has already been claimed. */
export async function isTxClaimed(
  db: Pick<PrismaClient, 'paymentClaim'>,
  txHash: string,
): Promise<boolean> {
  const existing = await (db as any).paymentClaim.findFirst({
    where: { txHash: txHash.toLowerCase() },
    select: { id: true },
  });
  return existing !== null;
}
