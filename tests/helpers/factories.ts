import type { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';

// Counter-based (not random) values keep failures reproducible.
let n = 0;
const next = () => ++n;

export async function makeUser(prisma: PrismaClient, overrides: { walletAddress?: string } = {}) {
  const walletAddress = overrides.walletAddress ?? Keypair.random().publicKey();
  return prisma.user.create({
    data: { walletAddress, identityKey: walletAddress },
  });
}

export async function makeMarket(
  prisma: PrismaClient,
  overrides: { onChainMarketId?: bigint; status?: string } = {},
) {
  const i = next();
  return prisma.market.create({
    data: {
      question: `Test market ${i}?`,
      category: 'FED',
      initialYesProb: 0.5,
      confidenceInterval: { lower: 0.4, upper: 0.6 },
      expiryTimestamp: new Date(Date.now() + 86_400_000),
      ...(overrides.onChainMarketId !== undefined ? { onChainMarketId: overrides.onChainMarketId } : {}),
      ...(overrides.status ? { status: overrides.status as never } : {}),
    },
  });
}

/** A market already on-chain, with a unique counter-based onChainMarketId. */
export async function makeOnChainMarket(prisma: PrismaClient) {
  return makeMarket(prisma, { onChainMarketId: BigInt(1_000_000 + next()), status: 'ACTIVE' });
}

export async function makePendingTrade(prisma: PrismaClient, overrides: { marketId?: string; amount?: number } = {}) {
  const marketId = overrides.marketId ?? (await makeOnChainMarket(prisma)).id;
  return prisma.trade.create({
    data: {
      marketId,
      direction: 'YES',
      status: 'PENDING',
      amount: overrides.amount ?? 4,
      price: 0.5,
      edgeDetected: 0.1,
      kellyFraction: 0.05,
    },
  });
}

/**
 * An OPEN Position (from an EXECUTED trade) holding `sharesRaw` shares, with
 * one SUBMITTED PositionExit per entry in `exits` (collateral_out each).
 */
export async function makeOpenPositionWithExit(
  prisma: PrismaClient,
  overrides: { sharesRaw?: bigint; costBasisRaw?: bigint; exits?: bigint[] } = {},
) {
  const trade = await makePendingTrade(prisma);
  await prisma.trade.update({ where: { id: trade.id }, data: { status: 'EXECUTED', executedAt: new Date() } });
  const position = await prisma.position.create({
    data: {
      marketId: trade.marketId,
      tradeId: trade.id,
      direction: 'YES',
      status: 'OPEN',
      entryPrice: 0.5,
      currentPrice: 0.5,
      size: trade.amount,
      sharesRaw: (overrides.sharesRaw ?? 8_000_000n).toString(),
      costBasisRaw: (overrides.costBasisRaw ?? 4_000_000n).toString(),
      feesPaidRaw: '0',
    },
  });
  const exits = [];
  for (const collateralOut of overrides.exits ?? [1_000_000n]) {
    exits.push(
      await prisma.positionExit.create({
        data: {
          positionId: position.id,
          mode: 'live',
          collateralOutRaw: collateralOut.toString(),
          maxSharesInRaw: (collateralOut * 3n).toString(),
          reason: 'TAKE_PROFIT',
          status: 'SUBMITTED',
        },
      }),
    );
  }
  return { trade, position, exit: exits[0], exits };
}

/** A ReasoningTrace on an on-chain market with a SUBMITTED TracePublication. */
export async function makeTraceWithPublication(prisma: PrismaClient) {
  const market = await makeOnChainMarket(prisma);
  const trace = await prisma.reasoningTrace.create({
    data: {
      marketId: market.id,
      agentType: 'TRADER',
      decisionType: 'OPEN_POSITION',
      sourcesUsed: [],
      probabilityEstimate: 0.6,
      marketProbability: 0.5,
      edge: 0.1,
      confidenceInterval: { lower: 0.5, upper: 0.7 },
      ipfsCid: `bafytest${next()}`,
      traceHash: 'ab'.repeat(32),
    },
  });
  const publication = await prisma.tracePublication.create({
    data: { traceId: trace.id, action: 'OPEN_POSITION', status: 'SUBMITTED', attempts: 1 },
  });
  return { market, trace, publication };
}
