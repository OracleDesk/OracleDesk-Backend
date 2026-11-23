/**
 * On-chain fee receipt decoder and recorder (#308).
 *
 * Decodes the actual fee charged (inclusion, non-refundable resource,
 * refundable resource, and rent) from Stellar RPC `getTransaction` responses
 * (`resultXdr` + `resultMetaXdr`) and the landed transaction envelope,
 * attributing fee-bumped landings to the fee payer while keeping the inner
 * hash as the outbox identity.
 */
import { StrKey, TransactionBuilder, rpc, xdr } from '@stellar/stellar-sdk';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { prisma as defaultPrisma } from '../../lib/prisma';
import type { OperationClass } from './fees';

export interface FeeReceipt {
  landedHash: string;
  feeBumped: boolean;
  payer: string;
  innerSource: string;
  /** TransactionResult.feeCharged of the landed envelope. */
  feeCharged: bigint;
  /** innerResultPair.result.feeCharged when fee-bumped, else null. */
  innerFeeCharged: bigint | null;
  nonRefundableResourceCharged: bigint | null;
  refundableResourceCharged: bigint | null;
  rentCharged: bigint | null;
  /** Declared fee in the landed envelope (outer fee when bumped). */
  declaredFee: bigint;
  /** Declared sorobanData.resourceFee of the inner transaction. */
  declaredResourceFee: bigint;
  ledger: number;
  success: boolean;
  metaVersion: number;
}

export interface FeeEstimate {
  inclusionFee: bigint;
  resourceFee: bigint;
  totalFee: bigint;
}

export interface FeeReceiptRowInput {
  id?: string | null;
  kind?: string | null;
  opClass?: string | null;
  hash?: string | null;
  source?: string | null;
  envelopeXdr?: string | null;
  innerFee?: string | null;
  resourceFee?: string | null;
  feeBumpEnvelopes?: unknown;
}

export interface FeeReceiptMetrics {
  recorded: number;
  errors: number;
}

const metrics: FeeReceiptMetrics = {
  recorded: 0,
  errors: 0,
};

export function feeReceiptMetrics(): Readonly<FeeReceiptMetrics> {
  return { ...metrics };
}

export function resetFeeReceiptMetricsForTest(): void {
  metrics.recorded = 0;
  metrics.errors = 0;
}

function toBigInt(val: unknown): bigint {
  if (typeof val === 'bigint') return val;
  if (val && typeof (val as { toString(): string }).toString === 'function') {
    return BigInt((val as { toString(): string }).toString());
  }
  return BigInt(String(val));
}

/** Extracts the base G… Ed25519 account id from a MuxedAccount XDR value. */
function muxedAccountToGAddress(muxed: xdr.MuxedAccount): string {
  const sw = muxed.switch().name;
  if (sw === 'keyTypeMuxedEd25519') {
    return StrKey.encodeEd25519PublicKey(muxed.med25519().ed25519());
  }
  return StrKey.encodeEd25519PublicKey(muxed.ed25519());
}

function sorobanResourceFeeFromTx(tx: xdr.Transaction): bigint {
  try {
    const ext = tx.ext();
    if (ext.switch() === 1) {
      return toBigInt(ext.sorobanData().resourceFee());
    }
  } catch {
    // Non-Soroban transaction
  }
  return 0n;
}

function parseEnvelopeFields(envelopeXdr: string): {
  envelopeFeeBumped: boolean;
  payer: string;
  innerSource: string;
  declaredFee: bigint;
  declaredResourceFee: bigint;
} {
  const env = xdr.TransactionEnvelope.fromXDR(envelopeXdr, 'base64');
  const sw = env.switch().name;
  if (sw === 'envelopeTypeTxFeeBump') {
    const bumpTx = env.feeBump().tx();
    const payer = muxedAccountToGAddress(bumpTx.feeSource());
    const declaredFee = toBigInt(bumpTx.fee());
    const innerTx = bumpTx.innerTx().v1().tx();
    const innerSource = muxedAccountToGAddress(innerTx.sourceAccount());
    const declaredResourceFee = sorobanResourceFeeFromTx(innerTx);
    return { envelopeFeeBumped: true, payer, innerSource, declaredFee, declaredResourceFee };
  }
  if (sw === 'envelopeTypeTxV0') {
    const txV0 = env.v0().tx();
    const innerSource = StrKey.encodeEd25519PublicKey(txV0.sourceAccountEd25519());
    return {
      envelopeFeeBumped: false,
      payer: innerSource,
      innerSource,
      declaredFee: toBigInt(txV0.fee()),
      declaredResourceFee: 0n,
    };
  }
  const innerTx = env.v1().tx();
  const innerSource = muxedAccountToGAddress(innerTx.sourceAccount());
  const declaredFee = toBigInt(innerTx.fee());
  const declaredResourceFee = sorobanResourceFeeFromTx(innerTx);
  return { envelopeFeeBumped: false, payer: innerSource, innerSource, declaredFee, declaredResourceFee };
}

function parseTransactionResult(
  raw: xdr.TransactionResult | string | undefined,
): xdr.TransactionResult {
  if (!raw) throw new Error('getTransaction response missing resultXdr');
  if (typeof raw === 'string') {
    return xdr.TransactionResult.fromXDR(raw, 'base64');
  }
  return raw;
}

function parseSorobanFeeExt(rawMeta: xdr.TransactionMeta | string | undefined): {
  metaVersion: number;
  nonRefundableResourceCharged: bigint | null;
  refundableResourceCharged: bigint | null;
  rentCharged: bigint | null;
} {
  if (!rawMeta) {
    return {
      metaVersion: 0,
      nonRefundableResourceCharged: null,
      refundableResourceCharged: null,
      rentCharged: null,
    };
  }
  const meta = typeof rawMeta === 'string' ? xdr.TransactionMeta.fromXDR(rawMeta, 'base64') : rawMeta;
  const metaVersion = typeof meta.switch === 'function' ? Number(meta.switch()) : 0;

  let sorobanMeta: { ext?: () => { switch(): number; v1(): {
    totalNonRefundableResourceFeeCharged(): unknown;
    totalRefundableResourceFeeCharged(): unknown;
    rentFeeCharged(): unknown;
  } } } | null = null;

  try {
    if (metaVersion === 3 && typeof meta.v3 === 'function') {
      sorobanMeta = (meta.v3().sorobanMeta?.() ?? null) as typeof sorobanMeta;
    } else if (metaVersion === 4 && typeof meta.v4 === 'function') {
      sorobanMeta = (meta.v4().sorobanMeta?.() ?? null) as typeof sorobanMeta;
    }
  } catch {
    sorobanMeta = null;
  }

  if (sorobanMeta && typeof sorobanMeta.ext === 'function') {
    try {
      const ext = sorobanMeta.ext();
      if (ext && typeof ext.switch === 'function' && ext.switch() === 1) {
        const v1 = ext.v1();
        return {
          metaVersion,
          nonRefundableResourceCharged: toBigInt(v1.totalNonRefundableResourceFeeCharged()),
          refundableResourceCharged: toBigInt(v1.totalRefundableResourceFeeCharged()),
          rentCharged: toBigInt(v1.rentFeeCharged()),
        };
      }
    } catch {
      // Extension absent or unreadable; return nulls so callers distinguish unknown from zero.
    }
  }

  return {
    metaVersion,
    nonRefundableResourceCharged: null,
    refundableResourceCharged: null,
    rentCharged: null,
  };
}

/**
 * Decodes a full `FeeReceipt` from a terminal `getTransaction` response
 * (SUCCESS or FAILED) and the base64 XDR of the landed transaction envelope.
 */
export function feeReceiptFrom(
  resp: rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse,
  envelopeXdr: string,
  landedHashOverride?: string,
): FeeReceipt {
  const anyResp = resp as unknown as {
    status: string;
    txHash?: string;
    ledger?: number;
    resultXdr?: xdr.TransactionResult | string;
    resultMetaXdr?: xdr.TransactionMeta | string;
  };

  const result = parseTransactionResult(anyResp.resultXdr);
  const feeCharged = toBigInt(result.feeCharged());

  const resultSwitch = result.result().switch().name;
  const resultIsFeeBump =
    resultSwitch === 'txFeeBumpInnerSuccess' || resultSwitch === 'txFeeBumpInnerFailed';

  let innerFeeCharged: bigint | null = null;
  if (resultIsFeeBump) {
    innerFeeCharged = toBigInt(result.result().innerResultPair().result().feeCharged());
  }

  const envInfo = parseEnvelopeFields(envelopeXdr);
  const feeBumped = resultIsFeeBump || envInfo.envelopeFeeBumped;

  const metaInfo = parseSorobanFeeExt(anyResp.resultMetaXdr);

  let landedHash = landedHashOverride ?? anyResp.txHash ?? '';
  if (!landedHash) {
    try {
      const parsed = TransactionBuilder.fromXDR(envelopeXdr, config.STELLAR_NETWORK_PASSPHRASE);
      landedHash = parsed.hash().toString('hex');
    } catch {
      landedHash = '';
    }
  }

  return {
    landedHash,
    feeBumped,
    payer: envInfo.payer,
    innerSource: envInfo.innerSource,
    feeCharged,
    innerFeeCharged,
    nonRefundableResourceCharged: metaInfo.nonRefundableResourceCharged,
    refundableResourceCharged: metaInfo.refundableResourceCharged,
    rentCharged: metaInfo.rentCharged,
    declaredFee: envInfo.declaredFee,
    declaredResourceFee: envInfo.declaredResourceFee,
    ledger: typeof anyResp.ledger === 'number' ? anyResp.ledger : 0,
    success: anyResp.status === 'SUCCESS',
    metaVersion: metaInfo.metaVersion,
  };
}

/**
 * Inclusion fee actually charged = feeCharged − (nonRefundable + refundable + rent)
 * when all Soroban resource components are known; null otherwise.
 */
export function inclusionChargedOf(receipt: Pick<
  FeeReceipt,
  'feeCharged' | 'nonRefundableResourceCharged' | 'refundableResourceCharged' | 'rentCharged'
>): bigint | null {
  if (
    receipt.nonRefundableResourceCharged === null ||
    receipt.refundableResourceCharged === null ||
    receipt.rentCharged === null
  ) {
    return null;
  }
  return (
    receipt.feeCharged -
    (receipt.nonRefundableResourceCharged +
      receipt.refundableResourceCharged +
      receipt.rentCharged)
  );
}

/**
 * Soroban resource fee refunded = declaredResourceFee − (nonRefundable + refundable)
 * when both components are known; null otherwise.
 */
export function refundedResourceOf(receipt: Pick<
  FeeReceipt,
  'declaredResourceFee' | 'nonRefundableResourceCharged' | 'refundableResourceCharged'
>): bigint | null {
  if (
    receipt.nonRefundableResourceCharged === null ||
    receipt.refundableResourceCharged === null
  ) {
    return null;
  }
  return (
    receipt.declaredResourceFee -
    (receipt.nonRefundableResourceCharged + receipt.refundableResourceCharged)
  );
}

/** Picks the landed envelope XDR for `landedHash` (outer bump envelope when bumped, else inner). */
export function envelopeForLandedHash(row: FeeReceiptRowInput, landedHash?: string | null): string | null {
  if (landedHash && row.hash && landedHash !== row.hash && Array.isArray(row.feeBumpEnvelopes)) {
    const match = (row.feeBumpEnvelopes as Array<{ hash?: string; xdr?: string }>).find(
      (b) => b?.hash === landedHash && typeof b.xdr === 'string',
    );
    if (match?.xdr) return match.xdr;
  }
  return row.envelopeXdr ?? null;
}

/** Infers OperationClass from an outbox row when `opClass` is not yet populated. */
export function inferOpClass(row: Pick<FeeReceiptRowInput, 'opClass' | 'kind'>): OperationClass {
  if (
    row.opClass === 'market_create' ||
    row.opClass === 'trade' ||
    row.opClass === 'trace_publish' ||
    row.opClass === 'maintenance'
  ) {
    return row.opClass;
  }
  const kind = row.kind ?? '';
  if (kind === 'market.create' || kind === 'market') return 'market_create';
  if (kind.startsWith('trade')) return 'trade';
  if (kind === 'trace.publish' || kind === 'trace') return 'trace_publish';
  return 'maintenance';
}

/** Reconstructs the FeeEstimate from an outbox row's stored innerFee and resourceFee. */
export function estimateFromRow(row: Pick<FeeReceiptRowInput, 'innerFee' | 'resourceFee'>): FeeEstimate {
  const inclusionFee = row.innerFee ? BigInt(row.innerFee) : 0n;
  const resourceFee = row.resourceFee ? BigInt(row.resourceFee) : 0n;
  return { inclusionFee, resourceFee, totalFee: inclusionFee + resourceFee };
}

/** Serializes a `getTransaction` response's `resultXdr` to base64 when available. */
export function serializeResultXdr(resp: unknown): string | null {
  const raw = (resp as { resultXdr?: string | { toXDR?(enc: string): string } } | null)?.resultXdr;
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw.toXDR === 'function') {
    try {
      return raw.toXDR('base64');
    } catch {
      return null;
    }
  }
  return null;
}

interface ChainFeeDb {
  findUnique(args: unknown): Promise<{ txHash: string; source?: string } | null>;
  upsert(args: unknown): Promise<unknown>;
}

function chainFeeDb(db: typeof defaultPrisma): ChainFeeDb {
  return (db as unknown as { chainFee: ChainFeeDb }).chainFee;
}

/**
 * Decodes and upserts the fee receipt for a landed transaction (SUCCESS or FAILED)
 * keyed by the inner hash (the outbox identity), with `source = 'RECEIPT'`.
 *
 * - Idempotent per landed hash.
 * - Never overwrites a `RECEIPT` row with an `ESTIMATE`.
 * - Logs and counts errors without ever throwing into the write/recovery path.
 */
export async function recordFeeReceipt(
  row: FeeReceiptRowInput,
  opClass: OperationClass,
  estimate: FeeEstimate,
  resp: rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse | unknown,
  opts: { landedHash?: string | null; envelopeXdr?: string | null; prisma?: typeof defaultPrisma } = {},
): Promise<FeeReceipt | null> {
  const db = opts.prisma ?? defaultPrisma;
  const anyResp = resp as {
    status?: string;
    txHash?: string;
    ledger?: number;
    resultXdr?: xdr.TransactionResult | string;
    envelopeXdr?: xdr.TransactionEnvelope | string;
  } | null;

  const landedHash = opts.landedHash ?? anyResp?.txHash ?? row.hash ?? null;
  const innerHash = row.hash ?? landedHash;
  if (!innerHash) {
    metrics.errors++;
    logger.warn({ outboxId: row.id, opClass }, 'fee receipt: missing transaction hash; skipping');
    return null;
  }

  let envXdr = opts.envelopeXdr ?? envelopeForLandedHash(row, landedHash);
  if (!envXdr && anyResp?.envelopeXdr) {
    envXdr =
      typeof anyResp.envelopeXdr === 'string'
        ? anyResp.envelopeXdr
        : typeof (anyResp.envelopeXdr as { toXDR?(enc: string): string }).toXDR === 'function'
          ? (anyResp.envelopeXdr as { toXDR(enc: string): string }).toXDR('base64')
          : null;
  }

  try {
    if (anyResp?.resultXdr && envXdr) {
      const receipt = feeReceiptFrom(
        resp as rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse,
        envXdr,
        landedHash ?? undefined,
      );

      const receiptFields = {
        outboxId: row.id ?? null,
        landedHash: receipt.landedHash || landedHash || innerHash,
        payer: receipt.payer,
        feeBumped: receipt.feeBumped,
        success: receipt.success,
        feeCharged: receipt.feeCharged,
        innerFeeCharged: receipt.innerFeeCharged,
        nonRefundableCharged: receipt.nonRefundableResourceCharged,
        refundableCharged: receipt.refundableResourceCharged,
        rentCharged: receipt.rentCharged,
        declaredFee: receipt.declaredFee,
        ledger: receipt.ledger || null,
        source: 'RECEIPT',
      };

      await chainFeeDb(db).upsert({
        where: { txHash: innerHash },
        create: {
          txHash: innerHash,
          opClass,
          inclusionFee: estimate.inclusionFee,
          resourceFee: estimate.resourceFee || receipt.declaredResourceFee,
          totalFee: estimate.totalFee || receipt.declaredFee,
          ...receiptFields,
        },
        update: receiptFields,
      });

      metrics.recorded++;
      return receipt;
    }

    // Fallback when resultXdr/envelopeXdr is unavailable (e.g. legacy mock RPC response):
    // record an ESTIMATE only if no RECEIPT exists yet; never overwrite a RECEIPT.
    const existing = await chainFeeDb(db).findUnique({ where: { txHash: innerHash } });
    if (existing?.source === 'RECEIPT') {
      return null;
    }
    const fallbackCharged = estimate.totalFee;
    await chainFeeDb(db).upsert({
      where: { txHash: innerHash },
      create: {
        txHash: innerHash,
        opClass,
        inclusionFee: estimate.inclusionFee,
        resourceFee: estimate.resourceFee,
        totalFee: estimate.totalFee,
        feeCharged: fallbackCharged,
        outboxId: row.id ?? null,
        landedHash: landedHash ?? innerHash,
        payer: row.source ?? null,
        feeBumped: Boolean(landedHash && row.hash && landedHash !== row.hash),
        success: anyResp?.status ? anyResp.status === 'SUCCESS' : null,
        ledger: typeof anyResp?.ledger === 'number' ? anyResp.ledger : null,
        source: 'ESTIMATE',
      },
      update: {
        feeCharged: fallbackCharged,
        outboxId: row.id ?? null,
        landedHash: landedHash ?? innerHash,
        success: anyResp?.status ? anyResp.status === 'SUCCESS' : null,
      },
    });
    return null;
  } catch (err) {
    metrics.errors++;
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        txHash: innerHash,
        landedHash,
        outboxId: row.id,
        opClass,
      },
      'fee receipt: failed to decode or persist receipt',
    );
    return null;
  }
}
