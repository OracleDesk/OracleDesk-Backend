/**
 * Ledger-tagged price for trader decisions (#266).
 *
 * `decisionPrice()` returns a `DecisionPrice` with an explicit `asOfLedger`
 * and `source` so the policy can refuse to trade when the price is stale.
 * It never reads `market.currentYesProb` — that column may be many ledgers
 * behind the indexer cursor.
 *
 * Priority:
 *   1. Indexed cursor within `maxLagLedgers` → newest Trade event reserves
 *      (or `get_market` for markets with no trades).  `asOfLedger` = cursor.
 *   2. Cached `get_market` whose simulation ledger is within `maxLagLedgers`
 *      of the RPC latest.  `source = 'rpc'`.
 *   3. Neither available → throw `StalePriceError('NO_FRESH_SOURCE')`.
 */

import { AppError } from '../middlewares/error.middleware';
import { priceYesBps } from '../generated/fpmm';
import { latestLedgerView, indexerLag } from './chain-freshness.service';
import { getOnChainMarketCached } from './chain.service';
import { defaultReserveDeps } from './valuation.service';
import { logger } from '../lib/logger';

export interface DecisionPrice {
  /** YES price in basis points (0–10 000). */
  yesBps: bigint;
  reserveYes: bigint;
  reserveNo: bigint;
  feeBps: bigint;
  asOfLedger: number;
  source: 'indexed' | 'rpc';
  lagLedgers: number;
}

export class StalePriceError extends AppError {
  constructor(reason: string) {
    super(503, 'PRICE_STALE', `Decision price unavailable: ${reason}`, { reason });
  }
}

export interface DecisionPriceOpts {
  maxLagLedgers: number;
}

export async function decisionPrice(
  onChainMarketId: bigint,
  opts: DecisionPriceOpts,
): Promise<DecisionPrice> {
  const { maxLagLedgers } = opts;

  const view = await latestLedgerView();
  const lag  = await indexerLag(view);

  // ── Path 1: indexed reserves ───────────────────────────────────────────────
  if (lag.lagLedgers !== null && lag.lagLedgers <= maxLagLedgers && lag.cursorLedger !== null) {
    try {
      const event = await defaultReserveDeps.newestTradeEvent(onChainMarketId);
      if (event?.params.reserve_yes !== undefined && event.params.reserve_no !== undefined) {
        const reserveYes = BigInt(event.params.reserve_yes);
        const reserveNo  = BigInt(event.params.reserve_no);
        const feeBps     = BigInt((await defaultReserveDeps.getMarket(onChainMarketId)).fee_bps);
        return {
          yesBps: priceYesBps(reserveYes, reserveNo),
          reserveYes,
          reserveNo,
          feeBps,
          asOfLedger: lag.cursorLedger,
          source: 'indexed',
          lagLedgers: lag.lagLedgers,
        };
      }
      // Market exists but has no Trade events — fall through to get_market.
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, onChainMarketId: onChainMarketId.toString() },
        'decisionPrice: indexed path failed; trying RPC',
      );
    }

    // Market has no indexed trades — read reserves from the chain.
    try {
      const market   = await defaultReserveDeps.getMarket(onChainMarketId);
      const reserveYes = BigInt(market.reserve_yes);
      const reserveNo  = BigInt(market.reserve_no);
      const feeBps     = BigInt(market.fee_bps);
      return {
        yesBps: priceYesBps(reserveYes, reserveNo),
        reserveYes,
        reserveNo,
        feeBps,
        asOfLedger: lag.cursorLedger,
        source: 'indexed',
        lagLedgers: lag.lagLedgers,
      };
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err, onChainMarketId: onChainMarketId.toString() },
        'decisionPrice: get_market fallback also failed; will try cached chain read',
      );
    }
  }

  // ── Path 2: ledger-tagged cached chain read ────────────────────────────────
  try {
    const entry = await getOnChainMarketCached(onChainMarketId);
    const entryLag = view.latestLedger - entry.ledger;
    if (entry.ledger > 0 && entryLag <= maxLagLedgers) {
      const reserveYes = BigInt(entry.value.reserve_yes);
      const reserveNo  = BigInt(entry.value.reserve_no);
      const feeBps     = BigInt(entry.value.fee_bps);
      return {
        yesBps: priceYesBps(reserveYes, reserveNo),
        reserveYes,
        reserveNo,
        feeBps,
        asOfLedger: entry.ledger,
        source: 'rpc',
        lagLedgers: entryLag,
      };
    }
    logger.warn(
      { onChainMarketId: onChainMarketId.toString(), entryLag, maxLagLedgers },
      'decisionPrice: cached chain entry too stale',
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, onChainMarketId: onChainMarketId.toString() },
      'decisionPrice: RPC path failed',
    );
  }

  throw new StalePriceError('NO_FRESH_SOURCE');
}
