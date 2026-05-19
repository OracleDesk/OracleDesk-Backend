import { prisma } from '../lib/prisma';
import type { PortfolioSummary } from '../types';
import dayjs from 'dayjs';

/**
 * Compute a full portfolio summary for the agent.
 * Used by GET /portfolio endpoint.
 */
export async function getPortfolioSummary(bankroll = 10_000): Promise<PortfolioSummary> {
  const [openPositions, closedPositions, builderFees] = await Promise.all([
    prisma.position.findMany({ where: { status: 'OPEN' } }),
    prisma.position.findMany({ where: { status: { in: ['CLOSED', 'STOP_LOSS'] } } }),
    prisma.trade.aggregate({ _sum: { builderFee: true }, where: { status: 'EXECUTED' } }),
  ]);

  const deployedCapital = openPositions.reduce((acc, p) => acc + p.size, 0);
  const totalPnl = [...openPositions, ...closedPositions].reduce((acc, p) => acc + p.pnl, 0);

  // Daily PnL: positions closed or updated today
  const todayStart = dayjs().startOf('day').toDate();
  const dailyPnl = closedPositions
    .filter(p => p.closedAt && p.closedAt >= todayStart)
    .reduce((acc, p) => acc + p.pnl, 0);

  return {
    totalUsdc:         bankroll,
    deployedCapital:   parseFloat(deployedCapital.toFixed(2)),
    availableCapital:  parseFloat((bankroll - deployedCapital).toFixed(2)),
    openPositions:     openPositions.length,
    totalPnl:          parseFloat(totalPnl.toFixed(2)),
    dailyPnl:          parseFloat(dailyPnl.toFixed(2)),
    builderFeesEarned: parseFloat((builderFees._sum.builderFee ?? 0).toFixed(2)),
  };
}