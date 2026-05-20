import type { Request, Response } from 'express';
import { sendError, sendSuccess } from '../utils/response.util';
import {
  approveMarketResolution,
  getResolutionStatus,
} from '../services/oracle.service';

export async function approveResolution(req: Request, res: Response): Promise<void> {
  const { marketId, yesWon, rationale } = req.body as {
    marketId?: string;
    yesWon?: boolean;
    rationale?: string;
  };

  if (!marketId || typeof yesWon !== 'boolean') {
    sendError(res, 400, 'INVALID_RESOLUTION_INPUT', 'marketId and boolean yesWon are required');
    return;
  }

  const result = await approveMarketResolution({ marketId, yesWon, rationale });
  sendSuccess(res, result, 202);
}

export async function getResolution(req: Request, res: Response): Promise<void> {
  const marketId = String(req.params.marketId);
  const result = await getResolutionStatus(marketId);
  sendSuccess(res, result);
}
