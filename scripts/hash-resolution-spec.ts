/**
 * Computes sha256(XDR(ResolutionSpec)) from a ResolutionSpecJson document (#307).
 *
 * Matches the on-chain commitment `market.resolution_hash` (ADR 0001).
 *
 * Usage:
 *   echo '{"kind":"signers","signers":["G…"],"threshold":1,"disputeWindow":86400}' | npx tsx scripts/hash-resolution-spec.ts
 *   npx tsx scripts/hash-resolution-spec.ts --file ./spec.json
 *   npx tsx scripts/hash-resolution-spec.ts --json '{"kind":"price",...}'
 */
import fs from 'node:fs';
import { resolutionHash, validateResolutionSpec, type ResolutionSpecJson } from '../src/lib/resolution-spec';

async function readInput(): Promise<string> {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    return fs.readFileSync(args[fileIdx + 1], 'utf8');
  }
  const jsonIdx = args.indexOf('--json');
  if (jsonIdx !== -1 && args[jsonIdx + 1]) {
    return args[jsonIdx + 1];
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const raw = (await readInput()).trim();
  if (!raw) {
    console.error('Usage: echo \'<ResolutionSpecJson>\' | npx tsx scripts/hash-resolution-spec.ts');
    process.exit(2);
  }
  const spec = JSON.parse(raw) as ResolutionSpecJson;
  validateResolutionSpec(spec);
  console.log(resolutionHash(spec).toString('hex'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
