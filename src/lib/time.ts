/** Start of the current UTC day. All allowance windows use UTC, not host TZ. */
export function utcDayStart(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** Stellar RPC `createdAt` is ledger close time in Unix seconds. */
export function ledgerCloseDate(createdAt: number | null | undefined): Date | null {
  if (createdAt == null || !Number.isFinite(createdAt) || createdAt <= 0) return null;
  return new Date(createdAt * 1000);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The UTC day a transfer is charged to: the day of its ledger close time
 * (#219). Same arithmetic as utcDayStart; the name states the intent.
 */
export function ledgerDay(closeAt: Date): Date {
  return utcDayStart(closeAt);
}

/** `YYYY-MM-DD` of a UTC day, for binding to a Postgres DATE parameter. */
export function utcDayKey(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/**
 * Allowance charge day for a verified transfer (#219). Uses the RPC ledger
 * close time when present; otherwise falls back to `fallback` (normally now)
 * and reports `inferred` so the charge row records that the day is a guess.
 */
export function chargeDayFor(
  transfer: { createdAt?: number | null },
  fallback: Date,
): { day: Date; inferred: boolean } {
  const closeAt = ledgerCloseDate(transfer.createdAt);
  return closeAt ? { day: ledgerDay(closeAt), inferred: false } : { day: ledgerDay(fallback), inferred: true };
}
