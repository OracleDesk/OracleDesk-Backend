import { z } from 'zod';
import { MarketCategory } from '../lib/categories';

/**
 * A single resolution-spec block, as emitted by `resolvability.service.ts`
 * `QuestionResolutionBlock`. Kept intentionally permissive (passthrough)
 * so document validation does not reject fields added by the resolver as
 * the spec evolves — the hash of the spec is what is pinned on chain, not
 * its individual fields.
 */
const ResolutionBlock = z.object({}).passthrough();

/**
 * Optional price-market block (#90) carried on v1 and v2 question docs for
 * markets whose resolution is driven by a reflector/price oracle.
 */
const PriceResolutionBlock = z
  .object({
    kind: z.literal('price'),
    reflector: z.string(),
    asset: z.string(),
    assetKind: z.enum(['stellar', 'other']).or(z.string()),
    threshold: z.union([z.number(), z.string()]),
    direction: z.enum(['above', 'below', 'at_or_above', 'at_or_below']).or(z.string()),
    maxStaleness: z.number().int().nonnegative(),
  })
  .passthrough();

const MarketCategoryEnum = z.enum(
  Object.values(MarketCategory) as [MarketCategory, ...MarketCategory[]],
);
const ContractCategoryEnum = z.enum([
  'Macro',
  'Geopolitics',
  'Crypto',
  'Sports',
  'Culture',
  'Other',
]);

/**
 * Question document v1 — the shape produced by `questionDocument()` in
 * `market-chain.service.ts` for markets without resolution details. A v1
 * document may still carry a `priceResolution` block when the spec is a
 * reflector-backed price market (#90).
 */
export const QuestionDocV1 = z
  .object({
    version: z.literal(1),
    question: z.string().min(1),
    category: MarketCategoryEnum,
    contractCategory: ContractCategoryEnum,
    closeTime: z.number().int(),
    resolutionSource: z.string().nullable(),
    resolutionHash: z.string().regex(/^[0-9a-f]{64}$/),
    backendMarketId: z.string().uuid(),
    priceResolution: PriceResolutionBlock.optional(),
  })
  .strict();

export type QuestionDocV1 = z.infer<typeof QuestionDocV1>;

/**
 * Question document v2 — same core shape as v1 plus the `resolution` block
 * from #74. The version key is `version` (not `schemaVersion`), matching the
 * actual pinned bytes.
 */
export const QuestionDocV2 = z
  .object({
    version: z.literal(2),
    question: z.string().min(1),
    category: MarketCategoryEnum,
    contractCategory: ContractCategoryEnum,
    closeTime: z.number().int(),
    resolutionSource: z.string().nullable(),
    resolutionHash: z.string().regex(/^[0-9a-f]{64}$/),
    backendMarketId: z.string().uuid(),
    resolution: ResolutionBlock,
    priceResolution: PriceResolutionBlock.optional(),
  })
  .strict();

export type QuestionDocV2 = z.infer<typeof QuestionDocV2>;

export type QuestionDocAny = QuestionDocV1 | QuestionDocV2;

/**
 * Discriminated union over the version literal, used by `pinDocument` and by
 * the published JSON Schema `/schemas/question/v2.json` so validators can
 * accept either version from the same endpoint.
 */
export const QuestionDocAny = z.discriminatedUnion('version', [
  QuestionDocV1,
  QuestionDocV2,
]);
