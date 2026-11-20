/**
 * Versioned price tables for LLM budgeting and the ledger (#238).
 *
 * The ledger stores `priceVersion` alongside every call so that stored costs
 * keep their meaning when prices change. A price change ships as a NEW
 * version key (e.g. `'2026-11-01'`) — editing an existing entry breaks the
 * invariant and is caught by `tests/llm-ledger.test.ts`.
 */

export interface ProviderPrice {
  /** Price per 1K input tokens, in USD micro-units (1e-6 USD). */
  inputPer1k: number;
  /** Price per 1K output tokens, in USD micro-units (1e-6 USD). */
  outputPer1k: number;
}

/**
 * The current price table, keyed by `model`. The frozen test checks that
 * adding a new version always appends; it never replaces.
 */
export const PRICE_TABLES = {
  '2026-10-01': {
    'claude-sonnet-4-6': { inputPer1k: 3_000, outputPer1k: 15_000 },
    'gemini-2.0-flash':  { inputPer1k: 100,   outputPer1k: 400 },
  },
} as const satisfies Record<string, Record<string, ProviderPrice>>;

export type PriceVersion = keyof typeof PRICE_TABLES;

export const CURRENT_PRICE_VERSION: PriceVersion = '2026-10-01';

/**
 * Fallback used when the model is unknown to the registered version. Keeps
 * the budget on the safe side (overestimate) so a mystery model cannot
 * underestimate itself through a zero price.
 */
const FALLBACK_PRICE: ProviderPrice = { inputPer1k: 3_000, outputPer1k: 15_000 };

/**
 * Returns the price for `model` at `version`, together with `known = true`
 * when the model is in that version's table. The ledger stores `known` as
 * part of the outcome so operators can tell real-model costs from the
 * conservative fallback.
 */
export function priceFor(
  model: string,
  version: PriceVersion = CURRENT_PRICE_VERSION,
): ProviderPrice & { known: boolean } {
  const table = PRICE_TABLES[version];
  const price = table[model as keyof typeof table];
  if (price) return { ...price, known: true };
  return { ...FALLBACK_PRICE, known: false };
}
