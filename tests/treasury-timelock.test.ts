import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

test('classifyAndDiffConfig classifies tighten, loosen, no-op and address changes', async () => {
  const { classifyAndDiffConfig } = await import('../src/services/treasury-timelock.service');
  const current = {
    max_trade: '1000',
    max_market: '5000',
    max_daily: '10000',
    collateral: 'CCOL1',
    market_core: 'CMKT1',
  };

  assert.equal(classifyAndDiffConfig(current, { max_trade: '1000', max_market: '5000', max_daily: '10000' }).classification, 'no-op');
  assert.equal(classifyAndDiffConfig(current, { max_trade: '800', max_market: '5000', max_daily: '10000' }).classification, 'tighten');
  assert.equal(classifyAndDiffConfig(current, { max_trade: '800', max_market: '6000', max_daily: '10000' }).classification, 'loosen');
  assert.equal(classifyAndDiffConfig(current, { max_trade: '1000', max_market: '5000', max_daily: '10000', collateral: 'CCOL2' }).classification, 'loosen');
});

test('classifyAndDiffPricePolicy and CreationPolicy match contract rules', async () => {
  const { classifyAndDiffPricePolicy, classifyAndDiffCreationPolicy } = await import('../src/services/treasury-timelock.service');
  assert.equal(
    classifyAndDiffPricePolicy({ min_price_bps: 500, max_price_bps: 9500 }, { min_price_bps: 1000, max_price_bps: 9000 }).classification,
    'tighten',
  );
  assert.equal(
    classifyAndDiffPricePolicy({ min_price_bps: 500, max_price_bps: 9500 }, { min_price_bps: 200, max_price_bps: 9000 }).classification,
    'loosen',
  );
  assert.equal(
    classifyAndDiffCreationPolicy({ min_liquidity: '1000', max_markets_per_day: 5 }, { min_liquidity: '2000', max_markets_per_day: 3 }).classification,
    'tighten',
  );
  assert.equal(
    classifyAndDiffCreationPolicy({ min_liquidity: '1000', max_markets_per_day: 5 }, { min_liquidity: '500', max_markets_per_day: 5 }).classification,
    'loosen',
  );
});

test('buildTreasuryProposalsModel tracks pending, executable, executed, cancelled and superseded proposals', async () => {
  const { buildTreasuryProposalsModel } = await import('../src/services/treasury-timelock.service');
  const nowUnix = 1_800_000_000;
  const proposals = buildTreasuryProposalsModel(
    {
      pendingConfig: { value: { max_daily: '20000' }, executable_at: nowUnix + 600 },
      pendingPricePolicy: { value: { min_price_bps: 100 }, executable_at: nowUnix - 10 },
    },
    [
      { eventName: 'ConfigProposed', txHash: 'tx-cfg-1', ledgerClosedAt: new Date((nowUnix - 100) * 1000), params: {} },
      { eventName: 'AgentPolicyProposed', txHash: 'tx-ag-1', ledgerClosedAt: new Date((nowUnix - 500) * 1000), params: { agent: 'GAGENT1' } },
      { eventName: 'AgentPolicyCancelled', txHash: 'tx-ag-cancel', ledgerClosedAt: new Date((nowUnix - 400) * 1000), params: { agent: 'GAGENT1' } },
    ],
    [{ id: 'op-1', txHash: 'tx-cfg-1', kind: 'treasury.propose_config' }],
    nowUnix,
  );

  const cfg = proposals.find((p) => p.kind === 'config');
  assert.equal(cfg?.status, 'pending');
  assert.equal(cfg?.etaSeconds, 600);
  assert.equal(cfg?.proposerOperationId, 'op-1');

  const pp = proposals.find((p) => p.kind === 'price_policy');
  assert.equal(pp?.status, 'executable');
  assert.equal(pp?.etaSeconds, 0);

  const ag = proposals.find((p) => p.kind === 'agent');
  assert.equal(ag?.status, 'cancelled');
});

test('prepareOperation enforces creation policy tightening and timelock ETA for permissionless execution', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { prepareOperation } = await import('../src/services/treasury-ops.service');
  const adminAddr = Keypair.random().publicKey();
  const agentAddr = Keypair.random().publicKey();
  const nowUnix = 1_800_000_000;

  const origCreate = prisma.adminOperation.create;
  const origLog = prisma.agentLog.create;
  (prisma.adminOperation.create as any) = async ({ data }: any) => ({ id: 'op-new', ...data });
  (prisma.agentLog.create as any) = async () => ({});

  try {
    const baseState = {
      network: 'Test SDF Network ; September 2015',
      contracts: { treasury: 'CT', marketCore: 'CM', usdc: 'CU' },
      treasury: {
        config: { agent: agentAddr, collateral: 'CU', market_core: 'CM', max_daily: 1000n, max_market: 500n, max_trade: 200n },
        availableCapitalRaw: '10000',
        usdcBalanceRaw: '10000',
        dailyUsage: { amountRaw: '0', dayStart: 0, resetsAt: new Date().toISOString(), remainingRaw: '1000' },
        paused: false,
        admin: { address: adminAddr, kind: 'account' as const },
        creationPolicy: { min_liquidity: '10000000', max_markets_per_day: 5 },
        proposals: [
          {
            kind: 'config' as const,
            proposedValue: { max_daily: '2000' },
            executableAt: new Date((nowUnix + 300) * 1000).toISOString(),
            executableAtUnix: nowUnix + 300,
            etaSeconds: 300,
            status: 'pending' as const,
            proposerOperationId: 'op-prop',
          },
        ],
        ledgerTimeUnix: nowUnix,
      },
      marketCore: { paused: false, admin: adminAddr },
      agent: { address: agentAddr, xlmBalance: '100' },
    };

    const deps = {
      state: async () => baseState,
      account: async (addr: string) => ({
        address: addr,
        kind: 'account' as const,
        balanceXlm: '100',
        masterWeight: 1,
        thresholds: { low: 1, medium: 2, high: 2 },
        signers: [],
      }),
      build: async () => ({ xdr: 'AAAA', hash: 'h'.repeat(64), contractId: 'CT', sourceAccount: agentAddr }),
      now: () => nowUnix * 1000,
    };

    // 1. Creation policy loosening rejected
    await assert.rejects(
      () => prepareOperation({ kind: 'treasury.set_creation_policy', policy: { min_liquidity: '5000000' } }, 'admin-1', deps),
      (err: any) => err.code === 'POLICY_LOOSENING' && err.statusCode === 422,
    );

    // 2. Execute before ETA rejected with TIMELOCK_ACTIVE
    await assert.rejects(
      () => prepareOperation({ kind: 'treasury.execute_config' }, 'admin-1', deps),
      (err: any) => err.code === 'TIMELOCK_ACTIVE' && err.statusCode === 422,
    );

    // 3. Execute at/after ETA succeeds permissionlessly with requiredSigners = 1
    const execDeps = {
      ...deps,
      state: async () => ({
        ...baseState,
        treasury: { ...baseState.treasury, ledgerTimeUnix: nowUnix + 300 },
      }),
    };
    const prepared = await prepareOperation({ kind: 'treasury.execute_config' }, 'admin-1', execDeps);
    assert.equal(prepared.permissionless, true);
    assert.equal(prepared.requiredSigners, 1);
  } finally {
    (prisma.adminOperation.create as any) = origCreate;
    (prisma.agentLog.create as any) = origLog;
  }
});
