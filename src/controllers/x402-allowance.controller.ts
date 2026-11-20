import type { Request, Response } from 'express';
import { z } from 'zod';
import { sendError, sendSuccess } from '../utils/response.util';
import {
  commitReservation,
  releaseReservation,
  reserveAllowance,
} from '../services/x402-allowance.service';

/**
 * Service-to-service allowance API for the x402 trace service (#219).
 * Mounted at /x402/allowance behind requireServiceAuth and a required
 * Idempotency-Key. The contract is documented in docs/api.md.
 */

const rawAmount = z.string().regex(/^\d{1,39}$/, 'must be an integer in 7-decimal base units')
  .refine((v) => BigInt(v) > 0n, 'must be positive');
const txHash = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be a 64-character hex transaction hash');

const payerFields = {
  payer: z.string().min(1).max(128),
  subId: z.string().regex(/^\d{1,20}$/).nullish(),
  subIdKind: z.enum(['MUXED', 'MEMO']).nullish(),
};

const reserveSchema = z.object({
  ...payerFields,
  traceId: z.string().min(1).max(128),
  amountRaw: rawAmount,
  nonce: z.string().min(1).max(128),
});

const commitSchema = z.object({
  reservationId: z.string().min(1).max(64),
  txHash,
  // Unix seconds (RPC createdAt) or ISO-8601. Missing: charged to the
  // current UTC day with dayInferred = true.
  ledgerCloseTime: z.union([z.number().int().positive(), z.string().min(1).max(64)]).nullish(),
  amountRaw: rawAmount,
  // Optional: lets a commit for an unknown reservation still be booked.
  payer: payerFields.payer.optional(),
  subId: payerFields.subId,
  subIdKind: payerFields.subIdKind,
  traceId: z.string().min(1).max(128).nullish(),
});

const releaseSchema = z.object({ reservationId: z.string().min(1).max(64) });

function invalid(res: Response, error: z.ZodError): void {
  sendError(res, 400, 'VALIDATION_ERROR', 'Invalid request', error.flatten().fieldErrors as any);
}

/** POST /x402/allowance/reserve */
export async function reserve(req: Request, res: Response): Promise<void> {
  const parsed = reserveSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalid(res, parsed.error);
  const { amountRaw, ...rest } = parsed.data;
  const result = await reserveAllowance({ ...rest, amountRaw: BigInt(amountRaw) });
  sendSuccess(res, result, result.reservationId ? 201 : 200);
}

/** POST /x402/allowance/commit */
export async function commit(req: Request, res: Response): Promise<void> {
  const parsed = commitSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalid(res, parsed.error);
  const { payer, subId, subIdKind, amountRaw, ...rest } = parsed.data;
  const result = await commitReservation({
    ...rest,
    amountRaw: BigInt(amountRaw),
    payer: payer ? { payer, subId, subIdKind } : null,
  });
  sendSuccess(res, result);
}

/** POST /x402/allowance/release */
export async function release(req: Request, res: Response): Promise<void> {
  const parsed = releaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalid(res, parsed.error);
  sendSuccess(res, await releaseReservation(parsed.data.reservationId));
}
