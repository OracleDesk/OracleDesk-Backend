/**
 * Premium session device registry (#288).
 *
 * Tracks the devices actively using premium (pass-based) content per user,
 * caps concurrency with LRU eviction, enforces per-pass daily budgets, and
 * records anomaly signals without storing raw IPs.
 */
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { withAdvisoryLock } from '../lib/advisory-lock';
import { notifyUser } from '../lib/socket-auth';
import { hashClientIp } from './auth.service';
import { config } from '../config';
import { logger } from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PremiumDeviceView {
  id: string;
  label: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
}

export type AdmitResult =
  | { ok: true; deviceId: string }
  | { ok: false; code: 'DEVICE_REVOKED' | 'DEVICE_KEY_REQUIRED' | 'NO_PASS' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashDeviceKey(deviceKey: string): string {
  return crypto.createHash('sha256').update(deviceKey).digest('hex');
}

/** Truncates a device-key hash to the first 16 hex chars for token claims. */
export function dkClaimFromKey(deviceKey: string): string {
  return hashDeviceKey(deviceKey).slice(0, 16);
}

function today(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ─── Device admission ─────────────────────────────────────────────────────────

/**
 * Gate for premium (pass-based) content requests.
 *
 * - Known, active device: allowed; last-seen updated.
 * - Known, revoked device: denied unless a fresh login (new `sid` with
 *   `auth_time` > `revokedAt`) re-admits it, evicting the LRU device.
 * - Unknown device: registered; if the cap is exceeded, the LRU device is
 *   evicted and the user is notified.
 * - Tokens without `sid` (pre-#288 legacy): admitted without counting against
 *   the cap so the first deploy does not evict everyone.
 */
export async function admitPremiumDevice(p: {
  userId: string;
  sid?: string | null;
  dk?: string | null;
  deviceKey?: string | null;
  authTime?: number | null;
  ip: string | null;
  now?: Date;
}): Promise<AdmitResult> {
  // Legacy tokens have no sid — treat as admitted without tracking.
  if (!p.sid) {
    return { ok: true, deviceId: 'legacy' };
  }

  if (!p.deviceKey && !p.dk) {
    return { ok: false, code: 'DEVICE_KEY_REQUIRED' };
  }

  const deviceKeyHash = p.deviceKey ? hashDeviceKey(p.deviceKey) : null;
  const dkPrefix = p.dk ?? (deviceKeyHash ? deviceKeyHash.slice(0, 16) : null);
  if (!deviceKeyHash && !dkPrefix) {
    return { ok: false, code: 'DEVICE_KEY_REQUIRED' };
  }

  const ipPrefixHash = hashClientIp(p.ip);
  const now = p.now ?? new Date();

  const result = await withAdvisoryLock(`premium:${p.userId}`, async (tx) => {
    // Find by full hash when available, otherwise match by dk prefix.
    let existing = deviceKeyHash
      ? await tx.premiumDevice.findUnique({ where: { userId_deviceKeyHash: { userId: p.userId, deviceKeyHash } } })
      : await tx.premiumDevice.findFirst({ where: { userId: p.userId, deviceKeyHash: { startsWith: dkPrefix! } } });

    if (existing) {
      if (existing.revokedAt) {
        // Allow re-admission only if auth_time is fresher than the revocation.
        const authTime = p.authTime ? new Date(p.authTime * 1000) : null;
        if (!authTime || authTime <= existing.revokedAt) {
          return { ok: false as const, code: 'DEVICE_REVOKED' as const };
        }
        // Re-admit: clear revocation, then fall through to eviction logic.
        await tx.premiumDevice.update({
          where: { id: existing.id },
          data: { revokedAt: null, revokeReason: null, lastSid: p.sid!, lastSeenAt: now, ipPrefixHash },
        });
        // Evict LRU to stay within cap.
        await evictLruIfNeeded(tx, p.userId, existing.id, now);
        return { ok: true as const, deviceId: existing.id };
      }

      // Active device — throttled last-seen update (once per 60 s).
      const staleSec = (now.getTime() - existing.lastSeenAt.getTime()) / 1000;
      if (staleSec >= 60) {
        await tx.premiumDevice.update({
          where: { id: existing.id },
          data: { lastSid: p.sid!, lastSeenAt: now, ipPrefixHash },
        });
      }
      return { ok: true as const, deviceId: existing.id };
    }

    // New device — insert and evict if over cap.
    const device = await tx.premiumDevice.create({
      data: {
        userId: p.userId,
        deviceKeyHash: deviceKeyHash ?? dkPrefix! + '0'.repeat(64 - dkPrefix!.length),
        firstSid: p.sid!,
        lastSid: p.sid!,
        lastSeenAt: now,
        ipPrefixHash,
      },
    });
    await evictLruIfNeeded(tx, p.userId, device.id, now);
    return { ok: true as const, deviceId: device.id };
  });

  if (!result.acquired) {
    // Lock contention — fail open to avoid blocking legitimate users.
    logger.warn({ userId: p.userId }, 'premium advisory lock not acquired; admitting');
    return { ok: true, deviceId: 'contention' };
  }
  return result.value;
}

async function evictLruIfNeeded(
  tx: Parameters<Parameters<typeof withAdvisoryLock>[1]>[0],
  userId: string,
  currentDeviceId: string,
  now: Date,
): Promise<void> {
  const max = config.PREMIUM_MAX_DEVICES;
  const active = await tx.premiumDevice.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: 'asc' },
  });

  const toEvict = active.filter((d) => d.id !== currentDeviceId).slice(0, Math.max(0, active.length - max));

  for (const device of toEvict) {
    await tx.premiumDevice.update({
      where: { id: device.id },
      data: { revokedAt: now, revokeReason: 'EVICTED_LRU' },
    });
    await tx.premiumUsageDaily.upsert({
      where: { userId_day: { userId, day: today() } },
      create: { userId, day: today(), devicesEvicted: 1 },
      update: { devicesEvicted: { increment: 1 } },
    });
    // Notify outside the transaction (best-effort).
    setImmediate(() => {
      notifyUser(userId, 'PREMIUM_DEVICE_EVICTED', { deviceId: device.id, label: device.label });
    });
  }
}

// ─── Daily budget enforcement ─────────────────────────────────────────────────

/**
 * Increments the daily premium read counter. Throws `DAILY_READ_LIMIT` if the
 * user has exceeded `PREMIUM_DAILY_READ_LIMIT` reads today.
 */
export async function assertPremiumReadBudget(userId: string): Promise<void> {
  const day = today();
  const row = await prisma.premiumUsageDaily.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, premiumReads: 1 },
    update: { premiumReads: { increment: 1 } },
  });
  if (row.premiumReads > config.PREMIUM_DAILY_READ_LIMIT) {
    throw Object.assign(new Error('Daily premium read limit reached'), { code: 'DAILY_READ_LIMIT' });
  }
}

/**
 * Increments the daily key-release counter. Throws `KEY_RELEASE_LIMIT` if the
 * user has exceeded `PREMIUM_DAILY_KEY_RELEASE_LIMIT` key releases today.
 * Exported for use by the future confidential key-release route.
 */
export async function assertKeyReleaseBudget(userId: string): Promise<void> {
  const day = today();
  const row = await prisma.premiumUsageDaily.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, keyReleases: 1 },
    update: { keyReleases: { increment: 1 } },
  });
  if (row.keyReleases > config.PREMIUM_DAILY_KEY_RELEASE_LIMIT) {
    throw Object.assign(new Error('Daily key-release limit reached'), { code: 'KEY_RELEASE_LIMIT' });
  }
}

// ─── Device management ────────────────────────────────────────────────────────

export async function listDevices(userId: string): Promise<PremiumDeviceView[]> {
  const rows = await prisma.premiumDevice.findMany({
    where: { userId },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, label: true, lastSeenAt: true, createdAt: true, revokedAt: true, revokeReason: true },
  });
  return rows;
}

export async function labelDevice(userId: string, deviceId: string, label: string): Promise<void> {
  await prisma.premiumDevice.updateMany({
    where: { id: deviceId, userId },
    data: { label: label.slice(0, 64) },
  });
}

export async function revokeDevice(
  userId: string,
  deviceId: string,
  reason: 'USER_REVOKED' | 'ADMIN',
): Promise<void> {
  await prisma.premiumDevice.updateMany({
    where: { id: deviceId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
  notifyUser(userId, 'PREMIUM_DEVICE_EVICTED', { deviceId, label: null });
}

// ─── Admin anomaly view ───────────────────────────────────────────────────────

export async function getAnomalySignals(opts: { limit?: number } = {}) {
  const threshold = config.PREMIUM_ANOMALY_IP_THRESHOLD;
  return prisma.premiumUsageDaily.findMany({
    where: { distinctIpPrefixes: { gte: threshold } },
    orderBy: { distinctIpPrefixes: 'desc' },
    take: opts.limit ?? 50,
  });
}
