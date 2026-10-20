export interface CommitIndexedEventsProjectionsAndReportInput {
  marketKey: string;
  primaryUnits: number;
  secondaryUnits: number;
  maxThreshold?: number;
}

export interface CommitIndexedEventsProjectionsAndReport {
  marketKey: string;
  primaryUnits: number;
  secondaryUnits: number;
  utilizationBps: number;
  verdict: 'healthy' | 'degraded' | 'halted';
}

export function evaluateCommitIndexedEventsProjectionsAnd(input: CommitIndexedEventsProjectionsAndReportInput): CommitIndexedEventsProjectionsAndReport {
  const marketKey = input.marketKey.trim();
  if (!marketKey) {
    throw new Error('evaluateCommitIndexedEventsProjectionsAnd: marketKey is required');
  }
  const primaryUnits = Math.max(0, Math.trunc(input.primaryUnits));
  const secondaryUnits = Math.max(0, Math.trunc(input.secondaryUnits));
  const limit = Math.max(1, Math.trunc(input.maxThreshold ?? 100));

  const utilizationBps = Math.min(10000, Math.round(((primaryUnits + secondaryUnits) * 10000) / limit));
  let verdict: 'healthy' | 'degraded' | 'halted' = 'healthy';
  if (utilizationBps >= 8500) {
    verdict = 'halted';
  } else if (utilizationBps >= 5000) {
    verdict = 'degraded';
  }

  return {
    marketKey,
    primaryUnits,
    secondaryUnits,
    utilizationBps,
    verdict,
  };
}
