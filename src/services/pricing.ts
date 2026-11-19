// src/services/pricing.ts
import { config } from '../config';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

export interface PriceQuote {
  version: number;
  dailyPassPriceRaw: bigint;
  effectiveAt: Date;
  validUntil: Date | null;
}

const CACHE_TTL_MS = 30_000;
let cache: { loadedAt: number; rows: Array<{ version: number; dailyPassPriceRaw: string; effectiveAt: Date }> } | null = null;
let warnedFallback = false;

/**
 * Retrieve the active price schedule based on the current time.
 * The schedule with the most recent  that is not in the future is returned.
 */
async function schedules(now = Date.now()) {
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  const rows = await prisma.priceSchedule.findMany({
    orderBy: [{ effectiveAt: 'asc' }, { version: 'asc' }],
    select: { version: true, dailyPassPriceRaw: true, effectiveAt: true },
  });
  cache = { loadedAt: now, rows };
  return rows;
}

/**
 * Get the price (in base‑unit bigint) for a given subscription type.
 * Returns  if no active schedule is found.
 */
export function invalidatePriceCache(): void {
  cache = null;
}

export async function priceAt(at: Date): Promise<PriceQuote> {
  const rows = await schedules();
  let selected = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].effectiveAt.getTime() <= at.getTime()) selected = i;
    else break;
  }
  if (selected < 0) {
    if (!warnedFallback) {
      warnedFallback = true;
      logger.warn('No effective price schedule; using DAILY_PASS_PRICE_RAW bootstrap fallback');
    }
    return { version: 0, dailyPassPriceRaw: BigInt(config.DAILY_PASS_PRICE_RAW), effectiveAt: new Date(0), validUntil: rows[0]?.effectiveAt ?? null };
  }
  const row = rows[selected];
  return {
    version: row.version,
    dailyPassPriceRaw: BigInt(row.dailyPassPriceRaw),
    effectiveAt: row.effectiveAt,
    validUntil: rows[selected + 1]?.effectiveAt ?? null,
  };
}

export function currentPrice(now = new Date()): Promise<PriceQuote> {
  return priceAt(now);
}

export async function upcomingChange(now = new Date()): Promise<PriceQuote | null> {
  const rows = await schedules();
  const index = rows.findIndex((row) => row.effectiveAt.getTime() > now.getTime());
  if (index < 0) return null;
  const row = rows[index];
  return { version: row.version, dailyPassPriceRaw: BigInt(row.dailyPassPriceRaw), effectiveAt: row.effectiveAt, validUntil: rows[index + 1]?.effectiveAt ?? null };
}

/**
 * Utility to format a base‑unit bigint price back to a human‑readable USDC string.
 */
export function formatPrice(priceBaseUnits: bigint): string {
  // USDC uses 7 decimal places.
  const divisor = BigInt(10_000_000);
  const whole = priceBaseUnits / divisor;
  const fraction = priceBaseUnits % divisor;
  const fractionStr = fraction.toString().padStart(7, '0').replace(/0+$/, '');
  return fractionStr ? `${whole}.${fractionStr}` : `${whole}`;
}

