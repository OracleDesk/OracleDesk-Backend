import type { Request, Response } from 'express';
import { getLatestRiskSnapshot, getRiskSnapshotHistory, computeAndStoreRiskSnapshot } from '../services/portfolio-risk.service';

export async function getRiskPortfolio(_req: Request, res: Response): Promise<void> {
  const snapshot = await getLatestRiskSnapshot();
  if (!snapshot) { res.status(404).json({ error: 'No risk snapshot available yet' }); return; }
  res.json(snapshot);
}

export async function getRiskPortfolioHistory(req: Request, res: Response): Promise<void> {
  const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 7 * 86400000);
  const to   = req.query.to   ? new Date(req.query.to   as string) : new Date();
  const rows = await getRiskSnapshotHistory(from, to);
  res.json(rows);
}

export async function runRiskPortfolio(_req: Request, res: Response): Promise<void> {
  await computeAndStoreRiskSnapshot();
  const snapshot = await getLatestRiskSnapshot();
  res.json(snapshot);
}
