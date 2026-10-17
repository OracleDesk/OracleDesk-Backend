import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendSuccess, sendError, parsePagination, buildPaginationMeta } from '../utils/response.util';
import { cancelRun } from '../services/market-saga.service';

/**
 * GET /admin/generation-runs
 * Lists market maker generation runs.
 */
export async function listGenerationRuns(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = parsePagination(req.query as any);
  const state = req.query.state as string | undefined;

  const where = state ? { state: state as any } : {};

  const [runs, total] = await Promise.all([
    prisma.marketGenerationRun.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        market: {
          select: {
            id: true,
            question: true,
            status: true,
            onChainMarketId: true,
          },
        },
      },
    }),
    prisma.marketGenerationRun.count({ where }),
  ]);

  sendSuccess(res, runs, 200, buildPaginationMeta(page, limit, total) as any);
}

/**
 * GET /admin/generation-runs/:id
 * Fetches a single generation run by id.
 */
export async function getGenerationRun(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const run = await prisma.marketGenerationRun.findUnique({
    where: { id },
    include: {
      market: true,
    },
  });

  if (!run) {
    sendError(res, 404, 'RUN_NOT_FOUND', `Generation run ${id} not found`);
    return;
  }

  sendSuccess(res, run);
}

/**
 * POST /admin/generation-runs/:id/cancel
 * Cancels an incomplete pre-chain generation run.
 */
export async function cancelGenerationRun(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const reason = (req.body?.reason as string) || 'Admin cancelled via API';

  try {
    const cancelled = await cancelRun(id, reason);
    sendSuccess(res, cancelled);
  } catch (err: any) {
    sendError(res, err.statusCode || 400, err.code || 'CANCEL_FAILED', err.message);
  }
}
