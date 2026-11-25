import { indexerLag, latestLedgerView } from '../services/chain-freshness.service';

export type FreshnessSource = 'db' | 'indexed' | 'chain-cache' | 'rpc' | 'mixed';

/** Build the stable freshness metadata shared by chain-derived endpoints. */
export async function freshnessMeta(
  source: FreshnessSource,
  asOfLedger: number | null,
): Promise<{ freshness: Record<string, unknown> }> {
  let indexer: Record<string, unknown> | null = null;
  try {
    const view = await latestLedgerView();
    const lag = await indexerLag(view);
    indexer = {
      lastLedger: lag.cursorLedger,
      lagLedgers: lag.lagLedgers,
      stale: lag.lagLedgers !== null && lag.lagLedgers > 12,
    };
  } catch {
    // Freshness must never make an otherwise healthy read fail.
  }
  return {
    freshness: {
      source,
      asOfLedger,
      ledgerClosedAt: null,
      indexer,
    },
  };
}
