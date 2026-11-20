import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

async function withServer(fn: (base: string) => Promise<void>) {
  const { default: app } = await import('../src/app');
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

test('POST /oracle/resolve no longer exists', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/oracle/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"marketId":"x","yesWon":true}',
    });
    assert.equal(res.status, 404);
  });
});

test('POST /auth/connect no longer exists', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/auth/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"walletAddress":"0x0000000000000000000000000000000000000001"}',
    });
    assert.equal(res.status, 404);
  });
});

test('POST /markets/generate requires an admin', async () => {
  const { signToken } = await import('../src/middlewares/auth.middleware');
  await withServer(async (base) => {
    const anon = await fetch(`${base}/api/v1/markets/generate`, { method: 'POST' });
    assert.equal(anon.status, 401);
    const token = signToken('u1', Keypair.random().publicKey());
    const nonAdmin = await fetch(`${base}/api/v1/markets/generate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(nonAdmin.status, 403);
    assert.equal((await nonAdmin.json()).error.code, 'FORBIDDEN');
  });
});

test('GET /admin/trace-audit requires an admin', async () => {
  const { signToken } = await import('../src/middlewares/auth.middleware');
  await withServer(async (base) => {
    const anon = await fetch(`${base}/api/v1/admin/trace-audit`);
    assert.equal(anon.status, 401);
    const token = signToken('u1', Keypair.random().publicKey());
    const nonAdmin = await fetch(`${base}/api/v1/admin/trace-audit`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(nonAdmin.status, 403);
    assert.equal((await nonAdmin.json()).error.code, 'FORBIDDEN');
  });
});

test('CORS only allows configured origins', async () => {
  await withServer(async (base) => {
    const ok = await fetch(`${base}/health`, { headers: { origin: 'http://localhost:3000' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    const evil = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });
});

test('BigInt values serialise as decimal strings', async () => {
  const { default: app } = await import('../src/app');
  const replacer = app.get('json replacer');
  assert.equal(
    JSON.stringify({ id: 18446744073709551615n }, replacer),
    '{"id":"18446744073709551615"}',
  );
});

// ─── Issue 153 HTTP Tests ───────────────────────────────────────────────────

test('GET /api/v1/schemas/trace/v1.json returns application/schema+json with immutable caching', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/schemas/trace/v1.json`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/schema+json; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');

    const schema = await res.json();
    assert.equal(schema.schemaVersion, 1);
    assert.equal(schema.kind, 'oracledesk.trace');
    assert.ok(schema.$id);
  });
});

// ─── Issue 154 HTTP Tests ───────────────────────────────────────────────────

test('GET /traces/:id/key requires auth and an active pass', async () => {
  const { signToken } = await import('../src/middlewares/auth.middleware');
  await withServer(async (base) => {
    // 1. Without auth
    const anon = await fetch(`${base}/api/v1/traces/11111111-1111-1111-1111-111111111111/key`);
    assert.equal(anon.status, 401);

    // 2. With auth but without active subscription
    const token = signToken('u-test', Keypair.random().publicKey());
    const forbidden = await fetch(
      `${base}/api/v1/traces/11111111-1111-1111-1111-111111111111/key`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    assert.equal(forbidden.status, 403);
  });
});

test('internal key release rejects bad HMAC and replayed nonce', async () => {
  const { config } = await import('../src/config');
  (config as any).X402_KEY_RELEASE_SECRET = 'test-internal-secret-32-bytes-long';

  await withServer(async (base) => {
    const onChainId = '0';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = 'nonce-' + crypto.randomBytes(8).toString('hex');

    // 1. Bad HMAC signature
    const badSigRes = await fetch(`${base}/api/v1/internal/traces/${onChainId}/key`, {
      method: 'POST',
      headers: {
        'x-signature': 'bad-signature',
        'x-timestamp': timestamp,
        'x-nonce': nonce,
      },
    });
    assert.equal(badSigRes.status, 401);
    const badJson = await badSigRes.json();
    assert.equal(badJson.error.code, 'INVALID_SIGNATURE');

    // 2. Valid signature
    const validSig = crypto
      .createHmac('sha256', (config as any).X402_KEY_RELEASE_SECRET)
      .update(`${timestamp}:${nonce}:${onChainId}`)
      .digest('hex');

    const firstRes = await fetch(`${base}/api/v1/internal/traces/${onChainId}/key`, {
      method: 'POST',
      headers: {
        'x-signature': validSig,
        'x-timestamp': timestamp,
        'x-nonce': nonce,
      },
    });
    // Trace 0 not found in DB in this test, but auth succeeded!
    assert.equal(firstRes.status, 404);

    // 3. Replayed nonce with valid signature
    const replayRes = await fetch(`${base}/api/v1/internal/traces/${onChainId}/key`, {
      method: 'POST',
      headers: {
        'x-signature': validSig,
        'x-timestamp': timestamp,
        'x-nonce': nonce,
      },
    });
    assert.equal(replayRes.status, 401);
    const replayJson = await replayRes.json();
    assert.equal(replayJson.error.code, 'REPLAYED_NONCE');
  });
});

// ─── Issue 155 HTTP Tests ───────────────────────────────────────────────────

test('GET /leaderboard validates window and metric', async () => {
  await withServer(async (base) => {
    // 1. Invalid window
    const badWindow = await fetch(`${base}/api/v1/leaderboard?window=invalid`);
    assert.equal(badWindow.status, 400);

    // 2. Invalid metric
    const badMetric = await fetch(`${base}/api/v1/leaderboard?metric=invalid`);
    assert.equal(badMetric.status, 400);

    // 3. Valid defaults
    const valid = await fetch(`${base}/api/v1/leaderboard`);
    assert.equal(valid.status, 200);
    const json = await valid.json();
    assert.equal(json.ok, true);
    assert.ok(Array.isArray(json.data));
  });
});

test('GET /wallets/:address/stats rejects malformed addresses', async () => {
  await withServer(async (base) => {
    // 1. Invalid address
    const badAddr = await fetch(`${base}/api/v1/wallets/not-a-valid-stellar-address/stats`);
    assert.equal(badAddr.status, 400);
    const badJson = await badAddr.json();
    assert.equal(badJson.error.code, 'INVALID_ADDRESS');

    // 2. Valid G... address
    const validG = Keypair.random().publicKey();
    const okRes = await fetch(`${base}/api/v1/wallets/${validG}/stats`);
    assert.equal(okRes.status, 200);
    const okJson = await okRes.json();
    assert.equal(okJson.ok, true);
    assert.equal(okJson.data.wallet, validG);
  });
});

test('admin treasury routes require an admin (#156)', async () => {
  const { signToken } = await import('../src/middlewares/auth.middleware');
  await withServer(async (base) => {
    const anon = await fetch(`${base}/api/v1/admin/treasury`);
    assert.equal(anon.status, 401);
    const token = signToken('u1', Keypair.random().publicKey());
    const nonAdmin = await fetch(`${base}/api/v1/admin/treasury`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(nonAdmin.status, 403);
    assert.equal((await nonAdmin.json()).error.code, 'FORBIDDEN');
  });
});

test('PATCH /trade/copy/:id/confirm without auth is 401', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/trade/copy/some-id/confirm`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txHash: '11'.repeat(32) }),
    });
    assert.equal(res.status, 401);
  });
});

test('admin reconciliation routes require an admin (#83)', async () => {
  const { signToken } = await import('../src/middlewares/auth.middleware');
  await withServer(async (base) => {
    const token = signToken('u1', Keypair.random().publicKey());
    for (const [method, path] of [['POST', '/admin/reconciliation/run'], ['GET', '/admin/reconciliation/runs'], ['GET', '/admin/reconciliation/runs/abc']]) {
      const anon = await fetch(`${base}/api/v1${path}`, { method });
      assert.equal(anon.status, 401, `${method} ${path}`);
      const nonAdmin = await fetch(`${base}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}` } });
      assert.equal(nonAdmin.status, 403, `${method} ${path}`);
    }
  });
});

test('GET /portfolio derives capital from the treasury and serialises raw amounts as decimal strings (#76)', async () => {
  const { prisma } = await import('../src/lib/prisma');
  const { setChainOverrides } = await import('../src/services/chain.service');
  const USDC = 10_000_000n;
  const orig = {
    positions: prisma.position.findMany, agg: prisma.trade.aggregate,
    report: prisma.transparencyReport.findFirst, snap: prisma.correlationSnapshot.findFirst,
  };
  (prisma.position.findMany as any) = async ({ where }: any) =>
    where.status === 'OPEN' ? [{ size: 25, pnl: 0, costBasisRaw: '250000000', realisedPnlRaw: '0', unrealisedPnlRaw: '0', market: { id: 'm1', category: 'FED' } }] : [];
  (prisma.trade.aggregate as any) = async () => ({ _sum: { builderFee: 0 } });
  (prisma.transparencyReport.findFirst as any) = async () => null;
  (prisma.correlationSnapshot.findFirst as any) = async () => null;
  const prev = setChainOverrides({
    treasuryAvailableCapital: async () => 800n * USDC + 5n,
    treasuryRiskConfig: async () => ({ agent: 'G', collateral: 'C', market_core: 'M', max_trade: 50n * USDC, max_market: 100n * USDC, max_daily: 200n * USDC }),
    treasuryDailyUsage: async () => ({ amount: 15n * USDC, day_start: 1_792_310_400n }),
  });
  try {
    await withServer(async (base) => {
      const ok = await (await fetch(`${base}/api/v1/portfolio`)).json();
      assert.equal(ok.ok, true);
      assert.deepEqual(ok.data.treasury, {
        availableRaw: '8000000005',
        maxTradeRaw: '500000000',
        maxMarketRaw: '1000000000',
        maxDailyRaw: '2000000000',
        dailyUsedRaw: '150000000',
        dailyRemainingRaw: '1850000000',
        dailyResetsAt: new Date((1_792_310_400 + 86_400) * 1000).toISOString(),
      });
      assert.equal(ok.data.availableCapitalRaw, '8000000005');
      assert.equal(ok.data.availableCapital, 800);
      assert.equal(ok.data.deployedCapital, 25);
      assert.equal(ok.data.totalUsdc, 825);
      assert.equal(ok.data.correlationRisk.isOverExposed, false);
    });

    setChainOverrides({ treasuryAvailableCapital: async () => { throw new Error('rpc down'); } });
    await withServer(async (base) => {
      const down = await (await fetch(`${base}/api/v1/portfolio`)).json();
      assert.equal(down.ok, true);
      assert.equal(down.data.treasury, null);
      assert.equal(down.data.availableCapitalRaw, null);
      assert.equal(down.data.totalUsdc, null);
      assert.equal(down.data.availableCapital, null);
      assert.equal(down.data.deployedCapital, 25, 'database fields are still returned');
    });
  } finally {
    setChainOverrides(prev);
    (prisma.position.findMany as any) = orig.positions;
    (prisma.trade.aggregate as any) = orig.agg;
    (prisma.transparencyReport.findFirst as any) = orig.report;
    (prisma.correlationSnapshot.findFirst as any) = orig.snap;
  }
});

test('admin outbox console: chain.outbox.* permissions, step-up and one audit row per action (#221)', async () => {
  const { signToken } = await import('../src/middlewares/auth.middleware');
  const { prisma } = await import('../src/lib/prisma');
  const outbox = await import('../src/services/stellar/outbox');
  const { FakeRedis } = await import('./helpers/fake-redis');

  const reader = Keypair.random().publicKey();
  const operator = Keypair.random().publicKey();
  const outsider = Keypair.random().publicKey();
  const roles: Record<string, { roleName: string; permissions: string[] }> = {
    [reader]: { roleName: 'auditor', permissions: ['admin.read', 'chain.outbox.read'] },
    [operator]: { roleName: 'operator', permissions: ['admin.read', 'chain.outbox.read', 'chain.outbox.operate'] },
    [outsider]: { roleName: 'auditor', permissions: ['admin.read', 'admin.audit.read'] },
  };
  const id = crypto.randomUUID();
  const row: Record<string, unknown> = {
    id, kind: 'test.console', refId: null, status: 'FAILED', hash: 'ab'.repeat(32), feeBumpHashes: [],
    landedHash: null, returnValue: null, error: 'boom', handledAt: new Date(1_000), updatedAt: new Date(0),
  };
  const audits: Array<{ data: Record<string, any> }> = [];
  const orig = {
    role: prisma.adminRoleAssignment.findUnique,
    audit: prisma.adminAuditLog.create,
    chainTransaction: (prisma as any).chainTransaction,
  };
  (prisma.adminRoleAssignment.findUnique as any) = async ({ where }: { where: { walletAddress: string } }) => {
    const r = roles[where.walletAddress];
    return r ? { roleName: r.roleName, role: { permissions: r.permissions.map((permissionKey) => ({ permissionKey })) } } : null;
  };
  (prisma.adminAuditLog.create as any) = async (args: { data: Record<string, any> }) => {
    audits.push(args);
    return args.data;
  };
  (prisma as any).chainTransaction = {
    findUnique: async ({ where }: { where: { id: string } }) => (where.id === id ? { ...row } : null),
    updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, unknown> }) => {
      if (where.id !== id) return { count: 0 };
      if ('handledAt' in where) {
        const current = row.handledAt as Date | null;
        const matches = where.handledAt === null ? current === null : current?.getTime() === where.handledAt.getTime();
        if (!matches) return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    },
  };
  outbox.setRowLeaseRedisForTest(new FakeRedis() as never);

  const fresh = (wallet: string) => signToken(`u-${wallet.slice(0, 6)}`, wallet);
  const stale = (wallet: string) => signToken(`u-${wallet.slice(0, 6)}`, wallet, { authTime: Math.floor(Date.now() / 1000) - 7 * 24 * 3600 });
  const body = JSON.stringify({ reason: 'handler fixed, re-applying the outcome' });
  try {
    await withServer(async (base) => {
      const api = `${base}/api/v1/admin/chain/transactions`;
      const post = (path: string, token: string, payload = body) =>
        fetch(`${api}/${id}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: payload });

      // No chain.outbox.* at all: 403 on reads and actions.
      assert.equal((await fetch(api, { headers: { authorization: `Bearer ${fresh(outsider)}` } })).status, 403);
      assert.equal((await fetch(`${api}/${id}`, { headers: { authorization: `Bearer ${fresh(outsider)}` } })).status, 403);
      // Read-only role: every action is 403.
      for (const path of ['recover', 'rerun-handler', 'abandon']) {
        const res = await post(path, fresh(reader));
        assert.equal(res.status, 403, path);
        assert.equal((await res.json()).error.code, 'FORBIDDEN');
      }
      // Operate without a fresh wallet signature: STEP_UP_REQUIRED.
      for (const path of ['recover', 'rerun-handler', 'abandon']) {
        const res = await post(path, stale(operator));
        assert.equal(res.status, 403, path);
        assert.equal((await res.json()).error.code, 'STEP_UP_REQUIRED');
      }
      assert.equal(audits.length, 0);

      // The reason is required.
      assert.equal((await post('rerun-handler', fresh(operator), '{"reason":"short"}')).status, 400);

      const ok = await post('rerun-handler', fresh(operator));
      assert.equal(ok.status, 200);
      const json = await ok.json();
      assert.equal(json.data.toStatus, 'FAILED');
      assert.equal(json.data.handled, true);
      assert.ok(row.handledAt, 'the handler re-ran and re-marked the row');

      // A terminal row cannot be abandoned.
      const refused = await post('abandon', fresh(operator));
      assert.equal(refused.status, 409);
      assert.equal((await refused.json()).error.code, 'OUTBOX_INVALID_STATE');
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(audits.length, 1, 'exactly one audit row: the generic request audit is off for these routes');
    assert.equal(audits[0].data.action, 'CHAIN_OUTBOX_RERUN_HANDLER');
    assert.equal(audits[0].data.actor, operator);
    assert.equal(audits[0].data.target, id);
    assert.deepEqual(
      { ...audits[0].data.metadata, outcome: undefined },
      {
        outboxId: id, kind: 'test.console', fromStatus: 'FAILED', toStatus: 'FAILED',
        reason: 'handler fixed, re-applying the outcome', hashes: ['ab'.repeat(32)], outcome: undefined,
      },
    );
  } finally {
    (prisma.adminRoleAssignment.findUnique as any) = orig.role;
    (prisma.adminAuditLog.create as any) = orig.audit;
    (prisma as any).chainTransaction = orig.chainTransaction;
    outbox.setRowLeaseRedisForTest(null);
  }
});
