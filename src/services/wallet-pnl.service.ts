import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { withAdvisoryLockWait } from '../lib/advisory-lock';
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

  // Void: each outcome holding settles at half its shares via settleValue
  const yesVal = settleValue('void', yes.shares, 0n);
  const noVal = settleValue('void', 0n, no.shares);
  const yesRealized = yesVal - yes.cost;
  const noRealized = noVal - no.cost;

  return {
    yes: { ...yes, realized: yes.realized + yesRealized, cost: 0n },
    no: { ...no, realized: no.realized + noRealized, cost: 0n },
    realized: yesRealized + noRealized,
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
    const { contractName, eventName, params, ledgerClosedAt } = event;
    if (contractName !== 'marketCore') return;

    // Fence against concurrent full/per-market rebuilds when running standalone
    if (!txClient) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('wallet-pnl:global'))`;
      if (params?.market_id !== undefined) {
        const lockKey = `wallet-pnl:market:${BigInt(params.market_id)}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      }
    }

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

      // Out of order detection (earlier event id or trade arriving after settlement)
      if (existing && (existing.settled || (existing.lastEventId && event.id < existing.lastEventId))) {
        logger.warn({ marketId: onChainMarketId.toString(), eventId: event.id }, 'Out-of-order event detected');
        await tx.walletPnlDirtyMarket.upsert({
          where: { onChainMarketId },
          create: { onChainMarketId, reason: existing.settled ? 'Trade after settlement' : 'Out-of-order event' },
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
        if (first.lastEventId && event.id < first.lastEventId) {
          logger.warn({ marketId: onChainMarketId.toString(), eventId: event.id }, 'Out-of-order Redeemed event detected');
          await tx.walletPnlDirtyMarket.upsert({
            where: { onChainMarketId },
            create: { onChainMarketId, reason: 'Out-of-order Redeemed event' },
            update: {},
          });
        }
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

const MARKET_CORE_PNL_EVENTS = ['MarketCreated', 'Trade', 'Redeemed', 'MarketResolved'];

function toUtcDay(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/**
 * Recomputes daily stats for the given (wallet, day, category) keys from all
 * *other* markets in the same category, so a per-market rebuild can clear the
 * target market's contribution without losing sibling markets on the same day.
 */
async function resetDailyStatsForMarket(
  tx: Prisma.TransactionClient,
  targetMarketId: bigint,
  targetEvents: Array<{ eventName: string; params: unknown; ledgerClosedAt: Date }>,
): Promise<void> {
  const market = await tx.market.findUnique({
    where: { onChainMarketId: targetMarketId },
    select: { category: true },
  });
  const category = market?.category ? String(market.category) : 'MACRO';

  const affectedKeys = new Map<string, { wallet: string; day: Date }>();
  for (const ev of targetEvents) {
    if (ev.eventName !== 'Trade') continue;
    const p = ev.params as Record<string, any>;
    const wallet = String(p?.trader ?? '');
    if (!wallet) continue;
    const day = toUtcDay(ev.ledgerClosedAt);
    affectedKeys.set(`${wallet}:${day.toISOString()}`, { wallet, day });
  }
  if (affectedKeys.size === 0) return;

  const affectedWallets = new Set([...affectedKeys.values()].map((k) => k.wallet));
  for (const { wallet, day } of affectedKeys.values()) {
    await tx.walletStatsDaily.deleteMany({
      where: { wallet, day, category },
    });
  }

  // Find sibling markets in the same category where affected wallets have positions
  const siblingPositions = await tx.walletPosition.findMany({
    where: {
      wallet: { in: [...affectedWallets] },
      onChainMarketId: { not: targetMarketId },
    },
    select: { onChainMarketId: true },
    distinct: ['onChainMarketId'],
  });
  if (siblingPositions.length === 0) return;

  const siblingMarkets = await tx.market.findMany({
    where: {
      onChainMarketId: { in: siblingPositions.map((p) => p.onChainMarketId) },
    },
    select: { onChainMarketId: true, category: true },
  });
  const sameCategoryMarketIds = new Set(
    siblingMarkets
      .filter((m) => (m.category ? String(m.category) : 'MACRO') === category && m.onChainMarketId !== null)
      .map((m) => m.onChainMarketId!.toString()),
  );
  if (sameCategoryMarketIds.size === 0) return;

  const siblingTrades = await tx.chainEvent.findMany({
    where: {
      contractName: 'marketCore',
      eventName: 'Trade',
    },
    orderBy: [{ ledger: 'asc' }, { id: 'asc' }],
  });

  // Replay sibling trades in memory per (wallet, market, outcome) to get exact daily stats
  const lots = new Map<string, Lot>();
  const dailyAgg = new Map<
    string,
    { wallet: string; day: Date; volume: bigint; realized: bigint; fees: bigint; trades: number; wins: number; losses: number }
  >();

  for (const ev of siblingTrades) {
    const p = ev.params as Record<string, any>;
    const mIdStr = p?.market_id !== undefined ? String(p.market_id) : '';
    if (!sameCategoryMarketIds.has(mIdStr)) continue;
    const wallet = String(p?.trader ?? '');
    if (!affectedWallets.has(wallet)) continue;

    const rawOutcome = p.outcome?.tag ?? p.outcome;
    const outcome = rawOutcome === 'No' ? 'No' : 'Yes';
    const lotKey = `${wallet}:${mIdStr}:${outcome}`;
    let lot = lots.get(lotKey) ?? createEmptyLot();

    const isBuy = Boolean(p.is_buy);
    const collateral = BigInt(p.collateral || 0);
    const shares = BigInt(p.shares || 0);
    const fee = BigInt(p.fee || 0);

    let tradeRealized = 0n;
    if (isBuy) {
      lot = applyBuy(lot, collateral, shares, fee);
    } else {
      const res = applySell(lot, collateral, shares, fee);
      lot = res.lot;
      tradeRealized = res.realized;
    }
    lots.set(lotKey, lot);

    const day = toUtcDay(ev.ledgerClosedAt);
    const dk = `${wallet}:${day.toISOString()}`;
    if (!affectedKeys.has(dk)) continue;

    const cur = dailyAgg.get(dk) ?? {
      wallet,
      day,
      volume: 0n,
      realized: 0n,
      fees: 0n,
      trades: 0,
      wins: 0,
      losses: 0,
    };
    cur.volume += collateral;
    cur.realized += tradeRealized;
    cur.fees += fee;
    cur.trades += 1;
    if (tradeRealized > 0n) cur.wins += 1;
    else if (tradeRealized < 0n) cur.losses += 1;
    dailyAgg.set(dk, cur);
  }

  for (const row of dailyAgg.values()) {
    await tx.walletStatsDaily.create({
      data: {
        wallet: row.wallet,
        day: row.day,
        category,
        volume: toDec(row.volume),
        realizedPnl: toDec(row.realized),
        fees: toDec(row.fees),
        trades: row.trades,
        wins: row.wins,
        losses: row.losses,
      },
    });
  }
}

/**
 * Full or per-market rebuild of wallet PnL state from chain_events.
 * Acquires Postgres advisory locks so it can run safely while the indexer is live.
 */
export async function rebuildWalletPnl(opts: {
  fromScratch?: boolean;
  marketId?: bigint;
}): Promise<void> {
  logger.info({ opts }, 'Starting wallet PnL rebuild');

  if (opts.fromScratch) {
    const lockRes = await withAdvisoryLockWait('wallet-pnl:global', async (tx) => {
      await tx.walletEventApplied.deleteMany();
      await tx.walletPosition.deleteMany();
      await tx.walletStatsDaily.deleteMany();
      await tx.walletPnlDirtyMarket.deleteMany();

      const events = await tx.chainEvent.findMany({
        where: {
          contractName: 'marketCore',
          eventName: { in: MARKET_CORE_PNL_EVENTS },
        },
        orderBy: [{ ledger: 'asc' }, { id: 'asc' }],
      });

      for (const ev of events) {
        await applyWalletEvent(
          {
            id: ev.id,
            contractName: ev.contractName,
            eventName: ev.eventName,
            params: ev.params as any,
            ledgerClosedAt: ev.ledgerClosedAt.toISOString(),
          },
          tx,
        );
      }
    });
    if (!lockRes.acquired) {
      throw new Error('Could not acquire global wallet-pnl advisory lock for rebuild');
    }
  } else if (opts.marketId !== undefined) {
    const targetMarketId = opts.marketId;
    const lockKey = `wallet-pnl:market:${targetMarketId}`;
    const lockRes = await withAdvisoryLockWait(lockKey, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('wallet-pnl:global'))`;

      const allEvents = await tx.chainEvent.findMany({
        where: {
          contractName: 'marketCore',
          eventName: { in: MARKET_CORE_PNL_EVENTS },
        },
        orderBy: [{ ledger: 'asc' }, { id: 'asc' }],
      });

      const marketEvents = allEvents.filter((ev) => {
        const p = ev.params as Record<string, any>;
        return p?.market_id !== undefined && BigInt(p.market_id) === targetMarketId;
      });

      await resetDailyStatsForMarket(tx, targetMarketId, marketEvents);

      if (marketEvents.length > 0) {
        await tx.walletEventApplied.deleteMany({
          where: { eventId: { in: marketEvents.map((e) => e.id) } },
        });
      }
      await tx.walletPosition.deleteMany({
        where: { onChainMarketId: targetMarketId },
      });
      await tx.walletPnlDirtyMarket.deleteMany({
        where: { onChainMarketId: targetMarketId },
      });

      for (const ev of marketEvents) {
        await applyWalletEvent(
          {
            id: ev.id,
            contractName: ev.contractName,
            eventName: ev.eventName,
            params: ev.params as any,
            ledgerClosedAt: ev.ledgerClosedAt.toISOString(),
          },
          tx,
        );
      }
    });
    if (!lockRes.acquired) {
      throw new Error(`Could not acquire wallet-pnl advisory lock for market ${targetMarketId}`);
    }
  }

  logger.info('Wallet PnL rebuild complete');
}

/**
 * Rebuilds any markets marked dirty by out-of-order events.
 */
export async function processDirtyMarkets(limit = 10): Promise<number> {
  const dirty = await prisma.walletPnlDirtyMarket.findMany({
    orderBy: { detectedAt: 'asc' },
    take: limit,
  });
  let repaired = 0;
  for (const row of dirty) {
    try {
      await rebuildWalletPnl({ marketId: row.onChainMarketId });
      repaired++;
    } catch (err) {
      logger.error(
        { err, marketId: row.onChainMarketId.toString() },
        'Failed to rebuild dirty wallet PnL market',
      );
    }
  }
  return repaired;
}
