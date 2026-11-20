import type { Request, Response } from 'express';
import type { GenerationRunState } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { bindDetached } from '../lib/context';
import { AppError } from '../middlewares/error.middleware';
import { sendSuccess, parsePagination, buildPaginationMeta } from '../utils/response.util';
import { advance, cancelRun, redactRun, retryRun, startRun } from '../services/market-saga.service';

// Market generation saga runs (#242). Guarded in admin.routes.ts by
// markets.generate; cancel, retry and start also require step-up.

const STATES: readonly GenerationRunState[] = [
  'STARTED', 'GATED', 'SIGNALS_READY', 'PROPOSED', 'VALIDATED', 'SEED_PLANNED', 'MARKET_PERSISTED',
  'QUESTION_PINNED', 'CHAIN_SUBMITTED', 'CHAIN_CONFIRMED', 'TRACE_PERSISTED', 'TRACE_PINNED',
  'TRACE_PUBLISHED', 'TRACE_ENQUEUED', 'COMPLETED', 'SKIPPED', 'NEEDS_ATTENTION', 'CANCELLED',
];

/** GET /admin/generation-runs?state&page&limit — newest first, proposal reduced to its question. */
export async function listGenerationRuns(req: Request, res: Response): Promise<void> {
  const state = req.query.state === undefined ? undefined : String(req.query.state);
  if (state !== undefined && !STATES.includes(state as GenerationRunState)) {
    throw new AppError(400, 'VALIDATION_ERROR', `state must be one of ${STATES.join(', ')}`);
  }
  const where = state ? { state: state as GenerationRunState } : {};
  const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
  const [runs, total] = await Promise.all([
    prisma.marketGenerationRun.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    prisma.marketGenerationRun.count({ where }),
  ]);
  sendSuccess(res, runs.map(redactRun), 200, buildPaginationMeta(page, limit, total) as any);
}

/** GET /admin/generation-runs/:id — full outputs and lastError. */
export async function getGenerationRun(req: Request, res: Response): Promise<void> {
  const run = await prisma.marketGenerationRun.findUnique({ where: { id: String(req.params.id) } });
  if (!run) throw new AppError(404, 'RUN_NOT_FOUND', 'Generation run not found');
  sendSuccess(res, run);
}

/** POST /admin/generation-runs/:id/cancel — only before the market is pinned or submitted. */
export async function cancelGenerationRun(req: Request, res: Response): Promise<void> {
  const reason = typeof req.body?.reason === 'string' && req.body.reason ? req.body.reason : 'Admin cancelled';
  sendSuccess(res, await cancelRun(String(req.params.id), reason));
}

/** POST /admin/generation-runs/:id/retry — resets NEEDS_ATTENTION to the failed step and resumes it. */
export async function retryGenerationRun(req: Request, res: Response): Promise<void> {
  const run = await retryRun(String(req.params.id));
  void bindDetached(() => advance(run.id), { kind: 'job' }).catch((err) =>
    logger.warn({ err, runId: run.id }, 'Generation run retry pass failed; the resume sweep will pick it up'),
  );
  sendSuccess(res, run, 202);
}

/** POST /admin/generation-runs — starts an admin-triggered saga run in the background. */
export async function startGenerationRun(_req: Request, res: Response): Promise<void> {
  const runId = await startRun('admin');
  void bindDetached(() => advance(runId, { priority: 'admin' }), { kind: 'job' }).catch((err) =>
    logger.warn({ err, runId }, 'Generation run failed to advance; the resume sweep will pick it up'),
  );
  sendSuccess(res, { runId }, 202);
}
