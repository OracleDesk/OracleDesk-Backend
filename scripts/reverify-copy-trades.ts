/**
 * Read-only re-verification report for previously or currently executed copy trades.
 *
 *   npm run copy-trade:reverify-report
 */
import { CopyTradeStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { verifyCopyTradeEvidence, verifyCopyTradeTx } from '../src/services/copy-trade.service';
import type { VerifiedCopyTrade } from '../src/services/copy-trade.service';

type ReverificationRow = {
  copyTradeId: string;
  txHash: string | null;
  recordedChainEventId: string | null;
  verified: boolean;
  source: 'chain_events' | 'rpc' | 'none';
  verifiedChainEventId?: string | null;
  verifiedLedger?: number;
  collateralRaw?: string;
  chainEventIdMatches?: boolean;
  ledgerMatches?: boolean;
  collateralMatches?: boolean;
  code?: string;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reportError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function createReport(): Promise<void> {
  const rows = await prisma.copyTrade.findMany({
    where: { status: { in: [CopyTradeStatus.EXECUTED, CopyTradeStatus.CONFIRMING] } },
    include: { market: { select: { onChainMarketId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const results: ReverificationRow[] = [];

  for (const copyTrade of rows) {
    let source: 'chain_events' | 'rpc' | 'none' = 'none';
    try {
      if (!copyTrade.txHash) {
        throw reportError('COPY_TRADE_MISSING_TX_HASH', 'Copy trade has no transaction hash');
      }
      if (copyTrade.market?.onChainMarketId == null) {
        throw reportError('MARKET_NOT_ON_CHAIN', 'Copy trade market has no on-chain id');
      }

      const expected = {
        txHash: copyTrade.txHash,
        trader: copyTrade.followerWallet,
        onChainMarketId: copyTrade.market.onChainMarketId,
        outcome: copyTrade.direction === 'YES' ? 'Yes' as const : 'No' as const,
        maxCollateral: BigInt(copyTrade.amountRaw ?? '0'),
      };
      const storedEvents = await prisma.chainEvent.findMany({
        where: {
          txHash: copyTrade.txHash,
          eventName: 'Trade',
          contractName: 'marketCore',
        },
        orderBy: [{ ledger: 'asc' }, { id: 'asc' }],
      });

      let verified: VerifiedCopyTrade;
      if (storedEvents.length > 0) {
        source = 'chain_events';
        if (storedEvents.some((event) => !isRecord(event.params))) {
          throw reportError('COPY_TRADE_INVALID_EVENT', 'Stored Trade event parameters are invalid');
        }
        const events = storedEvents.map((event) => ({
            id: event.id,
            contractId: event.contractId,
            name: event.eventName,
            data: event.params as Record<string, unknown>,
          }));
        verified = verifyCopyTradeEvidence(expected, {
          txHash: copyTrade.txHash,
          ledger: storedEvents[0].ledger,
          events,
        });
      } else {
        source = 'rpc';
        verified = await verifyCopyTradeTx(expected);
      }

      results.push({
        copyTradeId: copyTrade.id,
        txHash: copyTrade.txHash,
        recordedChainEventId: copyTrade.chainEventId,
        verified: true,
        source,
        verifiedChainEventId: verified.eventId,
        verifiedLedger: verified.ledger,
        collateralRaw: verified.collateral.toString(),
        chainEventIdMatches: copyTrade.chainEventId === verified.eventId,
        ledgerMatches: copyTrade.ledger === verified.ledger,
        collateralMatches: copyTrade.collateralRaw === verified.collateral.toString(),
      });
    } catch (error) {
      const err = error as { code?: string; message?: string };
      results.push({
        copyTradeId: copyTrade.id,
        txHash: copyTrade.txHash,
        recordedChainEventId: copyTrade.chainEventId,
        verified: false,
        source,
        code: err.code ?? 'COPY_TRADE_REVERIFICATION_FAILED',
        message: err.message ?? String(error),
      });
    }
  }

  const verifiedCount = results.filter((result) => result.verified).length;
  const metadataMismatchCount = results.filter((result) =>
    result.verified && (
      result.chainEventIdMatches === false ||
      result.ledgerMatches === false ||
      result.collateralMatches === false
    ),
  ).length;
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: results.length,
    verified: verifiedCount,
    notVerified: results.length - verifiedCount,
    metadataMismatches: metadataMismatchCount,
    rows: results,
  }, null, 2));
}

createReport()
  .catch((error) => {
    console.error('Could not generate copy-trade re-verification report:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
