import { config } from '../../config';
import { withAdvisoryLockWait } from '../../lib/advisory-lock';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../middlewares/error.middleware';
import type { OperationClass } from './fees';

export interface FeeSpendWindow {
  windowSeconds: number;
  budget: bigint;
}

export interface FeeSpendSnapshot {
  opClass: OperationClass;
  windowSeconds: number;
  windowStart: Date;
  windowEnd: Date;
  reserved: bigint;
  budget: bigint;
  remaining: bigint;
}

export class FeeSpendBudgetExceeded extends AppError {
  constructor(public readonly opClass: OperationClass, public readonly amount: bigint, public readonly budget: bigint) {
    super(429, 'FEE_SPEND_BUDGET_EXCEEDED', `rolling fee spend budget exceeded for ${opClass}`, {
      opClass,
      amount: amount.toString(),
      budget: budget.toString(),
    });
    this.name = 'FeeSpendBudgetExceeded';
  }
}

const db = () => prisma as any;

export function feeSpendWindows(opClass: OperationClass): FeeSpendWindow[] {
  if (!config.FEE_SPEND_BUDGETS_JSON) return [];
  try {
    const parsed = JSON.parse(config.FEE_SPEND_BUDGETS_JSON) as Record<string, unknown>;
    const value = parsed[opClass];
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return values
      .map((item: any) => ({ windowSeconds: Number(item.windowSeconds), budget: BigInt(item.budget) }))
      .filter((item) => Number.isSafeInteger(item.windowSeconds) && item.windowSeconds > 0 && item.budget >= 0n);
  } catch (err) {
    logger.error({ err, opClass }, 'Could not parse fee spend budgets');
    return [];
  }
}

function bounds(now: Date, windowSeconds: number): { start: Date; end: Date } {
  const seconds = Math.floor(now.getTime() / 1000);
  const start = Math.floor(seconds / windowSeconds) * windowSeconds * 1000;
  return { start: new Date(start), end: new Date(start + windowSeconds * 1000) };
}

function sumActive(rows: Array<{ amount: bigint; status: string }>): bigint {
  return rows.reduce((total, row) => row.status === 'RELEASED' ? total : total + BigInt(row.amount), 0n);
}

/** Atomically reserves the amount in every configured window for this class. */
export async function reserveSpend(
  opClass: OperationClass,
  amount: bigint,
  reservationId: string,
  now = new Date(),
): Promise<{ reserved: boolean; entries: number }> {
  if (!config.FEE_SPEND_ENFORCE) return { reserved: false, entries: 0 };
  if (amount < 0n) throw new Error('fee spend amount must be non-negative');
  const windows = feeSpendWindows(opClass);
  if (windows.length === 0) throw new Error(`no fee spend budget configured for ${opClass}`);

  const result = await withAdvisoryLockWait(`fee-spend:${opClass}`, async (tx) => {
    const client = tx as any;
    for (const window of windows) {
      const { start, end } = bounds(now, window.windowSeconds);
      const rows = await client.feeSpendEntry.findMany({
        where: { opClass, windowSeconds: window.windowSeconds, windowStart: start, windowEnd: end, status: { in: ['RESERVED', 'SETTLED'] } },
        select: { amount: true, status: true, reservationId: true },
      });
      const existing = rows.find((row: any) => row.reservationId === reservationId);
      const reserved = sumActive(rows.filter((row: any) => row.reservationId !== reservationId));
      if (!existing && reserved + amount > window.budget) throw new FeeSpendBudgetExceeded(opClass, reserved + amount, window.budget);
    }
    let entries = 0;
    for (const window of windows) {
      const { start, end } = bounds(now, window.windowSeconds);
      await client.feeSpendEntry.upsert({
        where: { reservationId_windowSeconds: { reservationId, windowSeconds: window.windowSeconds } },
        create: { reservationId, opClass, windowSeconds: window.windowSeconds, windowStart: start, windowEnd: end, amount, status: 'RESERVED' },
        update: {},
      });
      entries++;
    }
    return entries;
  }, { waitMs: config.SEQ_LOCK_WAIT_MS });

  if (!result.acquired) throw new Error('fee spend budget lock unavailable');
  return { reserved: true, entries: result.value };
}

export async function settleSpend(reservationId: string, actualAmount: bigint): Promise<void> {
  if (!config.FEE_SPEND_ENFORCE) return;
  await db().feeSpendEntry.updateMany({
    where: { reservationId, status: 'RESERVED' },
    data: { amount: actualAmount, status: 'SETTLED', settledAmount: actualAmount, settledAt: new Date() },
  });
}

export async function releaseSpend(reservationId: string): Promise<void> {
  if (!config.FEE_SPEND_ENFORCE) return;
  await db().feeSpendEntry.updateMany({
    where: { reservationId, status: 'RESERVED' },
    data: { status: 'RELEASED', settledAt: new Date() },
  });
}

export async function spendSnapshot(opClass: OperationClass, now = new Date()): Promise<FeeSpendSnapshot[]> {
  const snapshots: FeeSpendSnapshot[] = [];
  for (const window of feeSpendWindows(opClass)) {
    const { start, end } = bounds(now, window.windowSeconds);
    const rows = await db().feeSpendEntry.findMany({
      where: { opClass, windowSeconds: window.windowSeconds, windowStart: start, windowEnd: end, status: { in: ['RESERVED', 'SETTLED'] } },
      select: { amount: true, status: true },
    });
    const reserved = sumActive(rows);
    snapshots.push({ opClass, windowSeconds: window.windowSeconds, windowStart: start, windowEnd: end, reserved, budget: window.budget, remaining: window.budget > reserved ? window.budget - reserved : 0n });
  }
  return snapshots;
}
