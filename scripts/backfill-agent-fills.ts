#!/usr/bin/env node
/**
 * Backfills historic agent Trade, Position (including zero cost bases), and
 * PositionExit rows from indexed market-core `Trade` events in `chain_events` (#303).
 *
 * Usage:
 *   npx tsx scripts/backfill-agent-fills.ts
 */
import { prisma } from '../src/lib/prisma';
import { resolveAgentTradeFill } from '../src/services/agent-fill.service';
import {
  bigintToDecimalString,
  decimalToBigint,
  priceBpsFromRaw,
  toDisplayUsdc,
} from '../src/lib/amounts';

async function backfillTrades(): Promise<{ updatedTrades: number; updatedPositions: number }> {
  const trades = await prisma.trade.findMany({
    where: {
      status: 'EXECUTED',
      OR: [
        { collateralRaw: null },
        { fillLedger: null },
        { position: { costBasisRaw: '0' } },
      ],
    },
    include: {
      market: { select: { onChainMarketId: true } },
      position: { select: { id: true, costBasisRaw: true, sharesRaw: true, feesPaidRaw: true } },
    },
  });

  let updatedTrades = 0;
  let updatedPositions = 0;

  for (const trade of trades) {
    const hashes = [trade.txHash, trade.innerTxHash].filter((h): h is string => Boolean(h));
    if (hashes.length === 0) continue;

    // Also include landedHash from outbox if inner hash was stored on Trade
    const outbox = await prisma.chainTransaction.findFirst({
      where: { OR: [{ hash: { in: hashes } }, { landedHash: { in: hashes } }] },
      select: { hash: true, landedHash: true },
    });

    const fill = await resolveAgentTradeFill({
      txHashes: [outbox?.landedHash, trade.txHash, outbox?.hash, trade.innerTxHash],
      onChainMarketId: trade.market.onChainMarketId ?? undefined,
      isBuy: true,
      outcome: trade.direction === 'NO' ? 'No' : 'Yes',
    });
    if (!fill) continue;

    const fillPriceBps = priceBpsFromRaw(fill.collateral, fill.shares);
    const effectivePrice = fillPriceBps === null ? 0 : fillPriceBps / 10_000;

    await prisma.trade.update({
      where: { id: trade.id },
      data: {
        collateralRaw: bigintToDecimalString(fill.collateral),
        sharesRaw: bigintToDecimalString(fill.shares),
        feeRaw: bigintToDecimalString(fill.fee),
        reserveYesRaw: bigintToDecimalString(fill.reserveYes),
        reserveNoRaw: bigintToDecimalString(fill.reserveNo),
        fillLedger: fill.ledger,
        ...(fillPriceBps === null ? {} : { fillPriceBps }),
      },
    });
    updatedTrades++;

    if (trade.position && (trade.position.costBasisRaw == null || decimalToBigint(trade.position.costBasisRaw) === 0n)) {
      await prisma.position.update({
        where: { id: trade.position.id },
        data: {
          costBasisRaw: bigintToDecimalString(fill.collateral),
          feesPaidRaw: bigintToDecimalString(fill.fee),
          sharesRaw: trade.position.sharesRaw == null ? bigintToDecimalString(fill.shares) : undefined,
          entryPrice: effectivePrice,
          entryPriceBps: fillPriceBps,
          size: toDisplayUsdc(fill.collateral),
        },
      });
      updatedPositions++;
    }
  }

  return { updatedTrades, updatedPositions };
}

async function backfillExits(): Promise<number> {
  const exits = await prisma.positionExit.findMany({
    where: {
      status: 'CONFIRMED',
      fillLedger: null,
      txHash: { not: null },
    },
    include: {
      position: {
        select: {
          direction: true,
          market: { select: { onChainMarketId: true } },
        },
      },
    },
  });

  let updatedExits = 0;
  for (const exit of exits) {
    if (!exit.txHash) continue;
    const fill = await resolveAgentTradeFill({
      txHashes: [exit.txHash],
      onChainMarketId: exit.position.market.onChainMarketId ?? undefined,
      isBuy: false,
      outcome: exit.position.direction === 'NO' ? 'No' : 'Yes',
    });
    if (!fill) continue;

    const effectivePriceBps = priceBpsFromRaw(fill.collateral, fill.shares);
    const effectivePrice = effectivePriceBps === null ? null : effectivePriceBps / 10_000;

    await prisma.positionExit.update({
      where: { id: exit.id },
      data: {
        sharesSoldRaw: bigintToDecimalString(fill.shares),
        collateralOutRaw: bigintToDecimalString(fill.collateral),
        feeRaw: bigintToDecimalString(fill.fee),
        reserveYesRaw: bigintToDecimalString(fill.reserveYes),
        reserveNoRaw: bigintToDecimalString(fill.reserveNo),
        fillLedger: fill.ledger,
        effectivePrice,
        effectivePriceBps,
      },
    });
    updatedExits++;
  }

  return updatedExits;
}

async function main(): Promise<void> {
  const { updatedTrades, updatedPositions } = await backfillTrades();
  const updatedExits = await backfillExits();
  console.log(
    JSON.stringify({ updatedTrades, updatedPositions, updatedExits }),
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error during agent fill backfill:', err);
  process.exit(1);
});
