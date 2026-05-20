"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveMarketResolution = approveMarketResolution;
exports.finalizeMarketResolution = finalizeMarketResolution;
exports.getResolutionStatus = getResolutionStatus;
const prisma_1 = require("../lib/prisma");
const error_middleware_1 = require("../middlewares/error.middleware");
const chain_service_1 = require("./chain.service");
async function approveMarketResolution(params) {
    const market = await prisma_1.prisma.market.findUnique({ where: { id: params.marketId } });
    if (!market)
        throw new error_middleware_1.AppError(404, 'MARKET_NOT_FOUND', 'Market not found');
    if (!market.onChainAddress) {
        throw new error_middleware_1.AppError(409, 'MARKET_NOT_DEPLOYED', 'Market has no on-chain address yet');
    }
    if (!['ACTIVE', 'RESOLVING'].includes(market.status)) {
        throw new error_middleware_1.AppError(409, 'MARKET_NOT_RESOLVABLE', `Market status ${market.status} cannot be resolved`);
    }
    const txHash = await (0, chain_service_1.submitOracleApproval)({
        marketAddress: market.onChainAddress,
        yesWon: params.yesWon,
    });
    const updated = await prisma_1.prisma.market.update({
        where: { id: market.id },
        data: { status: 'RESOLVING' },
    });
    await prisma_1.prisma.agentLog.create({
        data: {
            agentType: 'MARKET_MAKER',
            level: 'INFO',
            action: 'ORACLE_RESOLUTION_APPROVED',
            marketId: market.id,
            data: {
                yesWon: params.yesWon,
                txHash,
                marketAddress: market.onChainAddress,
                rationale: params.rationale,
            },
        },
    });
    return { market: updated, txHash };
}
async function finalizeMarketResolution(params) {
    const market = await prisma_1.prisma.market.findFirst({
        where: { onChainAddress: { equals: params.marketAddress, mode: 'insensitive' } },
    });
    if (!market)
        throw new error_middleware_1.AppError(404, 'MARKET_NOT_FOUND', 'No market found for on-chain address');
    const updated = await prisma_1.prisma.market.update({
        where: { id: market.id },
        data: {
            status: 'RESOLVED',
            resolvedOutcome: params.yesWon,
            resolvedAt: new Date(),
        },
    });
    await prisma_1.prisma.position.updateMany({
        where: { marketId: market.id, status: 'OPEN' },
        data: { status: 'CLOSED', closedAt: new Date(), closeReason: params.yesWon ? 'YES_RESOLVED' : 'NO_RESOLVED' },
    });
    await prisma_1.prisma.agentLog.create({
        data: {
            agentType: 'MARKET_MAKER',
            level: 'INFO',
            action: 'MARKET_RESOLVED',
            marketId: market.id,
            data: { yesWon: params.yesWon, txHash: params.txHash, marketAddress: params.marketAddress },
        },
    });
    return updated;
}
async function getResolutionStatus(marketId) {
    const market = await prisma_1.prisma.market.findUnique({
        where: { id: marketId },
        select: {
            id: true,
            question: true,
            status: true,
            onChainAddress: true,
            resolutionOracle: true,
            resolvedOutcome: true,
            resolvedAt: true,
            agentLogs: {
                where: { action: { in: ['ORACLE_RESOLUTION_APPROVED', 'MARKET_RESOLVED'] } },
                orderBy: { createdAt: 'desc' },
                take: 10,
            },
        },
    });
    if (!market)
        throw new error_middleware_1.AppError(404, 'MARKET_NOT_FOUND', 'Market not found');
    return market;
}
