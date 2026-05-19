import { z } from 'zod';

export const copyTradeSchema = z.object({
  body: z.object({
    traceId:   z.string().uuid('Invalid trace ID'),
    marketId:  z.string().uuid('Invalid market ID'),
    amount:    z.number().positive('Amount must be positive'),
    userWallet: z.string().min(42).max(42, 'Invalid wallet address'),
  }),
});

export const kellyInputSchema = z.object({
  agentProbability:  z.number().min(0).max(1),
  marketProbability: z.number().min(0).max(1),
  bankroll:          z.number().positive(),
  netOdds:           z.number().positive(),
});

export type CopyTradeInput = z.infer<typeof copyTradeSchema>['body'];
export type KellyInput = z.infer<typeof kellyInputSchema>;