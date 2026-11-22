/**
 * Signed, verifiable purchase receipts (#313).
 *
 * Every settled purchase (daily passes now, per-trace unlocks via x402
 * ingestion) atomically issues a canonical, versioned receipt document signed
 * with a dedicated Ed25519 key (`RECEIPT_SIGNING_KEY`), published in
 * `/.well-known/oracledesk-receipt-keys.json`.
 *
 * After a database restore or lost row, a user can present a receipt to
 * `POST /api/v1/receipts/redeem` to re-grant the exact entitlement after
 * signature, replay, and on-chain checks.
 */
import crypto from 'node:crypto';
import {
  PaymentEventStatus,
  PaymentEventType,
  SettlementCurrency,
  SubscriptionStatus,
  SubscriptionType,
  type Prisma,
} from '@prisma/client';
import { config } from '../config';
import { CONTRACTS, PAYMENTS_RECIPIENT } from '../config/contracts';
import { secret } from '../config/secrets';
import { withAdvisoryLocksWait } from '../lib/advisory-lock';
import { toDisplayUsdc } from '../lib/amounts';
import { prisma } from '../lib/prisma';
import { AppError } from '../middlewares/error.middleware';
import { canonicalJson } from '../utils/hash.util';
import {
  buildEntitlementKeySet,
  entitlementJwks,
  type EntitlementKey,
  type EntitlementKeySet,
} from './entitlement/keys';
import { claimTransferEvents } from './payment-claims.service';
import { verifyUsdcTransfer, type VerifiedTransfer } from './payment-verification.service';

export const RECEIPT_VERSION = 1;
export const RECEIPT_TYP = 'application/oracledesk-receipt+json';

export interface ReceiptEventRef {
  contractId: string;
  from: string;
  to: string;
  amountRaw: string;
  opIndex: number;
  eventIndex: number;
  toMuxedId: string | null;
}

export interface ReceiptDocumentV1 {
  version: 1;
  receiptId: string;
  type: 'DAILY_PASS' | 'PER_TRACE';
  userId: string;
  payer: string;
  recipient: string;
  txHash: string;
  ledger: number;
  ledgerCloseTime: string;
  events: ReceiptEventRef[];
  amountRaw: string;
  currency: 'USDC';
  product: {
    type: 'DAILY_PASS' | 'PER_TRACE';
    traceId: string | null;
    startsAt: string | null;
    endsAt: string | null;
  };
  priceVersion: string;
  keyId: string;
  issuedAt: string;
}

export function getReceiptKeySet(): EntitlementKeySet {
  let currentValue: string | undefined;
  try {
    currentValue = secret('RECEIPT_SIGNING_KEY');
  } catch {
    currentValue = config.RECEIPT_SIGNING_KEY;
  }
  if (!currentValue) {
    currentValue = config.RECEIPT_SIGNING_KEY;
  }
  if (!currentValue) {
    throw new AppError(503, 'RECEIPT_KEY_UNAVAILABLE', 'Receipt signing key is not configured');
  }
  return buildEntitlementKeySet(currentValue, config.RECEIPT_PREVIOUS_PUBLIC_KEYS ?? []);
}

export function receiptJwks(): { keys: ReturnType<typeof entitlementJwks>['keys'] } {
  return entitlementJwks(getReceiptKeySet());
}

export function toDetachedJws(compactJws: string): string {
  const parts = compactJws.split('.');
  if (parts.length !== 3) {
    throw new AppError(400, 'INVALID_RECEIPT_JWS', 'JWS must have 3 dot-separated parts');
  }
  return `${parts[0]}..${parts[2]}`;
}

export function signReceiptDocument(
  doc: ReceiptDocumentV1,
  key: EntitlementKey,
): { compactJws: string; detachedJws: string } {
  if (!key.privateKey) {
    throw new AppError(500, 'RECEIPT_SIGNING_FAILED', 'Current receipt key has no private half');
  }
  const header = { alg: 'EdDSA', typ: RECEIPT_TYP, kid: key.kid };
  const headerB64 = Buffer.from(canonicalJson(header), 'utf8').toString('base64url');
  const payloadB64 = Buffer.from(canonicalJson(doc), 'utf8').toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = crypto.sign(null, Buffer.from(signingInput, 'utf8'), key.privateKey);
  const sigB64 = sig.toString('base64url');
  return {
    compactJws: `${signingInput}.${sigB64}`,
    detachedJws: `${headerB64}..${sigB64}`,
  };
}

export function verifyReceiptJws(
  jws: string,
  keySet: EntitlementKeySet = getReceiptKeySet(),
  detachedDocument?: ReceiptDocumentV1,
): ReceiptDocumentV1 {
  const parts = jws.trim().split('.');
  if (parts.length !== 3 || !parts[0] || !parts[2]) {
    throw new AppError(400, 'INVALID_RECEIPT_JWS', 'Malformed receipt JWS');
  }
  const [headerB64, rawPayloadB64, sigB64] = parts;

  let header: { alg?: string; typ?: string; kid?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_RECEIPT_JWS', 'Invalid JWS protected header');
  }
  if (header.alg !== 'EdDSA' || !header.kid) {
    throw new AppError(400, 'INVALID_RECEIPT_JWS', 'Unsupported receipt JWS algorithm or missing kid');
  }

  const allKeys = [keySet.current, ...keySet.previous];
  const signingKey = allKeys.find((k) => k.kid === header.kid);
  if (!signingKey) {
    throw new AppError(401, 'UNKNOWN_RECEIPT_KEY', `Receipt signing key '${header.kid}' is not in the trusted key set`);
  }

  let payloadB64 = rawPayloadB64;
  if (!payloadB64) {
    if (!detachedDocument) {
      throw new AppError(400, 'MISSING_RECEIPT_DOCUMENT', 'Detached JWS requires the receipt document body');
    }
    payloadB64 = Buffer.from(canonicalJson(detachedDocument), 'utf8').toString('base64url');
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  let valid = false;
  try {
    valid = crypto.verify(
      null,
      Buffer.from(signingInput, 'utf8'),
      signingKey.publicKey,
      Buffer.from(sigB64, 'base64url'),
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new AppError(401, 'INVALID_RECEIPT_SIGNATURE', 'Receipt signature verification failed');
  }

  let doc: ReceiptDocumentV1;
  try {
    doc = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as ReceiptDocumentV1;
  } catch {
    throw new AppError(400, 'INVALID_RECEIPT_DOCUMENT', 'Invalid receipt payload JSON');
  }

  if (
    doc.version !== RECEIPT_VERSION ||
    !doc.receiptId ||
    !doc.txHash ||
    !doc.userId ||
    !doc.payer ||
    !doc.amountRaw ||
    doc.keyId !== header.kid
  ) {
    throw new AppError(400, 'INVALID_RECEIPT_DOCUMENT', 'Receipt document is missing required fields or keyId mismatch');
  }

  return doc;
}

export interface IssueReceiptParams {
  receiptId?: string;
  userId: string;
  subscriptionId: string;
  paymentEventId: string;
  type: 'DAILY_PASS' | 'PER_TRACE';
  traceId: string | null;
  transfer: VerifiedTransfer;
  startsAt: Date;
  endsAt: Date;
  ledgerCloseAt: Date;
  issuedAt?: Date;
  priceVersion?: string;
  keySet?: EntitlementKeySet;
}

/**
 * Builds, signs, and stores a canonical receipt inside the settlement transaction.
 */
export async function issueReceiptInTx(
  tx: Prisma.TransactionClient,
  params: IssueReceiptParams,
): Promise<{ id: string; receiptId: string; keyId: string; document: ReceiptDocumentV1; jws: string }> {
  const keySet = params.keySet ?? getReceiptKeySet();
  const key = keySet.current;
  const receiptId = params.receiptId ?? crypto.randomUUID();
  const issuedAt = (params.issuedAt ?? new Date()).toISOString();
  const priceVersion = params.priceVersion ?? config.DAILY_PASS_PRICE_VERSION;
  const txHash = params.transfer.txHash.toLowerCase();

  const events: ReceiptEventRef[] = params.transfer.transfers.map((t) => ({
    contractId: t.contractId,
    from: t.from,
    to: t.to,
    amountRaw: t.amount.toString(),
    opIndex: t.opIndex ?? 0,
    eventIndex: t.eventIndex ?? 0,
    toMuxedId: t.toMuxedId,
  }));

  const doc: ReceiptDocumentV1 = {
    version: 1,
    receiptId,
    type: params.type,
    userId: params.userId,
    payer: params.transfer.from,
    recipient: params.transfer.to,
    txHash,
    ledger: params.transfer.ledger,
    ledgerCloseTime: params.ledgerCloseAt.toISOString(),
    events,
    amountRaw: params.transfer.amount.toString(),
    currency: 'USDC',
    product: {
      type: params.type,
      traceId: params.traceId,
      startsAt: params.startsAt.toISOString(),
      endsAt: params.endsAt.toISOString(),
    },
    priceVersion,
    keyId: key.kid,
    issuedAt,
  };

  const { compactJws } = signReceiptDocument(doc, key);
  const row = await (tx as any).receipt.create({
    data: {
      receiptId,
      version: RECEIPT_VERSION,
      userId: params.userId,
      subscriptionId: params.subscriptionId,
      paymentEventId: params.paymentEventId,
      type: params.type as SubscriptionType,
      traceId: params.traceId,
      txHash,
      ledger: params.transfer.ledger,
      payer: params.transfer.from,
      recipient: params.transfer.to,
      amountRaw: params.transfer.amount.toString(),
      currency: SettlementCurrency.USDC,
      priceVersion,
      keyId: key.kid,
      document: doc as unknown as object,
      jws: compactJws,
    },
  });

  return {
    id: row.id,
    receiptId: row.receiptId,
    keyId: row.keyId,
    document: doc,
    jws: compactJws,
  };
}

export async function listUserReceipts(userId: string, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    (prisma as any).receipt.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    (prisma as any).receipt.count({ where: { userId } }),
  ]);
  return { rows, total };
}

export async function getUserReceipt(userId: string, id: string) {
  const row = await (prisma as any).receipt.findFirst({
    where: {
      userId,
      OR: [{ id }, { receiptId: id }],
    },
  });
  if (!row) {
    throw new AppError(404, 'RECEIPT_NOT_FOUND', 'Receipt not found');
  }
  return row;
}

export interface RedeemDeps {
  keySet?: EntitlementKeySet;
  verifyChain?: typeof verifyUsdcTransfer;
  allowPrunedChain?: boolean;
  now?: () => Date;
}

export interface RedeemResult {
  status: 'REDEEMED' | 'ALREADY_PRESENT';
  redeemed: boolean;
  receiptId: string;
  txHash: string;
  subscriptionId: string;
  type: 'DAILY_PASS' | 'PER_TRACE';
  chainVerified: boolean;
}

/**
 * Re-grants a purchase from a signed receipt after a DB restore or row loss.
 */
export async function redeemReceipt(
  params: { jws: string; document?: ReceiptDocumentV1; requesterUserId?: string },
  deps: RedeemDeps = {},
): Promise<RedeemResult> {
  const keySet = deps.keySet ?? getReceiptKeySet();
  const doc = verifyReceiptJws(params.jws, keySet, params.document);

  if (params.requesterUserId && doc.userId !== params.requesterUserId) {
    throw new AppError(403, 'RECEIPT_OWNER_MISMATCH', 'This receipt belongs to another account');
  }

  const txHash = doc.txHash.toLowerCase();
  const now = deps.now ? deps.now() : new Date();

  // Check if already present (replay / non-restore call)
  const existingReceipt = await (prisma as any).receipt.findFirst({
    where: { OR: [{ receiptId: doc.receiptId }, { txHash }] },
  });
  const existingPayment = await prisma.paymentEvent.findUnique({ where: { txHash } });

  if (existingReceipt || existingPayment) {
    return {
      status: 'ALREADY_PRESENT',
      redeemed: false,
      receiptId: doc.receiptId,
      txHash,
      subscriptionId: existingReceipt?.subscriptionId ?? '',
      type: doc.type,
      chainVerified: false,
    };
  }

  // Verify against chain where chain still remembers the transfer
  let chainVerified = false;
  const verifyFn = deps.verifyChain ?? verifyUsdcTransfer;
  try {
    const verified = await verifyFn({
      txHash,
      token: CONTRACTS.usdc,
      from: doc.payer,
      to: doc.recipient || PAYMENTS_RECIPIENT,
      minAmount: BigInt(doc.amountRaw),
    });
    if (verified.ledger !== doc.ledger) {
      throw new AppError(400, 'RECEIPT_CHAIN_MISMATCH', 'Receipt ledger does not match on-chain transaction');
    }
    chainVerified = true;
  } catch (err) {
    if (err instanceof AppError && err.code === 'RECEIPT_CHAIN_MISMATCH') {
      throw err;
    }
    const code = err instanceof AppError ? err.code : '';
    const isPruned = code === 'TX_NOT_FOUND' || code === 'RPC_ERROR' || code === 'RPC_TIMEOUT';
    if (!isPruned || deps.allowPrunedChain === false) {
      throw err;
    }
    // Chain history pruned past retention window; proceed on valid Ed25519 signature.
  }

  return withAdvisoryLocksWait(
    [
      ['payment', txHash],
      ['user', doc.userId],
    ],
    async (tx) => {
      const recheck = await tx.paymentEvent.findUnique({ where: { txHash } });
      if (recheck) {
        const rec = await (tx as any).receipt.findFirst({ where: { txHash } });
        return {
          status: 'ALREADY_PRESENT' as const,
          redeemed: false,
          receiptId: doc.receiptId,
          txHash,
          subscriptionId: rec?.subscriptionId ?? '',
          type: doc.type,
          chainVerified,
        };
      }

      const startsAt = doc.product.startsAt ? new Date(doc.product.startsAt) : new Date(doc.ledgerCloseTime);
      const endsAt = doc.product.endsAt ? new Date(doc.product.endsAt) : new Date(startsAt.getTime() + 86_400_000);
      const granted = endsAt > now;
      const amountRaw = BigInt(doc.amountRaw);

      const sub = await tx.subscription.create({
        data: {
          userId: doc.userId,
          traceId: doc.product.traceId,
          type: doc.type as SubscriptionType,
          status: granted ? SubscriptionStatus.ACTIVE : SubscriptionStatus.EXPIRED,
          ...(config.PAYMENT_FLOAT_WRITES ? { amountPaid: toDisplayUsdc(amountRaw) } : {}),
          amountPaidRaw: amountRaw.toString(),
          currency: SettlementCurrency.USDC,
          txHash,
          purchaseLedger: doc.ledger,
          startsAt,
          endsAt,
          expiresAt: endsAt,
        },
      });

      const pe = await tx.paymentEvent.create({
        data: {
          userId: doc.userId,
          traceId: doc.product.traceId,
          txHash,
          type: doc.type as PaymentEventType,
          ...(config.PAYMENT_FLOAT_WRITES ? { amount: toDisplayUsdc(amountRaw) } : {}),
          amountRaw: amountRaw.toString(),
          fromAddress: doc.payer,
          currency: SettlementCurrency.USDC,
          status: PaymentEventStatus.CONFIRMED,
          ledger: doc.ledger,
          ledgerCloseTime: new Date(doc.ledgerCloseTime),
          confirmedAt: now,
          metadata: {
            redeemedFromReceipt: doc.receiptId,
            chainVerified,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          } as object,
        },
      });

      if ((tx as any).paymentClaim?.create) {
        await claimTransferEvents(tx, {
          txHash,
          channel: 'LEGACY_UNLOCK',
          userId: doc.userId,
          paymentEventId: pe.id,
          totalAmountRaw: amountRaw,
          transfers: doc.events.map((e) => ({
            opIndex: e.opIndex,
            eventIndex: e.eventIndex,
            amount: BigInt(e.amountRaw),
          })),
        });
      }

      await (tx as any).receipt.create({
        data: {
          receiptId: doc.receiptId,
          version: doc.version,
          userId: doc.userId,
          subscriptionId: sub.id,
          paymentEventId: pe.id,
          type: doc.type as SubscriptionType,
          traceId: doc.product.traceId,
          txHash,
          ledger: doc.ledger,
          payer: doc.payer,
          recipient: doc.recipient,
          amountRaw: doc.amountRaw,
          currency: SettlementCurrency.USDC,
          priceVersion: doc.priceVersion,
          keyId: doc.keyId,
          document: doc as unknown as object,
          jws: params.jws,
          redeemedAt: now,
        },
      });

      return {
        status: 'REDEEMED' as const,
        redeemed: true,
        receiptId: doc.receiptId,
        txHash,
        subscriptionId: sub.id,
        type: doc.type,
        chainVerified,
      };
    },
  );
}
