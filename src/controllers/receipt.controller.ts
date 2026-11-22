import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../middlewares/error.middleware';
import { buildPaginationMeta, parsePagination, sendSuccess } from '../utils/response.util';
import {
  getUserReceipt,
  listUserReceipts,
  receiptJwks,
  redeemReceipt,
  toDetachedJws,
} from '../services/receipt.service';

const redeemReceiptSchema = z.object({
  jws: z.string().min(10),
  document: z.record(z.string(), z.unknown()).optional(),
});

export async function getReceiptJwks(_req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json(receiptJwks());
}

export async function listReceipts(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { page, limit } = parsePagination(req.query as Record<string, string>);
  const { rows, total } = await listUserReceipts(userId, page, limit);
  sendSuccess(res, rows, 200, buildPaginationMeta(page, limit, total) as any);
}

export async function getReceipt(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const id = String(req.params.id);
  const receipt = await getUserReceipt(userId, id);

  const format = String(req.query.format ?? '').toLowerCase();
  const accept = String(req.headers.accept ?? '').toLowerCase();
  if (format === 'jws' || accept.includes('application/jose')) {
    const detached = toDetachedJws(receipt.jws);
    res.setHeader('Content-Type', 'application/jose; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${receipt.receiptId}.jws"`);
    res.status(200).send(detached);
    return;
  }

  sendSuccess(res, {
    id: receipt.id,
    receiptId: receipt.receiptId,
    version: receipt.version,
    type: receipt.type,
    traceId: receipt.traceId,
    txHash: receipt.txHash,
    ledger: receipt.ledger,
    amountRaw: receipt.amountRaw,
    priceVersion: receipt.priceVersion,
    keyId: receipt.keyId,
    document: receipt.document,
    jws: receipt.jws,
    detachedJws: toDetachedJws(receipt.jws),
    redeemedAt: receipt.redeemedAt,
    createdAt: receipt.createdAt,
  });
}

export async function postRedeemReceipt(req: Request, res: Response): Promise<void> {
  const parsed = redeemReceiptSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid receipt redemption payload', parsed.error.flatten().fieldErrors as any);
  }
  const result = await redeemReceipt({
    jws: parsed.data.jws,
    document: parsed.data.document as any,
    requesterUserId: req.user!.userId,
  });
  sendSuccess(res, result, result.redeemed ? 201 : 200);
}
