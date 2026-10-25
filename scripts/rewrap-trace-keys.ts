#!/usr/bin/env node
/**
 * Re-wraps stored trace data keys under a new KEK (Key-Encryption Key).
 *
 * Usage:
 *   npx tsx scripts/rewrap-trace-keys.ts --to-kid kek-2026-11 [--dry-run]
 */
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { loadKeks, unwrapKey } from '../src/services/trace-crypto.service';

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const toKidIdx = process.argv.indexOf('--to-kid');
  const targetKid = toKidIdx !== -1 ? process.argv[toKidIdx + 1] : config.TRACE_KEK_ACTIVE;

  console.log(`Re-wrapping trace keys to '${targetKid}' (${isDryRun ? 'DRY-RUN' : 'EXECUTE'})...`);

  const keks = loadKeks(config);
  const targetKek = keks.get(targetKid);
  if (!targetKek) {
    console.error(`Target KEK '${targetKid}' not found in TRACE_KEKS configuration.`);
    process.exit(1);
  }

  const keys = await prisma.traceKey.findMany({
    where: {
      kid: { not: targetKid },
    },
  });

  console.log(`Found ${keys.length} keys to re-wrap.\n`);

  let count = 0;
  for (const tk of keys) {
    try {
      // 1. Unwrap data key using old KEK
      const rawDataKey = unwrapKey(tk.wrappedKey, tk.kid, keks);

      // 2. Wrap using new KEK
      const newWrappedKey = targetKek.wrap(rawDataKey);

      if (!isDryRun) {
        await prisma.traceKey.update({
          where: { traceId: tk.traceId },
          data: {
            kid: targetKid,
            wrappedKey: newWrappedKey,
          },
        });
      }
      count++;
    } catch (err: any) {
      console.error(`Failed to re-wrap trace ${tk.traceId}: ${err.message}`);
    }
  }

  console.log(`\nSuccessfully re-wrapped ${count}/${keys.length} keys.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
