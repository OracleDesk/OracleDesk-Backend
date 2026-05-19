import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendSuccess, sendError, parsePagination, buildPaginationMeta } from '../utils/response.util';
import { runMarketMakerCycle } from '../agents/market-maker.agent';
import { listMarketsSchema } from '../validators/market.validator';
import { AppError } from '../middlewares/error.middleware';

/**
 * GET /markets
 * Returns a paginated list of prediction markets.
 * Query params: status, category, currency, page, limit
 */
export async function listMarkets(req: Request, res: Response): Promise<void> {
  const parsed = listMarketsSchema.safeParse({ query: req.query });
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters',
      parsed.error.flatten().fieldErrors as any);
    return;
  }

  const { status, category, currency, page: p, limit: l } = parsed.data.query;
  const { page, limit, skip } = parsePagination({ page: p, limit: l });

  const where = {
    ...(status   ? { status }                                   : {}),
    ...(category ? { category }                                 : {}),
    ...(currency ? { settlementCurrency: currency as any }      : {}),
  };

  const [markets, total] = await Promise.all([
    prisma.market.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { trades: true, reasoningTraces: true } },
      },
    }),
    prisma.market.count({ where }),
  ]);

  sendSuccess(res, markets, 200, buildPaginationMeta(page, limit, total) as any);
}

/**
 * GET /markets/:id
 * Returns full detail for a single market including confidence interval
 * and linked reasoning traces.
 */
export async function getMarket(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const market = await prisma.market.findUnique({
    where: { id },
    include: {
      reasoningTraces: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          agentType: true,
          edge: true,
          probabilityEstimate: true,
          verified: true,
          createdAt: true,
        },
      },
      _count: { select: { trades: true, positions: true } },
    },
  });

  if (!market) {
    sendError(res, 404, 'MARKET_NOT_FOUND', `Market ${id} not found`);
    return;
  }

  sendSuccess(res, market);
}

/**
 * POST /markets/generate
 * Manually trigger one Market Maker Agent cycle.
 * Used for hackathon demos and testing.
 * Requires auth.
 */
export async function triggerMarketGeneration(req: Request, res: Response): Promise<void> {
  // Fire-and-forget — return immediately, cycle runs in background
  runMarketMakerCycle().catch(err =>
    console.error('Manual market generation error:', err)
  );

  sendSuccess(res, { message: 'Market Maker cycle triggered' }, 202);
}