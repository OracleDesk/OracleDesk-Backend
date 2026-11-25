import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { isInPaymentLock, withActiveLockContext } from './context';
import { getTransactionReader, setTransactionReader } from '../services/stellar/tx-inspect';

export interface AdvisoryLockWaitInfo {
  keys: string[];
  attempt: number;
  elapsedMs: number;
}

export interface AdvisoryLockWaitOptions {
  waitMs?: number;
  pollMs?: number;
  timeoutMs?: number;
  maxWaitMs?: number;
  onWait?: (info: AdvisoryLockWaitInfo) => void;
}

/**
 * Runs `fn` on one instance at a time using a Postgres advisory lock. The lock
 * is held by an interactive transaction (`pg_try_advisory_xact_lock`), not a
 * session lock: with a connection pool, a session lock and its
 * `pg_advisory_unlock` can land on different connections and leak. The
 * transaction connection only holds the lock; `fn` does its own queries
 * through the provided transaction client.
 *
 * The lock is released when the transaction commits or rolls back, and by
 * Postgres when the connection dies, so a crashed holder can never block a
 * key forever.
 *
 * `isolationLevel` (e.g. RepeatableRead) makes every query `fn` runs through
 * `tx` see the one snapshot taken by the lock statement (#222).
 */
export async function withAdvisoryLock<T>(
  key: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { timeoutMs?: number; maxWaitMs?: number; isolationLevel?: Prisma.TransactionIsolationLevel } = {},
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`;
      if (!rows[0]?.locked) return { acquired: false as const };
      const heldAt = Date.now();
      try {
        const value = await withActiveLockContext([key], () => fn(tx));
        return { acquired: true as const, value };
      } finally {
        logger.debug({ key, holderDurationMs: Date.now() - heldAt }, 'advisory lock released');
      }
    },
    {
      timeout: opts.timeoutMs ?? 10 * 60_000,
      maxWait: opts.maxWaitMs ?? 5_000,
      ...(opts.isolationLevel ? { isolationLevel: opts.isolationLevel } : {}),
    },
  );
}

/**
 * Takes several advisory locks in one transaction. Keys are sorted before
 * acquisition so two callers requesting the same set can never deadlock.
 */
export async function withAdvisoryLocks<T>(
  keys: string[],
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { timeoutMs?: number; maxWaitMs?: number } = {},
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const ordered = [...new Set(keys)].sort();
  return prisma.$transaction(
    async (tx) => {
      for (const key of ordered) {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`;
        if (!rows[0]?.locked) return { acquired: false as const };
      }
      const heldAt = Date.now();
      try {
        const value = await withActiveLockContext(ordered, () => fn(tx));
        return { acquired: true as const, value };
      } finally {
        logger.debug({ keys: ordered, holderDurationMs: Date.now() - heldAt }, 'advisory locks released');
      }
    },
    { timeout: opts.timeoutMs ?? 10 * 60_000, maxWait: opts.maxWaitMs ?? 5_000 },
  );
}

/** Like withAdvisoryLockWait, for a set of keys acquired atomically. */
export async function withAdvisoryLocksWait<T>(
  keys: string[],
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: AdvisoryLockWaitOptions = {},
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const ordered = [...new Set(keys)].sort();
  const startedAt = Date.now();
  const deadline = startedAt + (opts.waitMs ?? 30_000);
  const pollMs = opts.pollMs ?? 50;
  let attempts = 0;

  for (;;) {
    attempts++;
    const attemptStart = Date.now();
    const result = await withAdvisoryLocks(ordered, fn, { timeoutMs: opts.timeoutMs, maxWaitMs: opts.maxWaitMs });
    if (result.acquired) {
      const waitMs = attemptStart - startedAt;
      const holderDurationMs = Date.now() - attemptStart;
      if (attempts > 1 || holderDurationMs > 1_000) {
        logger.info({ keys: ordered, attempts, waitMs, holderDurationMs }, 'advisory locks acquired and completed');
      }
      return result;
    }
    const elapsedMs = Date.now() - startedAt;
    opts.onWait?.({ keys: ordered, attempt: attempts, elapsedMs });
    if (Date.now() >= deadline) {
      logger.warn({ keys: ordered, attempts, waitMs: elapsedMs }, 'advisory locks wait timed out');
      return { acquired: false };
    }
    await sleep(pollMs);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Like withAdvisoryLock, but waits up to `waitMs` for a competing holder to
 * finish instead of failing immediately. Every retry is its own short
 * transaction, so a waiter never holds a connection while it sleeps.
 *
 * Returns `{ acquired: false }` only when the deadline passes. Callers must
 * treat that as a retryable 409/503, never as permission to proceed.
 */
export async function withAdvisoryLockWait<T>(
  key: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: AdvisoryLockWaitOptions = {},
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const startedAt = Date.now();
  const deadline = startedAt + (opts.waitMs ?? 30_000);
  const pollMs = opts.pollMs ?? 50;
  let attempts = 0;

  for (;;) {
    attempts++;
    const attemptStart = Date.now();
    const result = await withAdvisoryLock(key, fn, { timeoutMs: opts.timeoutMs, maxWaitMs: opts.maxWaitMs });
    if (result.acquired) {
      const waitMs = attemptStart - startedAt;
      const holderDurationMs = Date.now() - attemptStart;
      if (attempts > 1 || holderDurationMs > 1_000) {
        logger.info({ key, attempts, waitMs, holderDurationMs }, 'advisory lock acquired and completed');
      }
      return result;
    }
    const elapsedMs = Date.now() - startedAt;
    opts.onWait?.({ keys: [key], attempt: attempts, elapsedMs });
    if (Date.now() >= deadline) {
      logger.warn({ key, attempts, waitMs: elapsedMs }, 'advisory lock wait timed out');
      return { acquired: false };
    }
    await sleep(pollMs);
  }
}

/**
 * Test assertion helper (#305): wraps the active Stellar `TransactionReader`
 * and throws immediately if `getTransaction` is invoked while a payment
 * advisory lock transaction is open (tracked via AsyncLocalStorage).
 * Returns a restore function to unwrap the reader.
 */
export function assertNoIoInLock(): () => void {
  const inner = getTransactionReader();
  const guarded = {
    async getTransaction(hash: string) {
      if (isInPaymentLock()) {
        throw new Error(`RPC getTransaction(${hash}) called while holding a payment advisory lock`);
      }
      return inner.getTransaction(hash);
    },
  };
  const prev = setTransactionReader(guarded);
  return () => {
    setTransactionReader(prev);
  };
}
