#!/usr/bin/env node
/**
 * Lists legacy plaintext reasoning traces and optionally unpins them from Pinata.
 *
 * Usage:
 *   npx tsx scripts/unpin-legacy-traces.ts             # Dry run (list only)
 *   npx tsx scripts/unpin-legacy-traces.ts --execute   # Unpin from Pinata
 *
 * NOTE: Unpinning removes the file from our Pinata pinning service.
 * Public copies may still persist on other IPFS nodes and gateways.
 */
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import axios from 'axios';

async function main() {
  const isExecute = process.argv.includes('--execute');

  console.log(`Running unpin-legacy-traces (${isExecute ? 'EXECUTE' : 'DRY-RUN'})...`);

  // Find traces with ipfsCid and no traceKeys (PLAINTEXT_LEGACY)
  const legacyTraces = await prisma.reasoningTrace.findMany({
    where: {
      ipfsCid: { not: null },
      traceKeys: null,
    },
    select: {
      id: true,
      ipfsCid: true,
      traceHash: true,
      createdAt: true,
    },
  });

  console.log(`Found ${legacyTraces.length} legacy plaintext traces.\n`);

  if (legacyTraces.length === 0) {
    console.log('No legacy traces found.');
    await prisma.$disconnect();
    return;
  }

  for (const t of legacyTraces) {
    console.log(`Trace ${t.id}: CID=${t.ipfsCid} CreatedAt=${t.createdAt.toISOString()}`);

    if (isExecute && t.ipfsCid) {
      if (!config.PINATA_API_KEY || !config.PINATA_SECRET_API_KEY) {
        console.error('Pinata API keys not configured; cannot unpin.');
        process.exit(1);
      }

      try {
        await axios.delete(`https://api.pinata.cloud/pinning/unpin/${t.ipfsCid}`, {
          headers: {
            pinata_api_key: config.PINATA_API_KEY,
            pinata_secret_api_key: config.PINATA_SECRET_API_KEY,
          },
        });
        console.log(`  Unpinned ${t.ipfsCid} successfully.`);
      } catch (err: any) {
        console.error(`  Failed to unpin ${t.ipfsCid}: ${err.response?.data?.error || err.message}`);
      }
    }
  }

  if (!isExecute) {
    console.log('\nDry run complete. Use --execute to unpin from Pinata.');
    console.log('NOTICE: Copies may persist on public IPFS gateways and peer nodes.');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
