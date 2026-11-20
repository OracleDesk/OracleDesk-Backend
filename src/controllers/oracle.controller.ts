import type { Request, Response } from 'express';
import { sendSuccess } from '../utils/response.util';
import { getResolutionStatus } from '../services/oracle.service';
import { freshnessMeta } from '../lib/freshness';

/** GET /oracle/markets/:marketId/resolution — live resolver + market-core state. */
export async function getResolution(req: Request, res: Response): Promise<void> {
  const result = await getResolutionStatus(String(req.params.marketId), req.signal);
  sendSuccess(res, result, 200, await freshnessMeta(result.cached ? 'chain-cache' : 'rpc', result.ledger));
}
