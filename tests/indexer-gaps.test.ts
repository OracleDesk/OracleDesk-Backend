import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

const ADMIN = Keypair.random().publicKey();
process.env.ADMIN_ADDRESSES = ADMIN;

import { config } from '../src/config';
(config as any).ADMIN_ADDRESSES = [ADMIN];

import { planStart, CURSOR_ID, backfillEvents } from '../src/services/indexer.service';
import { isTainted, openGaps } from '../src/services/indexer/gaps';
import { prisma } from '../src/lib/prisma';
import type { IndexerGap } from '@prisma/client';

async function withServer(fn: (base: string) => Promise<void>) {
  const { default: app } = await import('../src/app');
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

test('indexer-gaps: planStart pure planner handles all boundary cases', () => {
  const health = { oldestLedger: 100, latestLedger: 200 };

  // 1. Normal resume: cursor within range
  const resumePlan = planStart(150, undefined, health);
  assert.deepEqual(resumePlan, { action: 'resume', startLedger: 151 });

  // 2. Idle: cursor reached or exceeded tip
  const idlePlan = planStart(200, undefined, health);
  assert.deepEqual(idlePlan, { action: 'idle', startLedger: 201, lastLedger: 200 });

  // 3. Gap RETENTION: cursor older than oldestLedger
  const retentionGap = planStart(80, undefined, health);
  assert.deepEqual(retentionGap, {
    action: 'gap',
    startLedger: 100,
    gap: { fromLedger: 81, toLedger: 99, kind: 'RETENTION' },
  });

  // 4. Gap INITIAL: cursor is null and deployLedger older than oldestLedger
  const initialGap = planStart(null, undefined, health, 50);
  assert.deepEqual(initialGap, {
    action: 'gap',
    startLedger: 100,
    gap: { fromLedger: 50, toLedger: 99, kind: 'INITIAL' },
  });

  // 5. Explicit fromLedger older than oldestLedger
  const explicitGap = planStart(null, 70, health);
  assert.deepEqual(explicitGap, {
    action: 'gap',
    startLedger: 100,
    gap: { fromLedger: 70, toLedger: 99, kind: 'INITIAL' },
  });

  // 6. Explicit fromLedger within range
  const explicitResume = planStart(null, 120, health);
  assert.deepEqual(explicitResume, { action: 'resume', startLedger: 120 });

  // 7. No cursor, no deployLedger: resumes from oldestLedger
  const cleanStart = planStart(null, undefined, health);
  assert.deepEqual(cleanStart, { action: 'resume', startLedger: 100 });
});

test('indexer-gaps: isTainted correctly evaluates taint conditions', () => {
  const mockGaps: IndexerGap[] = [
    {
      id: 'gap-1',
      network: 'stellar:testnet',
      fromLedger: 100,
      toLedger: 150,
      kind: 'RETENTION',
      detectedAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
      note: null,
    },
    {
      id: 'gap-2',
      network: 'stellar:testnet',
      fromLedger: 300,
      toLedger: 350,
      kind: 'INITIAL',
      detectedAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
      note: null,
    },
  ];

  // Empty gaps list -> not tainted
  assert.equal(isTainted([]), false);
  assert.equal(isTainted([], 120), false);

  // Gaps present, no range -> tainted
  assert.equal(isTainted(mockGaps), true);

  // Exact number inside gap -> tainted
  assert.equal(isTainted(mockGaps, 100), true);
  assert.equal(isTainted(mockGaps, 125), true);
  assert.equal(isTainted(mockGaps, 150), true);

  // Number outside gaps -> not tainted
  assert.equal(isTainted(mockGaps, 99), false);
  assert.equal(isTainted(mockGaps, 200), false);
  assert.equal(isTainted(mockGaps, 351), false);

  // Range overlap
  assert.equal(isTainted(mockGaps, { fromLedger: 90, toLedger: 110 }), true);
  assert.equal(isTainted(mockGaps, { fromLedger: 140, toLedger: 160 }), true);
  assert.equal(isTainted(mockGaps, { fromLedger: 200, toLedger: 250 }), false);
  assert.equal(isTainted(mockGaps, { fromLedger: 320 }), true);
  assert.equal(isTainted(mockGaps, { toLedger: 110 }), true);
});

test('indexer-gaps: backfillEvents writes gap and cursor atomically on gap detection', async () => {
  let txOps: any[] = [];
  (prisma as any).$transaction = async (ops: any[]) => {
    txOps = ops;
    return ops;
  };
  (prisma.indexerCursor as any).findUnique = async () => ({ lastLedger: 50 });
  (prisma.indexerCursor as any).upsert = async () => ({});
  (prisma.chainEvent as any).findMany = async () => [];

  const source = {
    getHealth: async () => ({ oldestLedger: 100, latestLedger: 120 }),
    getEvents: async () => ({ events: [], latestLedger: 120 }),
  };

  const res = await backfillEvents(undefined, { source: source as any, emit: () => undefined });
  assert.equal(res.startLedger, 100);
  assert.ok(txOps.length >= 2, 'Must execute indexerGap and indexerCursor upserts in one transaction');
});

test('indexer-gaps: admin API endpoints enforce authentication and RBAC', async () => {
  const { signToken } = await import('../src/middlewares/auth.middleware');

  await withServer(async (base) => {
    // 1. GET /api/v1/admin/indexer/gaps without auth -> 401
    const unauth = await fetch(`${base}/api/v1/admin/indexer/gaps`);
    assert.equal(unauth.status, 401);

    // 2. GET /api/v1/admin/indexer/gaps with non-admin token -> 403
    const nonAdminToken = signToken('user-1', Keypair.random().publicKey());
    const forbidden = await fetch(`${base}/api/v1/admin/indexer/gaps`, {
      headers: { authorization: `Bearer ${nonAdminToken}` },
    });
    assert.equal(forbidden.status, 403);

    // 3. GET /api/v1/admin/indexer/gaps with admin token -> 200
    (prisma.adminRoleAssignment as any).findUnique = async ({ where }: any) => {
      if (where.walletAddress === ADMIN) {
        return {
          walletAddress: ADMIN,
          role: {
            name: 'super_admin',
            permissions: [
              { permissionKey: 'admin.read' },
              { permissionKey: 'admin.manage' },
            ],
          },
        };
      }
      return null;
    };
    (prisma.adminAuditLog as any).create = async () => ({});
    (prisma.indexerGap as any).findMany = async () => [];
    (prisma.indexerGap as any).count = async () => 0;

    const adminToken = signToken('admin-1', ADMIN);
    const ok = await fetch(`${base}/api/v1/admin/indexer/gaps`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, []);
    assert.equal(body.meta.page, 1);
    assert.equal(body.meta.total, 0);

    // 4. PATCH /api/v1/admin/indexer/gaps/:id/resolve validation failure -> 400
    const invalidBody = await fetch(`${base}/api/v1/admin/indexer/gaps/gap-1/resolve`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(invalidBody.status, 400);

    // 5. PATCH /api/v1/admin/indexer/gaps/:id/resolve not found -> 404
    (prisma.indexerGap as any).findUnique = async () => null;
    const notFound = await fetch(`${base}/api/v1/admin/indexer/gaps/gap-nonexistent/resolve`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ resolvedBy: 'admin:G...' }),
    });
    assert.equal(notFound.status, 404);

    // 6. PATCH /api/v1/admin/indexer/gaps/:id/resolve already resolved -> 409
    (prisma.indexerGap as any).findUnique = async () => ({
      id: 'gap-already-done',
      resolvedAt: new Date(),
    });
    const alreadyResolved = await fetch(`${base}/api/v1/admin/indexer/gaps/gap-already-done/resolve`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ resolvedBy: 'admin:G...' }),
    });
    assert.equal(alreadyResolved.status, 409);

    // 7. PATCH /api/v1/admin/indexer/gaps/:id/resolve success -> 200
    const mockGap = {
      id: 'gap-to-resolve',
      network: CURSOR_ID,
      fromLedger: 100,
      toLedger: 150,
      kind: 'RETENTION',
      detectedAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
      note: 'Initial note',
    };
    (prisma.indexerGap as any).findUnique = async () => mockGap;
    (prisma.indexerGap as any).update = async ({ data }: any) => ({
      ...mockGap,
      resolvedAt: data.resolvedAt,
      resolvedBy: data.resolvedBy,
      note: data.note,
    });

    const resolved = await fetch(`${base}/api/v1/admin/indexer/gaps/gap-to-resolve/resolve`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ resolvedBy: 'archive-backfill', note: 'Backfilled from history' }),
    });
    assert.equal(resolved.status, 200);
    const resBody = await resolved.json();
    assert.equal(resBody.data.resolvedBy, 'archive-backfill');
    assert.equal(resBody.data.note, 'Backfilled from history');
    assert.ok(resBody.data.resolvedAt);
  });
});

test('indexer-gaps: serializeMarket surfaces indexerStale based on open gaps', async () => {
  await withServer(async (base) => {
    // 1. With open gaps -> indexerStale: true
    (prisma.indexerGap as any).findMany = async () => [
      {
        id: 'gap-open',
        network: CURSOR_ID,
        fromLedger: 100,
        toLedger: 150,
        kind: 'RETENTION',
        detectedAt: new Date(),
        resolvedAt: null,
      },
    ];
    (prisma.market as any).findUnique = async () => ({
      id: 'market-fresh',
      category: 'CRYPTO',
      status: 'ACTIVE',
      updatedAt: new Date(),
      chainSyncedLedger: 200,
      reasoningTraces: [],
      _count: { trades: 0, positions: 0, reasoningTraces: 0 },
    });

    const resTainted = await fetch(`${base}/api/v1/markets/market-fresh`);
    assert.equal(resTainted.status, 200);
    const bodyTainted = await resTainted.json();
    assert.equal(bodyTainted.data.indexerStale, true);

    // 2. Without open gaps -> indexerStale: false
    (prisma.indexerGap as any).findMany = async () => [];
    const resClean = await fetch(`${base}/api/v1/markets/market-fresh`);
    assert.equal(resClean.status, 200);
    const bodyClean = await resClean.json();
    assert.equal(bodyClean.data.indexerStale, false);
  });
});
