import { z } from 'zod';

export const marketParamsSchema = z.object({
  marketId: z.string().uuid('marketId must be a market UUID'),
});

export const prepareBodySchema = z.object({
  outcome: z.enum(['YES', 'NO']),
  evidenceId: z.string().uuid().optional(),
});

export const evidenceBundleSchema = z.object({
  outcome: z.enum(['YES', 'NO', 'INVALID']),
  sources: z.array(z.string().url()).min(1).max(20),
  notes: z.string().max(2_000).optional(),
});

export const evidenceIdSchema = z.object({ evidenceId: z.string().uuid() });

export const prepareQuerySchema = z.object({
  allowConflict: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});

export const submitBodySchema = z.object({
  xdr: z.string().min(1).max(20_000),
  traceId: z.coerce.bigint().nonnegative().optional(),
});
