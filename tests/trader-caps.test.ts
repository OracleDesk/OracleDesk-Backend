import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';
import { USDC, budget, fakeTraderEnv, market, pool, T0 } from './helpers/fake-trader-env';

setupTestEnv();

async function policy() {
  const { DEFAULT_PARAMS, runTraderPolicy } = await import('../src/agents/trader-policy');
  return { params: { ...DEFAULT_PARAMS, headroomSafetyBps: 500 }, run: runTraderPolicy };
}

// With 10 000 USDC free, p_conservative 0.70 vs price 0.55 in a deep pool,
// half-Kelly on the curve hits the 2.5% position cap: a 250 USDC size.

test('kelly size above max_trade is clamped and binding=MAX_TRADE', async () => {
  const { params, run } = await policy();
  const env = fakeTraderEnv({ budget: async () => budget({ maxTradeRaw: 100n * USDC }) });
  await run(env, params);
  assert.equal(env.buys.length, 1);
  const [order] = env.buys;
  assert.equal(order.amountRaw, 100n * USDC);
  assert.equal(order.amount, 100);
  assert.equal(order.sizing.binding, 'MAX_TRADE');
  // The caps bound the curve optimisation (#225): the optimum within them is max_trade.
  assert.equal(order.sizing.kellyRaw, (100n * USDC).toString());
  assert.equal(order.sizing.finalRaw, (100n * USDC).toString());
  assert.equal(order.sizing.budget.maxTradeRaw, (100n * USDC).toString());
  assert.equal(typeof order.sizing.budget.readAt, 'string', 'the snapshot is JSON-safe');
});

test('market headroom from TradeAuthorized market_total clamps size', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { marketExposureRaw } = await import('../src/services/treasury-budget.service');
  const orig = prisma.chainEvent.findFirst;
  let where: any;
  (prisma.chainEvent.findFirst as any) = async (args: any) => {
    where = args.where;
    return { params: { market_id: '7', agent: 'G…', amount: '50000000', market_total: '1950000000', daily_total: '1950000000' } };
  };
  try {
    const exposure = await marketExposureRaw('m1', 7n);
    assert.deepEqual(exposure, { totalRaw: 195n * USDC, estimated: false });
    assert.deepEqual(where, {
      contractName: 'treasury', eventName: 'TradeAuthorized', params: { path: ['market_id'], equals: '7' },
    });
  } finally {
    (prisma.chainEvent.findFirst as any) = orig;
  }

  // 300 cap − 195 spent = 105 headroom, minus the 5% margin = 99.75 USDC.
  const { params, run } = await policy();
  const env = fakeTraderEnv({ budget: async () => budget({ maxMarketRaw: 300n * USDC }), exposureRaw: 195n * USDC });
  await run(env, params);
  assert.equal(env.buys[0].amountRaw, 997_500_000n);
  assert.equal(env.buys[0].sizing.binding, 'MAX_MARKET');
  assert.equal(env.buys[0].sizing.marketExposureRaw, (195n * USDC).toString());
});

test('market headroom falls back to DB trades + seed and is marked estimated', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { marketExposureRaw } = await import('../src/services/treasury-budget.service');
  const orig = { ev: prisma.chainEvent.findFirst, trades: prisma.trade.findMany, market: prisma.market.findUnique };
  let eventQueries = 0;
  (prisma.chainEvent.findFirst as any) = async () => { eventQueries++; return null; };
  (prisma.trade.findMany as any) = async ({ where }: any) => {
    assert.deepEqual(where, { marketId: 'm1', status: 'EXECUTED' });
    return [
      { collateralRaw: '125000000', amountRaw: null },
      { collateralRaw: null, amountRaw: '72500000' },
    ];
  };
  (prisma.market.findUnique as any) = async () => ({ seedAmountRaw: '500000000' });
  try {
    assert.deepEqual(await marketExposureRaw('m1', 7n), { totalRaw: 697_500_000n, estimated: true });
    assert.equal(eventQueries, 1);
    // A market not on-chain yet has no events to look for.
    assert.deepEqual(await marketExposureRaw('m1', null), { totalRaw: 697_500_000n, estimated: true });
    assert.equal(eventQueries, 1);
  } finally {
    (prisma.chainEvent.findFirst as any) = orig.ev;
    (prisma.trade.findMany as any) = orig.trades;
    (prisma.market.findUnique as any) = orig.market;
  }
});

test('daily remaining with safety margin clamps size; zero remaining skips trade', async () => {
  const { params, run } = await policy();
  // 1 000 cap − 900 used = 100, minus 5% = 95 USDC.
  const tight = fakeTraderEnv({ budget: async () => budget({ maxDailyRaw: 1_000n * USDC, dailyUsedRaw: 900n * USDC }) });
  await run(tight, params);
  assert.equal(tight.buys[0].amountRaw, 95n * USDC);
  assert.equal(tight.buys[0].sizing.binding, 'DAILY');

  const spent = fakeTraderEnv({ budget: async () => budget({ maxDailyRaw: 1_000n * USDC, dailyUsedRaw: 1_000n * USDC }) });
  await run(spent, params);
  assert.equal(spent.buys.length, 0);
  const skip = spent.decisions.find((d) => d.kind === 'SKIP')!;
  assert.equal(skip.data.reason, 'SIZE_BELOW_MIN');
  assert.equal((skip.data.sizing as any).binding, 'DAILY');
});

test('orders in one cycle see the headroom earlier orders used', async () => {
  const { params, run } = await policy();
  const env = fakeTraderEnv({
    budget: async () => budget({ maxDailyRaw: 300n * USDC }),
    markets: [market({ id: 'm1' }), market({ id: 'm2' })],
  });
  await run(env, params);
  assert.deepEqual(env.buys.map((b) => [b.marketId, b.amountRaw, b.sizing.binding]), [
    ['m1', 250n * USDC, 'KELLY'],
    ['m2', 475_000_000n, 'DAILY'], // (300 − 250) × 0.95
  ]);
});

test('correlation cuts are recorded as binding=CORRELATION', async () => {
  const { params, run } = await policy();
  const env = fakeTraderEnv({ correlationKeep: 0.5 });
  await run(env, params);
  assert.equal(env.buys[0].amountRaw, 125n * USDC);
  assert.equal(env.buys[0].sizing.binding, 'CORRELATION');
  assert.equal(env.buys[0].sizing.correlationRaw, (125n * USDC).toString());
});

test('budget read failure skips the cycle and logs TREASURY_READ_FAILED', async () => {
  const { params, run } = await policy();
  const env = fakeTraderEnv({ budget: async () => { throw new Error('rpc unreachable'); } });
  await run(env, params);
  assert.equal(env.buys.length, 0);
  assert.deepEqual(env.calls, ['budget'], 'nothing else runs: no constant fallback');
  assert.equal(env.decisions[0].kind, 'TREASURY_READ_FAILED');
  assert.match(String(env.decisions[0].data.error), /rpc unreachable/);

  // Production writes the durable decision record and retains the agent log.
  const { prisma } = await import('../src/lib/prisma');
  const { prodTraderEnv } = await import('../src/agents/trader-env');
  const logs: any[] = [];
  const decisions: any[] = [];
  const orig = { log: prisma.agentLog.create, decision: prisma.agentDecision.upsert };
  (prisma.agentLog.create as any) = async ({ data }: any) => { logs.push(data); return data; };
  (prisma.agentDecision.upsert as any) = async ({ create }: any) => { decisions.push(create); return create; };
  try {
    const { DEFAULT_PARAMS } = await import('../src/agents/trader-policy');
    await prodTraderEnv(DEFAULT_PARAMS).recordDecision(env.decisions[0]);
    assert.equal(logs[0].action, 'TREASURY_READ_FAILED');
    assert.equal(logs[0].agentType, 'TRADER');
    assert.equal(decisions[0].reasonCode, 'TREASURY_READ_FAILED');
    assert.match(decisions[0].inputsDigest, /^[a-f0-9]{64}$/);
  } finally {
    (prisma.agentLog.create as any) = orig.log;
    (prisma.agentDecision.upsert as any) = orig.decision;
  }
});

test('bankroll for drawdown and correlation equals available capital', async () => {
  const { params, run } = await policy();
  // A 40 USDC loss is 4% of 1 000 (pause at 3%) but 0.4% of 10 000.
  const small = fakeTraderEnv({ budget: async () => budget({ availableRaw: 1_000n * USDC }), closedPnl: [-40n * USDC] });
  await run(small, params);
  assert.equal(small.decisions[0].kind, 'DRAWDOWN_PAUSE');
  assert.equal(small.buys.length, 0);

  const large = fakeTraderEnv({ budget: async () => budget({ availableRaw: 10_000n * USDC }), closedPnl: [-40n * USDC] });
  await run(large, params);
  assert.ok(!large.decisions.some((d) => d.kind === 'DRAWDOWN_PAUSE'));
  assert.deepEqual(large.correlationBankrolls, [10_000]);
  assert.equal(large.buys[0].sizing.kellyRaw, (250n * USDC).toString(), 'Kelly sizes from available capital');
});

test('a budget older than budgetMaxAgeMs is re-read before the next order', async () => {
  const { params, run } = await policy();
  let t = T0.getTime();
  const env = fakeTraderEnv({ markets: [market({ id: 'm1' }), market({ id: 'm2' })], now: () => new Date((t += 40_000)) });
  await run(env, params);
  assert.ok(env.budgetReads >= 2);
  const fixed = fakeTraderEnv({ markets: [market({ id: 'm1' }), market({ id: 'm2' })] });
  await run(fixed, params);
  assert.equal(fixed.budgetReads, 1);
});

test('readTreasuryBudget mirrors the contract views', async () => {
  const { readTreasuryBudget } = await import('../src/services/treasury-budget.service');
  const b = await readTreasuryBudget({
    availableCapital: async () => 123n,
    getConfig: async () => ({ max_trade: 10n, max_market: 20n, max_daily: 30n }),
    dailyUsage: async () => ({ amount: 45n, day_start: 1_792_310_400n }),
  }, T0);
  assert.equal(b.dailyRemainingRaw, 0n, 'never negative');
  assert.equal(b.dailyUsedRaw, 45n);
  assert.equal(b.dailyWindowStart.toISOString(), new Date(1_792_310_400_000).toISOString());
  assert.equal(b.dailyResetsAt.getTime() - b.dailyWindowStart.getTime(), 86_400_000);
  assert.equal(b.readAt, T0);
});

test('clampSize never returns negative or exceeds any limit (property test over random bigints)', async () => {
  const { clampSize, withSafetyMargin } = await import('../src/services/treasury-budget.service');
  const { mulberry32 } = await import('../src/backtest/rng');
  const rng = mulberry32(76);
  const big = () => {
    const r = rng();
    // Mix of zeros, negatives, small and very large values.
    if (r < 0.05) return 0n;
    if (r < 0.1) return -BigInt(Math.floor(rng() * 1e9));
    return BigInt(Math.floor(rng() * 1e9)) * BigInt(1 + Math.floor(rng() * 1e6));
  };
  for (let i = 0; i < 5_000; i++) {
    const b = budget({ availableRaw: big(), maxTradeRaw: big(), dailyRemainingRaw: big() });
    const desired = big();
    const headroom = big();
    const bps = Math.floor(rng() * 10_000);
    const { sizeRaw, binding } = clampSize(desired, b, headroom, bps);
    const limits = {
      MAX_TRADE: b.maxTradeRaw,
      MAX_MARKET: withSafetyMargin(headroom, bps),
      DAILY: withSafetyMargin(b.dailyRemainingRaw, bps),
      AVAILABLE: b.availableRaw,
    };
    assert.ok(sizeRaw >= 0n, `negative size at case ${i}`);
    assert.ok(sizeRaw <= (desired > 0n ? desired : 0n));
    for (const [name, limit] of Object.entries(limits)) assert.ok(sizeRaw <= (limit > 0n ? limit : 0n), `${name} exceeded at case ${i}`);
    // Maximal: it equals the smallest of the bounds.
    const floor = [desired, ...Object.values(limits)].map((x) => (x > 0n ? x : 0n)).reduce((a, c) => (c < a ? c : a));
    assert.equal(sizeRaw, floor);
    if (binding !== 'KELLY') assert.equal(sizeRaw, (limits as any)[binding] > 0n ? (limits as any)[binding] : 0n);
  }
});

test('executeTrade submits amountRaw without a float round trip', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { setChainOverrides } = await import('../src/services/chain.service');
  const { executeTrade } = await import('../src/services/trade.service');
  const orig = { m: prisma.market.findUnique, p: prisma.position.findFirst, c: prisma.trade.create, u: prisma.trade.update, l: prisma.agentLog.create };
  (prisma.market.findUnique as any) = async () => ({ id: 'm1', onChainMarketId: 7n });
  (prisma.position.findFirst as any) = async () => null;
  (prisma.trade.create as any) = async ({ data }: any) => ({ id: 't1', ...data });
  (prisma.trade.update as any) = async ({ data }: any) => data;
  (prisma.agentLog.create as any) = async ({ data }: any) => data;
  let sent: any;
  const prev = setChainOverrides({
    getOnChainMarket: async () => ({ fee_bps: 100 }) as any,
    quoteBuy: async () => 200_000_000n,
    agentBuy: (async (args: any) => {
      sent = typeof args === 'function' ? await args() : args;
      return { mode: 'dry-run', method: 'agent_buy', value: 200_000_000n, txHash: null };
    }) as any,
  });
  try {
    // 123456789 base units is 12.3456789 USDC; the float says 12.35 on purpose.
    await executeTrade({ marketId: 'm1', direction: 'YES', amount: 12.35, amountRaw: 123_456_789n, price: 0.55, kellyFraction: 0.02, edgeDetected: 0.2 });
    assert.equal(sent.collateral_in, 123_456_789n);
  } finally {
    setChainOverrides(prev);
    (prisma.market.findUnique as any) = orig.m;
    (prisma.position.findFirst as any) = orig.p;
    (prisma.trade.create as any) = orig.c;
    (prisma.trade.update as any) = orig.u;
    (prisma.agentLog.create as any) = orig.l;
  }
});

test('TradeCapExceeded from chain is logged as TREASURY_CAP_REJECTED', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { setChainOverrides } = await import('../src/services/chain.service');
  const { ChainError } = await import('../src/services/stellar/errors');
  const { executeTrade } = await import('../src/services/trade.service');
  const orig = { m: prisma.market.findUnique, p: prisma.position.findFirst, c: prisma.trade.create, u: prisma.trade.update, l: prisma.agentLog.create };
  const logs: any[] = [];
  const updates: any[] = [];
  (prisma.market.findUnique as any) = async () => ({ id: 'm1', onChainMarketId: 7n });
  (prisma.position.findFirst as any) = async () => null;
  (prisma.trade.create as any) = async ({ data }: any) => ({ id: 't1', ...data });
  (prisma.trade.update as any) = async ({ data }: any) => { updates.push(data); return data; };
  (prisma.agentLog.create as any) = async ({ data }: any) => { logs.push(data); return data; };
  const prev = setChainOverrides({
    getOnChainMarket: async () => ({ fee_bps: 100 }) as any,
    agentBuy: (async () => { throw new ChainError('agent_buy failed: TradeCapExceeded', 'TradeCapExceeded', { method: 'agent_buy' }); }) as any,
  });
  const snapshot = { availableRaw: '1', maxTradeRaw: '2', maxMarketRaw: '3', maxDailyRaw: '4', dailyUsedRaw: '0', dailyRemainingRaw: '4', dailyWindowStart: T0.toISOString(), dailyResetsAt: T0.toISOString(), readAt: T0.toISOString() };
  try {
    await assert.rejects(
      executeTrade({ marketId: 'm1', direction: 'NO', amount: 50, amountRaw: 50n * USDC, budget: snapshot, price: 0.45, kellyFraction: 0.02, edgeDetected: -0.2 }),
      (err: any) => err.code === 'TRADE_FAILED',
    );
    const rejected = logs.find((l) => l.action === 'TREASURY_CAP_REJECTED');
    assert.ok(rejected, `actions: ${logs.map((l) => l.action).join(',')}`);
    assert.equal(rejected.level, 'WARN');
    assert.equal(rejected.data.contractError, 'TradeCapExceeded');
    assert.equal(rejected.data.amountRaw, (50n * USDC).toString());
    assert.deepEqual(rejected.data.budget, snapshot);
    assert.equal(updates[updates.length - 1].status, 'FAILED');
  } finally {
    setChainOverrides(prev);
    (prisma.market.findUnique as any) = orig.m;
    (prisma.position.findFirst as any) = orig.p;
    (prisma.trade.create as any) = orig.c;
    (prisma.trade.update as any) = orig.u;
    (prisma.agentLog.create as any) = orig.l;
  }
});

// ─── Sizing against the FPMM curve (#225) ─────────────────────────────────────

/** A ~1 800 USDC pool: a hundred USDC moves it enough that the curve, not a cap, sets the size. */
const thinPool = (yesProb = 0.55) => pool(yesProb, { seedUsdc: 1_000n });

test('a thin pool sizes below every cap: binding=IMPACT, from the same sizer and inputs', async () => {
  const { params, run } = await policy();
  const { sizeAgainstPool } = await import('../src/services/impact-kelly');
  const { assertCanonicalSafe } = await import('../src/utils/hash.util');
  const p = thinPool();
  const env = fakeTraderEnv({ pool: () => p });
  await run(env, params);
  assert.equal(env.buys.length, 1, JSON.stringify(env.decisions));
  const [order] = env.buys;
  assert.equal(order.sizing.binding, 'IMPACT');
  assert.ok(order.amountRaw < 250n * USDC, `${order.amountRaw} is below the 2.5% cap`);

  const expected = sizeAgainstPool({
    p: 0.7, side: 'YES', pool: p, wealthRaw: 10_000n * USDC, maxRaw: 250n * USDC, kellyMultiplier: 0.5, minRaw: USDC,
  });
  assert.equal(order.amountRaw, expected.collateralRaw);
  assert.equal(order.sizing.kellyRaw, expected.collateralRaw.toString());
  assert.equal(order.conservativeProb, 0.7);
  assert.deepEqual(order.sizing.impact, {
    model: 'impact',
    midBps: expected.midBps,
    avgPriceBps: expected.avgPriceBps,
    postPriceBps: expected.postPriceBps,
    impactBps: expected.impactBps,
    feeRaw: expected.feeRaw.toString(),
    expectedSharesRaw: expected.sharesOutRaw.toString(),
    effectiveEdge: expected.effectiveEdge.toFixed(6),
    poolLedger: 1_000,
    poolSource: 'indexed',
  });
  assert.ok(order.sizing.impact.avgPriceBps < 7000 && order.sizing.impact.postPriceBps > order.sizing.impact.midBps);
  assert.ok(order.sizing.impact.impactBps > 0);
  // Strings and integers only: the block embeds in the pinned trace as is.
  assertCanonicalSafe(order.sizing);
  assert.ok(Object.values(order.sizing.impact).every((v) => typeof v === 'string' || Number.isInteger(v)));
});

test('a correlation cut re-optimises within the smaller bound: binding=CORRELATION', async () => {
  const { params, run } = await policy();
  const env = fakeTraderEnv({ pool: () => thinPool(), correlationKeep: 0.5 });
  await run(env, params);
  const [order] = env.buys;
  const kellyRaw = BigInt(order.sizing.kellyRaw);
  // Correlation saw the curve-optimal size, once, and its cut is the final size.
  assert.equal(env.correlationSizes.length, 1);
  assert.equal(env.correlationSizes[0], Number(kellyRaw) / 1e7);
  assert.equal(order.sizing.binding, 'CORRELATION');
  assert.equal(order.sizing.finalRaw, order.sizing.correlationRaw);
  assert.ok(order.amountRaw < kellyRaw && order.amountRaw >= kellyRaw / 2n - 100_000n);
  // The recorded fill is re-quoted at the final size.
  assert.ok(BigInt(order.sizing.impact.expectedSharesRaw) > order.amountRaw);
});

test('reserves older than TRADER_POOL_MAX_AGE_LEDGERS skip the market with POOL_STALE', async () => {
  const { params, run } = await policy();
  const { config } = await import('../src/config');
  const limit = config.TRADER_POOL_MAX_AGE_LEDGERS;
  assert.equal(limit, 120, 'default is valuation DEFAULT_MAX_AGE_LEDGERS');

  const stale = fakeTraderEnv({ pool: () => pool(0.55, { lagLedgers: limit + 1, source: 'rpc' }) });
  await run(stale, params);
  assert.equal(stale.buys.length, 0);
  const skip = stale.decisions.find((d) => d.kind === 'SKIP')!;
  assert.equal(skip.data.reason, 'POOL_STALE');
  assert.equal(skip.data.lagLedgers, limit + 1);
  assert.equal(skip.data.poolLedger, 1_000);
  assert.equal(skip.data.poolSource, 'rpc');

  const fresh = fakeTraderEnv({ pool: () => pool(0.55, { lagLedgers: limit }) });
  await run(fresh, params);
  assert.equal(fresh.buys.length, 1);

  const missing = fakeTraderEnv({ pool: () => null });
  missing.price = async () => ({ yesBps: 5500n, reserveYes: 1n, reserveNo: 1n, feeBps: 0n, asOfLedger: 1, source: 'indexed', lagLedgers: 0 });
  await run(missing, params);
  assert.equal(missing.buys.length, 0);
  assert.equal(missing.decisions.find((d) => d.kind === 'SKIP')!.data.reason, 'POOL_UNAVAILABLE');
});

test('a NO order is sized on the NO side of the pool against 1 − ci.upper', async () => {
  const { params, run } = await policy();
  const { sizeAgainstPool } = await import('../src/services/impact-kelly');
  const p = thinPool();
  const env = fakeTraderEnv({ pool: () => p, forecast: () => ({ p: 0.3, ci: { lower: 0.25, upper: 0.35 }, sources: [] }) });
  await run(env, params);
  const [order] = env.buys;
  assert.equal(order.direction, 'NO');
  assert.ok(Math.abs(order.conservativeProb - 0.65) < 1e-12);
  const expected = sizeAgainstPool({
    p: 1 - 0.35, side: 'NO', pool: p, wealthRaw: 10_000n * USDC, maxRaw: 250n * USDC, kellyMultiplier: 0.5, minRaw: USDC,
  });
  assert.equal(order.amountRaw, expected.collateralRaw);
  assert.equal(order.sizing.impact.midBps, Number((p.reserveYes * 10_000n) / (p.reserveYes + p.reserveNo)), 'the NO mid');
});

test('a second order in the cycle optimises against the wealth the first one left', async () => {
  const { params, run } = await policy();
  const { sizeAgainstPool } = await import('../src/services/impact-kelly');
  const p = thinPool();
  const env = fakeTraderEnv({ pool: () => p, markets: [market({ id: 'm1' }), market({ id: 'm2' })] });
  await run(env, params);
  assert.equal(env.buys.length, 2);
  const [first, second] = env.buys;
  const left = 10_000n * USDC - first.amountRaw;
  assert.equal(second.sizing.budget.availableRaw, left.toString());
  const expected = sizeAgainstPool({
    p: 0.7, side: 'YES', pool: p, wealthRaw: left, maxRaw: (left * 250n) / 10_000n, kellyMultiplier: 0.5, minRaw: USDC,
  });
  assert.equal(second.amountRaw, expected.collateralRaw);
  assert.ok(second.amountRaw < first.amountRaw);
});

test('fee and impact that eat the conservative edge on the smallest order skip with NO_EDGE_AT_MARGIN', async () => {
  const { params, run } = await policy();
  // p_conservative 0.64 vs mid 0.55 clears MIN_EDGE, but a 30% fee does not.
  const env = fakeTraderEnv({
    pool: () => pool(0.55, { feeBps: 3_000n }),
    forecast: () => ({ p: 0.7, ci: { lower: 0.64, upper: 0.76 }, sources: [] }),
  });
  await run(env, params);
  assert.equal(env.buys.length, 0);
  const skip = env.decisions.find((d) => d.kind === 'SKIP')!;
  assert.equal(skip.data.reason, 'NO_EDGE_AT_MARGIN');
  assert.equal((skip.data.sizing as any).finalRaw, '0');
});

test('poolFromChain tags reserves with a real ledger and measures lag from the RPC', async () => {
  const { poolFromChain } = await import('../src/agents/trader-env');
  const reserves = { reserveYes: 4n, reserveNo: 6n, feeBps: 150n };
  const deps = (source: 'indexed' | 'rpc', cursorLedger: number | null) => ({
    reserves: async () => ({ ...reserves, asOfLedger: source === 'rpc' ? 0 : 900, source }),
    marketWithLedger: async () => ({ reserveYes: 5n, reserveNo: 5n, feeBps: 150n, ledger: 1_990 }),
    latestLedger: async () => 2_000,
    indexerLag: async (latest: number) => ({ cursorLedger, lagLedgers: cursorLedger === null ? null : latest - cursorLedger }),
  });
  // Indexed: valid up to the indexer cursor, however old the newest Trade is.
  assert.deepEqual(await poolFromChain(7n, deps('indexed', 1_950)), { ...reserves, asOfLedger: 1_950, source: 'indexed', lagLedgers: 50 });
  assert.deepEqual(await poolFromChain(7n, deps('indexed', null)), { ...reserves, asOfLedger: 900, source: 'indexed', lagLedgers: 1_100 });
  // RPC: get_market's simulation ledger, never 0, with the market's own fee.
  assert.deepEqual(await poolFromChain(7n, deps('rpc', null)), { reserveYes: 5n, reserveNo: 5n, feeBps: 150n, asOfLedger: 1_990, source: 'rpc', lagLedgers: 10 });
});

test('execution re-quote cancels when the fresh average price has consumed the conservative edge', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { setChainOverrides } = await import('../src/services/chain.service');
  const { executeTrade } = await import('../src/services/trade.service');
  const orig = { m: prisma.market.findUnique, p: prisma.position.findFirst, c: prisma.trade.create, u: prisma.trade.update, l: prisma.agentLog.create };
  const updates: any[] = [];
  const logs: any[] = [];
  (prisma.market.findUnique as any) = async () => ({ id: 'm1', onChainMarketId: 7n });
  (prisma.position.findFirst as any) = async () => null;
  (prisma.trade.create as any) = async ({ data }: any) => ({ id: 't1', ...data });
  (prisma.trade.update as any) = async ({ data }: any) => { updates.push(data); return data; };
  (prisma.agentLog.create as any) = async ({ data }: any) => { logs.push(data); return data; };
  let quotedShares = 0n;
  let sent: any;
  const prev = setChainOverrides({
    getOnChainMarket: async () => ({ fee_bps: 100 }) as any,
    quoteBuy: async () => quotedShares,
    agentBuy: (async (args: any) => {
      sent = typeof args === 'function' ? await args() : args;
      return { mode: 'dry-run', method: 'agent_buy', value: quotedShares, txHash: null };
    }) as any,
  });
  const order = { marketId: 'm1', direction: 'YES' as const, amount: 100, amountRaw: 100n * USDC, price: 0.55, kellyFraction: 0.01, edgeDetected: 0.2, conservativeProb: 0.7 };
  try {
    // 100 USDC for 142.857 shares: 0.7000 a share, exactly the conservative probability.
    quotedShares = 1_428_571_428n;
    await assert.rejects(executeTrade(order), (err: any) => err.code === 'EDGE_CONSUMED');
    assert.ok(sent === undefined, 'nothing was built or sent');
    assert.equal(updates[0].status, 'CANCELLED');
    assert.equal(updates[0].errorMessage, 'edge consumed by price movement');
    assert.equal(logs.find((l) => l.action === 'EDGE_CONSUMED').data.avgPriceBps, '7000');

    // 0.6999 a share still has edge: the order goes out with the usual slippage bound.
    updates.length = 0;
    quotedShares = 1_428_775_540n;
    await executeTrade(order);
    assert.equal(sent.collateral_in, 100n * USDC);
    assert.equal(sent.min_shares_out, (quotedShares * 9_900n) / 10_000n, 'min_shares_out logic unchanged');
  } finally {
    setChainOverrides(prev);
    (prisma.market.findUnique as any) = orig.m;
    (prisma.position.findFirst as any) = orig.p;
    (prisma.trade.create as any) = orig.c;
    (prisma.trade.update as any) = orig.u;
    (prisma.agentLog.create as any) = orig.l;
  }
});
