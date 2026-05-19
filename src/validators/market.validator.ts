// This file validates incoming requests for market-related endpoints using Zod schemas. 
// It defines the expected structure of the request body and query parameters for creating and listing markets, ensuring that the data adheres to the specified formats and constraints before being processed by the controllers.

import { z } from 'zod';

export const createMarketSchema = z.object({
  body: z.object({
    question: z.string().min(10, 'Question must be at least 10 characters'),
    category: z.enum(['FED', 'ECB', 'ELECTION', 'GEOPOLITICAL', 'CRYPTO', 'MACRO', "SPORTS", "ENTERTAINMENT", "POLITICS"]),
    settlementCurrency: z.enum(['USDC', 'EURC']).default('USDC'),
    expiryTimestamp: z.number().int().positive(),
    resolutionOracle: z.string().optional(),
    minimumLiquidity: z.number().positive().default(100),
  }),
});

export const listMarketsSchema = z.object({
  query: z.object({
    status: z.enum(['PENDING', 'ACTIVE', 'RESOLVING', 'RESOLVED', 'CANCELLED']).optional(),
    category: z.enum(['FED', 'ECB', 'ELECTION', 'GEOPOLITICAL', 'CRYPTO', 'MACRO', "SPORTS", "ENTERTAINMENT", "POLITICS"]).optional(),
    currency: z.enum(['USDC', 'EURC']).optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export type CreateMarketInput = z.infer<typeof createMarketSchema>['body'];