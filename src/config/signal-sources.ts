import type { SignalSource } from '../services/signal-normalize';

/** How freshness is judged for each provider (#277). */
export interface SourceExpectation {
  /** Wall-clock minutes; null when freshness uses the observation calendar (FRED). */
  maxFreshnessLagMin: number | null;
  /** FRED series observation calendars keyed by series id. */
  fredSeries?: Record<string, { cadenceDays: number }>;
}

export const SOURCE_EXPECTATIONS: Record<SignalSource, SourceExpectation> = {
  NEWSAPI: { maxFreshnessLagMin: 12 * 60 },
  GDELT: { maxFreshnessLagMin: 36 * 60 },
  FRED: {
    maxFreshnessLagMin: null,
    fredSeries: {
      FEDFUNDS: { cadenceDays: 45 },
      CPIAUCSL: { cadenceDays: 35 },
      UNRATE: { cadenceDays: 35 },
      T10Y2Y: { cadenceDays: 2 },
    },
  },
};