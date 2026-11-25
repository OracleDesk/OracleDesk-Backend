import type { KellyResult, KellyInput } from '../types';
import type { TraderParamsV1 } from '../lib/risk-params';

/**
 * Half-Kelly position sizing (#274). Thresholds come from the active param snapshot.
 */
export function calculateKellySize(
  input: KellyInput,
  limits: Pick<TraderParamsV1, 'minConservativeEdge' | 'kellyMultiplier' | 'maxSinglePositionPct'>,
): KellyResult {
  const { agentProbability: p, marketProbability, bankroll, netOdds: b } = input;
  const q = 1 - p;
  const edge = p - marketProbability;

  if (edge < limits.minConservativeEdge) {
    return { fraction: 0, halfKelly: 0, betSize: 0, edge, odds: b };
  }

  const rawFraction = (b * p - q) / b;
  if (rawFraction <= 0) {
    return { fraction: 0, halfKelly: 0, betSize: 0, edge, odds: b };
  }

  const halfKelly = Math.min(rawFraction * limits.kellyMultiplier, limits.maxSinglePositionPct);
  const betSize = halfKelly * bankroll;

  return {
    fraction: parseFloat(rawFraction.toFixed(4)),
    halfKelly: parseFloat(halfKelly.toFixed(4)),
    betSize: parseFloat(betSize.toFixed(2)),
    edge: parseFloat(edge.toFixed(4)),
    odds: b,
  };
}