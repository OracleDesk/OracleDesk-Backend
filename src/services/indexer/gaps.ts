import { prisma } from '../../lib/prisma';
import { CURSOR_ID } from '../indexer.service';
import type { IndexerGap } from '@prisma/client';

export interface LedgerRange {
  fromLedger?: number;
  toLedger?: number;
}

/**
 * Returns all unresolved indexer gaps for the given network (default: current network).
 */
export async function openGaps(network: string = CURSOR_ID): Promise<IndexerGap[]> {
  return prisma.indexerGap.findMany({
    where: { network, resolvedAt: null },
    orderBy: { fromLedger: 'asc' },
  });
}

/**
 * Checks whether a ledger or ledger range is tainted by any unresolved indexer gap.
 * If range is omitted, returns true if there are any open gaps.
 */
export function isTainted(
  gaps: IndexerGap[],
  range?: LedgerRange | number,
): boolean {
  if (gaps.length === 0) return false;
  if (range === undefined) return true;

  if (typeof range === 'number') {
    return gaps.some((g) => range >= g.fromLedger && range <= g.toLedger);
  }

  const from = range.fromLedger ?? -Infinity;
  const to = range.toLedger ?? Infinity;
  return gaps.some((g) => g.toLedger >= from && g.fromLedger <= to);
}
