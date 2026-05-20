import { prisma } from '../lib/prisma';
import { AppError } from '../middlewares/error.middleware';
import { submitOracleApproval } from './chain.service';

export async function approveMarketResolution(params: {
  marketId: string;
  yesWon: boolean;
  rationale?: string;
}): Promise<{ market: any; txHash: string }> {
  const market = await prisma.market.findUnique({ where: { id: params.marketId } });
  if (!market) throw new AppError(404, 'MARKET_NOT_FOUND', 'Market not found');
  if (!market.onChainAddress) {
    throw new AppError(409, 'MARKET_NOT_DEPLOYED', 'Market has no on-chain address yet');
  }
  if (!['ACTIVE', 'RESOLVING'].includes(market.status)) {
    throw new AppError(409, 'MARKET_NOT_RESOLVABLE', `Market status ${market.status} cannot be resolved`);
  }

  const txHash = await submitOracleApproval({
    marketAddress: market.onChainAddress,
    yesWon: params.yesWon,
  });

  const updated = await prisma.market.update({
    where: { id: market.id },
    data: { status: 'RESOLVING' },
  });

  await prisma.agentLog.create({
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
      } as any,
    },
  });

  return { market: updated, txHash };
}

export async function finalizeMarketResolution(params: {
  marketAddress: string;
  yesWon: boolean;
  txHash?: string;
}): Promise<any> {
  const market = await prisma.market.findFirst({
    where: { onChainAddress: { equals: params.marketAddress, mode: 'insensitive' } },
  });
  if (!market) throw new AppError(404, 'MARKET_NOT_FOUND', 'No market found for on-chain address');

  const updated = await prisma.market.update({
    where: { id: market.id },
    data: {
      status: 'RESOLVED',
      resolvedOutcome: params.yesWon,
      resolvedAt: new Date(),
    },
  });

  await prisma.position.updateMany({
    where: { marketId: market.id, status: 'OPEN' },
    data: { status: 'CLOSED', closedAt: new Date(), closeReason: params.yesWon ? 'YES_RESOLVED' : 'NO_RESOLVED' },
  });

  await prisma.agentLog.create({
    data: {
      agentType: 'MARKET_MAKER',
      level: 'INFO',
      action: 'MARKET_RESOLVED',
      marketId: market.id,
      data: { yesWon: params.yesWon, txHash: params.txHash, marketAddress: params.marketAddress } as any,
    },
  });

  return updated;
}

export async function getResolutionStatus(marketId: string): Promise<any> {
  const market = await prisma.market.findUnique({
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

  if (!market) throw new AppError(404, 'MARKET_NOT_FOUND', 'Market not found');
  return market;
}
