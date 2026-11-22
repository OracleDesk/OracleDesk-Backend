/**
 * Independent transparency-report verifier (#159).
 *
 * Uses only @stellar/stellar-sdk + the generated bindings. No database.
 *
 *   npm run verify:report -- --date 2026-10-14 [--rpc URL] [--gateway URL]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { rpc } from '@stellar/stellar-sdk';
import { traceAttestationMessage, verifyTraceSignatureLocal } from '../src/lib/trace-signing';
import { canonicalJson, sha256Hex } from '../src/utils/hash.util';
import { buildReportForDate } from '../src/services/transparency-report.service';
import {
  createFixtureReportChainReader,
  createLiveReportChainReader,
  type RecordedReportFixture,
  type ReportChainReader,
} from '../src/services/report-chain-reader';
import { Client as RegistryClient } from '../src/generated/reasoning-registry';
import { Client as TreasuryClient } from '../src/generated/treasury';
import deployments from '../src/generated/deployments.testnet.json';

export const REPORT_MARKET_ID = 18446744073709551615n;

export interface VerifyOptions {
  date?: string;
  traceId?: string;
  rpcUrl?: string;
  gatewayUrl?: string;
  networkPassphrase?: string;
  contracts?: { reasoningRegistry?: string; treasury?: string };
  rebuild?: boolean;
  fixturePath?: string;
  reader?: ReportChainReader;
  /** Test seam for unit tests; the CLI never passes this. */
  deps?: {
    registry?: any;
    treasury?: any;
    fetch?: typeof fetch;
    latestLedger?: () => Promise<{ sequence: number }>;
  };
}

export interface VerifyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  traceId?: string;
  cid?: string;
  computedHash?: string;
  checks: VerifyCheck[];
}

function unwrap<T>(tx: { result: unknown }): T {
  const result = tx.result as { isOk?: () => boolean; unwrap?: () => T };
  if (typeof result?.isOk === 'function') {
    if (!result.isOk()) throw new Error('contract returned an error');
    return result.unwrap!();
  }
  return result as T;
}

function clientBase(contractId: string, rpcUrl: string, networkPassphrase: string) {
  return { contractId, rpcUrl, networkPassphrase, allowHttp: rpcUrl.startsWith('http://') };
}

export async function verify(opts: VerifyOptions = {}): Promise<VerifyResult> {
  const networkPassphrase = opts.networkPassphrase ?? process.env.STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';
  const rpcUrl = opts.rpcUrl ?? process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
  const gateway = (opts.gatewayUrl ?? process.env.IPFS_GATEWAY_URL ?? 'https://gateway.pinata.cloud/ipfs').replace(/\/$/, '');
  const registryId = opts.contracts?.reasoningRegistry ?? process.env.REASONING_REGISTRY_CONTRACT_ID ?? deployments.contracts.reasoning_registry;
  const treasuryId = opts.contracts?.treasury ?? process.env.TREASURY_CONTRACT_ID ?? deployments.contracts.treasury;
  const registry = opts.deps?.registry ?? new RegistryClient(clientBase(registryId, rpcUrl, networkPassphrase));
  const treasury = opts.deps?.treasury ?? new TreasuryClient(clientBase(treasuryId, rpcUrl, networkPassphrase));
  const fetchImpl = opts.deps?.fetch ?? fetch;
  const checks: VerifyCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  let traceId = opts.traceId ? BigInt(opts.traceId) : null;
  if (traceId === null) {
    const count = unwrap<bigint>(await registry.market_trace_count({ market_id: REPORT_MARKET_ID }));
    if (!opts.date) {
      add('find_report', false, 'provide --date or --trace-id');
      return { ok: false, checks };
    }
    for (let i = 0n; i < count; i++) {
      const id = unwrap<bigint>(await registry.market_trace_at({ market_id: REPORT_MARKET_ID, index: i }));
      const trace = unwrap<{ ipfs_cid: string }>(await registry.get_trace({ trace_id: id }));
      try {
        const res = await fetchImpl(`${gateway}/${encodeURIComponent(trace.ipfs_cid)}`);
        if (!res.ok) continue;
        const doc = JSON.parse(Buffer.from(await res.arrayBuffer()).toString('utf8')) as { period?: { from?: string } };
        if (doc.period?.from?.slice(0, 10) === opts.date) {
          traceId = id;
          break;
        }
      } catch {
        // keep scanning
      }
    }
  }

  if (traceId === null) {
    add('find_report', false, `no report trace found for ${opts.date}`);
    return { ok: false, checks };
  }
  add('find_report', true, `trace ${traceId.toString()}`);

  const trace = unwrap<{
    agent: string;
    action: string;
    ipfs_cid: string;
    trace_hash: Buffer;
    market_id: bigint;
  }>(await registry.get_trace({ trace_id: traceId }));
  add('sentinel_market', trace.market_id === REPORT_MARKET_ID, `market_id=${trace.market_id.toString()}`);
  add('action', trace.action === 'report', `action=${trace.action}`);

  let bytes: Buffer;
  try {
    const res = await fetchImpl(`${gateway}/${encodeURIComponent(trace.ipfs_cid)}`);
    if (!res.ok) throw new Error(`gateway ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    add('fetch_content', false, err instanceof Error ? err.message : String(err));
    return { ok: false, traceId: traceId.toString(), cid: trace.ipfs_cid, checks };
  }
  add('fetch_content', true, `${bytes.length} bytes`);

  const computedHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const onChainHash = Buffer.from(trace.trace_hash).toString('hex');
  add('content_hash', computedHash === onChainHash, `${computedHash} vs ${onChainHash}`);

  let report: any;
  try {
    report = JSON.parse(bytes.toString('utf8'));
  } catch {
    add('parse_document', false, 'content is not JSON');
    return { ok: false, traceId: traceId.toString(), cid: trace.ipfs_cid, computedHash, checks };
  }
  add('parse_document', true, `${report.kind} v${report.schemaVersion}`);

  const risk = unwrap<{ agent: string }>(await treasury.get_config());
  add('report_agent_matches_trace', report.agent === trace.agent, `${report.agent} vs ${trace.agent}`);
  add('agent_matches_treasury', trace.agent === risk.agent, `${trace.agent} vs ${risk.agent}`);

  // Detached Ed25519 trace signature check (#273) when supported by the deployed registry.
  if (typeof registry.get_trace_signature === 'function') {
    try {
      const sigRow = unwrap<{ signing_key?: Buffer; signature?: Buffer } | null>(
        await registry.get_trace_signature({ trace_id: traceId }),
      );
      if (!sigRow?.signing_key || !sigRow?.signature) {
        add('trace_signature', true, 'unsigned (pre-cutover trace)');
      } else {
        const keyHex = Buffer.from(sigRow.signing_key).toString('hex');
        const sigBytes = Buffer.from(sigRow.signature);
        if (typeof registry.get_key_agent === 'function') {
          const boundAgent = unwrap<string | null>(await registry.get_key_agent({ public_key: sigRow.signing_key }));
          add('signing_key_agent', boundAgent === trace.agent, `${boundAgent ?? 'unbound'} vs ${trace.agent}`);
        }
        const msg = traceAttestationMessage({
          networkPassphrase,
          registry: registryId,
          agent: trace.agent,
          marketId: trace.market_id,
          action: { kind: 'Other', symbol: String(trace.action) },
          traceHash: Buffer.from(trace.trace_hash),
        });
        const sigOk = verifyTraceSignatureLocal(keyHex, msg, sigBytes);
        add('trace_signature', sigOk, sigOk ? `valid Ed25519 signature by ${keyHex.slice(0, 12)}…` : 'invalid Ed25519 signature');
      }
    } catch (err) {
      add('trace_signature', false, err instanceof Error ? err.message : String(err));
    }
  }

  const mark = (report.markets ?? []).reduce((sum: bigint, m: any) => sum + BigInt(m.markValueRaw), 0n);
  const nav = BigInt(report.treasury.usdcBalanceRaw) + mark;
  add('totals_mark', mark.toString() === report.totals.positionsMarkRaw, `${mark.toString()} vs ${report.totals.positionsMarkRaw}`);
  add('totals_nav', nav.toString() === report.totals.navRaw, `${nav.toString()} vs ${report.totals.navRaw}`);

  if (report.schemaVersion >= 2 || report.chain || report.reconciliation) {
    const intStr = (v: unknown) => typeof v === 'string' && /^-?\d+$/.test(v);
    const chainOk =
      report.chain != null &&
      typeof report.chain === 'object' &&
      intStr(report.chain.navRaw) &&
      intStr(report.chain.liquidRaw) &&
      intStr(report.chain.yieldPrincipalRaw) &&
      (report.chain.yieldValueShares === null || intStr(report.chain.yieldValueShares)) &&
      intStr(report.chain.queueReservedRaw) &&
      intStr(report.chain.netExposureRaw) &&
      typeof report.chain.ledger === 'number' &&
      Number.isFinite(report.chain.ledger);
    add('chain_block', chainOk, chainOk ? `nav=${report.chain.navRaw} ledger=${report.chain.ledger}` : 'missing or malformed chain block');

    const recon = report.reconciliation;
    const reconShapeOk =
      recon != null &&
      typeof recon === 'object' &&
      intStr(recon.navDiffRaw) &&
      Array.isArray(recon.perMarket) &&
      Array.isArray(recon.flags);
    add('reconciliation_block', reconShapeOk, reconShapeOk ? `markets=${recon.perMarket.length} flags=${recon.flags.length}` : 'missing or malformed reconciliation block');

    if (chainOk && reconShapeOk) {
      let perMarketOk = true;
      let recomputedFloorSum = 0n;
      for (const item of recon.perMarket) {
        if (!intStr(item?.chainFloorRaw) || !intStr(item?.recomputedFloorRaw) || !intStr(item?.diffRaw)) {
          perMarketOk = false;
          break;
        }
        const expectedDiff = BigInt(item.chainFloorRaw) - BigInt(item.recomputedFloorRaw);
        if (expectedDiff.toString() !== item.diffRaw) {
          perMarketOk = false;
          break;
        }
        recomputedFloorSum += BigInt(item.recomputedFloorRaw);
      }
      add('reconciliation_per_market', perMarketOk, `${recon.perMarket.length} markets checked`);

      const recomputedFloorNav =
        BigInt(report.treasury.usdcBalanceRaw) + recomputedFloorSum - BigInt(report.chain.queueReservedRaw);
      const expectedNavDiff = BigInt(report.chain.navRaw) - recomputedFloorNav;
      add(
        'reconciliation_nav_diff',
        expectedNavDiff.toString() === recon.navDiffRaw,
        `${expectedNavDiff.toString()} vs ${recon.navDiffRaw}`,
      );
    }
  }

  if (report.previous) {
    try {
      const prevId = BigInt(report.previous.onChainTraceId);
      const prev = unwrap<{ trace_hash: Buffer; action: string; ipfs_cid: string }>(await registry.get_trace({ trace_id: prevId }));
      const prevHash = Buffer.from(prev.trace_hash).toString('hex');
      add('previous_hash_chain', prevHash === report.previous.traceHash, `${prevHash} vs ${report.previous.traceHash}`);
      add('previous_is_report', prev.action === 'report', `action=${prev.action}`);
      add('previous_cid', Boolean(prev.ipfs_cid), prev.ipfs_cid);
    } catch (err) {
      add('previous_hash_chain', false, err instanceof Error ? err.message : String(err));
    }
  } else {
    add('previous_hash_chain', true, 'genesis report (no previous)');
  }

  const latest = opts.deps?.latestLedger
    ? await opts.deps.latestLedger()
    : await new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') }).getLatestLedger();
  add('anchor_not_future', report.anchor.ledger <= latest.sequence, `anchor=${report.anchor.ledger}, latest=${latest.sequence}`);
  if (report.anchor.ledger < latest.sequence) {
    add('state_moved_since_anchor', true, `state moved ${latest.sequence - report.anchor.ledger} ledgers; re-simulation is advisory`);
  }

  if (opts.rebuild) {
    const reportDate = opts.date ?? String(report.period?.from ?? '').slice(0, 10);
    try {
      const reader = opts.reader
        ?? (opts.fixturePath
          ? createFixtureReportChainReader(JSON.parse(fs.readFileSync(opts.fixturePath, 'utf8')) as RecordedReportFixture)
          : createLiveReportChainReader());
      const rebuilt = await buildReportForDate(reportDate, { reader });
      const rebuiltHash = sha256Hex(canonicalJson(rebuilt));
      add('rebuild_byte_identical', rebuiltHash === computedHash, `${rebuiltHash} vs ${computedHash}`);
    } catch (err) {
      add('rebuild_byte_identical', false, err instanceof Error ? err.message : String(err));
    }
  }

  return {
    ok: checks.every((c) => c.ok),
    traceId: traceId.toString(),
    cid: trace.ipfs_cid,
    computedHash,
    checks,
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (require.main === module) {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm run verify:report -- --date YYYY-MM-DD [--rpc URL] [--gateway URL] [--trace-id ID] [--rebuild] [--fixture PATH]');
    process.exit(0);
  }
  verify({
    date: arg('date'),
    traceId: arg('trace-id'),
    rpcUrl: arg('rpc'),
    gatewayUrl: arg('gateway'),
    rebuild: process.argv.includes('--rebuild'),
    fixturePath: arg('fixture'),
  })
    .then((result) => {
      for (const check of result.checks) console.log(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`);
      console.log(result.ok ? '\nreport verified' : '\nreport verification FAILED');
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
