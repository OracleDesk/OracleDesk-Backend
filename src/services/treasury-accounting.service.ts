/**
 * Authoritative on-chain treasury accounting read model (#299).
 *
 * Reads the treasury contract's NAV, capital breakdown, daily headroom,
 * net exposure, withdrawal-queue reservations, and YieldVenue instance
 * storage in one parallel batch with ledger-skew checking and single-flight
 * caching. Known contract gaps (yield excluded from NAV, yield_value
 * denominated in Blend pool shares, BlendPositions decoding traps, and
 * available_capital mixing USDC + bToken units) are detected and surfaced
 * explicitly as `flags` rather than trusted blindly.
 */
import { config } from '../config';
import { CONTRACTS } from '../config/contracts';
import { treasuryAccountingCached as cacheAccounting } from '../lib/chain-cache';
import { logger } from '../lib/logger';
import {
  getChainCache,
  treasuryCapitalBreakdown,
  treasuryDailyHeadroom,
  treasuryLiquidCapital,
  treasuryNav,
  treasuryNetExposure,
  treasuryQueueReserved,
  treasuryYieldVenue,
  type CapitalBreakdown,
  type YieldVenueConfig,
} from './chain.service';

export type AccountingFlag =
  | 'NAV_EXCLUDES_YIELD'
  | 'YIELD_VALUE_IN_SHARES'
  | 'YIELD_READ_FAILED'
  | 'AVAILABLE_MIXES_UNITS';

export interface TreasuryAccounting {
  ledger: number;
  navRaw: bigint;
  liquidRaw: bigint;
  yieldPrincipalRaw: bigint;
  yieldValueShares: bigint | null;
  queueReservedRaw: bigint;
  dailyHeadroomRaw: bigint;
  netExposureRaw: bigint;
  spendableRaw: bigint;
  flags: AccountingFlag[];
}

export interface AccountingReader {
  nav(signal?: AbortSignal): Promise<{ value: bigint; ledger: number }>;
  capitalBreakdown(signal?: AbortSignal): Promise<{ value: CapitalBreakdown; ledger: number }>;
  liquidCapital(signal?: AbortSignal): Promise<{ value: bigint; ledger: number }>;
  dailyHeadroom(signal?: AbortSignal): Promise<{ value: bigint; ledger: number }>;
  netExposure(signal?: AbortSignal): Promise<{ value: bigint; ledger: number }>;
  queueReserved(signal?: AbortSignal): Promise<{ value: bigint; ledger: number }>;
  yieldVenue(signal?: AbortSignal): Promise<{ value: YieldVenueConfig | null; ledger: number }>;
}

export const chainAccountingReader: AccountingReader = {
  nav: (signal) => treasuryNav(signal),
  capitalBreakdown: (signal) => treasuryCapitalBreakdown(signal),
  liquidCapital: (signal) => treasuryLiquidCapital(signal),
  dailyHeadroom: (signal) => treasuryDailyHeadroom(signal),
  netExposure: (signal) => treasuryNetExposure(signal),
  queueReserved: (signal) => treasuryQueueReserved(signal),
  yieldVenue: (signal) => treasuryYieldVenue(signal),
};

const MAX_SKEW_ATTEMPTS = 3;
const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);

async function fetchAccountingSnapshot(
  reader: AccountingReader,
  signal?: AbortSignal,
): Promise<TreasuryAccounting> {
  let lastSnapshot: TreasuryAccounting | null = null;
  const maxSkew = config.ACCOUNTING_MAX_LEDGER_SKEW;

  for (let attempt = 1; attempt <= MAX_SKEW_ATTEMPTS; attempt++) {
    const [navRes, breakdownOutcome, headroomRes, exposureRes, queueRes, yieldVenueRes] = await Promise.all([
      reader.nav(signal),
      reader
        .capitalBreakdown(signal)
        .then((res) => ({ ok: true as const, res }))
        .catch((err) => ({ ok: false as const, err })),
      reader.dailyHeadroom(signal),
      reader.netExposure(signal),
      reader.queueReserved(signal),
      reader
        .yieldVenue(signal)
        .catch(() => ({ value: null as YieldVenueConfig | null, ledger: 0 })),
    ]);

    const flags = new Set<AccountingFlag>();
    let liquidRaw: bigint;
    let yieldPrincipalRaw: bigint;
    let yieldValueShares: bigint | null;
    let capitalLedger: number;

    if (breakdownOutcome.ok) {
      liquidRaw = breakdownOutcome.res.value.liquid;
      yieldPrincipalRaw = breakdownOutcome.res.value.yield_principal;
      yieldValueShares = breakdownOutcome.res.value.yield_value;
      capitalLedger = breakdownOutcome.res.ledger;
    } else {
      logger.warn(
        { err: breakdownOutcome.err instanceof Error ? breakdownOutcome.err.message : String(breakdownOutcome.err) },
        'treasury capital_breakdown trapped; falling back to liquid_capital',
      );
      flags.add('YIELD_READ_FAILED');
      const liquidRes = await reader.liquidCapital(signal);
      liquidRaw = liquidRes.value;
      yieldPrincipalRaw = 0n;
      yieldValueShares = null;
      capitalLedger = liquidRes.ledger;
    }

    const yieldConfiguredAndEnabled = Boolean(yieldVenueRes.value?.enabled);
    if (yieldConfiguredAndEnabled || (yieldValueShares !== null && yieldValueShares > 0n)) {
      flags.add('NAV_EXCLUDES_YIELD');
      flags.add('YIELD_VALUE_IN_SHARES');
      flags.add('AVAILABLE_MIXES_UNITS');
    }

    const ledgers = [
      navRes.ledger,
      capitalLedger,
      headroomRes.ledger,
      exposureRes.ledger,
      queueRes.ledger,
    ].filter((l) => Number.isFinite(l) && l > 0);

    const minLedger = ledgers.length > 0 ? Math.min(...ledgers) : 0;
    const maxLedger = ledgers.length > 0 ? Math.max(...ledgers) : 0;

    const queueReservedRaw = maxBig(0n, queueRes.value);
    const spendableRaw = maxBig(0n, liquidRaw - queueReservedRaw);

    lastSnapshot = {
      ledger: maxLedger,
      navRaw: navRes.value,
      liquidRaw,
      yieldPrincipalRaw,
      yieldValueShares,
      queueReservedRaw,
      dailyHeadroomRaw: maxBig(0n, headroomRes.value),
      netExposureRaw: maxBig(0n, exposureRes.value),
      spendableRaw,
      flags: [...flags],
    };

    if (maxLedger - minLedger <= maxSkew) {
      return lastSnapshot;
    }

    logger.debug(
      { attempt, minLedger, maxLedger, maxSkew },
      'treasury accounting ledger skew exceeded threshold; re-reading',
    );
  }

  return lastSnapshot!;
}

/**
 * Reads the treasury's on-chain accounting views with ledger-aware caching.
 * Pass `{ fresh: true }` to bypass the cache.
 */
export async function readTreasuryAccounting(opts?: {
  fresh?: boolean;
  signal?: AbortSignal;
  reader?: AccountingReader;
}): Promise<TreasuryAccounting> {
  const reader = opts?.reader ?? chainAccountingReader;
  if (opts?.fresh || opts?.reader) {
    return fetchAccountingSnapshot(reader, opts?.signal);
  }
  const entry = await cacheAccounting(getChainCache(), CONTRACTS.treasury, async () => {
    const value = await fetchAccountingSnapshot(reader, opts?.signal);
    return { value, ledger: value.ledger };
  });
  return entry.value;
}
