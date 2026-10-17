import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import {
  priceYesBps,
  collateralOutForShares,
  seedReserves,
  settleValue,
  BPS,
} from '../generated/fpmm';

export interface Lot {
  shares: bigint;
  cost: bigint;
  realized: bigint;
  fees: bigint;
  bought: bigint;
  sold: bigint;
  redeemed: bigint;
  trades: number;
  incomplete?: boolean;
}

export function createEmptyLot(): Lot {
  return {
    shares: 0n,
    cost: 0n,
    realized: 0n,
    fees: 0n,
    bought: 0n,
    sold: 0n,
    redeemed: 0n,
    trades: 0,
    incomplete: false,
  };
}

export function toBig(
  d: Prisma.Decimal | string | number | bigint | null | undefined,
): bigint {
  if (d === null || d === undefined) return 0n;
  if (typeof d === 'bigint') return d;
  if (typeof d === 'number') return BigInt(Math.trunc(d));
  if (typeof d === 'string') {
    const intPart = d.split('.')[0];
    return BigInt(intPart || '0');
  }
  return BigInt(d.toFixed(0));
}

export function toDec(b: bigint | number): Prisma.Decimal {
  return new Prisma.Decimal(b.toString());
}

// ─── Pure Accounting ─────────────────────────────────────────────────────────

export function applyBuy(
  l: Lot,
  collateralIn: bigint,
  sharesOut: bigint,
  fee: bigint,
): Lot {
  return {
    ...l,
    shares: l.shares + sharesOut,
    cost: l.cost + collateralIn,
    bought: l.bought + collateralIn,
    fees: l.fees + fee,
    trades: l.trades + 1,
  };
}

export function applySell(
  l: Lot,
  collateralOut: bigint,
  sharesIn: bigint,
  fee: bigint,
): { lot: Lot; realized: bigint } {
  let effectiveSharesIn = sharesIn;
  let incomplete = l.incomplete ?? false;
  let removedCost: bigint;

  if (l.shares <= 0n) {
    incomplete = true;
    removedCost = 0n;
    effectiveSharesIn = 0n;
  } else if (sharesIn >= l.shares) {
    if (sharesIn > l.shares) {
      incomplete = true;
    }
    effectiveSharesIn = l.shares;
    removedCost = l.cost;
  } else {
    // Average cost: cost * sharesIn / shares (floor, remainder stays in basis)
    removedCost = (l.cost * sharesIn) / l.shares;
  }

  const realized = collateralOut - removedCost;
  const remainingCost = l.cost >= removedCost ? l.cost - removedCost : 0n;
  const remainingShares =
    l.shares >= effectiveSharesIn ? l.shares - effectiveSharesIn : 0n;

  return {
    lot: {
      ...l,
      shares: remainingShares,
      cost: remainingCost,
      realized: l.realized + realized,
      sold: l.sold + collateralOut,
      fees: l.fees + fee,
      trades: l.trades + 1,
      incomplete,
    },
    realized,
  };
}

export function applySettlement(
  yes: Lot,
  no: Lot,
  kind: 'yes' | 'no' | 'void',
): { yes: Lot; no: Lot; realized: bigint } {
  if (kind === 'yes') {
    const yesVal = yes.shares;
    const yesRealized = yesVal - yes.cost;
    const noRealized = 0n - no.cost;
    return {
      yes: { ...yes, realized: yes.realized + yesRealized, cost: 0n },
      no: { ...no, realized: no.realized + noRealized, cost: 0n },
      realized: yesRealized + noRealized,
    };
  }

  if (kind === 'no') {
    const noVal = no.shares;
    const yesRealized = 0n - yes.cost;
    const noRealized = noVal - no.cost;
    return {
      yes: { ...yes, realized: yes.realized + yesRealized, cost: 0n },
      no: { ...no, realized: no.realized + noRealized, cost: 0n },
      realized: yesRealized + noRealized,
    };
  }

  // Void: (yes.shares + no.shares) / 2n
  const combinedVal = (yes.shares + no.shares) / 2n;
  const totalCost = yes.cost + no.cost;
  const totalRealized = combinedVal - totalCost;

  return {
    yes: { ...yes, realized: yes.realized + (combinedVal - yes.cost), cost: 0n },
    no: { ...no, realized: no.realized - no.cost, cost: 0n },
    realized: totalRealized,
  };
}

export function applyRedeem(l: Lot, payout: bigint): Lot {
  return {
    ...l,
    redeemed: l.redeemed + payout,
  };
}

export function markToMarket(
  l: Lot,
  outcome: 'Yes' | 'No',
  reserveYes: bigint,
  reserveNo: bigint,
  mode: 'mid' | 'liquidation',
  feeBps: number,
): bigint {
  if (l.shares <= 0n) return 0n;

  if (mode === 'liquidation') {
    const rSold = outcome === 'Yes' ? reserveYes : reserveNo;
    const rOther = outcome === 'Yes' ? reserveNo : reserveYes;
    try {
      return collateralOutForShares(rSold, rOther, l.shares, BigInt(feeBps));
    } catch {
      return 0n;
    }
  }

  try {
    const yesProb = priceYesBps(reserveYes, reserveNo);
    const prob = outcome === 'Yes' ? yesProb : BPS - yesProb;
    return (l.shares * prob) / BPS;
  } catch {
    return 0n;
  }
}

// ─── Database Projection ──────────────────────────────────────────────────────

function lotFromDb(row: any): Lot {
  if (!row) return createEmptyLot();
  return {
    shares: toBig(row.shares),
    cost: toBig(row.costBasis),
    realized: toBig(row.realizedPnl),
    fees: toBig(row.feesPaid),
    bought: toBig(row.boughtCollateral),
    sold: toBig(row.soldCollateral),
    redeemed: toBig(row.redeemed),
    trades: row.tradeCount || 0,
    incomplete: row.incomplete ?? false,
  };
}

export async function applyWalletEvent(event: any, txClient?: any): Promise<void> {
  const runner = txClient
    ? (fn: any) => fn(txClient)
    : (fn: any) => prisma.$transaction(fn);

  await runner(async (tx: any) => {
    // 1. Check idempotency
    try {
      await tx.walletEventApplied.create({
        data: { eventId: event.id },
      });
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Event already processed
        return;
      }
      throw err;
    }

    const { contractName, eventName, params, ledgerClosedAt } = event;
    if (contractName !== 'marketCore') return;

    const day = new Date(ledgerClosedAt || Date.now());
    day.setUTCHours(0, 0, 0, 0);

    // ── MarketCreated: track creator LP seed shares ─────────────────────────
    if (eventName === 'MarketCreated') {
      const onChainMarketId = BigInt(params.market_id);
      const creator = params.creator;
      const seedAmount = BigInt(params.seed_amount || 0);
      const initialYesBps = BigInt(params.initial_yes_bps || 5000);

      try {
        const seed = seedReserves(seedAmount, initialYesBps);

        // Store creator LP positions
        for (const [outcome, shares] of [
          ['Yes:lp', seed.creatorYes],
          ['No:lp', seed.creatorNo],
        ] as const) {
          if (shares > 0n) {
            await tx.walletPosition.upsert({
              where: {
                wallet_onChainMarketId_outcome: {
                  wallet: creator,
                  onChainMarketId,
                  outcome,
                },
              },
              create: {
                wallet: creator,
                onChainMarketId,
                outcome,
                shares: toDec(shares),
                costBasis: toDec(seedAmount / 2n),
                realizedPnl: toDec(0),
                boughtCollateral: toDec(seedAmount / 2n),
                soldCollateral: toDec(0),
                feesPaid: toDec(0),
                redeemed: toDec(0),
                tradeCount: 1,
                lastEventId: event.id,
              },
              update: {
                shares: toDec(shares),
                lastEventId: event.id,
              },
            });
          }
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Failed to compute seed reserves on MarketCreated');
      }
      return;
    }

    // ── Trade: buy or sell ──────────────────────────────────────────────────
    if (eventName === 'Trade') {
      const onChainMarketId = BigInt(params.market_id);
      const trader = params.trader;
      const rawOutcome = params.outcome?.tag ?? params.outcome;
      const outcome = rawOutcome === 'No' ? 'No' : 'Yes';
      const isBuy = Boolean(params.is_buy);
      const collateral = BigInt(params.collateral || 0);
      const shares = BigInt(params.shares || 0);
      const fee = BigInt(params.fee || 0);

      const existing = await tx.walletPosition.findUnique({
        where: {
          wallet_onChainMarketId_outcome: {
            wallet: trader,
            onChainMarketId,
            outcome,
          },
        },
      });

      // Out of order detection
      if (existing && existing.lastEventId && event.id < existing.lastEventId) {
        logger.warn({ marketId: onChainMarketId.toString(), eventId: event.id }, 'Out-of-order event detected');
        await tx.walletPnlDirtyMarket.upsert({
          where: { onChainMarketId },
          create: { onChainMarketId, reason: 'Out-of-order event' },
          update: {},
        });
      }

      let lot = lotFromDb(existing);
      let tradeRealized = 0n;

      if (isBuy) {
        lot = applyBuy(lot, collateral, shares, fee);
      } else {
        const soldResult = applySell(lot, collateral, shares, fee);
        lot = soldResult.lot;
        tradeRealized = soldResult.realized;
      }

      await tx.walletPosition.upsert({
        where: {
          wallet_onChainMarketId_outcome: {
            wallet: trader,
            onChainMarketId,
            outcome,
          },
        },
        create: {
          wallet: trader,
          onChainMarketId,
          outcome,
          shares: toDec(lot.shares),
          costBasis: toDec(lot.cost),
          realizedPnl: toDec(lot.realized),
          boughtCollateral: toDec(lot.bought),
          soldCollateral: toDec(lot.sold),
          feesPaid: toDec(lot.fees),
          redeemed: toDec(lot.redeemed),
          tradeCount: lot.trades,
          lastEventId: event.id,
          incomplete: lot.incomplete ?? false,
        },
        update: {
          shares: toDec(lot.shares),
          costBasis: toDec(lot.cost),
          realizedPnl: toDec(lot.realized),
          boughtCollateral: toDec(lot.bought),
          soldCollateral: toDec(lot.sold),
          feesPaid: toDec(lot.fees),
          redeemed: toDec(lot.redeemed),
          tradeCount: lot.trades,
          lastEventId: event.id,
          incomplete: lot.incomplete ?? false,
        },
      });

      // Update daily stats
      const market = await tx.market.findUnique({
        where: { onChainMarketId },
        select: { category: true },
      });
      const category = market?.category ? String(market.category) : 'MACRO';

      const daily = await tx.walletStatsDaily.findUnique({
        where: {
          wallet_day_category: {
            wallet: trader,
            day,
            category,
          },
        },
      });

      const curVol = daily ? toBig(daily.volume) : 0n;
      const curReal = daily ? toBig(daily.realizedPnl) : 0n;
      const curFees = daily ? toBig(daily.fees) : 0n;
      const curTrades = daily ? daily.trades : 0;
      let curWins = daily ? daily.wins : 0;
      let curLosses = daily ? daily.losses : 0;

      if (tradeRealized > 0n) curWins++;
      else if (tradeRealized < 0n) curLosses++;

      await tx.walletStatsDaily.upsert({
        where: {
          wallet_day_category: {
            wallet: trader,
            day,
            category,
          },
        },
        create: {
          wallet: trader,
          day,
          category,
          volume: toDec(curVol + collateral),
          realizedPnl: toDec(curReal + tradeRealized),
          fees: toDec(curFees + fee),
          trades: curTrades + 1,
          wins: curWins,
          losses: curLosses,
        },
        update: {
          volume: toDec(curVol + collateral),
          realizedPnl: toDec(curReal + tradeRealized),
          fees: toDec(curFees + fee),
          trades: curTrades + 1,
          wins: curWins,
          losses: curLosses,
        },
      });

      return;
    }

    // ── Redeemed: holder redeems payout ─────────────────────────────────────
    if (eventName === 'Redeemed') {
      const onChainMarketId = BigInt(params.market_id);
      const holder = params.holder;
      const payout = BigInt(params.payout || 0);

      // Reconcile across positions
      const positions = await tx.walletPosition.findMany({
        where: { wallet: holder, onChainMarketId },
      });

      if (positions.length > 0) {
        const first = positions[0];
        const lot = applyRedeem(lotFromDb(first), payout);
        await tx.walletPosition.update({
          where: {
            wallet_onChainMarketId_outcome: {
              wallet: holder,
              onChainMarketId,
              outcome: first.outcome,
            },
          },
          data: {
            redeemed: toDec(lot.redeemed),
            lastEventId: event.id,
          },
        });
      }
      return;
    }

    // ── MarketResolved: settle all positions ────────────────────────────────
    if (eventName === 'MarketResolved') {
      const onChainMarketId = BigInt(params.market_id);
      const rawOutcome = params.outcome?.tag ?? params.outcome;
      let settlementKind: 'yes' | 'no' | 'void' = 'void';
      if (rawOutcome === 'Yes') settlementKind = 'yes';
      else if (rawOutcome === 'No') settlementKind = 'no';

      const positions = await tx.walletPosition.findMany({
        where: { onChainMarketId, settled: false },
      });

      // Group by wallet
      const byWallet = new Map<string, { yes?: any; no?: any }>();
      for (const p of positions) {
        if (!byWallet.has(p.wallet)) byWallet.set(p.wallet, {});
        const entry = byWallet.get(p.wallet)!;
        if (p.outcome === 'Yes') entry.yes = p;
        else if (p.outcome === 'No') entry.no = p;
      }

      for (const [wallet, pair] of byWallet.entries()) {
        const yesLot = lotFromDb(pair.yes);
        const noLot = lotFromDb(pair.no);

        const settled = applySettlement(yesLot, noLot, settlementKind);

        if (pair.yes) {
          await tx.walletPosition.update({
            where: {
              wallet_onChainMarketId_outcome: {
                wallet,
                onChainMarketId,
                outcome: 'Yes',
              },
            },
            data: {
              costBasis: toDec(settled.yes.cost),
              realizedPnl: toDec(settled.yes.realized),
              settled: true,
              lastEventId: event.id,
            },
          });
        }

        if (pair.no) {
          await tx.walletPosition.update({
            where: {
              wallet_onChainMarketId_outcome: {
                wallet,
                onChainMarketId,
                outcome: 'No',
              },
            },
            data: {
              costBasis: toDec(settled.no.cost),
              realizedPnl: toDec(settled.no.realized),
              settled: true,
              lastEventId: event.id,
            },
          });
        }
      }
      return;
    }
  });
}

/**
 * Full or per-market rebuild of wallet PnL state from chain_events.
 */
export async function rebuildWalletPnl(opts: {
  fromScratch?: boolean;
  marketId?: bigint;
}): Promise<void> {
  logger.info({ opts }, 'Starting wallet PnL rebuild');

  if (opts.fromScratch) {
    await prisma.$transaction([
      prisma.walletEventApplied.deleteMany(),
      prisma.walletPosition.deleteMany(),
      prisma.walletStatsDaily.deleteMany(),
      prisma.walletPnlDirtyMarket.deleteMany(),
    ]);
  } else if (opts.marketId) {
    await prisma.$transaction([
      prisma.walletPosition.deleteMany({
        where: { onChainMarketId: opts.marketId },
      }),
      prisma.walletPnlDirtyMarket.deleteMany({
        where: { onChainMarketId: opts.marketId },
      }),
    ]);
  }

  // Load relevant events in chronological order (ledger, id)
  const events = await prisma.chainEvent.findMany({
    where: {
      contractName: 'marketCore',
      eventName: { in: ['MarketCreated', 'Trade', 'Redeemed', 'MarketResolved'] },
    },
    orderBy: [{ ledger: 'asc' }, { id: 'asc' }],
  });

  for (const ev of events) {
    const params = ev.params as any;
    if (opts.marketId && BigInt(params.market_id) !== opts.marketId) {
      continue;
    }

    await applyWalletEvent({
      id: ev.id,
      contractName: ev.contractName,
      eventName: ev.eventName,
      params,
      ledgerClosedAt: ev.ledgerClosedAt.toISOString(),
    });
  }

  logger.info('Wallet PnL rebuild complete');
}
