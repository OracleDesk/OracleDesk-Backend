import type { Request, Response } from 'express';
import { z } from 'zod';
import { StrKey } from '@stellar/stellar-sdk';
import { prisma } from '../lib/prisma';
import { sendSuccess, sendError, buildPaginationMeta } from '../utils/response.util';
import { CONTRACTS } from '../config/contracts';
import { getRedis } from '../lib/redis';
import { toBig } from '../services/wallet-pnl.service';

const leaderboardQuerySchema = z.object({
  window: z.enum(['7d', '30d', 'all']).default('all'),
  category: z.string().optional(),
  metric: z.enum(['pnl', 'volume', 'roi']).default('pnl'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  includeIncomplete: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  label: string | null;
  pnlRaw: string;
  volumeRaw: string;
  roiBps: number;
  trades: number;
  winRate: number;
  incomplete: boolean;
}

/**
 * GET /leaderboard
 * Computes wallet trading performance leaderboard.
 */
export async function getLeaderboard(req: Request, res: Response): Promise<void> {
  const parsed = leaderboardQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Invalid leaderboard query parameters',
      parsed.error.flatten().fieldErrors as any,
    );
    return;
  }

  const { window, category, metric, page, limit, includeIncomplete } = parsed.data;

  // Try Redis cache
  const cacheKey = `leaderboard:${window}:${category || 'all'}:${metric}:${page}:${limit}:${includeIncomplete}`;
  try {
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.status(200).json(JSON.parse(cached));
      return;
    }
  } catch {
    // Redis unavailable, compute directly
  }

  let entries: LeaderboardEntry[] = [];

  if (window === 'all') {
    // Compute from wallet_positions
    const positions = await prisma.walletPosition.findMany({
      where: {
        outcome: { not: { contains: ':lp' } },
        ...(includeIncomplete ? {} : { incomplete: false }),
      },
    });

    const byWallet = new Map<
      string,
      {
        realized: bigint;
        unrealized: bigint;
        bought: bigint;
        sold: bigint;
        trades: number;
        wins: number;
        losses: number;
        incomplete: boolean;
      }
    >();

    for (const p of positions) {
      if (!byWallet.has(p.wallet)) {
        byWallet.set(p.wallet, {
          realized: 0n,
          unrealized: 0n,
          bought: 0n,
          sold: 0n,
          trades: 0,
          wins: 0,
          losses: 0,
          incomplete: false,
        });
      }
      const w = byWallet.get(p.wallet)!;
      const realized = toBig(p.realizedPnl);
      w.realized += realized;
      w.bought += toBig(p.boughtCollateral);
      w.sold += toBig(p.soldCollateral);
      w.trades += p.tradeCount;
      if (p.incomplete) w.incomplete = true;

      if (realized > 0n) w.wins++;
      else if (realized < 0n) w.losses++;
    }

    entries = Array.from(byWallet.entries()).map(([wallet, stats]) => {
      const pnl = stats.realized + stats.unrealized;
      const volume = stats.bought + stats.sold;
      const roiBps = stats.bought > 0n ? Number((pnl * 10_000n) / stats.bought) : 0;
      const winRate =
        stats.trades > 0 ? parseFloat((stats.wins / stats.trades).toFixed(4)) : 0;

      return {
        rank: 0,
        wallet,
        label:
          wallet === CONTRACTS.treasury ? 'OracleDesk agent (treasury)' : null,
        pnlRaw: pnl.toString(),
        volumeRaw: volume.toString(),
        roiBps,
        trades: stats.trades,
        winRate,
        incomplete: stats.incomplete,
      };
    });
  } else {
    // 7d or 30d window: query wallet_stats_daily
    const days = window === '7d' ? 7 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const statsRows = await prisma.walletStatsDaily.findMany({
      where: {
        day: { gte: since },
        ...(category ? { category } : {}),
      },
    });

    const byWallet = new Map<
      string,
      {
        realized: bigint;
        volume: bigint;
        trades: number;
        wins: number;
        losses: number;
      }
    >();

    for (const r of statsRows) {
      if (!byWallet.has(r.wallet)) {
        byWallet.set(r.wallet, {
          realized: 0n,
          volume: 0n,
          trades: 0,
          wins: 0,
          losses: 0,
        });
      }
      const w = byWallet.get(r.wallet)!;
      w.realized += toBig(r.realizedPnl);
      w.volume += toBig(r.volume);
      w.trades += r.trades;
      w.wins += r.wins;
      w.losses += r.losses;
    }

    entries = Array.from(byWallet.entries()).map(([wallet, stats]) => {
      const pnl = stats.realized;
      const roiBps =
        stats.volume > 0n ? Number((pnl * 10_000n) / stats.volume) : 0;
      const winRate =
        stats.trades > 0 ? parseFloat((stats.wins / stats.trades).toFixed(4)) : 0;

      return {
        rank: 0,
        wallet,
        label:
          wallet === CONTRACTS.treasury ? 'OracleDesk agent (treasury)' : null,
        pnlRaw: pnl.toString(),
        volumeRaw: stats.volume.toString(),
        roiBps,
        trades: stats.trades,
        winRate,
        incomplete: false,
      };
    });
  }

  // Sort by requested metric
  entries.sort((a, b) => {
    if (metric === 'pnl') {
      const diff = BigInt(b.pnlRaw) - BigInt(a.pnlRaw);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    }
    if (metric === 'volume') {
      const diff = BigInt(b.volumeRaw) - BigInt(a.volumeRaw);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    }
    if (metric === 'roi') {
      return b.roiBps - a.roiBps;
    }
    return 0;
  });

  const total = entries.length;
  const skip = (page - 1) * limit;
  const paginated = entries.slice(skip, skip + limit).map((e, idx) => ({
    ...e,
    rank: skip + idx + 1,
  }));

  const responseBody = {
    ok: true,
    data: paginated,
    meta: buildPaginationMeta(page, limit, total),
    error: null,
  };

  // Cache in Redis for 30s
  try {
    const redis = getRedis();
    await redis.set(cacheKey, JSON.stringify(responseBody), 'EX', 30);
  } catch {
    // Ignore cache failure
  }

  res.status(200).json(responseBody);
}

/**
 * GET /wallets/:address/stats
 * Fetches comprehensive trading stats for an address.
 */
export async function getWalletStats(req: Request, res: Response): Promise<void> {
  const address = String(req.params.address);

  if (
    !StrKey.isValidEd25519PublicKey(address) &&
    !StrKey.isValidContract(address)
  ) {
    sendError(
      res,
      400,
      'INVALID_ADDRESS',
      'Address must be a valid Stellar public key (G...) or contract address (C...)',
    );
    return;
  }

  const [positions, dailyStats, recentEvents] = await Promise.all([
    prisma.walletPosition.findMany({
      where: { wallet: address },
    }),
    prisma.walletStatsDaily.findMany({
      where: { wallet: address },
      orderBy: { day: 'desc' },
      take: 90,
    }),
    prisma.chainEvent.findMany({
      where: {
        contractName: 'marketCore',
        eventName: 'Trade',
      },
      orderBy: { ledger: 'desc' },
      take: 200,
    }),
  ]);

  // Filter last 50 trades where trader is this address
  const recentTrades = recentEvents
    .filter((e) => (e.params as any)?.trader === address)
    .slice(0, 50)
    .map((e) => ({
      id: e.id,
      txHash: e.txHash,
      ledger: e.ledger,
      ledgerClosedAt: e.ledgerClosedAt,
      params: e.params,
    }));

  let totalRealized = 0n;
  let totalBought = 0n;
  let totalSold = 0n;
  let totalFees = 0n;
  let totalTrades = 0;
  let isIncomplete = false;

  for (const p of positions) {
    if (!p.outcome.includes(':lp')) {
      totalRealized += toBig(p.realizedPnl);
      totalBought += toBig(p.boughtCollateral);
      totalSold += toBig(p.soldCollateral);
      totalFees += toBig(p.feesPaid);
      totalTrades += p.tradeCount;
      if (p.incomplete) isIncomplete = true;
    }
  }

  // Category breakdown from daily stats
  const categoryMap = new Map<string, { volume: bigint; pnl: bigint; trades: number }>();
  for (const d of dailyStats) {
    if (!categoryMap.has(d.category)) {
      categoryMap.set(d.category, { volume: 0n, pnl: 0n, trades: 0 });
    }
    const c = categoryMap.get(d.category)!;
    c.volume += toBig(d.volume);
    c.pnl += toBig(d.realizedPnl);
    c.trades += d.trades;
  }

  const categoryBreakdown = Array.from(categoryMap.entries()).map(([category, s]) => ({
    category,
    volumeRaw: s.volume.toString(),
    pnlRaw: s.pnl.toString(),
    trades: s.trades,
  }));

  sendSuccess(res, {
    wallet: address,
    label: address === CONTRACTS.treasury ? 'OracleDesk agent (treasury)' : null,
    totals: {
      realizedPnlRaw: totalRealized.toString(),
      volumeRaw: (totalBought + totalSold).toString(),
      feesPaidRaw: totalFees.toString(),
      tradeCount: totalTrades,
      incomplete: isIncomplete,
    },
    categoryBreakdown,
    positions: positions.map((p) => ({
      onChainMarketId: p.onChainMarketId.toString(),
      outcome: p.outcome,
      sharesRaw: toBig(p.shares).toString(),
      costBasisRaw: toBig(p.costBasis).toString(),
      realizedPnlRaw: toBig(p.realizedPnl).toString(),
      settled: p.settled,
    })),
    recentTrades,
  });
}
