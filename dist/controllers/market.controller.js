"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMarkets = listMarkets;
exports.getMarket = getMarket;
exports.triggerMarketGeneration = triggerMarketGeneration;
const prisma_1 = require("../lib/prisma");
const response_util_1 = require("../utils/response.util");
const market_maker_agent_1 = require("../agents/market-maker.agent");
const market_validator_1 = require("../validators/market.validator");
/**
 * GET /markets
 * Returns a paginated list of prediction markets.
 * Query params: status, category, currency, page, limit
 */
async function listMarkets(req, res) {
    const parsed = market_validator_1.listMarketsSchema.safeParse({ query: req.query });
    if (!parsed.success) {
        (0, response_util_1.sendError)(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters', parsed.error.flatten().fieldErrors);
        return;
    }
    const { status, category, currency, page: p, limit: l } = parsed.data.query;
    const { page, limit, skip } = (0, response_util_1.parsePagination)({ page: p, limit: l });
    const where = {
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        ...(currency ? { settlementCurrency: currency } : {}),
    };
    const [markets, total] = await Promise.all([
        prisma_1.prisma.market.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                _count: { select: { trades: true, reasoningTraces: true } },
            },
        }),
        prisma_1.prisma.market.count({ where }),
    ]);
    (0, response_util_1.sendSuccess)(res, markets, 200, (0, response_util_1.buildPaginationMeta)(page, limit, total));
}
/**
 * GET /markets/:id
 * Returns full detail for a single market including confidence interval
 * and linked reasoning traces.
 */
async function getMarket(req, res) {
    const id = String(req.params.id);
    const market = await prisma_1.prisma.market.findUnique({
        where: { id },
        include: {
            reasoningTraces: {
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    agentType: true,
                    edge: true,
                    probabilityEstimate: true,
                    verified: true,
                    createdAt: true,
                },
            },
            _count: { select: { trades: true, positions: true } },
        },
    });
    if (!market) {
        (0, response_util_1.sendError)(res, 404, 'MARKET_NOT_FOUND', `Market ${id} not found`);
        return;
    }
    (0, response_util_1.sendSuccess)(res, market);
}
/**
 * POST /markets/generate
 * Manually trigger one Market Maker Agent cycle.
 * Used for hackathon demos and testing.
 * Requires auth.
 */
async function triggerMarketGeneration(req, res) {
    // Fire-and-forget — return immediately, cycle runs in background
    (0, market_maker_agent_1.runMarketMakerCycle)().catch(err => console.error('Manual market generation error:', err));
    (0, response_util_1.sendSuccess)(res, { message: 'Market Maker cycle triggered' }, 202);
}
