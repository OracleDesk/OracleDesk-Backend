/**
 * Shared ledger-view and indexer-lag helpers used by the trader, valuation,
 * and health probes (#266).
 *
 * `latestLedgerView()` returns the RPC's current ledger, cached for ≤ 5 s so
 * multiple callers in the same cycle share one network round-trip.
 * `indexerLag()` reads the same `indexer_cursors` row the health probe uses,
 * so every replica sees the same answer.
 */

import { rpcServer } from './stellar/clients';
import { prisma } from '../lib/prisma';
import { CURSOR_ID } from './indexer.service';

export interface LedgerView {
  latestLedger: number;
  latestCloseTime: number;
  observedAt: number;
}

export interface IndexerLag {
  cursorLedger: number | null;
  lagLedgers: number | null;
}

const LEDGER_VIEW_TTL_MS = 5_000;

let cachedView: LedgerView | null = null;

export async function latestLedgerView(): Promise<LedgerView> {
  const now = Date.now();
  if (cachedView && now - cachedView.observedAt < LEDGER_VIEW_TTL_MS) return cachedView;
  const res = await rpcServer.getLatestLedger();
  cachedView = {
    latestLedger: res.sequence,
    latestCloseTime: Number(res.protocolVersion) > 0 ? now : now, // close-time not in all SDKs; use wall time
    observedAt: now,
  };
  return cachedView;
}

/** Invalidate the cache — called by tests and by the indexer after a successful poll. */
export function invalidateLedgerViewCache(): void {
  cachedView = null;
}

export async function indexerLag(view: LedgerView): Promise<IndexerLag> {
  const row = await prisma.indexerCursor.findUnique({ where: { id: CURSOR_ID } });
  if (!row) return { cursorLedger: null, lagLedgers: null };
  const lagLedgers = view.latestLedger - row.lastLedger;
  return { cursorLedger: row.lastLedger, lagLedgers };
}
