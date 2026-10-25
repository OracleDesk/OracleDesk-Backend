import { z } from 'zod';
import { MarketCategory, ContractCategoryTag } from '../lib/categories';

export const QuestionDocV1 = z
  .object({
    version: z.literal(1),
    question: z.string(),
    category: z.string(),
    contractCategory: z.string(),
    closeTime: z.number(),
    resolutionSource: z.string().nullable().optional(),
    resolutionHash: z.string(),
    backendMarketId: z.string(),
  })
  .strict();

export type QuestionDocV1 = z.infer<typeof QuestionDocV1>;

export const QuestionDocV2 = z
  .object({
    schemaVersion: z.literal(2),
    kind: z.literal('oracledesk.question'),
    question: z.string().min(1),
    category: z.enum([
      'FED',
      'ECB',
      'MACRO',
      'GEOPOLITICAL',
      'ELECTION',
      'POLITICS',
      'CRYPTO',
      'SPORTS',
      'ENTERTAINMENT',
    ]),
    contractCategory: z.enum(['Macro', 'Geopolitics', 'Crypto', 'Sports', 'Culture', 'Other']),
    closeTime: z.number().int(),
    resolutionSource: z.string().nullable(),
    resolutionSpecHash: z.string().regex(/^[0-9a-f]{64}$/),
    backendMarketId: z.string().uuid(),
  })
  .strict();

export type QuestionDocV2 = z.infer<typeof QuestionDocV2>;

export type QuestionDocAny = QuestionDocV1 | QuestionDocV2;

/**
 * Builds a canonical question document according to version (v1 or v2).
 */
export function questionDocument(
  market: {
    id: string;
    question: string;
    category: string;
    expiryTimestamp: Date | string | number;
  },
  resolution: {
    specHash: string;
    source?: string | null;
  },
  contractCategory: string,
  version: 1 | 2 = 2,
): QuestionDocV1 | QuestionDocV2 {
  const closeTime = Math.floor(new Date(market.expiryTimestamp).getTime() / 1000);

  if (version === 1) {
    return QuestionDocV1.parse({
      version: 1,
      question: market.question,
      category: market.category,
      contractCategory,
      closeTime,
      resolutionSource: resolution.source ?? null,
      resolutionHash: resolution.specHash,
      backendMarketId: market.id,
    });
  }

  return QuestionDocV2.parse({
    schemaVersion: 2,
    kind: 'oracledesk.question',
    question: market.question,
    category: market.category as any,
    contractCategory: contractCategory as any,
    closeTime,
    resolutionSource: resolution.source ?? null,
    resolutionSpecHash: resolution.specHash,
    backendMarketId: market.id,
  });
}
