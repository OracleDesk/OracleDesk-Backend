/**
 * Best-effort backfill of fee receipts from Stellar RPC retention (#308).
 *
 * Scans `chain_transactions` rows with a `landedHash` that do not yet have a
 * `RECEIPT` row in `chain_fees`, calls `getTransaction(landedHash)`, decodes
 * the receipt, records it idempotently, and reports how many rows fell outside
 * RPC retention.
 *
 * Usage:
 *   npx tsx scripts/backfill-fee-receipts.ts [--limit=500] [--dry-run]
 */
import { prisma } from '../src/lib/prisma';
import { logger } from '../src/lib/logger';
import { rpcServer } from '../src/services/stellar/clients';
import {
  estimateFromRow,
  inferOpClass,
  recordFeeReceipt,
  serializeResultXdr,
  type FeeReceiptRowInput,
} from '../src/services/stellar/fee-receipt';

interface BackfillSummary {
  scanned: number;
  recorded: number;
  alreadyRecorded: number;
  outsideRetention: number;
  errors: number;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 500) : 500;

  const summary: BackfillSummary = {
    scanned: 0,
    recorded: 0,
    alreadyRecorded: 0,
    outsideRetention: 0,
    errors: 0,
  };

  const outboxModel = (prisma as unknown as {
    chainTransaction: {
      findMany(args: unknown): Promise<Array<FeeReceiptRowInput & { id: string; landedHash: string | null; resultXdr: string | null }>>;
      update(args: unknown): Promise<unknown>;
    };
    chainFee: {
      findUnique(args: unknown): Promise<{ source?: string } | null>;
    };
  });

  const rows = await outboxModel.chainTransaction.findMany({
    where: {
      landedHash: { not: null },
      status: { in: ['SUCCESS', 'FAILED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  for (const row of rows) {
    summary.scanned++;
    const innerHash = row.hash ?? row.landedHash;
    if (!innerHash || !row.landedHash) continue;

    const existing = await outboxModel.chainFee.findUnique({ where: { txHash: innerHash } });
    if (existing?.source === 'RECEIPT') {
      summary.alreadyRecorded++;
      continue;
    }

    try {
      const resp = await rpcServer.getTransaction(row.landedHash);
      if (resp.status !== 'SUCCESS' && resp.status !== 'FAILED') {
        summary.outsideRetention++;
        continue;
      }

      if (dryRun) {
        summary.recorded++;
        continue;
      }

      const receipt = await recordFeeReceipt(
        row,
        inferOpClass(row),
        estimateFromRow(row),
        resp,
        { landedHash: row.landedHash },
      );

      if (receipt) {
        summary.recorded++;
        if (!row.resultXdr) {
          const resultXdrB64 = serializeResultXdr(resp);
          if (resultXdrB64) {
            await outboxModel.chainTransaction.update({
              where: { id: row.id },
              data: { resultXdr: resultXdrB64 },
            }).catch(() => undefined);
          }
        }
      } else {
        summary.errors++;
      }
    } catch (err) {
      summary.errors++;
      logger.warn(
        { outboxId: row.id, landedHash: row.landedHash, err: err instanceof Error ? err.message : String(err) },
        'backfill-fee-receipts: failed to fetch/record receipt',
      );
    }
  }

  console.log(JSON.stringify({ dryRun, ...summary }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
