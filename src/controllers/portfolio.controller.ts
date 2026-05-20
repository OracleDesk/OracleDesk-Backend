import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendSuccess, parsePagination, buildPaginationMeta } from '../utils/response.util';
import { getPortfolioSummary } from '../services/portfolio.service';
import { getPortfolioCorrelations } from '../services/correlation.service';

/**
 * GET /portfolio
 * Returns the agent's portfolio summary:
 *   totalUsdc, deployedCapital, availableCapital,
 *   openPositions count, totalPnl, dailyPnl, builderFeesEarned
 */
export async function getPortfolio(req: Request, res: Response): Promise<void> {
  const [summary, correlations] = await Promise.all([
    getPortfolioSummary(),
    getPortfolioCorrelations(10_000),
  ]);

  sendSuccess(res, { ...summary, correlationRisk: correlations });
}

/**
 * GET /positions
 * Returns paginated positions (open + closed).
 * Query params: status (OPEN|CLOSED|STOP_LOSS|HEDGED), page, limit
 */
export async function getPositions(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req.query as any);
  const status = req.query.status as string | undefined;

  const where = { ...(status ? { status: status as any } : {}) };

  const [positions, total] = await Promise.all([
    prisma.position.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        market: {
          select: { question: true, category: true, settlementCurrency: true, expiryTimestamp: true },
        },
        trade: {
          select: { direction: true, amount: true, edgeDetected: true, kellyFraction: true, txHash: true },
        },
      },
    }),
    prisma.position.count({ where }),
  ]);

  sendSuccess(res, positions, 200, buildPaginationMeta(page, limit, total) as any);
}