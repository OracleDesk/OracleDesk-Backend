"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkCorrelation = checkCorrelation;
exports.getPortfolioCorrelations = getPortfolioCorrelations;
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
// ─── Correlation threshold constants ───
const MAX_CORRELATED_EXPOSURE_PCT = 0.05; // 5% of bankroll
const CORRELATION_THRESHOLD = 0.60; // Pairs with score ≥ 0.60 are "correlated"
/**
 * Hardcoded macro correlation matrix.
 *
 * Values range -1 to +1:
 *   +1 = perfectly positively correlated (both move together)
 *   -1 = perfectly negatively correlated (they move opposite)
 *    0 = no relationship
 *
 * These represent known relationships between macro event categories.
 * A full production system would compute these dynamically from historical
 * resolution data, but for V1 we encode known relationships.
 *
 * Key pairs documented:
 *   FED ↔ FED:         0.90 — Fed rate decisions in consecutive meetings are correlated
 *   FED ↔ MACRO:       0.75 — Fed rate decisions influence broad macro
 *   ECB ↔ ECB:         0.85 — ECB consecutive meetings
 *   ECB ↔ MACRO:       0.65 — ECB decisions influence EU macro
 *   FED ↔ ECB:         0.55 — Fed and ECB often move in the same direction
 *   ELECTION ↔ GEOPOLITICAL: 0.50 — Elections can create geopolitical risk
 *   CRYPTO ↔ MACRO:    0.40 — Crypto partially correlated with risk-on/risk-off
 *   ELECTION ↔ FED:    0.20 — Elections occasionally affect Fed path
 */
const CATEGORY_CORRELATION_MATRIX = {
    FED: { FED: 0.90, MACRO: 0.75, ECB: 0.55, ELECTION: 0.20, GEOPOLITICAL: 0.15, CRYPTO: 0.30 },
    ECB: { ECB: 0.85, MACRO: 0.65, FED: 0.55, ELECTION: 0.20, GEOPOLITICAL: 0.25, CRYPTO: 0.20 },
    MACRO: { MACRO: 0.70, FED: 0.75, ECB: 0.65, ELECTION: 0.30, GEOPOLITICAL: 0.25, CRYPTO: 0.40 },
    ELECTION: { ELECTION: 0.60, GEOPOLITICAL: 0.50, FED: 0.20, ECB: 0.20, MACRO: 0.30, CRYPTO: 0.10 },
    GEOPOLITICAL: { GEOPOLITICAL: 0.55, ELECTION: 0.50, MACRO: 0.25, FED: 0.15, ECB: 0.25, CRYPTO: 0.20 },
    CRYPTO: { CRYPTO: 0.70, MACRO: 0.40, FED: 0.30, ECB: 0.20, ELECTION: 0.10, GEOPOLITICAL: 0.20 },
};
/**
 * Check if adding a new position creates excessive correlated exposure.
 *
 * Steps:
 * 1. Load all open positions with their market categories
 * 2. For each open position, compute correlation with the proposed new position
 * 3. Sum total correlated exposure (size of positions with correlation ≥ 0.60)
 * 4. If correlated exposure > 5%, reduce new position size proportionally
 *
 * Returns the adjusted position size and list of correlated pairs.
 */
async function checkCorrelation(proposedMarketId, proposedSize, bankroll) {
    // Get the proposed market's category
    const proposedMarket = await prisma_1.prisma.market.findUnique({
        where: { id: proposedMarketId },
        select: { category: true, id: true },
    });
    if (!proposedMarket) {
        return {
            hasCorrelatedPositions: false,
            correlatedPairs: [],
            adjustedPositionSize: proposedSize,
            totalCorrelatedExposure: 0,
        };
    }
    // Load all open positions with their markets
    const openPositions = await prisma_1.prisma.position.findMany({
        where: { status: 'OPEN' },
        include: { market: { select: { id: true, category: true } } },
    });
    const correlatedPairs = [];
    let totalCorrelatedExposure = 0;
    for (const position of openPositions) {
        const existingCategory = position.market.category;
        const proposedCategory = proposedMarket.category;
        const correlationScore = CATEGORY_CORRELATION_MATRIX[proposedCategory]?.[existingCategory] ?? 0;
        if (correlationScore >= CORRELATION_THRESHOLD) {
            correlatedPairs.push({
                marketIdA: proposedMarketId,
                marketIdB: position.market.id,
                correlationScore,
                relationship: 'POSITIVE',
            });
            totalCorrelatedExposure += position.size;
        }
    }
    const maxCorrelatedUsdc = bankroll * MAX_CORRELATED_EXPOSURE_PCT;
    const hasExcessExposure = totalCorrelatedExposure + proposedSize > maxCorrelatedUsdc;
    let adjustedPositionSize = proposedSize;
    if (hasExcessExposure) {
        const remainingBudget = Math.max(0, maxCorrelatedUsdc - totalCorrelatedExposure);
        adjustedPositionSize = Math.min(proposedSize, remainingBudget);
        logger_1.logger.info({
            proposedSize,
            adjustedPositionSize,
            totalCorrelatedExposure,
            maxCorrelatedUsdc,
        }, 'Position size reduced due to correlated exposure');
    }
    return {
        hasCorrelatedPositions: correlatedPairs.length > 0,
        correlatedPairs,
        adjustedPositionSize: parseFloat(adjustedPositionSize.toFixed(2)),
        totalCorrelatedExposure: parseFloat(totalCorrelatedExposure.toFixed(2)),
    };
}
/**
 * Finds all pairs of open positions that are highly correlated.
 * Used by the portfolio endpoint to display risk warnings.
 */
async function getPortfolioCorrelations(bankroll) {
    const openPositions = await prisma_1.prisma.position.findMany({
        where: { status: 'OPEN' },
        include: { market: { select: { id: true, category: true } } },
    });
    const pairs = [];
    for (let i = 0; i < openPositions.length; i++) {
        for (let j = i + 1; j < openPositions.length; j++) {
            const catA = openPositions[i].market.category;
            const catB = openPositions[j].market.category;
            const score = CATEGORY_CORRELATION_MATRIX[catA]?.[catB] ?? 0;
            if (score >= CORRELATION_THRESHOLD) {
                pairs.push({
                    marketIdA: openPositions[i].market.id,
                    marketIdB: openPositions[j].market.id,
                    correlationScore: score,
                    relationship: score > 0 ? 'POSITIVE' : 'NEGATIVE',
                });
            }
        }
    }
    const totalExposure = openPositions.reduce((acc, p) => acc + p.size, 0);
    const isOverExposed = totalExposure > bankroll * MAX_CORRELATED_EXPOSURE_PCT * 2;
    return { pairs, totalExposure, isOverExposed };
}
