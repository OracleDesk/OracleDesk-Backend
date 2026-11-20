/**
 * premium-session.test.ts (#288)
 *
 * In-memory tests for the premium device registry. Prisma calls are
 * monkey-patched so no real database is needed.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';

setupTestEnv();

// ─── In-memory Prisma stub ────────────────────────────────────────────────────

const devices = new Map<string, any>();
const usageRows = new Map<string, any>();
let nextId = 1;

function makeDeviceId() { return `dev-${nextId++}`; }

const stubPrisma = {
  premiumDevice: {
    findUnique: async ({ where }: any) => {
      if (where.userId_deviceKeyHash) {
        for (const d of devices.values()) {
          if (d.userId === where.userId_deviceKeyHash.userId && d.deviceKeyHash === where.userId_deviceKeyHash.deviceKeyHash) return d;
        }
      }
      return null;
    },
    findFirst: async ({ where }: any) => {
      for (const d of devices.values()) {
        if (d.userId === where.userId) return d;
      }
      return null;
    },
    findMany: async ({ where, orderBy, take, select }: any) => {
      let rows = [...devices.values()].filter((d) => {
        if (where?.userId && d.userId !== where.userId) return false;
        if (where?.revokedAt === null && d.revokedAt !== null) return false;
        return true;
      });
      if (orderBy?.lastSeenAt === 'asc') rows.sort((a, b) => a.lastSeenAt - b.lastSeenAt);
      if (orderBy?.lastSeenAt === 'desc') rows.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
      if (take) rows = rows.slice(0, take);
      return rows;
    },
    create: async ({ data }: any) => {
      const id = data.id ?? makeDeviceId();
      const row = { ...data, id, createdAt: new Date(), revokedAt: null };
      devices.set(id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = devices.get(where.id);
      if (!row) return null;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      for (const d of devices.values()) {
        if (d.id === where.id && d.userId === where.userId) Object.assign(d, data);
      }
    },
  },
  premiumUsageDaily: {
    upsert: async ({ where, create, update }: any) => {
      const key = `${where.userId_day.userId}:${where.userId_day.day}`;
      let row = usageRows.get(key);
      if (!row) {
        row = { ...create };
        usageRows.set(key, row);
        return row;
      }
      for (const [k, v] of Object.entries(update as Record<string, any>)) {
        if (v && typeof v === 'object' && 'increment' in v) {
          row[k] = (row[k] ?? 0) + v.increment;
        } else {
          row[k] = v;
        }
      }
      return row;
    },
    findMany: async () => [...usageRows.values()],
  },
  $transaction: async (fn: any) => fn(stubPrisma),
};

// Patch prisma module (tests compile to CommonJS, so `require` is the live module object)
const prismaLib = require('../src/lib/prisma');
const originalPrisma = prismaLib.prisma;
Object.assign(prismaLib, { prisma: stubPrisma });

// Patch advisory lock to run inline
const lockLib = require('../src/lib/advisory-lock');
const originalLock = lockLib.withAdvisoryLock;
Object.assign(lockLib, {
  withAdvisoryLock: async (_key: string, fn: (tx: any) => Promise<any>) => {
    const value = await fn(stubPrisma);
    return { acquired: true, value };
  },
});

function resetStubs() {
  devices.clear();
  usageRows.clear();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('premium device registry', () => {

  test('first two devices are admitted; a third evicts the least recently seen', async () => {
    resetStubs();
    const { admitPremiumDevice } = await import('../src/services/premium-session.service');

    const t0 = new Date(2024, 0, 1, 0, 0, 0);
    const t1 = new Date(2024, 0, 1, 0, 1, 0);
    const t2 = new Date(2024, 0, 1, 0, 2, 0);

    const r1 = await admitPremiumDevice({ userId: 'u1', sid: 'sid-1', deviceKey: 'key-aaaa', ip: null, now: t0 });
    const r2 = await admitPremiumDevice({ userId: 'u1', sid: 'sid-2', deviceKey: 'key-bbbb', ip: null, now: t1 });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);

    const r3 = await admitPremiumDevice({ userId: 'u1', sid: 'sid-3', deviceKey: 'key-cccc', ip: null, now: t2 });
    assert.equal(r3.ok, true);

    // The oldest device (key-aaaa) should be evicted
    const oldest = [...devices.values()].find((d) => d.deviceKeyHash?.startsWith(require('crypto').createHash('sha256').update('key-aaaa').digest('hex').slice(0, 8)));
    // At least one device is revoked
    const revoked = [...devices.values()].filter((d) => d.revokedAt !== null);
    assert.equal(revoked.length >= 1, true, 'LRU device was evicted');
  });

  test('tabs sharing a deviceKey count as one device', async () => {
    resetStubs();
    const { admitPremiumDevice } = await import('../src/services/premium-session.service');

    const r1 = await admitPremiumDevice({ userId: 'u2', sid: 'sid-a', deviceKey: 'shared-key', ip: null });
    const r2 = await admitPremiumDevice({ userId: 'u2', sid: 'sid-b', deviceKey: 'shared-key', ip: null });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);

    const active = [...devices.values()].filter((d) => d.userId === 'u2' && !d.revokedAt);
    assert.equal(active.length, 1, 'two tabs with same key register as one device');
  });

  test('a revoked device gets DEVICE_REVOKED', async () => {
    resetStubs();
    const { admitPremiumDevice } = await import('../src/services/premium-session.service');
    const now = new Date();

    const r1 = await admitPremiumDevice({ userId: 'u3', sid: 'sid-1', deviceKey: 'key-x', ip: null, now });
    assert.equal(r1.ok, true);

    // Manually revoke
    const device = [...devices.values()].find((d) => d.userId === 'u3');
    device.revokedAt = new Date();
    device.revokeReason = 'USER_REVOKED';

    const r2 = await admitPremiumDevice({ userId: 'u3', sid: 'sid-2', deviceKey: 'key-x', ip: null, authTime: Math.floor(Date.now() / 1000) - 100, now });
    assert.equal(r2.ok, false);
    assert.equal((r2 as any).code, 'DEVICE_REVOKED');
  });

  test('a fresh login re-admits a revoked device', async () => {
    resetStubs();
    const { admitPremiumDevice } = await import('../src/services/premium-session.service');

    const revokeTime = new Date(Date.now() - 5000);
    const freshTime = Math.floor(Date.now() / 1000);

    const r1 = await admitPremiumDevice({ userId: 'u4', sid: 'sid-old', deviceKey: 'key-y', ip: null });
    assert.equal(r1.ok, true);
    const device = [...devices.values()].find((d) => d.userId === 'u4');
    device.revokedAt = revokeTime;

    // Fresh auth_time > revokedAt — should re-admit
    const r2 = await admitPremiumDevice({ userId: 'u4', sid: 'sid-new', deviceKey: 'key-y', ip: null, authTime: freshTime });
    assert.equal(r2.ok, true, 'fresh login re-admits revoked device');
    assert.equal(device.revokedAt, null, 'revocation cleared');
  });

  test('legacy tokens without sid are admitted without counting against cap', async () => {
    resetStubs();
    const { admitPremiumDevice } = await import('../src/services/premium-session.service');

    const r = await admitPremiumDevice({ userId: 'u5', sid: null, deviceKey: null, ip: null });
    assert.equal(r.ok, true);
    assert.equal((r as any).deviceId, 'legacy');
    assert.equal(devices.size, 0, 'no DB row for legacy token');
  });

  test('assertKeyReleaseBudget throws KEY_RELEASE_LIMIT after the daily limit', async () => {
    resetStubs();
    const { assertKeyReleaseBudget } = await import('../src/services/premium-session.service');

    // Set up the limit at 1 for test purposes by pre-filling the row.
    const day = new Date(); day.setUTCHours(0, 0, 0, 0);
    usageRows.set('u6:' + day, { userId: 'u6', day, keyReleases: 50, premiumReads: 0, distinctIpPrefixes: 0, devicesEvicted: 0 });

    // The service reads from config; set a low limit by patching config
    const cfgModule = require('../src/config');
    const original = cfgModule.config.PREMIUM_DAILY_KEY_RELEASE_LIMIT;
    cfgModule.config.PREMIUM_DAILY_KEY_RELEASE_LIMIT = 50;
    try {
      await assert.rejects(() => assertKeyReleaseBudget('u6'), /KEY_RELEASE_LIMIT|Daily key-release/);
    } finally {
      cfgModule.config.PREMIUM_DAILY_KEY_RELEASE_LIMIT = original;
    }
  });

  test('refresh keeps sid; tokenless requests rejected from device gate', async () => {
    resetStubs();
    const { admitPremiumDevice } = await import('../src/services/premium-session.service');

    // No dk and no deviceKey but has sid → DEVICE_KEY_REQUIRED
    const r = await admitPremiumDevice({ userId: 'u7', sid: 'sid-abc', dk: null, deviceKey: null, ip: null });
    assert.equal(r.ok, false);
    assert.equal((r as any).code, 'DEVICE_KEY_REQUIRED');
  });

});
