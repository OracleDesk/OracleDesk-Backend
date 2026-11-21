import { createHash } from 'node:crypto';
import { canonicalBytes } from '../utils/hash.util';

export interface DecisionLeafV1 {
  version: 1;
  kind: 'oracledesk.decision';
  agent: string;
  cycleId: string;
  decidedAt: string;
  ledger: number;
  marketId: string;
  onChainMarketId: string | null;
  decision: 'BUY' | 'SKIP' | 'HOLD' | 'NO_FORECAST';
  reason?: string;
  inputs: Record<string, number | string | undefined>;
}

export function decisionLeafHash(leaf: DecisionLeafV1): string {
  return createHash('sha256').update(canonicalBytes(leaf)).digest('hex');
}
