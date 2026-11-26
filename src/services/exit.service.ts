/**
 * On-chain position exits through treasury.agent_sell (#77).
 *
 * market-core's `sell` takes an exact `collateral_out` and burns however many
 * shares that needs (reverting with SlippageExceeded above `max_shares_in`, or
 * InsufficientShares if the holder has too few). To sell "N shares" we invert
 * the FPMM off-chain (`collateralOutForShares`, rounded down), verify with
 * `calcSell`, and bound the share spend with `max_shares_in`.
 *
 * The holder of agent positions is the treasury contract, not the agent key,
 * so balances are read for `CONTRACTS.treasury`. A position changes only from
 * a confirmed live result; dry-run exits are recorded as SIMULATED. Every
 * attempt writes a PositionExit row. An exit whose submission outcome is
 * unknown stays SUBMITTED and blocks new exits for that position until the
 * next call reconciles it against the on-chain balance, so it never sells twice.
 */
import type { Prisma } from '@prisma/client';
import { nowMs } from '../lib/clock';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { cancelPositionPredicates } from './hedge-predicate.service';
import {
  classifyLiquidityBucket,
  markExecutionReportOutcome,
  recordExecutionQuoteAttempt,
} from './execution-quality.service';
import { priceYesBps } from '../generated/fpmm';
import { writeAgentLog } from '../lib/agent-log';
import { AppError } from '../middlewares/error.middleware';
import { CONTRACTS } from '../config/contracts';
import { checkFillDiscrepancies, resolveAgentTradeFill } from './agent-fill.service';
import {
  bigintToDecimalString,
  decimalToBigint,
  priceBpsFromRaw,
  toDisplayUsdc,
} from '../lib/amounts';
import { MathError, calcSell, collateralOutForShares, priceYesBps } from '../generated/fpmm';
import type { Market as OnChainMarket } from '../generated/market-core';
import {
  Outcomes,
  agentSell,
  closeTrade,
  getBreakerConfig,
  getBreakerState,
  getOnChainMarket,
  getPosition,
  quoteSell,
} from './chain.service';
import { ChainError, ChainPendingError } from './stellar/errors';
import { registerHandler, type ChainTransactionRow, type CompletionContext, type CompletionOutcome } from './stellar/outbox';
import { AgentPausedError } from './agent-controls.service';

/** Remaining shares at or below this are dust: the position counts as closed. */
export const DUST_SHARES = 1_000n;
export const EXIT_SLIPPAGE_BPS = 100n;
/** Exits planned this close to close_time race with trading stopping; leave them to settlement. */
export const EXIT_CLOSE_GUARD_MS = 60_000;
const MAX_VERIFY_STEPS = 16;
const MAX_HALVINGS = 4;
const MAX_SLIPPAGE_RETRIES = 2;
const MAX_INSUFFICIENT_RETRIES = 1;

type Outcome = 'YES' | 'NO';

export class ExitError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(409, code, message, details);
    this.name = 'ExitError';
  }
}

export interface ExitPlan {
  sharesTarget: bigint;
  collateralOut: bigint;
  quotedSharesIn: bigint;
  maxSharesIn: bigint;
}

/**
 * Plans a sale of `sharesTarget` shares against the pool in `m`.
 *
 * `collateralOutForShares` ignores integer rounding, so the result is checked
 * with `calcSell` and lowered one unit at a time until the shares it burns fit
 * the target (bounded). A pool that can't absorb the target halves it (at most
 * 4 times) before giving up with EXIT_ILLIQUID; the plan's `sharesTarget` is
 * the reduced amount. `max_shares_in` never exceeds `sharesHeld`.
 */
export function planExit(
  m: Pick<OnChainMarket, 'reserve_yes' | 'reserve_no' | 'fee_bps'>,
  outcome: Outcome,
  sharesTarget: bigint,
  slippageBps: bigint,
  sharesHeld: bigint = sharesTarget,
): ExitPlan {
  const [rSold, rOther] = outcome === 'YES'
    ? [BigInt(m.reserve_yes), BigInt(m.reserve_no)]
    : [BigInt(m.reserve_no), BigInt(m.reserve_yes)];
  const feeBps = BigInt(m.fee_bps);

  let target = sharesTarget < sharesHeld ? sharesTarget : sharesHeld;
  for (let halvings = 0; halvings <= MAX_HALVINGS && target > 0n; halvings++) {
    try {
      let collateralOut = collateralOutForShares(rSold, rOther, target, feeBps);
      for (let step = 0; step < MAX_VERIFY_STEPS; step++) {
        if (collateralOut <= 0n) throw new MathError('invalid input');
        const sale = calcSell(rSold, rOther, collateralOut, feeBps);
        if (sale.sharesIn <= target) {
          const padded = (target * (10_000n + slippageBps)) / 10_000n;
          const maxSharesIn = padded < sharesHeld ? padded : sharesHeld;
          return { sharesTarget: target, collateralOut, quotedSharesIn: sale.sharesIn, maxSharesIn };
        }
        collateralOut -= 1n;
      }
      throw new ExitError('EXIT_PLAN_UNVERIFIED', 'Could not find a collateral_out that sells within the target shares');
    } catch (err) {
      if (!(err instanceof MathError)) throw err;
      target /= 2n;
    }
  }
  throw new ExitError('EXIT_ILLIQUID', 'The pool cannot absorb this sale', {
    sharesTarget: sharesTarget.toString(),
  });
}

// ─── Exit execution ──────────────────────────────────────────────────────────

export interface ExitResult {
  exitId: string | null;
  status: 'CONFIRMED' | 'FAILED' | 'SIMULATED' | 'SUBMITTED';
  /** Reason code for FAILED / pending exits, e.g. EXIT_MARKET_CLOSED. */
  code?: string;
  sharesSoldRaw: bigint;
  collateralOutRaw: bigint;
  /** The position is closed after this exit. */
  closed: boolean;
}

interface LoadedPosition {
  id: string;
  marketId: string;
  direction: Outcome;
  status: string;
  sharesRaw: any;
  costBasisRaw: any;
  realisedCollateralRaw: any;
  realisedPnlRaw: any;
  entryPriceBps: number | null;
  trade: { amountRaw: any; collateralRaw: any } | null;
  market: { id: string; onChainMarketId: bigint | null; expiryTimestamp: Date };
}

const loadPosition = (id: string) =>
  prisma.position.findUnique({
    where: { id },
    include: {
      trade: { select: { amountRaw: true, collateralRaw: true } },
      market: { select: { id: true, onChainMarketId: true, expiryTimestamp: true } },
    },
  }) as unknown as Promise<LoadedPosition | null>;

const outcomeValue = (o: Outcome) => (o === 'YES' ? Outcomes.Yes : Outcomes.No);

async function chainHeld(onChainMarketId: bigint, outcome: Outcome): Promise<bigint> {
  const held = await getPosition(onChainMarketId, CONTRACTS.treasury);
  return BigInt(outcome === 'YES' ? held.yes : held.no);
}

type Failure = 'slippage' | 'insufficient' | 'closed' | 'paused' | 'agent-paused' | 'breaker' | 'ambiguous' | 'other';

function classify(err: unknown): Failure {
  if (err instanceof AgentPausedError) return 'agent-paused';
  // Submitted but unconfirmed within the inline wait (#35): the outbox worker
  // resolves it; the exit stays SUBMITTED until then.
  if (err instanceof ChainPendingError) return 'ambiguous';
  if (err instanceof ChainError) {
    switch (err.contractError) {
      case 'SlippageExceeded': return 'slippage';
      case 'InsufficientShares': return 'insufficient';
      case 'PriceImpactTooHigh':
      case 'PriceBandExceeded': return 'breaker';
      case 'MarketClosed':
      case 'MarketNotOpen': return 'closed';
      case 'Paused': return 'paused';
    }
    if ((err.details as { failureClass?: string } | undefined)?.failureClass === 'BREAKER_TRIPPED') return 'breaker';
    // The submission may or may not have landed. #40 reports this as a
    // TransactionError with failureClass UNKNOWN_OUTCOME / submitted=true.
    if (err.code === 'CHAIN_SUBMISSION_TIMEOUT') return 'ambiguous';
    if ((err.details as { failureClass?: string } | undefined)?.failureClass === 'UNKNOWN_OUTCOME') return 'ambiguous';
    if (err.contractError === null && /submission failed/.test(err.message)) return 'ambiguous';
  }
  return 'other';
}

const FAILURE_CODES: Record<Exclude<Failure, 'ambiguous'>, string> = {
  slippage: 'EXIT_SLIPPAGE',
  insufficient: 'EXIT_INSUFFICIENT_SHARES',
  breaker: 'EXIT_BREAKER_TRIPPED',
  closed: 'EXIT_MARKET_CLOSED',
  paused: 'EXIT_PAUSED',
  'agent-paused': 'AGENT_PAUSED',
  other: 'EXIT_FAILED',
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function recordFailure(
  positionId: string,
  p: { mode: string; reason: string; code: string; error?: string; collateralOut?: bigint; maxSharesIn?: bigint },
) {
  return prisma.positionExit.create({
    data: {
      positionId,
      mode: p.mode,
      reason: p.reason,
      status: 'FAILED',
      error: [p.code, p.error].filter(Boolean).join(': '),
      collateralOutRaw: bigintToDecimalString(p.collateralOut ?? 0n),
      maxSharesInRaw: bigintToDecimalString(p.maxSharesIn ?? 0n),
    },
  });
}

/**
 * Applies a confirmed (or reconciled) sale to the position and the exit row in
 * one transaction. Cost basis is released pro rata; a full exit releases it all.
 */
/**
 * Applies a confirmed exit exactly once (#35): the CONFIRMED transition is a
 * compare-and-set on the exit row's SUBMITTED status inside one transaction
 * with the position update, so the trade.sell completion handler (inline or
 * crash recovery) and exitPosition's direct path can both call it safely —
 * whoever wins the CAS applies the position deltas, the loser reads back.
 *
 * The deltas are computed from the position as read inside that transaction
 * under FOR UPDATE, not from the caller's earlier read: two exits of one
 * position confirmed at once (two recoverers, #229) would otherwise both start
 * from the same sharesBefore and the second update would undo the first.
 */
async function applyConfirmedExitInTx(
  tx: Prisma.TransactionClient,
  positionId: string,
  exitId: string,
  p: { sold: bigint; collateralOut: bigint; txHash: string | null; reason: string; note?: string },
): Promise<{ closed: boolean } | null> {
  const [current] = await tx.$queryRaw<
    Array<{
      sharesRaw: Prisma.Decimal | null;
      costBasisRaw: Prisma.Decimal | null;
      realisedCollateralRaw: Prisma.Decimal;
      realisedPnlRaw: Prisma.Decimal;
      size: number;
    }>
  >`SELECT "sharesRaw", "costBasisRaw", "realisedCollateralRaw", "realisedPnlRaw", "size" FROM positions WHERE id = ${positionId} FOR UPDATE`;
  if (!current) return null;

  const sharesBefore = decimalToBigint(current.sharesRaw as never);
  const costBefore = current.costBasisRaw == null
    ? BigInt(Math.round(current.size * 1_000_000))
    : decimalToBigint(current.costBasisRaw);
  const sold = p.sold > sharesBefore ? sharesBefore : p.sold;
  const remaining = sharesBefore - sold;
  const closed = remaining <= DUST_SHARES;
  const costSold = closed || sharesBefore === 0n ? costBefore : (costBefore * sold) / sharesBefore;
  const realisedPnlRaw = decimalToBigint(current.realisedPnlRaw) + (p.collateralOut - costSold);
  const effectivePriceBps = priceBpsFromRaw(p.collateralOut, sold);
  const effectivePrice = effectivePriceBps === null ? null : effectivePriceBps / 10_000;

  const won = await tx.positionExit.updateMany({
    where: { id: exitId, status: 'SUBMITTED' },
    data: {
      status: 'CONFIRMED',
      sharesSoldRaw: bigintToDecimalString(sold),
      collateralOutRaw: bigintToDecimalString(p.collateralOut),
      effectivePrice,
      effectivePriceBps,
      txHash: p.txHash,
      error: p.note ?? null,
    },
  });
  if (won.count === 0) return null;
  await tx.position.update({
    where: { id: positionId },
    data: {
      sharesRaw: bigintToDecimalString(remaining),
      costBasisRaw: bigintToDecimalString(costBefore - costSold),
      realisedCollateralRaw: bigintToDecimalString(decimalToBigint(current.realisedCollateralRaw) + p.collateralOut),
      realisedPnlRaw: bigintToDecimalString(realisedPnlRaw),
      pnl: toDisplayUsdc(realisedPnlRaw),
      ...(closed
        ? {
            status: p.reason === 'STOP_LOSS' ? 'STOP_LOSS' : 'CLOSED',
            closedAt: new Date(),
            closeReason: p.reason,
            markValueRaw: '0',
            liquidationValueRaw: '0',
            unrealisedPnlRaw: '0',
            ...(effectivePriceBps !== null
              ? { currentPrice: effectivePriceBps / 10_000, markPriceBps: effectivePriceBps }
              : {}),
          }
        : {}),
    } as any,
  });
  return { closed };
}

async function applyConfirmedExit(
  position: LoadedPosition,
  exitId: string,
  p: {
    sold: bigint;
    collateralOut: bigint;
    txHash: string | null;
    reason: string;
    note?: string;
    feeRaw?: bigint | null;
    reserveYesRaw?: bigint | null;
    reserveNoRaw?: bigint | null;
    fillLedger?: number | null;
    fillMismatch?: Record<string, unknown> | null;
  },
): Promise<{ closed: boolean; applied: boolean }> {
  const result = await prisma.$transaction((tx) => applyConfirmedExitInTx(tx, position.id, exitId, p));
  if (!result) {
    const current = await prisma.position.findUnique({ where: { id: position.id }, select: { status: true } });
    return { closed: current != null && current.status !== 'OPEN', applied: false };
  }
  if (result.closed) {
    await cancelPositionPredicates(position.id).catch((err) => {
      logger.warn({ err, positionId: position.id }, 'Failed to cancel predicates on closed position');
    });
  }
  return { closed: result.closed, applied: true };
}

/** Fills missing raw position accounting only from exact fills or chain balances. */
async function backfillShares(position: LoadedPosition, held: bigint): Promise<LoadedPosition> {
  const others = await prisma.position.findMany({
    where: { marketId: position.marketId, direction: position.direction, status: 'OPEN', id: { not: position.id } },
    select: { sharesRaw: true },
  });
  const othersShares = others.reduce((sum, other) => {
    if (other.sharesRaw == null) {
      throw new AppError(409, 'POSITION_ACCOUNTING_RAW_MISSING', 'Cannot allocate on-chain shares without exact balances for peer positions');
    }
    return sum + decimalToBigint(other.sharesRaw);
  }, 0n);
  if (held < othersShares) {
    throw new AppError(409, 'POSITION_ACCOUNTING_RAW_MISSING', 'On-chain balance is below recorded peer position shares');
  }
  const shares = held - othersShares;
  const cost = position.costBasisRaw ?? position.trade?.collateralRaw ?? position.trade?.amountRaw;
  if (cost == null) {
    throw new AppError(409, 'POSITION_ACCOUNTING_RAW_MISSING', 'Position has no exact collateral cost basis');
  }
  const costBasisRaw = decimalToBigint(cost);
  await prisma.position.update({
    where: { id: position.id },
    data: { sharesRaw: bigintToDecimalString(shares), costBasisRaw: bigintToDecimalString(costBasisRaw), valuationSource: 'estimated' } as any,
  });
  return { ...position, sharesRaw: shares.toString(), costBasisRaw: costBasisRaw.toString() };
}

/**
 * Resolves an exit stuck in SUBMITTED by comparing the on-chain balance with
 * the position's recorded shares. Returns false if it can't be decided yet.
 */
async function reconcileStuckExit(position: LoadedPosition, stuck: any): Promise<boolean> {
  try {
    const held = await chainHeld(position.market.onChainMarketId!, position.direction);
    const others = (await prisma.position.findMany({
      where: { marketId: position.marketId, direction: position.direction, status: 'OPEN', id: { not: position.id } },
      select: { sharesRaw: true },
    })) as Array<{ sharesRaw: any }>;
    const othersShares = others.reduce((acc, o) => acc + (o.sharesRaw == null ? 0n : decimalToBigint(o.sharesRaw)), 0n);
    const own = held > othersShares ? held - othersShares : 0n;
    const recorded = decimalToBigint(position.sharesRaw);
    if (own >= recorded) {
      await prisma.positionExit.update({
        where: { id: stuck.id },
        data: { status: 'FAILED', error: 'EXIT_RECONCILED_NOT_LANDED: on-chain balance unchanged' },
      });
      return true;
    }
    await applyConfirmedExit(position, stuck.id, {
      sold: recorded - own,
      collateralOut: decimalToBigint(stuck.collateralOutRaw),
      txHash: stuck.txHash ?? null,
      reason: stuck.reason,
      note: 'Reconciled from the on-chain balance; collateral is the planned collateral_out',
    });
    return true;
  } catch (err) {
    logger.warn({ err: errorText(err), exitId: stuck.id }, 'Could not reconcile stuck exit; blocking new exits');
    return false;
  }
}

/**
 * Sells `fraction` of a position's shares through treasury.agent_sell.
 * Never throws for chain-side failures: the outcome is in the returned status
 * and the PositionExit rows.
 */
/**
 * Plans a sale that fits within market-core's circuit breakers (#292), halving
 * `target` up to `EXIT_BREAKER_MAX_PARTS` times when a single sell would breach
 * `max_impact_bps` or `band_bps`. Remaining shares stay open for the next ledger.
 */
async function planBreakerSafeExit(
  onChainMarketId: bigint,
  market: Pick<OnChainMarket, 'reserve_yes' | 'reserve_no' | 'fee_bps'>,
  outcome: Outcome,
  target: bigint,
  slippageBps: bigint,
  held: bigint,
): Promise<{ plan: ExitPlan; splitForBreaker: boolean }> {
  const [breakerCfg, breakerSt] = await Promise.all([
    getBreakerConfig(onChainMarketId).catch(() => null),
    getBreakerState(onChainMarketId).catch(() => null),
  ]);
  if (!breakerCfg) {
    return { plan: planExit(market, outcome, target, slippageBps, held), splitForBreaker: false };
  }

  const rYes = BigInt(market.reserve_yes);
  const rNo = BigInt(market.reserve_no);
  const feeBps = BigInt(market.fee_bps);
  const preYesBps = Number(priceYesBps(rYes, rNo));
  const maxImpact = Number(breakerCfg.max_impact_bps);
  const maxBand = Number(breakerCfg.band_bps);

  let partTarget = target;
  let splitForBreaker = false;
  const maxParts = Math.max(1, config.EXIT_BREAKER_MAX_PARTS);

  for (let part = 0; part < maxParts && partTarget > 0n; part++) {
    const plan = planExit(market, outcome, partTarget, slippageBps, held);
    const [rSold, rOther] = outcome === 'YES' ? [rYes, rNo] : [rNo, rYes];
    const sale = calcSell(rSold, rOther, plan.collateralOut, feeBps);
    const postYesBps = Number(
      outcome === 'YES'
        ? priceYesBps(sale.newRSold, sale.newROther)
        : priceYesBps(sale.newROther, sale.newRSold),
    );
    const impactBps = Math.abs(postYesBps - preYesBps);
    const bandBps = breakerSt ? Math.abs(postYesBps - Number(breakerSt.ref_price_bps)) : 0;

    if (impactBps <= maxImpact && bandBps <= maxBand) {
      return { plan, splitForBreaker };
    }
    splitForBreaker = true;
    partTarget = plan.sharesTarget / 2n;
  }

  // Return the smallest planned chunk if halving exhausted EXIT_BREAKER_MAX_PARTS.
  const fallbackTarget = partTarget > 0n ? partTarget : 1n;
  return { plan: planExit(market, outcome, fallbackTarget, slippageBps, held), splitForBreaker: true };
}

export async function exitPosition(
  positionId: string,
  opts: { fraction?: number; reason: string },
): Promise<ExitResult> {
  const fraction = opts.fraction ?? 1;
  if (!(fraction > 0 && fraction <= 1)) {
    throw new AppError(400, 'INVALID_FRACTION', 'fraction must be in (0, 1]');
  }
  const fractionBps = BigInt(Math.round(fraction * 10_000));
  const mode = config.CHAIN_EXECUTION_MODE === 'live' ? 'live' : 'dry-run';

  let position = await loadPosition(positionId);
  if (!position) throw new AppError(404, 'POSITION_NOT_FOUND', 'Position not found');
  if (position.status !== 'OPEN') throw new AppError(409, 'POSITION_CLOSED', 'Position is already closed');
  const onChainMarketId = position.market.onChainMarketId;
  if (onChainMarketId === null) {
    throw new AppError(409, 'MARKET_NOT_ON_CHAIN', 'Market has no on-chain id yet');
  }
  const outcome = position.direction;
  const failed = async (code: string, extra: { error?: string; collateralOut?: bigint; maxSharesIn?: bigint } = {}): Promise<ExitResult> => {
    const row = await recordFailure(positionId, { mode, reason: opts.reason, code, ...extra });
    return { exitId: row.id, status: 'FAILED', code, sharesSoldRaw: 0n, collateralOutRaw: 0n, closed: false };
  };

  // A SUBMITTED exit blocks new ones until it is reconciled with the chain.
  const stuck = await prisma.positionExit.findFirst({ where: { positionId, status: 'SUBMITTED' } });
  if (stuck) {
    if (!(await reconcileStuckExit(position, stuck))) {
      return { exitId: stuck.id, status: 'SUBMITTED', code: 'EXIT_PENDING_RECONCILE', sharesSoldRaw: 0n, collateralOutRaw: 0n, closed: false };
    }
    position = await loadPosition(positionId);
    if (!position || position.status !== 'OPEN') {
      return { exitId: stuck.id, status: 'CONFIRMED', sharesSoldRaw: 0n, collateralOutRaw: 0n, closed: true };
    }
  }

  if (position.market.expiryTimestamp.getTime() - nowMs() < EXIT_CLOSE_GUARD_MS) {
    return failed('EXIT_MARKET_CLOSED', { error: 'within 60s of close_time; left to settlement' });
  }

  let held: bigint;
  try {
    held = await chainHeld(onChainMarketId, outcome);
  } catch (err) {
    return failed('EXIT_BALANCE_UNAVAILABLE', { error: errorText(err) });
  }
  if (position.sharesRaw == null) position = await backfillShares(position, held);

  let slippageRetries = 0;
  let insufficientRetries = 0;
  let breakerSplits = 0;
  let effectiveFractionBps = fractionBps;
  for (;;) {
    const recorded = decimalToBigint(position.sharesRaw);
    const available = recorded < held ? recorded : held;
    const target = (available * effectiveFractionBps) / 10_000n;
    if (target <= 0n) return failed('EXIT_NO_SHARES', { error: `recorded ${recorded}, on-chain ${held}` });

    let plan: ExitPlan;
    let exitMarket: OnChainMarket;
    try {
      let market = await getOnChainMarket(onChainMarketId);
      ({ plan } = await planBreakerSafeExit(onChainMarketId, market, outcome, target, EXIT_SLIPPAGE_BPS, held));
      const quoted = await quoteSell(onChainMarketId, outcomeValue(outcome), plan.collateralOut);
      const drift = quoted > plan.quotedSharesIn ? quoted - plan.quotedSharesIn : plan.quotedSharesIn - quoted;
      if (drift > 1n) {
        market = await getOnChainMarket(onChainMarketId);
        ({ plan } = await planBreakerSafeExit(onChainMarketId, market, outcome, target, EXIT_SLIPPAGE_BPS, held));
      }
      exitMarket = market;
    } catch (err) {
      if (err instanceof ExitError) return failed(err.code, { error: err.message });
      const kind = classify(err);
      return failed(kind === 'ambiguous' ? 'EXIT_FAILED' : FAILURE_CODES[kind], { error: errorText(err) });
    }

    const row = await prisma.positionExit.create({
      data: {
        positionId,
        mode,
        reason: opts.reason,
        status: 'SUBMITTED',
        collateralOutRaw: bigintToDecimalString(plan.collateralOut),
        maxSharesInRaw: bigintToDecimalString(plan.maxSharesIn),
      },
    });

    const exitResYes = BigInt(exitMarket.reserve_yes);
    const exitResNo = BigInt(exitMarket.reserve_no);
    const exitYesMidBps = exitResYes > 0n && exitResNo > 0n ? Number(priceYesBps(exitResYes, exitResNo)) : null;
    const exitQuoteMidBps = exitYesMidBps === null ? null : (outcome === 'YES' ? exitYesMidBps : 10_000 - exitYesMidBps);
    await recordExecutionQuoteAttempt({
      kind: 'SELL',
      positionExitId: row.id,
      marketId: position.marketId,
      direction: outcome,
      decisionMidBps: position.markPriceBps ?? null,
      slippageBoundBps: Number(EXIT_SLIPPAGE_BPS),
      liquidityBucket: classifyLiquidityBucket(exitResYes, exitResNo),
      quote: {
        attempt: 1,
        quotedAt: new Date().toISOString(),
        quoteMidBps: exitQuoteMidBps,
        quotedOutRaw: plan.quotedSharesIn.toString(),
        boundRaw: plan.maxSharesIn.toString(),
        quotedPriceBps: priceBpsFromRaw(plan.collateralOut, plan.quotedSharesIn),
      },
    });

    try {
      const result = await agentSell(
        {
          market_id: onChainMarketId,
          outcome: outcomeValue(outcome),
          collateral_out: plan.collateralOut,
          max_shares_in: plan.maxSharesIn,
        },
        undefined,
        { kind: 'trade.sell', refId: row.id },
      );
      if (result.txHash) {
        await markExecutionReportOutcome({
          positionExitId: row.id,
          status: 'PENDING',
          landedTxHash: result.txHash,
        });
      }
      const sold = BigInt(result.value);

      if (result.mode === 'dry-run') {
        const effectivePriceBps = priceBpsFromRaw(plan.collateralOut, sold);
        await prisma.positionExit.update({
          where: { id: row.id },
          data: {
            status: 'SIMULATED',
            sharesSoldRaw: bigintToDecimalString(sold),
            effectivePrice: effectivePriceBps === null ? null : effectivePriceBps / 10_000,
            effectivePriceBps,
          },
        });
        return { exitId: row.id, status: 'SIMULATED', sharesSoldRaw: sold, collateralOutRaw: plan.collateralOut, closed: false };
      }

      // #35, #290: the trade.sell outbox completion handler already applied this
      // inside the outbox transaction before agentSell resolved; only apply
      // directly when an injected test override bypassed the outbox.
      let closed: boolean;
      if (!result.outboxId) {
        ({ closed } = await applyConfirmedExit(position, row.id, {
          sold,
          collateralOut: plan.collateralOut,
          txHash: result.txHash,
          reason: opts.reason,
        }));
      } else {
        const current = await prisma.position.findUnique({ where: { id: position.id }, select: { status: true } });
        closed = current != null && current.status !== 'OPEN';
      }
      await writeAgentLog({
        agentType: 'TRADER',
        level: 'INFO',
        action: closed ? 'POSITION_CLOSED' : 'POSITION_REDUCED',
        marketId: position.marketId,
        data: {
          positionId,
          exitId: row.id,
          reason: opts.reason,
          sharesSoldRaw: finalSold.toString(),
          collateralOutRaw: finalCollateralOut.toString(),
          txHash: result.txHash,
        },
      }).catch(() => undefined);
      logger.info({ positionId, exitId: row.id, closed }, 'Position exit confirmed');
      return { exitId: row.id, status: 'CONFIRMED', sharesSoldRaw: finalSold, collateralOutRaw: finalCollateralOut, closed };
    } catch (err) {
      const kind = classify(err);

      if (kind === 'ambiguous') {
        // The transaction may have landed: leave SUBMITTED; the next call reconciles.
        await prisma.positionExit.update({ where: { id: row.id }, data: { error: errorText(err) } });
        return { exitId: row.id, status: 'SUBMITTED', code: 'EXIT_PENDING_RECONCILE', sharesSoldRaw: 0n, collateralOutRaw: plan.collateralOut, closed: false };
      }

      const code = FAILURE_CODES[kind];
      await prisma.positionExit.update({ where: { id: row.id }, data: { status: 'FAILED', error: `${code}: ${errorText(err)}` } });
      await markExecutionReportOutcome({
        positionExitId: row.id,
        status: kind === 'slippage' ? 'SLIPPAGE_EXCEEDED' : 'FAILED',
        failureCode: kind === 'slippage' ? 'SlippageExceeded' : code,
      });

      if (kind === 'slippage' && slippageRetries < MAX_SLIPPAGE_RETRIES) {
        slippageRetries++;
        continue; // re-plan from a fresh get_market
      }
      if (kind === 'breaker' && breakerSplits < config.EXIT_BREAKER_MAX_PARTS && effectiveFractionBps > 1n) {
        breakerSplits++;
        effectiveFractionBps = effectiveFractionBps / 2n;
        logger.info({ positionId, breakerSplits, effectiveFractionBps: effectiveFractionBps.toString() }, 'Exit tripped breaker; splitting exit size');
        continue;
      }
      if (kind === 'insufficient' && insufficientRetries < MAX_INSUFFICIENT_RETRIES) {
        insufficientRetries++;
        try {
          held = await chainHeld(onChainMarketId, outcome);
          if (held < recorded) {
            await prisma.position.update({ where: { id: positionId }, data: { sharesRaw: bigintToDecimalString(held) } as any });
            position = { ...position, sharesRaw: held.toString() };
          }
          continue;
        } catch (readErr) {
          logger.warn({ err: errorText(readErr), positionId }, 'Could not re-read the on-chain balance');
        }
      }
      logger.warn({ positionId, exitId: row.id, code }, 'Position exit failed');
      return { exitId: row.id, status: 'FAILED', code, sharesSoldRaw: 0n, collateralOutRaw: plan.collateralOut, closed: false };
    }
  }
}

/**
 * Completion handler for `trade.sell` outbox rows (#35, #290). Runs inside
 * the outbox completion transaction using `ctx.tx` (never global `prisma`).
 */
export async function handleTradeSellOutcome(
  row: ChainTransactionRow,
  outcome: CompletionOutcome,
  ctx: CompletionContext,
): Promise<void> {
  const exitId = row.refId;
  if (!exitId) return;
  const exit = await ctx.tx.positionExit.findUnique({ where: { id: exitId } });
  if (!exit || exit.status !== 'SUBMITTED') return;

  if (outcome.status !== 'SUCCESS') {
    await ctx.tx.positionExit.updateMany({
      where: { id: exitId, status: 'SUBMITTED' },
      data: {
        status: 'FAILED',
        error: outcome.status === 'EXPIRED' ? 'expired unsubmitted' : (outcome.error ?? 'failed on-chain'),
      },
    });
    return;
  }

  const pos = await ctx.tx.position.findUnique({
    where: { id: exit.positionId },
    select: { id: true, marketId: true },
  });
  if (!pos) return;
  const sold = BigInt(String(outcome.value ?? '0'));
  const collateralOut = decimalToBigint(exit.collateralOutRaw ?? '0');
  const applied = await applyConfirmedExitInTx(ctx.tx, pos.id, exitId, {
    sold,
    collateralOut,
    txHash: outcome.txHash ?? null,
    reason: exit.reason,
    feeRaw: eventFill?.fee ?? null,
    reserveYesRaw: eventFill?.reserveYes ?? null,
    reserveNoRaw: eventFill?.reserveNo ?? null,
    fillLedger: eventFill?.ledger ?? outcome.ledger ?? null,
    fillMismatch,
  });
  if (applied) {
    ctx.afterCommit(() =>
      writeAgentLog({
        agentType: 'TRADER',
        level: 'INFO',
        action: applied.closed ? 'POSITION_CLOSED' : 'POSITION_REDUCED',
        marketId: pos.marketId,
        data: {
          positionId: pos.id,
          exitId,
          reason: exit.reason,
          sharesSoldRaw: sold.toString(),
          collateralOutRaw: collateralOut.toString(),
          txHash: outcome.txHash ?? null,
        },
      }).catch(() => undefined),
    );
  }
}

registerHandler('trade.sell', handleTradeSellOutcome);
