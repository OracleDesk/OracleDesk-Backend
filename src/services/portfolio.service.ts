import { prisma } from '../lib/prisma';
import type { PortfolioSummary } from '../types';
import dayjs from 'dayjs';
import { decimalToBigint, toDisplayUsdc } from '../lib/amounts';
import type { TreasuryBudget } from './treasury-budget.service';

/**
 * Compute a full portfolio summary for the agent.
 * Used by GET /portfolio endpoint.
 *
 * Capital comes from the treasury budget (#76, #299):
 * - `availableCapital` is the spendable trading bankroll (`min(liquid - queueReserved, dailyHeadroom)`
 *   when on-chain accounting is available, otherwise `available_capital`).
 * - `totalUsdc` is derived from the on-chain treasury `navRaw` when present
 *   (idle collateral + outcome-independent floor of open markets − queued withdrawals;
 *   excludes yield-venue capital when `NAV_EXCLUDES_YIELD` is flagged), and falls back
 *   to `availableCapital + deployedCapital` otherwise.
 * - Without a budget (the chain read failed), both are null and `treasury` is null;
 *   the database fields are still returned.
 */
export async function getPortfolioSummary(budget: TreasuryBudget | null = null): Promise<PortfolioSummary> {
  const [openPositions, closedPositions, builderFees] = await Promise.all([
    prisma.position.findMany({
      where: { status: 'OPEN' },
      include: { trade: { select: { amountRaw: true, collateralRaw: true } } },
    }),
    prisma.position.findMany({ where: { status: { in: ['CLOSED', 'STOP_LOSS'] } } }),
    prisma.trade.aggregate({ _sum: { builderFee: true }, where: { status: 'EXECUTED' } }),
  ]);

  // Monetary totals use raw base units. Float columns remain display-only for
  // API compatibility and are not mixed into portfolio accounting.
  let deployedRaw = 0n;
  let totalPnlRaw = 0n;
  for (const p of openPositions) {
    const costBasisRaw = p.costBasisRaw ?? p.trade?.collateralRaw ?? p.trade?.amountRaw;
    if (costBasisRaw != null) deployedRaw += decimalToBigint(costBasisRaw);
    totalPnlRaw += decimalToBigint(p.realisedPnlRaw);
    if (p.unrealisedPnlRaw != null) totalPnlRaw += decimalToBigint(p.unrealisedPnlRaw);
  }
  for (const p of closedPositions) {
    totalPnlRaw += decimalToBigint(p.realisedPnlRaw);
    if (p.unrealisedPnlRaw != null) totalPnlRaw += decimalToBigint(p.unrealisedPnlRaw);
  }
  const deployedCapital = toDisplayUsdc(deployedRaw);

  // Daily PnL: positions closed or updated today
  const todayStart = dayjs().startOf('day').toDate();
  const dailyPnlRaw = closedPositions
    .filter((p) => p.closedAt && p.closedAt >= todayStart)
    .reduce((sum, p) => sum + decimalToBigint(p.realisedPnlRaw) +
      (p.unrealisedPnlRaw == null ? 0n : decimalToBigint(p.unrealisedPnlRaw)), 0n);

  const available = budget ? toDisplayUsdc(budget.availableRaw) : null;
  const totalUsdc =
    budget?.navRaw !== undefined
      ? parseFloat(toDisplayUsdc(budget.navRaw).toFixed(2))
      : available === null
        ? null
        : parseFloat((available + deployedCapital).toFixed(2));
  return {
    totalUsdc,
    deployedCapital:   parseFloat(deployedCapital.toFixed(2)),
    availableCapital:  available === null ? null : parseFloat(available.toFixed(2)),
    openPositions:     openPositions.length,
    totalPnl:          parseFloat(toDisplayUsdc(totalPnlRaw).toFixed(2)),
    dailyPnl:          parseFloat(toDisplayUsdc(dailyPnlRaw).toFixed(2)),
    builderFeesEarned: parseFloat((builderFees._sum.builderFee ?? 0).toFixed(2)),
    treasury: budget
      ? {
          availableRaw:      budget.availableRaw.toString(),
          maxTradeRaw:       budget.maxTradeRaw.toString(),
          maxMarketRaw:      budget.maxMarketRaw.toString(),
          maxDailyRaw:       budget.maxDailyRaw.toString(),
          dailyUsedRaw:      budget.dailyUsedRaw.toString(),
          dailyRemainingRaw: budget.dailyRemainingRaw.toString(),
          dailyResetsAt:     budget.dailyResetsAt.toISOString(),
          ...(budget.navRaw !== undefined ? { navRaw: budget.navRaw.toString() } : {}),
          ...(budget.spendableRaw !== undefined ? { spendableRaw: budget.spendableRaw.toString() } : {}),
          ...(budget.flags !== undefined ? { flags: [...budget.flags] } : {}),
        }
      : null,
  };
}