import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

const TREASURY_ID = 'CTREASURY';
const AGENT_ID = 'GAGENT';

function market(overrides: any = {}) {
  return {
    creator: TREASURY_ID,
    status: { tag: 'Open', values: undefined },
    reserve_yes: 100n,
    reserve_no: 200n,
    fee_bps: 100,
    lp_claimed: false,
    fees_accrued: 0n,
    close_time: 0n,
    meta_uri: '',
    question_hash: Buffer.alloc(0),
    resolution_hash: Buffer.alloc(0),
    sets_minted: 0n,
    category: { tag: 'Macro', values: undefined },
    ...overrides,
  } as any;
}

function snapshot(overrides: any = {}) {
  return { marketId: 0n, market: market(), position: { yes: 10n, no: 5n }, ...overrides } as any;
}

test('mark value uses priceYesBps integer math (#159)', async () => {
  const { markValueRaw } = await import('../src/services/transparency-report.service');
  const { priceYesBps } = await import('../src/generated/fpmm');
  const bps = Number(priceYesBps(100n, 200n));
  assert.equal(bps, 6666);
  assert.equal(markValueRaw(10n, 5n, bps), ((10n * 6666n + 5n * 3334n) / 10_000n).toString());
});

test('liquidation value equals collateralOutForShares for each side (#159)', async () => {
  const { liquidationValueRaw } = await import('../src/services/transparency-report.service');
  const { collateralOutForShares } = await import('../src/generated/fpmm');
  const expected = collateralOutForShares(100n, 200n, 10n, 100n) + collateralOutForShares(200n, 100n, 5n, 100n);
  assert.equal(liquidationValueRaw(100n, 200n, 10n, 5n, 100n), expected.toString());
});

test('void settlement uses settleValue, and final markets expose settlement/lp values (#159)', async () => {
  const { valueMarket } = await import('../src/services/transparency-report.service');
  const { settleValue } = await import('../src/generated/fpmm');
  const voided = valueMarket(snapshot({ market: market({ status: { tag: 'Void', values: undefined } }) }), TREASURY_ID);
  assert.equal(voided.settlementValueRaw, settleValue('void', 10n, 5n).toString());
  assert.equal(voided.lpRemainderRaw, settleValue('void', 100n, 200n).toString());
  const open = valueMarket(snapshot(), TREASURY_ID);
  assert.equal(open.settlementValueRaw, null);
  assert.equal(open.createdByTreasury, true);
});

test('the report document is byte-identical across runs (#159)', async () => {
  const { buildReportDocument, valueMarket, totalsFor } = await import('../src/services/transparency-report.service');
  const markets = [valueMarket(snapshot(), TREASURY_ID)];
  const inputs = {
    date: '2026-10-14',
    network: 'Test SDF Network ; September 2015',
    contracts: { treasury: TREASURY_ID, marketCore: 'CM', usdc: 'CU', reasoningRegistry: 'CR' },
    agent: AGENT_ID,
    anchor: { ledger: 100, closedAt: '2026-10-14T00:00:00.000Z' },
    consistency: 'exact' as const,
    treasury: {
      usdcBalanceRaw: '1000',
      availableCapitalRaw: '1000',
      riskConfig: { maxTradeRaw: '1', maxMarketRaw: '2', maxDailyRaw: '3' },
      dailyUsage: { amountRaw: '0', dayStart: 0 },
    },
    markets,
    periodFlows: {
      coverage: { fromLedger: 100, toLedger: 100, complete: true, gaps: [] as Array<[number, number]> },
      tradesBoughtRaw: '0', tradesSoldRaw: '0', feesPaidRaw: '0', redeemedRaw: '0',
      feesCollectedRaw: '0', seedDeployedRaw: '0', tradeCount: 0,
    },
    traces: { total: 0, byAction: {} },
    previous: null,
    methodDoc: 'doc',
  };
  const a = buildReportDocument(inputs);
  const b = buildReportDocument(inputs);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.schemaVersion, 2);
  assert.deepEqual(a.totals, totalsFor(markets, '1000'));
});

test('coverage is incomplete when the indexer cursor is behind the period and matches treasury contract identity (#159, #299)', async () => {
  const { buildReportForDate } = await import('../src/services/transparency-report.service');
  const report = await buildReportForDate('2026-10-14', {
    treasuryContractId: TREASURY_ID,
    latestLedger: async () => 100,
    openMarkets: async () => [],
    marketCount: async () => 0n,
    treasuryConfig: async () => ({ agent: AGENT_ID, max_daily: 1000n, max_market: 100n, max_trade: 10n }),
    dailyUsage: async () => ({ amount: 0n, day_start: 0n }),
    availableCapital: async () => 500n,
    usdcBalance: async () => 500n,
    accounting: async () => ({
      ledger: 100,
      navRaw: 500n,
      liquidRaw: 500n,
      yieldPrincipalRaw: 0n,
      yieldValueShares: 0n,
      queueReservedRaw: 0n,
      dailyHeadroomRaw: 1000n,
      netExposureRaw: 0n,
      spendableRaw: 500n,
      flags: [],
    }),
    chainEvents: async () => [
      { contractName: 'marketCore', eventName: 'Trade', ledger: 90, ledgerClosedAt: new Date(), params: { trader: TREASURY_ID, collateral: '100', fee: '1', is_buy: true } },
      // Trades by the agent G-address directly must not be confused with treasury contract flows.
      { contractName: 'marketCore', eventName: 'Trade', ledger: 91, ledgerClosedAt: new Date(), params: { trader: AGENT_ID, collateral: '999', fee: '5', is_buy: true } },
    ],
    indexerCursor: async () => 50,
    traceCount: async () => 0n,
    previousReport: async () => null,
    methodDoc: 'doc',
  });
  assert.equal(report.agent, AGENT_ID);
  assert.equal(report.contracts.treasury, TREASURY_ID);
  assert.equal(report.period_flows.coverage.complete, false);
  assert.deepEqual(report.period_flows.coverage.gaps, [[51, 91]]);
  assert.equal(report.period_flows.tradesBoughtRaw, '100');
  assert.equal(report.period_flows.tradeCount, 1);
});

test('snapshot retries when the ledger moves and flags best_effort after 3 attempts (#159)', async () => {
  const { buildReportForDate } = await import('../src/services/transparency-report.service');
  const sequence = [100, 101, 101, 102, 102, 103];
  let index = 0;
  const report = await buildReportForDate('2026-10-14', {
    treasuryContractId: TREASURY_ID,
    latestLedger: async () => sequence[Math.min(index++, sequence.length - 1)],
    openMarkets: async () => [],
    marketCount: async () => 0n,
    treasuryConfig: async () => ({ agent: AGENT_ID, max_daily: 1000n, max_market: 100n, max_trade: 10n }),
    dailyUsage: async () => ({ amount: 0n, day_start: 0n }),
    availableCapital: async () => 0n,
    usdcBalance: async () => 0n,
    accounting: async () => ({
      ledger: 103,
      navRaw: 0n,
      liquidRaw: 0n,
      yieldPrincipalRaw: 0n,
      yieldValueShares: 0n,
      queueReservedRaw: 0n,
      dailyHeadroomRaw: 1000n,
      netExposureRaw: 0n,
      spendableRaw: 0n,
      flags: [],
    }),
    chainEvents: async () => [],
    indexerCursor: async () => 0,
    traceCount: async () => 0n,
    previousReport: async () => null,
    methodDoc: 'doc',
  });
  assert.equal(report.consistency, 'best_effort');
  assert.equal(report.anchor.ledger, 103);
});

test('publish uses REPORT_MARKET_ID and action report; dry-run rows are uncommitted (#159)', async () => {
  const tracePublish = await import('../src/services/trace-publish.service');
  const { REPORT_MARKET_ID, runReportJob } = await import('../src/services/transparency-report.service');
  const { prisma } = await import('../src/lib/prisma');
  let published: any = null;
  (tracePublish as any).pinAndPublishDocument = async (params: any) => {
    published = params;
    return { cid: 'bafy-report', hash: 'a'.repeat(64), onChainTraceId: null, publishTxHash: null, mode: 'dry-run' };
  };
  let created: any = null;
  (prisma.transparencyReport.findUnique as any) = async () => null;
  (prisma.transparencyReport.create as any) = async ({ data }: any) => {
    created = data;
    return { id: 'report-1', ...data };
  };

  await runReportJob('2026-10-14', {
    now: () => new Date('2026-10-14T00:00:00.000Z'),
    treasuryContractId: TREASURY_ID,
    latestLedger: async () => 100,
    openMarkets: async () => [],
    marketCount: async () => 0n,
    treasuryConfig: async () => ({ agent: AGENT_ID, max_daily: 1000n, max_market: 100n, max_trade: 10n }),
    dailyUsage: async () => ({ amount: 0n, day_start: 0n }),
    availableCapital: async () => 0n,
    usdcBalance: async () => 0n,
    accounting: async () => ({
      ledger: 100,
      navRaw: 0n,
      liquidRaw: 0n,
      yieldPrincipalRaw: 0n,
      yieldValueShares: 0n,
      queueReservedRaw: 0n,
      dailyHeadroomRaw: 1000n,
      netExposureRaw: 0n,
      spendableRaw: 0n,
      flags: [],
    }),
    chainEvents: async () => [],
    indexerCursor: async () => 100,
    traceCount: async () => 0n,
    previousReport: async () => null,
    methodDoc: 'doc',
  });
  assert.equal(REPORT_MARKET_ID, 18446744073709551615n);
  assert.equal(published.action, 'report');
  assert.equal(published.marketId, REPORT_MARKET_ID);
  assert.equal(created.mode, 'dry-run');
  assert.equal(created.onChainTraceId, null);
});

test('a crash after pin re-publishes the stored bytes, never recomputing (#159)', async () => {
  const tracePublish = await import('../src/services/trace-publish.service');
  const { runReportJob } = await import('../src/services/transparency-report.service');
  const { prisma } = await import('../src/lib/prisma');
  let republished: any = null;
  (tracePublish as any).publishPinnedDocument = async (params: any) => {
    republished = params;
    return { onChainTraceId: 7n, publishTxHash: 'tx', mode: 'live' };
  };
  (prisma.transparencyReport.findUnique as any) = async () => ({
    id: 'report-1', date: '2026-10-14', cid: 'bafy-old', hash: 'b'.repeat(64), onChainTraceId: null, mode: 'dry-run',
  });
  (prisma.transparencyReport.update as any) = async ({ data }: any) => ({ id: 'report-1', ...data });

  await runReportJob('2026-10-14');
  assert.equal(republished.cid, 'bafy-old');
  assert.equal(republished.hash, 'b'.repeat(64));
  assert.equal(republished.marketId, 18446744073709551615n);
});

function fakeTx(value: any) {
  return { result: value };
}

function fakeRegistry(trace: any, previous?: any) {
  return {
    async get_trace({ trace_id }: any) {
      if (trace_id === 1n) return fakeTx(trace);
      if (previous && trace_id === 0n) return fakeTx(previous);
      throw new Error('unknown trace');
    },
    async market_trace_count() { return fakeTx(1n); },
    async market_trace_at() { return fakeTx(1n); },
  };
}

async function verifyFixture(report: any, trace: any, previous?: any) {
  const { verify } = await import('../scripts/verify-report');
  const bytes = Buffer.from(JSON.stringify(report));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const registry = fakeRegistry({ ...trace, trace_hash: Buffer.from(hash, 'hex') }, previous);
  const treasury = { async get_config() { return fakeTx({ agent: 'GAGENT' }); } };
  return verify({
    traceId: '1',
    gatewayUrl: 'https://gw',
    deps: {
      registry,
      treasury,
      fetch: (async () => ({ ok: true, arrayBuffer: async () => bytes })) as any,
      latestLedger: async () => ({ sequence: 200 }),
    },
  });
}

const validReport = {
  kind: 'oracledesk.transparency-report',
  schemaVersion: 1,
  agent: 'GAGENT',
  markets: [{ markValueRaw: '10' }],
  treasury: { usdcBalanceRaw: '100' },
  totals: { markValueRaw: '10', positionsMarkRaw: '10', positionsLiquidityRaw: '0', navRaw: '110' },
  anchor: { ledger: 100 },
  previous: null,
};

test('verifier accepts a valid report and recomputes totals (#159)', async () => {
  const result = await verifyFixture(validReport, { agent: 'GAGENT', action: 'report', ipfs_cid: 'bafy', market_id: 18446744073709551615n });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
});

test('verifier detects tampered content, wrong agent and a broken previous chain (#159)', async () => {
  const { verify } = await import('../scripts/verify-report');
  const bytes = Buffer.from(JSON.stringify(validReport));
  const tampered = Buffer.from(JSON.stringify({ ...validReport, totals: { ...validReport.totals, navRaw: '999' } }));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const registry = fakeRegistry({ agent: 'GAGENT', action: 'report', ipfs_cid: 'bafy', trace_hash: Buffer.from(hash, 'hex'), market_id: 18446744073709551615n });
  const treasury = { async get_config() { return fakeTx({ agent: 'GAGENT' }); } };
  const tamperedResult = await verify({
    traceId: '1',
    deps: { registry, treasury, fetch: (async () => ({ ok: true, arrayBuffer: async () => tampered })) as any, latestLedger: async () => ({ sequence: 200 }) },
  });
  assert.equal(tamperedResult.ok, false);
  assert.ok(tamperedResult.checks.some((c) => c.name === 'content_hash' && !c.ok));

  const wrongAgent = await verifyFixture({ ...validReport, agent: 'GOTHER' }, { agent: 'GOTHER', action: 'report', ipfs_cid: 'bafy', market_id: 18446744073709551615n });
  assert.equal(wrongAgent.ok, false);
  assert.ok(wrongAgent.checks.some((c) => c.name === 'agent_matches_treasury' && !c.ok));

  const broken = await verifyFixture(
    { ...validReport, previous: { onChainTraceId: '0', traceHash: 'f'.repeat(64) } },
    { agent: 'GAGENT', action: 'report', ipfs_cid: 'bafy', market_id: 18446744073709551615n },
    { agent: 'GAGENT', action: 'report', ipfs_cid: 'bafy-prev', trace_hash: Buffer.from('e'.repeat(64), 'hex') },
  );
  assert.equal(broken.ok, false);
  assert.ok(broken.checks.some((c) => c.name === 'previous_hash_chain' && !c.ok));
});

test('u64::MAX sentinel serialises correctly in ScVal XDR (#159)', async () => {
  const { xdr } = await import('@stellar/stellar-sdk');
  const value = xdr.Uint64.fromString('18446744073709551615');
  assert.equal(value.toString(), '18446744073709551615');
  const encoded = xdr.ScVal.scvU64(value).toXDR('base64');
  const decoded = xdr.ScVal.fromXDR(encoded, 'base64').u64();
  assert.equal(decoded.toString(), '18446744073709551615');
});

test('the report service never imports portfolio floats or unrelated Prisma models (#159)', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const source = readFileSync(join(__dirname, '..', '..', 'src', 'services', 'transparency-report.service.ts'), 'utf8');
  assert.equal(source.includes('portfolio.service'), false, 'no portfolio.service import');
  assert.equal(/from ['"]@prisma\/client['"]/.test(source), false, 'no Prisma model types');
  const models = [...source.matchAll(/prisma\.([a-zA-Z]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(models)].sort(), ['chainEvent', 'indexerCursor', 'registryTraceCache', 'transparencyReport']);
});

test('lastModifiedLedgerSeq drift forces best_effort even with a stable latest ledger (#159)', async () => {
  const { buildReportForDate } = await import('../src/services/transparency-report.service');
  const report = await buildReportForDate('2026-10-14', {
    treasuryContractId: TREASURY_ID,
    latestLedger: async () => 100,
    ledgerEntries: async () => [{ lastModifiedLedgerSeq: 150 }],
    openMarkets: async () => [],
    marketCount: async () => 0n,
    treasuryConfig: async () => ({ agent: AGENT_ID, max_daily: 1000n, max_market: 100n, max_trade: 10n }),
    dailyUsage: async () => ({ amount: 0n, day_start: 0n }),
    availableCapital: async () => 0n,
    usdcBalance: async () => 0n,
    accounting: async () => ({
      ledger: 100,
      navRaw: 0n,
      liquidRaw: 0n,
      yieldPrincipalRaw: 0n,
      yieldValueShares: 0n,
      queueReservedRaw: 0n,
      dailyHeadroomRaw: 1000n,
      netExposureRaw: 0n,
      spendableRaw: 0n,
      flags: [],
    }),
    chainEvents: async () => [],
    indexerCursor: async () => 100,
    traceCount: async () => 0n,
    previousReport: async () => null,
    methodDoc: 'doc',
  });
  assert.equal(report.consistency, 'best_effort');
});

test('report v2 uses open-market index, real SAC USDC balance, and flags NAV diffs above tolerance without hiding them (#299)', async () => {
  const { buildReportForDate } = await import('../src/services/transparency-report.service');
  let marketCountCalled = false;
  const report = await buildReportForDate('2026-10-14', {
    treasuryContractId: TREASURY_ID,
    latestLedger: async () => 500,
    openMarkets: async () => [7n],
    marketCount: async () => {
      marketCountCalled = true;
      return 1000n;
    },
    getMarket: async () => market({ reserve_yes: 100n, reserve_no: 200n }),
    getPosition: async (_id, holder) => {
      assert.equal(holder, TREASURY_ID);
      return { yes: 10n, no: 5n } as any;
    },
    marketValuation: async () => 120n,
    treasuryConfig: async () => ({ agent: AGENT_ID, max_daily: 10_000n, max_market: 5_000n, max_trade: 1_000n }),
    dailyUsage: async () => ({ amount: 0n, day_start: 0n }),
    availableCapital: async () => 9999n, // mixes units, must not be used for usdcBalanceRaw
    usdcBalance: async (holder) => {
      assert.equal(holder, TREASURY_ID);
      return 1000n;
    },
    accounting: async () => ({
      ledger: 500,
      navRaw: 1070n, // recomputed floor nav = 1000 + (5 + 100) - 50 = 1055 -> diff = +15
      liquidRaw: 1000n,
      yieldPrincipalRaw: 300n,
      yieldValueShares: 295n,
      queueReservedRaw: 50n,
      dailyHeadroomRaw: 10_000n,
      netExposureRaw: 200n,
      spendableRaw: 950n,
      flags: ['NAV_EXCLUDES_YIELD', 'YIELD_VALUE_IN_SHARES', 'AVAILABLE_MIXES_UNITS'],
    }),
    navToleranceRaw: 10n,
    chainEvents: async () => [],
    indexerCursor: async () => 500,
    traceCount: async () => 0n,
    previousReport: async () => null,
    methodDoc: 'doc',
  });

  assert.equal(marketCountCalled, false, 'should iterate open-market index rather than 0..marketCount');
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.treasury.usdcBalanceRaw, '1000');
  assert.equal(report.chain.navRaw, '1070');
  assert.equal(report.chain.yieldValueShares, '295');
  assert.equal(report.reconciliation.perMarket.length, 1);
  assert.equal(report.reconciliation.perMarket[0].recomputedFloorRaw, '105');
  assert.equal(report.reconciliation.perMarket[0].chainFloorRaw, '120');
  assert.equal(report.reconciliation.perMarket[0].diffRaw, '15');
  assert.equal(report.reconciliation.navDiffRaw, '15');
  assert.equal(report.consistency, 'best_effort');
  assert.ok(report.reconciliation.flags.includes('NAV_DIFF_EXCEEDS_TOLERANCE'));
  assert.ok(report.reconciliation.flags.includes('NAV_EXCLUDES_YIELD'));

  // Verifier validates v2 chain + reconciliation blocks and recomputes navDiffRaw.
  const verifyRes = await verifyFixture(report, {
    agent: AGENT_ID,
    action: 'report',
    ipfs_cid: 'bafy-v2',
    market_id: 18446744073709551615n,
  });
  assert.equal(verifyRes.ok, true, JSON.stringify(verifyRes.checks));
  assert.ok(verifyRes.checks.some((c) => c.name === 'reconciliation_nav_diff' && c.ok));
});
