"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPortfolio = getPortfolio;
exports.getPositions = getPositions;
const prisma_1 = require("../lib/prisma");
const response_util_1 = require("../utils/response.util");
const portfolio_service_1 = require("../services/portfolio.service");
const correlation_service_1 = require("../services/correlation.service");
/**
 * GET /portfolio
 * Returns the agent's portfolio summary:
 *   totalUsdc, deployedCapital, availableCapital,
 *   openPositions count, totalPnl, dailyPnl, builderFeesEarned
 */
async function getPortfolio(req, res) {
    const [summary, correlations] = await Promise.all([
        (0, portfolio_service_1.getPortfolioSummary)(),
        (0, correlation_service_1.getPortfolioCorrelations)(10000),
    ]);
    (0, response_util_1.sendSuccess)(res, { ...summary, correlationRisk: correlations });
}
/**
 * GET /positions
 * Returns paginated positions (open + closed).
 * Query params: status (OPEN|CLOSED|STOP_LOSS|HEDGED), page, limit
 */
async function getPositions(req, res) {
    const { page, limit, skip } = (0, response_util_1.parsePagination)(req.query);
    const status = req.query.status;
    const where = { ...(status ? { status: status } : {}) };
    const [positions, total] = await Promise.all([
        prisma_1.prisma.position.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                market: {
                    select: { question: true, category: true, settlementCurrency: true, expiryTimestamp: true },
                },
                trade: {
                    select: { direction: true, amount: true, edgeDetected: true, kellyFraction: true, txHash: true },
                },
            },
        }),
        prisma_1.prisma.position.count({ where }),
    ]);
    (0, response_util_1.sendSuccess)(res, positions, 200, (0, response_util_1.buildPaginationMeta)(page, limit, total));
}
