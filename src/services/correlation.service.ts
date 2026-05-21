import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { CorrelationPair, CorrelationCheckResult } from '../types';

const MAX_CORRELATED_EXPOSURE_PCT = 0.05;
const CORRELATION_THRESHOLD       = 0.60;

/**
 * Correlation matrix for all nine MarketCategory values.
 *
 * Values: -1 (perfect inverse) → 0 (no relationship) → +1 (perfect positive).
 *
 * New category reasoning:
 *   POLITICS ↔ ELECTION:     0.85 — political events directly drive electoral outcomes
 *   POLITICS ↔ GEOPOLITICAL: 0.65 — political decisions create geopolitical risk
 *   SPORTS ↔ SPORTS:         0.65 — sports events within a season correlate
 *   SPORTS ↔ ENTERTAINMENT:  0.20 — overlapping celebrity/media coverage
 *   ENTERTAINMENT:           Low correlation with financial markets (<0.15)
 */
const CATEGORY_CORRELATION_MATRIX: Record<string, Record<string, number>> = {
  FED: {
    FED: 0.90, MACRO: 0.75, ECB: 0.55, ELECTION: 0.20,
    GEOPOLITICAL: 0.15, CRYPTO: 0.30, POLITICS: 0.25,
    SPORTS: 0.05, ENTERTAINMENT: 0.05,
  },
  ECB: {
    ECB: 0.85, MACRO: 0.65, FED: 0.55, ELECTION: 0.20,
    GEOPOLITICAL: 0.25, CRYPTO: 0.20, POLITICS: 0.20,
    SPORTS: 0.05, ENTERTAINMENT: 0.05,
  },
  MACRO: {
    MACRO: 0.70, FED: 0.75, ECB: 0.65, ELECTION: 0.30,
    GEOPOLITICAL: 0.25, CRYPTO: 0.40, POLITICS: 0.35,
    SPORTS: 0.10, ENTERTAINMENT: 0.10,
  },
  ELECTION: {
    ELECTION: 0.60, GEOPOLITICAL: 0.50, POLITICS: 0.85,
    FED: 0.20, ECB: 0.20, MACRO: 0.30,
    CRYPTO: 0.10, SPORTS: 0.15, ENTERTAINMENT: 0.10,
  },
  GEOPOLITICAL: {
    GEOPOLITICAL: 0.55, ELECTION: 0.50, POLITICS: 0.65,
    MACRO: 0.25, FED: 0.15, ECB: 0.25,
    CRYPTO: 0.20, SPORTS: 0.10, ENTERTAINMENT: 0.05,
  },
  CRYPTO: {
    CRYPTO: 0.70, MACRO: 0.40, FED: 0.30, ECB: 0.20,
    ELECTION: 0.10, GEOPOLITICAL: 0.20, POLITICS: 0.15,
    SPORTS: 0.10, ENTERTAINMENT: 0.15,
  },
  POLITICS: {
    POLITICS: 0.80, ELECTION: 0.85, GEOPOLITICAL: 0.65,
    MACRO: 0.35, FED: 0.25, ECB: 0.20,
    CRYPTO: 0.15, SPORTS: 0.25, ENTERTAINMENT: 0.15,
  },
  SPORTS: {
    SPORTS: 0.65, ENTERTAINMENT: 0.20, POLITICS: 0.25,
    ELECTION: 0.15, MACRO: 0.10, GEOPOLITICAL: 0.10,
    FED: 0.05, ECB: 0.05, CRYPTO: 0.10,
  },
  ENTERTAINMENT: {
    ENTERTAINMENT: 0.55, SPORTS: 0.20, POLITICS: 0.15,
    ELECTION: 0.10, MACRO: 0.05, GEOPOLITICAL: 0.05,
    FED: 0.05, ECB: 0.05, CRYPTO: 0.15,
  },
};

/**
 * Checks if adding a new position creates excessive correlated exposure.
 *
 * Steps:
 * 1. Load all open positions with their market categories
 * 2. For each open position, score correlation with proposed market
 * 3. Sum total correlated exposure (positions with score ≥ 0.60)
 * 4. If total exceeds 5% of bankroll, reduce new position proportionally
 */
export async function checkCorrelation(
  proposedMarketId: string,
  proposedSize:     number,
  bankroll:         number,
): Promise<CorrelationCheckResult> {
  const proposedMarket = await prisma.market.findUnique({
    where:  { id: proposedMarketId },
    select: { category: true, id: true },
  });

  if (!proposedMarket) {
    return {
      hasCorrelatedPositions:  false,
      correlatedPairs:         [],
      adjustedPositionSize:    proposedSize,
      totalCorrelatedExposure: 0,
    };
  }

  const openPositions = await prisma.position.findMany({
    where:   { status: 'OPEN' },
    include: { market: { select: { id: true, category: true } } },
  });

  const correlatedPairs: CorrelationPair[] = [];
  let totalCorrelatedExposure = 0;

  for (const position of openPositions) {
    const existingCategory = position.market.category;
    const proposedCategory = proposedMarket.category;
    const correlationScore =
      CATEGORY_CORRELATION_MATRIX[proposedCategory]?.[existingCategory] ?? 0;

    if (correlationScore >= CORRELATION_THRESHOLD) {
      correlatedPairs.push({
        marketIdA:        proposedMarketId,
        marketIdB:        position.market.id,
        correlationScore,
        relationship:     'POSITIVE',
      });
      totalCorrelatedExposure += position.size;
    }
  }

  const maxCorrelatedUsdc = bankroll * MAX_CORRELATED_EXPOSURE_PCT;
  const hasExcessExposure = totalCorrelatedExposure + proposedSize > maxCorrelatedUsdc;

  let adjustedPositionSize = proposedSize;
  if (hasExcessExposure) {
    const remainingBudget = Math.max(0, maxCorrelatedUsdc - totalCorrelatedExposure);
    adjustedPositionSize  = Math.min(proposedSize, remainingBudget);
    logger.info(
      { proposedSize, adjustedPositionSize, totalCorrelatedExposure },
      'Position reduced due to correlated exposure',
    );
  }

  return {
    hasCorrelatedPositions:  correlatedPairs.length > 0,
    correlatedPairs,
    adjustedPositionSize:    parseFloat(adjustedPositionSize.toFixed(2)),
    totalCorrelatedExposure: parseFloat(totalCorrelatedExposure.toFixed(2)),
  };
}

/**
 * Returns all highly correlated pairs in the current open portfolio.
 * Used by the portfolio endpoint to surface risk warnings.
 */
export async function getPortfolioCorrelations(bankroll: number): Promise<{
  pairs:         CorrelationPair[];
  totalExposure: number;
  isOverExposed: boolean;
}> {
  const openPositions = await prisma.position.findMany({
    where:   { status: 'OPEN' },
    include: { market: { select: { id: true, category: true } } },
  });

  const pairs: CorrelationPair[] = [];

  for (let i = 0; i < openPositions.length; i++) {
    for (let j = i + 1; j < openPositions.length; j++) {
      const catA  = openPositions[i].market.category;
      const catB  = openPositions[j].market.category;
      const score = CATEGORY_CORRELATION_MATRIX[catA]?.[catB] ?? 0;

      if (score >= CORRELATION_THRESHOLD) {
        pairs.push({
          marketIdA:        openPositions[i].market.id,
          marketIdB:        openPositions[j].market.id,
          correlationScore: score,
          relationship:     score > 0 ? 'POSITIVE' : 'NEGATIVE',
        });
      }
    }
  }

  const totalExposure = openPositions.reduce((acc, p) => acc + p.size, 0);
  const isOverExposed = totalExposure > bankroll * MAX_CORRELATED_EXPOSURE_PCT * 2;

  return { pairs, totalExposure, isOverExposed };
}