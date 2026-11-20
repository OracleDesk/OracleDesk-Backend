import { CopyTradeStatus, Prisma } from '@prisma/client';
import { Address, rpc } from '@stellar/stellar-sdk';
import { prisma as defaultPrisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { CONTRACTS } from '../config/contracts';
import { priceBpsFromRaw, toDisplayUsdc } from '../lib/amounts';
import { AppError } from '../middlewares/error.middleware';
import { withTimeout, TimeoutError } from '../lib/resilience';
import {
  innerTransaction,
  readContractEvents,
  getTransactionReader,
  TransactionReader,
} from './stellar/tx-inspect';
import type { DecodedEvent } from './indexer.service';
import { notifyUser } from '../lib/socket-auth';

export { CopyTradeStatus };

/**
 * The guarded transition below is the sole post-write notification point for
 * COPY_TRADE_CONFIRMED.
 */
export function notifyCopyTradeConfirmed(
  copyTrade: { id: string; userId?: string | null; txHash?: string | null; status: string },
  verified: boolean,
): void {
  if (!copyTrade.userId) return;
  notifyUser(copyTrade.userId, 'COPY_TRADE_CONFIRMED', {
    copyTradeId: copyTrade.id,
    txHash: copyTrade.txHash ?? null,
    status: copyTrade.status,
    verified,
  });
}

export class CopyTradePendingError extends AppError {
  constructor(message = 'Transaction not confirmed on-chain yet') {
    super(202, 'COPY_TRADE_PENDING', message, { retryAfterSeconds: 5 });
  }
}

export interface VerifiedCopyTrade {
  txHash: string;
  ledger: number;
  trader: string;
  onChainMarketId: bigint;
  outcome: 'Yes' | 'No';
  collateral: bigint;
  shares: bigint;
  fee: bigint;
  eventId: string | null;
}

export interface ExpectedCopyTrade {
  txHash: string;
  trader: string;
  onChainMarketId: bigint;
  outcome: 'Yes' | 'No';
  maxCollateral: bigint;
}

export interface CopyTradeEventEvidence {
  id?: string | null;
  contractId: string;
  name: string;
  data: Record<string, unknown>;
}

export interface CopyTradeEvidence {
  txHash: string;
  ledger: number;
  eventId?: string | null;
  events: readonly CopyTradeEventEvidence[];
}

function parseOutcome(o: unknown): 'Yes' | 'No' | null {
  if (o === 'Yes' || o === 'No') return o;
  if (o && typeof o === 'object' && 'tag' in o) {
    const tag = (o as { tag?: unknown }).tag;
    if (tag === 'Yes' || tag === 'No') return tag;
  }
  return null;
}

function normalizeAddress(addr: unknown): string | null {
  if (typeof addr !== 'string') return null;
  try {
    return Address.fromString(addr).toString();
  } catch {
    return null;
  }
}

function copyTradeError(code: string, message: string): AppError {
  return new AppError(422, code, message);
}

/**
 * Applies the same rules to an indexed event and an event decoded from RPC.
 */
export function verifyCopyTradeEvidence(
  expected: ExpectedCopyTrade,
  evidence: CopyTradeEvidence,
): VerifiedCopyTrade {
  const txHash = expected.txHash.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txHash) || evidence.txHash.toLowerCase() !== txHash) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid copy-trade transaction hash');
  }

  const tradeEvents = evidence.events.filter(
    (event) =>
      (event.name === 'Trade' || event.name === 'trade') &&
      event.contractId.toLowerCase() === CONTRACTS.marketCore.toLowerCase(),
  );
  if (tradeEvents.length === 0) {
    throw copyTradeError('COPY_TRADE_NO_TRADE_EVENT', 'Transaction did not emit a Trade event');
  }

  const marketEvents = tradeEvents.filter((event) => {
    try {
      return BigInt(String(event.data.market_id)) === expected.onChainMarketId;
    } catch {
      return false;
    }
  });
  if (marketEvents.length === 0) {
    throw copyTradeError('COPY_TRADE_WRONG_MARKET', 'Trade was executed on a different market');
  }

  const expectedTrader = normalizeAddress(expected.trader);
  if (!expectedTrader) {
    throw copyTradeError('COPY_TRADE_WRONG_TRADER', 'Expected wallet address is invalid');
  }
  const traderEvents = marketEvents.filter(
    (event) => normalizeAddress(event.data.trader) === expectedTrader,
  );
  if (traderEvents.length === 0) {
    throw copyTradeError('COPY_TRADE_WRONG_TRADER', 'Trade was executed by a different wallet');
  }

  const buyEvents = traderEvents.filter((event) => event.data.is_buy === true);
  if (buyEvents.length === 0) {
    throw copyTradeError('COPY_TRADE_NOT_A_BUY', 'Trade was a sell, not a buy');
  }

  const sideEvents = buyEvents.filter((event) => parseOutcome(event.data.outcome) === expected.outcome);
  if (sideEvents.length === 0) {
    throw copyTradeError('COPY_TRADE_WRONG_SIDE', 'Trade outcome does not match requested outcome');
  }
  if (sideEvents.length > 1) {
    throw copyTradeError(
      'COPY_TRADE_AMBIGUOUS_EVENTS',
      'Transaction contains multiple matching Trade events for user',
    );
  }

  const matched = sideEvents[0];
  let collateral: bigint;
  let shares: bigint;
  let fee: bigint;
  try {
    collateral = BigInt(String(matched.data.collateral));
    shares = BigInt(String(matched.data.shares));
    fee = BigInt(String(matched.data.fee ?? 0));
  } catch {
    throw copyTradeError('COPY_TRADE_INVALID_EVENT', 'Trade event contains invalid numeric values');
  }
  if (collateral < 0n || shares < 0n || fee < 0n) {
    throw copyTradeError('COPY_TRADE_INVALID_EVENT', 'Trade event contains negative values');
  }
  if (collateral > expected.maxCollateral) {
    throw copyTradeError(
      'COPY_TRADE_AMOUNT_EXCEEDED',
      `Executed collateral (${collateral}) exceeds maximum approved amount (${expected.maxCollateral})`,
    );
  }

  return {
    txHash,
    ledger: evidence.ledger,
    trader: expected.trader,
    onChainMarketId: expected.onChainMarketId,
    outcome: expected.outcome,
    collateral,
    shares,
    fee,
    eventId: matched.id ?? evidence.eventId ?? null,
  };
}

/**
 * Verifies a copy-trade transaction against on-chain status, contract events, and envelope.
 */
export async function verifyCopyTradeTx(
  expected: ExpectedCopyTrade,
  customReader?: TransactionReader,
  signal?: AbortSignal,
): Promise<VerifiedCopyTrade> {
  const txHash = expected.txHash.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(txHash)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'txHash must be a 64-character lowercase hex string');
  }

  const reader = customReader ?? getTransactionReader();
  let response: rpc.Api.GetTransactionResponse;

  try {
    response = await withTimeout(
      'rpc-read',
      async () => reader.getTransaction(txHash),
      { signal },
    );
  } catch (err: any) {
    if (err instanceof TimeoutError || err?.code === 'UPSTREAM_TIMEOUT') {
      throw new AppError(502, 'CHAIN_READ_FAILED', 'Stellar RPC read timed out', { timeout: true });
    }
    throw new AppError(502, 'CHAIN_READ_FAILED', 'Could not reach Stellar RPC to verify copy trade', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  if (response.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    throw new CopyTradePendingError();
  }

  if (response.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new AppError(422, 'COPY_TRADE_TX_FAILED', 'Transaction failed on-chain');
  }

  // Primary verification evidence: Contract Events
  const parsedEvents = readContractEvents(response);
  const verified = verifyCopyTradeEvidence(expected, {
    txHash,
    ledger: response.ledger,
    events: parsedEvents,
  });

  // Defence-in-depth: check transaction envelope if present
  if (response.envelopeXdr) {
    try {
      const tx = innerTransaction(response.envelopeXdr);
      const ops = tx.operations();
      if (ops.length === 1) {
        const op = ops[0].body();
        if (op.switch().name === 'invokeHostFunction') {
          const hf = op.invokeHostFunctionOp().hostFunction();
          if (hf.switch().name === 'hostFunctionTypeInvokeContract') {
            const call = hf.invokeContract();
            const calledContract = Address.fromScAddress(call.contractAddress()).toString();
            const fnName = call.functionName().toString();

            // If direct call to marketCore.buy, check trader argument
            if (
              calledContract.toLowerCase() === CONTRACTS.marketCore.toLowerCase() &&
              fnName === 'buy'
            ) {
              const args = call.args();
              if (args.length > 0) {
                const traderArg = Address.fromScVal(args[0]).toString();
                if (normalizeAddress(traderArg) !== normalizeAddress(expected.trader)) {
                  throw new AppError(
                    422,
                    'COPY_TRADE_WRONG_TRADER',
                    'Direct contract invocation trader does not match wallet',
                  );
                }
              }
            }
            // Smart wallet routing (e.g. C... account or account proxy):
            // envelope check skipped; event authorization check above is authoritative.
          }
        }
      }
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      // Other envelope parsing issues do not reject if event was valid
    }
  }

  return verified;
}

export async function transitionCopyTrade(
  prisma: typeof defaultPrisma,
  copyTrade: { id: string; userId: string | null },
  txHash: string,
  data: Prisma.CopyTradeUpdateManyMutationInput,
  options: {
    allowedStatuses?: CopyTradeStatus[];
    audit?: {
      fromStatus: CopyTradeStatus;
      chainEventId: string;
      reason: string;
    };
  } = {},
): Promise<Prisma.CopyTradeGetPayload<{}> | null> {
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.copyTrade.updateMany({
      where: {
        id: copyTrade.id,
        status: { in: options.allowedStatuses ?? [CopyTradeStatus.PENDING, CopyTradeStatus.CONFIRMING] },
        OR: [{ txHash: null }, { txHash }],
      },
      data: { ...data, txHash },
    });
    if (count !== 1) return null;

    if (options.audit) {
      if (data.status !== CopyTradeStatus.EXECUTED) {
        throw new Error('Copy-trade audit records require an EXECUTED transition');
      }
      await tx.copyTradeAudit.create({
        data: {
          copyTradeId: copyTrade.id,
          fromStatus: options.audit.fromStatus,
          toStatus: CopyTradeStatus.EXECUTED,
          txHash,
          chainEventId: options.audit.chainEventId,
          reason: options.audit.reason,
        },
      });
    }

    return tx.copyTrade.findUnique({ where: { id: copyTrade.id } });
  });
  if (!updated) return null;

  if (data.status === CopyTradeStatus.EXECUTED) {
    notifyCopyTradeConfirmed({
      id: copyTrade.id,
      userId: copyTrade.userId,
      txHash,
      status: CopyTradeStatus.EXECUTED,
    }, true);
  }
  return updated;
}

/**
 * Confirms a copy trade on-chain.
 * Updates state to EXECUTED on success, or CONFIRMING if still pending.
 */
export async function confirmCopyTrade(
  userId: string,
  wallet: string,
  copyTradeId: string,
  txHashRaw: string,
  prisma = defaultPrisma,
): Promise<any> {
  const txHash = txHashRaw.toLowerCase();

  const copyTrade = await prisma.copyTrade.findFirst({
    where: {
      id: copyTradeId,
      userId,
    },
    include: {
      market: { select: { onChainMarketId: true } },
    },
  });

  if (!copyTrade) {
    throw new AppError(404, 'COPY_TRADE_NOT_FOUND', 'Copy trade not found');
  }
  const storedWallet = normalizeAddress(copyTrade.followerWallet);
  const requestWallet = normalizeAddress(wallet);
  if (!storedWallet || !requestWallet || storedWallet !== requestWallet) {
    throw new AppError(404, 'COPY_TRADE_NOT_FOUND', 'Copy trade not found');
  }

  // Idempotent return if already executed with identical txHash
  if (copyTrade.status === CopyTradeStatus.EXECUTED) {
    if (copyTrade.txHash?.toLowerCase() === txHash) {
      return copyTrade;
    }
    throw new AppError(
      409,
      'COPY_TRADE_ALREADY_CONFIRMED',
      'Copy trade is already confirmed with another transaction',
    );
  }

  if (
    copyTrade.status !== CopyTradeStatus.PENDING &&
    copyTrade.status !== CopyTradeStatus.CONFIRMING
  ) {
    throw new AppError(
      400,
      'COPY_TRADE_INVALID_STATE',
      `Cannot confirm copy trade in ${copyTrade.status} status`,
    );
  }

  // Check if txHash has already been consumed by another copy trade
  const duplicate = await prisma.copyTrade.findFirst({
    where: {
      txHash,
      id: { not: copyTradeId },
    },
  });
  if (duplicate) {
    throw new AppError(
      409,
      'COPY_TRADE_TX_ALREADY_USED',
      'This transaction has already confirmed another copy trade',
    );
  }

  if (copyTrade.market?.onChainMarketId == null) {
    throw new AppError(400, 'MARKET_NOT_ON_CHAIN', 'Market is not active on-chain');
  }

  const expectedOutcome: 'Yes' | 'No' = copyTrade.direction === 'YES' ? 'Yes' : 'No';
  const maxCollateral = BigInt(copyTrade.amountRaw ?? '0');

  try {
    const verified = await verifyCopyTradeTx({
      txHash,
      trader: copyTrade.followerWallet,
      onChainMarketId: copyTrade.market.onChainMarketId,
      outcome: expectedOutcome,
      maxCollateral,
    });

    const updated = await transitionCopyTrade(prisma, copyTrade, txHash, {
      status: CopyTradeStatus.EXECUTED,
      collateralRaw: verified.collateral.toString(),
      sharesRaw: verified.shares.toString(),
      feeRaw: verified.fee.toString(),
      priceBps: priceBpsFromRaw(verified.collateral, verified.shares),
      ledger: verified.ledger,
      chainEventId: verified.eventId,
      confirmedAt: new Date(),
      amount: toDisplayUsdc(verified.collateral),
      failureCode: null,
    });
    if (!updated) {
      const current = await prisma.copyTrade.findUnique({ where: { id: copyTradeId } });
      if (current?.status === CopyTradeStatus.EXECUTED && current.txHash?.toLowerCase() === txHash) {
        return current;
      }
      throw new AppError(409, 'COPY_TRADE_STATE_CHANGED', 'Copy trade changed while it was being verified');
    }
    return updated;
  } catch (err: any) {
    if (err instanceof CopyTradePendingError) {
      // Mark as CONFIRMING
      const transitioned = await transitionCopyTrade(prisma, copyTrade, txHash, {
        status: CopyTradeStatus.CONFIRMING,
        verificationAttempts: { increment: 1 },
      });
      if (!transitioned) {
        const current = await prisma.copyTrade.findUnique({ where: { id: copyTradeId } });
        if (current?.status === CopyTradeStatus.EXECUTED && current.txHash?.toLowerCase() === txHash) {
          return current;
        }
      }
      throw err;
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(
        409,
        'COPY_TRADE_TX_ALREADY_USED',
        'This transaction has already confirmed another copy trade',
      );
    }

    // Definitive validation errors -> mark FAILED
    if (err instanceof AppError && err.statusCode === 422) {
      const failed = await transitionCopyTrade(prisma, copyTrade, txHash, {
        status: CopyTradeStatus.FAILED,
        failureCode: err.code,
      });
      if (!failed) {
        const current = await prisma.copyTrade.findUnique({ where: { id: copyTradeId } });
        if (current?.status === CopyTradeStatus.EXECUTED && current.txHash?.toLowerCase() === txHash) {
          return current;
        }
      }
    }

    throw err;
  }
}

/**
 * Records an ambiguity instead of assigning evidence to an indistinguishable intent.
 */
async function reportCopyTradeAmbiguity(
  event: DecodedEvent,
  candidateCopyTradeIds: string[],
  reason: string,
  prisma: typeof defaultPrisma,
): Promise<void> {
  const candidates = [...new Set(candidateCopyTradeIds)].sort();
  await prisma.copyTradeAmbiguity.upsert({
    where: { chainEventId: event.id },
    create: {
      chainEventId: event.id,
      txHash: event.txHash.toLowerCase(),
      candidateCopyTradeIds: candidates as Prisma.InputJsonValue,
      reason,
    },
    update: {
      candidateCopyTradeIds: candidates as Prisma.InputJsonValue,
      reason,
    },
  });
  logger.warn(
    { eventId: event.id, txHash: event.txHash, candidateCopyTradeIds: candidates, reason },
    'Copy-trade event could not be assigned unambiguously',
  );
}

/**
 * Reconciles an indexed buy against an explicit tx hash or the oldest uniquely
 * identifiable intent with no submitted hash.
 */
export async function reconcileFromTradeEvent(
  event: DecodedEvent,
  prisma = defaultPrisma,
): Promise<'confirmed' | 'failed' | 'ambiguous' | 'ignored'> {
  const p = event.params;
  if (p.is_buy !== true) return 'ignored';

  const txHash = event.txHash.toLowerCase();
  let copyTrade = await prisma.copyTrade.findFirst({
    where: {
      txHash,
      status: { in: [CopyTradeStatus.PENDING, CopyTradeStatus.CONFIRMING, CopyTradeStatus.EXPIRED] },
    },
    include: { market: { select: { onChainMarketId: true } } },
  });

  if (!copyTrade) {
    const alreadyConsumed = await prisma.copyTrade.findFirst({ where: { txHash } });
    if (alreadyConsumed) return 'ignored';

    const trader = normalizeAddress(p.trader);
    const outcome = parseOutcome(p.outcome);
    let onChainMarketId: bigint;
    let collateral: bigint;
    try {
      onChainMarketId = BigInt(p.market_id);
      collateral = BigInt(p.collateral);
    } catch {
      return 'ignored';
    }
    if (!trader || !outcome || collateral < 0n) return 'ignored';

    const createdBeforeEvent = new Date(event.ledgerClosedAt);
    const candidates = await prisma.copyTrade.findMany({
      where: {
        followerWallet: trader,
        direction: outcome === 'Yes' ? 'YES' : 'NO',
        status: { in: [CopyTradeStatus.PENDING, CopyTradeStatus.EXPIRED] },
        txHash: null,
        createdAt: { lte: createdBeforeEvent },
        market: { onChainMarketId },
      },
      include: { market: { select: { onChainMarketId: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const eligible = candidates.flatMap((candidate) => {
      const wallet = normalizeAddress(candidate.followerWallet);
      const approved = BigInt(candidate.amountRaw ?? '0');
      if (
        wallet !== trader ||
        candidate.market?.onChainMarketId !== onChainMarketId ||
        approved < collateral
      ) {
        return [];
      }
      return [{ copyTrade: candidate, slack: approved - collateral }];
    });
    if (eligible.length === 0) return 'ignored';

    eligible.sort((a, b) =>
      (a.slack < b.slack ? -1 : a.slack > b.slack ? 1 : 0) ||
      a.copyTrade.createdAt.getTime() - b.copyTrade.createdAt.getTime() ||
      a.copyTrade.id.localeCompare(b.copyTrade.id),
    );
    const best = eligible[0];
    const tied = eligible.filter(
      (candidate) =>
        candidate.slack === best.slack &&
        candidate.copyTrade.createdAt.getTime() === best.copyTrade.createdAt.getTime(),
    );
    if (tied.length > 1) {
      await reportCopyTradeAmbiguity(
        event,
        tied.map(({ copyTrade: candidate }) => candidate.id),
        'COPY_TRADE_INTENT_AMBIGUOUS',
        prisma,
      );
      return 'ambiguous';
    }
    copyTrade = best.copyTrade;
  }

  if (copyTrade.market?.onChainMarketId == null) {
    return 'ignored';
  }
  const outcome: 'Yes' | 'No' = copyTrade.direction === 'YES' ? 'Yes' : 'No';
  const expected: ExpectedCopyTrade = {
    txHash,
    trader: copyTrade.followerWallet,
    onChainMarketId: copyTrade.market.onChainMarketId,
    outcome,
    maxCollateral: BigInt(copyTrade.amountRaw ?? '0'),
  };
  let eventVerified: VerifiedCopyTrade | null = null;
  try {
    eventVerified = verifyCopyTradeEvidence(
      expected,
      {
        txHash,
        ledger: event.ledger,
        eventId: event.id,
        events: [{
          id: event.id,
          contractId: event.contractId,
          name: event.eventName,
          data: p,
        }],
      },
    );
  } catch (err) {
    if (!(err instanceof AppError) || err.statusCode !== 422) throw err;
    if (copyTrade.txHash == null) return 'ignored';
  }

  let verified: VerifiedCopyTrade;
  try {
    // The indexed event may be only one of several Trade events in this
    // transaction; RPC supplies the complete set for ambiguity checks.
    verified = await verifyCopyTradeTx(expected);
  } catch (err) {
    if (!(err instanceof AppError) || err.statusCode !== 422) throw err;
    if (err.code === 'COPY_TRADE_AMBIGUOUS_EVENTS' && copyTrade.txHash == null) {
      await reportCopyTradeAmbiguity(event, [copyTrade.id], err.code, prisma);
      return 'ambiguous';
    }
    if (copyTrade.status === CopyTradeStatus.EXPIRED) {
      logger.warn(
        { copyTradeId: copyTrade.id, txHash, failureCode: err.code },
        'Late on-chain event did not verify for expired copy trade',
      );
      return 'ignored';
    }
    const failed = await transitionCopyTrade(prisma, copyTrade, txHash, {
      status: CopyTradeStatus.FAILED,
      failureCode: err.code,
    }, { allowedStatuses: [copyTrade.status] });
    if (failed) {
      logger.warn({ copyTradeId: copyTrade.id, txHash, failureCode: err.code }, 'Indexed transaction failed copy-trade verification');
      return 'failed';
    }
    return 'ignored';
  }

  const isLateEvidence =
    copyTrade.status === CopyTradeStatus.EXPIRED ||
    (copyTrade.expiresAt !== null &&
      new Date(event.ledgerClosedAt).getTime() > copyTrade.expiresAt.getTime());
  const confirmed = await transitionCopyTrade(prisma, copyTrade, txHash, {
    status: CopyTradeStatus.EXECUTED,
    collateralRaw: verified.collateral.toString(),
    sharesRaw: verified.shares.toString(),
    feeRaw: verified.fee.toString(),
    priceBps: priceBpsFromRaw(verified.collateral, verified.shares),
    ledger: verified.ledger,
    chainEventId: eventVerified?.eventId ?? verified.eventId,
    confirmedAt: new Date(event.ledgerClosedAt),
    amount: toDisplayUsdc(verified.collateral),
    failureCode: null,
  }, {
    allowedStatuses: [copyTrade.status],
    ...(isLateEvidence
      ? {
          audit: {
            fromStatus: copyTrade.status,
            chainEventId: event.id,
            reason: copyTrade.status === CopyTradeStatus.EXPIRED
              ? 'EXPIRED_INTENT_REVERIFIED'
              : 'LATE_CHAIN_EVIDENCE',
          },
        }
      : {}),
  });
  if (!confirmed) return 'ignored';

  logger.info({ copyTradeId: copyTrade.id, txHash }, 'Reconciled copy trade from on-chain event');
  return 'confirmed';
}

/**
 * Expires pending and confirming copy trades that have passed expiresAt.
 */
export async function expireStaleCopyTrades(
  now = new Date(),
  prisma = defaultPrisma,
): Promise<number> {
  const { count } = await prisma.copyTrade.updateMany({
    where: {
      status: { in: [CopyTradeStatus.PENDING, CopyTradeStatus.CONFIRMING] },
      expiresAt: { lt: now },
    },
    data: {
      status: CopyTradeStatus.EXPIRED,
      failureCode: 'EXPIRED',
    },
  });

  if (count > 0) {
    logger.info({ count }, 'Expired stale unconfirmed copy trades');
  }
  return count;
}
