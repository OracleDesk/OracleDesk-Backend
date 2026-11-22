/**
 * Maps contract write methods and their arguments (plus optional return value)
 * to the chain-read cache tags they invalidate (#330).
 *
 * Single source of truth shared by the inline write path (write intents +
 * confirmation) and the outbox recovery worker.
 */

export type WriteTagMethod =
  | 'agent_buy'
  | 'agent_sell'
  | 'agent_create_market'
  | 'register_price_spec'
  | 'register_signer_spec'
  | 'resolve_price'
  | 'attest'
  | 'finalize_signers'
  | 'publish_trace';

/**
 * Mapping from `setChainOverrides` / `chain.service` write function names to
 * their on-chain contract method names. Tested to guarantee every write method
 * is accounted for in `tagsForWrite`.
 */
export const WRITE_OVERRIDE_TO_METHOD: Record<string, WriteTagMethod> = {
  agentBuy: 'agent_buy',
  agentSell: 'agent_sell',
  agentCreateMarket: 'agent_create_market',
  registerPriceSpec: 'register_price_spec',
  registerSignerSpec: 'register_signer_spec',
  resolvePrice: 'resolve_price',
  attest: 'attest',
  finalizeSigners: 'finalize_signers',
  publishTrace: 'publish_trace',
};

function idString(raw: unknown): string | null {
  if (typeof raw === 'bigint') return raw.toString();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return null;
}

function marketIdFromArgs(args: Record<string, unknown> | null | undefined): string | null {
  if (!args || typeof args !== 'object') return null;
  return idString(args.market_id ?? args.marketId);
}

/**
 * Derives the cache tags affected by a chain write.
 *
 * - `agent_buy`, `agent_sell` -> `market:<market_id>`, `treasury:capital`
 * - `agent_create_market` -> `treasury:capital` (+ `market:<returned id>` when known)
 * - `register_price_spec`, `register_signer_spec`, `resolve_price`, `attest`,
 *   `finalize_signers` -> `resolver:<market_id>`, `market:<market_id>`
 * - `publish_trace` -> none
 */
export function tagsForWrite(
  method: string,
  args: Record<string, unknown>,
  returnedValue?: unknown,
): string[] {
  const tags: string[] = [];
  const marketId = marketIdFromArgs(args);

  switch (method) {
    case 'agent_buy':
    case 'agent_sell': {
      if (marketId) tags.push(`market:${marketId}`);
      tags.push('treasury:capital');
      break;
    }
    case 'agent_create_market': {
      tags.push('treasury:capital');
      const createdId = idString(returnedValue) ?? marketId;
      if (createdId) tags.push(`market:${createdId}`);
      break;
    }
    case 'register_price_spec':
    case 'register_signer_spec':
    case 'resolve_price':
    case 'attest':
    case 'finalize_signers': {
      if (marketId) {
        tags.push(`resolver:${marketId}`, `market:${marketId}`);
      }
      break;
    }
    case 'publish_trace':
    default:
      break;
  }

  return tags;
}
