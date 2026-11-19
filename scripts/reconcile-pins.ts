#!/usr/bin/env node
/**
 * Imports pins that already exist at the provider into the pin ledger (#328),
 * so historic orphans can be collected by the GC. Replaces
 * scripts/unpin-legacy-traces.ts.
 *
 * Only pins named `oracledesk-*` are considered. References are attached by
 * parsing the name (`oracledesk-market-<id>`, `oracledesk-trace-<id>`) and by
 * matching `markets.metaUri` / `reasoning_traces.ipfsCid`; a reference whose
 * owner is on chain is imported ANCHORED.
 *
 * Usage:
 *   npx tsx scripts/reconcile-pins.ts            # dry run: report only
 *   npx tsx scripts/reconcile-pins.ts --execute  # write the ledger
 *
 * Run it once, then set PIN_GC_ENABLED=true.
 */
import { prisma } from '../src/lib/prisma';
import { getIpfsTransport } from '../src/services/ipfs.service';
import { postgresPinLedger, type PinOwner } from '../src/services/pin-ledger.service';

const PAGE = 100;

export function ownerFromName(name: string): PinOwner | null {
  const market = /^oracledesk-market-(.+)$/.exec(name);
  if (market) return { kind: 'MARKET_QUESTION', id: market[1] };
  const trace = /^oracledesk-trace-(.+)$/.exec(name);
  if (trace) return { kind: 'TRACE', id: trace[1] };
  return null;
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const transport = getIpfsTransport();
  if (!transport.list) throw new Error('The configured IPFS transport cannot list pins');
  console.log(`reconcile-pins (${execute ? 'EXECUTE' : 'DRY-RUN'})`);

  let imported = 0;
  let refs = 0;
  let unowned = 0;
  for (let offset = 0; ; offset += PAGE) {
    const page = await transport.list({ namePrefix: 'oracledesk-', pageLimit: PAGE, pageOffset: offset });
    for (const pin of page.pins) {
      if (!pin.name.startsWith('oracledesk-')) continue;

      // Owners: by name, then by what the rows point at.
      const owners: Array<{ owner: PinOwner; anchor: string | null }> = [];
      const named = ownerFromName(pin.name);
      if (named) owners.push({ owner: named, anchor: null });
      for (const m of await prisma.market.findMany({
        where: { metaUri: `ipfs://${pin.cid}` },
        select: { id: true, onChainMarketId: true },
      })) {
        owners.push({
          owner: { kind: 'MARKET_QUESTION', id: m.id },
          anchor: m.onChainMarketId != null ? `market:${m.onChainMarketId.toString()}` : null,
        });
      }
      for (const t of await prisma.reasoningTrace.findMany({
        where: { ipfsCid: pin.cid },
        select: { id: true, onChainTraceId: true },
      })) {
        owners.push({
          owner: { kind: 'TRACE', id: t.id },
          anchor: t.onChainTraceId != null ? `trace:${t.onChainTraceId.toString()}` : null,
        });
      }
      if (owners.length === 0) unowned++;

      if (!execute) {
        console.log(`${pin.cid}  ${pin.name}  owners=${owners.length}`);
        continue;
      }
      if (await postgresPinLedger.importPin({ cid: pin.cid, size: pin.size, provider: 'pinata', pinnedAt: pin.pinnedAt })) imported++;
      for (const { owner, anchor } of owners) {
        await postgresPinLedger.addRef(owner, pin.cid, anchor ? 'ANCHORED' : 'CANDIDATE', anchor);
        refs++;
      }
    }
    if (offset + PAGE >= page.total) break;
  }

  console.log(`pins imported: ${imported}, references added: ${refs}, pins with no known owner: ${unowned}`);
  if (unowned > 0) {
    console.log('Pins with no owner are collected only after PIN_GC_GRACE_HOURS; review them first.');
  }
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
}
