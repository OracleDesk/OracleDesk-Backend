import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'report-ledger');

test('golden transparency reports reproduce byte for byte from recorded XDR fixtures (#301)', async () => {
  const { buildReportForDate, REPORT_SCHEMA_VERSION } = await import('../src/services/transparency-report.service');
  const { createFixtureReportChainReader } = await import('../src/services/report-chain-reader');
  const { canonicalJson, sha256Hex } = await import('../src/utils/hash.util');

  const golden = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'golden.json'), 'utf8')) as {
    schemaVersion: number;
    reports: Record<string, string>;
  };

  assert.equal(
    golden.schemaVersion,
    REPORT_SCHEMA_VERSION,
    'golden.json schemaVersion must match REPORT_SCHEMA_VERSION',
  );

  for (const [date, expectedSha256] of Object.entries(golden.reports)) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${date}.json`), 'utf8'));
    const reader = createFixtureReportChainReader(fixture);
    const report = await buildReportForDate(date, { reader });
    const actualSha256 = sha256Hex(canonicalJson(report));
    assert.equal(actualSha256, expectedSha256, `Report hash mismatch for ${date}`);
  }
});

test('verify-report --rebuild passes against recorded fixture reader (#301)', async () => {
  const { buildReportForDate } = await import('../src/services/transparency-report.service');
  const { createFixtureReportChainReader } = await import('../src/services/report-chain-reader');
  const { canonicalJson, sha256Hex } = await import('../src/utils/hash.util');
  const { verify } = await import('../scripts/verify-report');

  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, '2026-10-14.json'), 'utf8'));
  const reader = createFixtureReportChainReader(fixture);
  const report = await buildReportForDate('2026-10-14', { reader });
  const bytes = Buffer.from(canonicalJson(report), 'utf8');
  const hashBuf = Buffer.from(sha256Hex(bytes), 'hex');
  const cfg = await reader.treasuryConfig();

  const result = await verify({
    date: '2026-10-14',
    traceId: '3',
    rebuild: true,
    reader,
    deps: {
      latestLedger: async () => ({ sequence: fixture.latestLedger }),
      treasury: {
        get_config: async () => ({ result: { isOk: () => true, unwrap: () => cfg } }),
      },
      registry: {
        get_trace: async () => ({
          result: {
            isOk: () => true,
            unwrap: () => ({
              agent: cfg.agent,
              action: 'report',
              ipfs_cid: 'bafyfixturecid',
              trace_hash: hashBuf,
              market_id: 18446744073709551615n,
            }),
          },
        }),
      },
      fetch: async () => new Response(bytes, { status: 200 }),
    },
  });

  const rebuildCheck = result.checks.find((c) => c.name === 'rebuild_byte_identical');
  assert.ok(rebuildCheck?.ok, `rebuild_byte_identical failed: ${rebuildCheck?.detail}`);
  assert.equal(result.ok, true);
});

test('nondeterminism sources are pinned or fail loudly (#301)', async () => {
  const { buildReportForDate } = await import('../src/services/transparency-report.service');
  const { createFixtureReportChainReader } = await import('../src/services/report-chain-reader');

  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, '2026-10-14.json'), 'utf8'));
  const reader = createFixtureReportChainReader(fixture);

  // 1. anchor.closedAt uses ledger close time, not wall clock
  // 2. treasury.usdcBalanceRaw is distinct from availableCapitalRaw
  const report = await buildReportForDate('2026-10-14', { reader });
  assert.equal(report.anchor.closedAt, fixture.anchorClosedAt);
  assert.equal(report.treasury.usdcBalanceRaw, '98500000000');
  assert.equal(report.treasury.availableCapitalRaw, '95000000000');
  assert.deepEqual(Object.keys(report.traces.byAction), ['buy_yes', 'create_market']);

  // 3. market read failure throws instead of silently skipping
  await assert.rejects(
    () =>
      buildReportForDate('2026-10-14', {
        reader,
        getMarket: async () => {
          throw new Error('RPC timeout');
        },
      }),
    /RPC timeout/,
  );
});
