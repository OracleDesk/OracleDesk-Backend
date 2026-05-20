"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPortfolioSummary = getPortfolioSummary;
const prisma_1 = require("../lib/prisma");
const dayjs_1 = __importDefault(require("dayjs"));
/**
 * Compute a full portfolio summary for the agent.
 * Used by GET /portfolio endpoint.
 */
async function getPortfolioSummary(bankroll = 10000) {
    const [openPositions, closedPositions, builderFees] = await Promise.all([
        prisma_1.prisma.position.findMany({ where: { status: 'OPEN' } }),
        prisma_1.prisma.position.findMany({ where: { status: { in: ['CLOSED', 'STOP_LOSS'] } } }),
        prisma_1.prisma.trade.aggregate({ _sum: { builderFee: true }, where: { status: 'EXECUTED' } }),
    ]);
    const deployedCapital = openPositions.reduce((acc, p) => acc + p.size, 0);
    const totalPnl = [...openPositions, ...closedPositions].reduce((acc, p) => acc + p.pnl, 0);
    // Daily PnL: positions closed or updated today
    const todayStart = (0, dayjs_1.default)().startOf('day').toDate();
    const dailyPnl = closedPositions
        .filter(p => p.closedAt && p.closedAt >= todayStart)
        .reduce((acc, p) => acc + p.pnl, 0);
    return {
        totalUsdc: bankroll,
        deployedCapital: parseFloat(deployedCapital.toFixed(2)),
        availableCapital: parseFloat((bankroll - deployedCapital).toFixed(2)),
        openPositions: openPositions.length,
        totalPnl: parseFloat(totalPnl.toFixed(2)),
        dailyPnl: parseFloat(dailyPnl.toFixed(2)),
        builderFeesEarned: parseFloat((builderFees._sum.builderFee ?? 0).toFixed(2)),
    };
}
