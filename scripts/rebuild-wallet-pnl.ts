#!/usr/bin/env node
/**
 * Rebuilds wallet PnL and trading stats from stored chain_events.
 *
 * Usage:
 *   npx tsx scripts/rebuild-wallet-pnl.ts                    # Full rebuild from scratch
 *   npx tsx scripts/rebuild-wallet-pnl.ts --market-id 0     # Rebuild single market
 */
import { prisma } from '../src/lib/prisma';
import { rebuildWalletPnl } from '../src/services/wallet-pnl.service';

async function main() {
  const mktIdx = process.argv.indexOf('--market-id');
  const marketId = mktIdx !== -1 ? BigInt(process.argv[mktIdx + 1]) : undefined;

  console.log(`Starting wallet PnL rebuild ${marketId !== undefined ? `for market ${marketId}` : 'from scratch'}...`);

  await rebuildWalletPnl({
    fromScratch: marketId === undefined,
    marketId,
  });

  console.log('Wallet PnL rebuild successfully completed.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error during rebuild:', err);
  process.exit(1);
});
