import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { MARKET_CATEGORIES } from '../lib/llm-schema';
import { sendError, sendSuccess } from '../utils/response.util';
import { AppError } from '../middlewares/error.middleware';
import { RISK_PARAM_SCOPES, type RiskParamScope } from '../lib/risk-params';
import {
  activateRiskParamSet,
  approveRiskParamSet,
  getRiskParamSet,
  listRiskParamSets,
  proposeRiskParamSet,
  rejectRiskParamSet,
} from '../services/risk-params.service';
import {
  GROUP_BYS,
  WINDOWS,
  computeAndStoreSnapshots,
  latestSnapshots,
} from '../services/calibration.service';
import { listActiveMaps } from '../services/recalibration.service';

const querySchema = z.object({
  window: z.enum(WINDOWS).default('90d'),
  groupBy: z.enum(GROUP_BYS).default('agentType'),
  agentType: z.enum(['MARKET_MAKER', 'TRADER']).optional(),
  category: z.enum(MARKET_CATEGORIES).optional(),
  // #244: also return the active recalibration maps and what they were fitted from.
  include: z.enum(['maps']).optional(),
});

/**
 * GET /agents/calibration?window=90d&groupBy=agentType&agentType=TRADER
 *
 * The latest stored snapshot for the window and grouping. `agentType` and
 * `category` filter the slices and only make sense for the groupings that
 * contain them (agentType, category, agentType_category).
 */
export async function getCalibration(req: Request, res: Response): Promise<void> {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid calibration query', parsed.error.flatten().fieldErrors as any);
    return;
  }
  const { window, groupBy, agentType, category, include } = parsed.data;

  const allowsAgent = groupBy === 'agentType' || groupBy === 'agentType_category';
  const allowsCategory = groupBy === 'category' || groupBy === 'agentType_category';
  if ((agentType && !allowsAgent) || (category && !allowsCategory)) {
    sendError(res, 400, 'VALIDATION_ERROR', `The agentType and category filters do not apply to groupBy=${groupBy}`);
    return;
  }

  let groupKey: string | undefined;
  if (groupBy === 'agentType') groupKey = agentType;
  else if (groupBy === 'category') groupKey = category;
  else if (groupBy === 'agentType_category' && agentType && category) groupKey = `${agentType}:${category}`;

  const snapshot = await latestSnapshots({ window, groupBy, groupKey });
  let slices = snapshot.slices;
  if (groupBy === 'agentType_category') {
    slices = slices.filter(({ groupKey: k }) => {
      const [a, c] = k.split(':');
      return (!agentType || a === agentType) && (!category || c === category);
    });
  }

  // Snapshots are daily: let shared caches hold a response for five minutes.
  res.setHeader('Cache-Control', 'public, max-age=300');
  sendSuccess(res, {
    window,
    groupBy,
    computedAt: snapshot.computedAt,
    minCalibrationMarkets: config.MIN_CALIBRATION_MARKETS,
    weighting: config.CALIBRATION_WEIGHTING,
    slices: slices.map(({ groupKey: key, metrics }) => ({ groupKey: key, ...(metrics as object) })),
    ...(include === 'maps' ? { recalibrationEnabled: config.CALIBRATION_SHRINKAGE_ENABLED, maps: await listActiveMaps() } : {}),
  });
}

/** POST /agents/calibration/recompute (admin). Runs the daily job now. */
export async function recomputeCalibration(_req: Request, res: Response): Promise<void> {
  const run = await computeAndStoreSnapshots();
  if (!run) {
    sendError(res, 409, 'CALIBRATION_IN_PROGRESS', 'Another instance is already computing calibration snapshots');
    return;
  }
  sendSuccess(res, run);
}

function actor(req: Request): string {
  if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  return req.user.walletAddress;
}

const scopeSchema = z.enum(RISK_PARAM_SCOPES);

export async function getRiskParams(req: Request, res: Response): Promise<void> {
  const parsed = scopeSchema.safeParse(req.query.scope);
  if (!parsed.success) {
    sendError(res, 400, 'VALIDATION_ERROR', `scope must be one of: ${RISK_PARAM_SCOPES.join(', ')}`);
    return;
  }
  sendSuccess(res, await listRiskParamSets(parsed.data));
}

export async function getRiskParamById(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getRiskParamSet(String(req.params.id)));
}

export async function postRiskParams(req: Request, res: Response): Promise<void> {
  const body = z
    .object({
      scope: scopeSchema,
      params: z.unknown(),
      reason: z.string().min(1).max(2000),
    })
    .parse(req.body ?? {});
  const row = await proposeRiskParamSet({ ...body, scope: body.scope as RiskParamScope, actor: actor(req) });
  sendSuccess(res, row, 201);
}

export async function postRiskParamsApprove(req: Request, res: Response): Promise<void> {
  await approveRiskParamSet(String(req.params.id), actor(req));
  sendSuccess(res, { approved: true });
}

export async function postRiskParamsReject(req: Request, res: Response): Promise<void> {
  await rejectRiskParamSet(String(req.params.id), actor(req));
  sendSuccess(res, { rejected: true });
}

export async function postRiskParamsActivate(req: Request, res: Response): Promise<void> {
  await activateRiskParamSet(String(req.params.id), actor(req));
  sendSuccess(res, { activated: true });
}
