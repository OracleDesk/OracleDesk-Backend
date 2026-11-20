// Execution bounds for agent trades (#245).
//
// The newer treasury entrypoints agent_buy_v2 / agent_sell_v2 take an
// average-price limit and a ledger-time deadline. market-core enforces them
// as (contracts/market-core/src/math.rs):
//
//   buy_within_limit:  collateral_in  × 10_000 ≤ shares_out × limit_bps
//   sell_within_limit: collateral_out × 10_000 ≥ shares_in  × limit_bps
//   DeadlineExpired:   ledger.timestamp() > deadline
//
// The same rules are applied locally before submission, so an order whose
// edge is already gone is skipped instead of being sent to revert. A limit of
// 0 disables the check in market-core, so 0 is never sent: a non-positive
// limit means "do not trade".
import { config } from '../config';

export const BPS = 10_000;

export interface TradeBounds {
  /** Highest (buy) or lowest (sell) acceptable average price, in bps of 1 USDC per share. */
  limitPriceBps: number;
  /** Ledger close time (unix seconds) after which the contract rejects the trade. */
  deadline: bigint;
  /** Ledger the decision price was read at, when known. */
  decisionLedger: number | null;
  /** Ledger close time the deadline was derived from (unix seconds). */
  decisionCloseTime: number;
}

/**
 * Highest average price at which a buy still has `minEdge` against the
 * conservative probability of the side being bought. calc_buy takes the fee
 * out of collateral before the swap, so the fee is already inside the average
 * price collateral_in / shares_out and is not subtracted again.
 * The caller passes the side's probability: for a NO buy that is 1 − p.
 * Returns 0 (no trade) when the edge cannot be met at any price.
 */
export function buyLimitBps(p: { conservativeProb: number; minEdge: number }): number {
  const raw = Math.floor((p.conservativeProb - p.minEdge) * BPS + 1e-9);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(BPS, raw);
}

/** Lowest acceptable average sell price: the mark minus the slippage allowance. */
export function sellLimitBps(p: { markPriceBps: number; maxSlippageBps: number }): number {
  const raw = Math.floor((p.markPriceBps * (BPS - p.maxSlippageBps)) / BPS);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(BPS, raw);
}

/** Deadline = decision ledger close time + a bounded decision TTL. */
export function deadlineFor(p: { closeTime: number; ttlSecs?: number }): bigint {
  const ttl = Math.min(300, Math.max(1, Math.floor(p.ttlSecs ?? config.TRADE_DECISION_TTL_SECONDS)));
  return BigInt(Math.floor(p.closeTime)) + BigInt(ttl);
}

/** Mirror of market-core buy_within_limit (integer only). */
export function buyWithinLimit(collateralIn: bigint, sharesOut: bigint, limitBps: number): boolean {
  if (limitBps <= 0) return false;
  return collateralIn * BigInt(BPS) <= sharesOut * BigInt(limitBps);
}

/** Mirror of market-core sell_within_limit (integer only). */
export function sellWithinLimit(collateralOut: bigint, sharesIn: bigint, limitBps: number): boolean {
  if (limitBps <= 0) return false;
  return collateralOut * BigInt(BPS) >= sharesIn * BigInt(limitBps);
}

/** True once `nowSecs` is past the deadline (the contract uses strict >). */
export function deadlinePassed(deadline: bigint, nowSecs: number): boolean {
  return BigInt(Math.floor(nowSecs)) > deadline;
}

export function buyBounds(p: {
  conservativeProb: number;
  minEdge: number;
  closeTime: number;
  decisionLedger?: number | null;
  ttlSecs?: number;
}): TradeBounds {
  return {
    limitPriceBps: buyLimitBps(p),
    deadline: deadlineFor({ closeTime: p.closeTime, ttlSecs: p.ttlSecs }),
    decisionLedger: p.decisionLedger ?? null,
    decisionCloseTime: Math.floor(p.closeTime),
  };
}

/** Columns persisted on trades / position_exits. */
export function boundsColumns(b: TradeBounds | undefined) {
  if (!b) return {};
  return { limitPriceBps: b.limitPriceBps, deadline: b.deadline, decisionLedger: b.decisionLedger };
}
