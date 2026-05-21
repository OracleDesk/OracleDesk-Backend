import { createPublicClient, http } from 'viem';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import {
  CONTRACT_ADDRESSES,
  MARKET_FACTORY_ABI,
  MULTISIG_ORACLE_ABI,
  POSITION_LEDGER_ABI,
  REASONING_REGISTRY_ABI,
} from '../config/contracts';

const arcChain = {
  id: config.ARC_CHAIN_ID,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.ARC_RPC_URL] } },
} as const;

const publicClient = createPublicClient({
  chain: arcChain as any,
  transport: http(config.ARC_RPC_URL),
});

export function startEventListener(): () => void {
  if (isZeroAddress(CONTRACT_ADDRESSES.marketFactory)) {
    logger.warn('MarketFactory address not configured; event indexer disabled');
    return () => {};
  }

  const unwatchers = [
    publicClient.watchContractEvent({
      poll: true,
      pollingInterval: 4000,
      address: CONTRACT_ADDRESSES.marketFactory as `0x${string}`,
      abi: MARKET_FACTORY_ABI as any,
      eventName: 'MarketDeployed',
      onLogs: (logs: any[]) => logs.forEach((log: any) => handleMarketDeployed(log).catch(logError)),
      onError: (err: unknown) => logger.error({ err }, 'MarketDeployed watcher error'),
    } as any),
    publicClient.watchContractEvent({
      poll: true,
      pollingInterval: 4000,
      address: CONTRACT_ADDRESSES.reasoningRegistry as `0x${string}`,
      abi: REASONING_REGISTRY_ABI as any,
      eventName: 'ReasoningPublished',
      onLogs: (logs: any[]) => logs.forEach((log: any) => handleRegistryReasoningPublished(log).catch(logError)),
      onError: (err: unknown) => logger.error({ err }, 'ReasoningRegistry watcher error'),
    } as any),
    publicClient.watchContractEvent({
      poll: true,
      pollingInterval: 4000,
      address: CONTRACT_ADDRESSES.positionLedger as `0x${string}`,
      abi: POSITION_LEDGER_ABI as any,
      eventName: 'PositionOpened',
      onLogs: (logs: any[]) => logs.forEach((log: any) => handlePositionOpened(log).catch(logError)),
      onError: (err: unknown) => logger.error({ err }, 'PositionOpened watcher error'),
    } as any),
    publicClient.watchContractEvent({
      poll: true,
      pollingInterval: 4000,
      address: CONTRACT_ADDRESSES.multiSigOracle as `0x${string}`,
      abi: MULTISIG_ORACLE_ABI as any,
      eventName: 'MarketResolved',
      onLogs: (logs: any[]) => logs.forEach((log: any) => handleMarketResolved(log).catch(logError)),
      onError: (err: unknown) => logger.error({ err }, 'MarketResolved watcher error'),
    } as any),
  ];

  logger.info('Blockchain event indexer started');
  return () => unwatchers.forEach(unwatch => unwatch());
}

export async function backfillEvents(fromBlock?: bigint): Promise<void> {
  if (isZeroAddress(CONTRACT_ADDRESSES.marketFactory)) {
    logger.warn('MarketFactory address not configured; skipping backfill');
    return;
  }

  const blockIndex = await prisma.blockIndex.findUnique({
    where: { chainId: config.ARC_CHAIN_ID },
  });

  const startBlock = fromBlock ?? ((blockIndex?.lastBlockNumber ?? BigInt(0)) + BigInt(1));
  const currentBlock = await publicClient.getBlockNumber();

  if (startBlock > currentBlock) {
    logger.info({ startBlock, currentBlock }, 'Backfill already up to date');
    return;
  }

  const batchSize = BigInt(500);
  logger.info({ startBlock, currentBlock }, 'Starting event backfill');

  for (let block = startBlock; block <= currentBlock; block += batchSize) {
    const toBlock = block + batchSize - BigInt(1) < currentBlock
      ? block + batchSize - BigInt(1)
      : currentBlock;

    try {
      const [marketLogs, reasoningLogs, positionLogs, resolutionLogs] = await Promise.all([
        publicClient.getContractEvents({
          address: CONTRACT_ADDRESSES.marketFactory as `0x${string}`,
          abi: MARKET_FACTORY_ABI,
          eventName: 'MarketDeployed',
          fromBlock: block,
          toBlock,
        }),
        publicClient.getContractEvents({
          address: CONTRACT_ADDRESSES.reasoningRegistry as `0x${string}`,
          abi: REASONING_REGISTRY_ABI,
          eventName: 'ReasoningPublished',
          fromBlock: block,
          toBlock,
        }),
        publicClient.getContractEvents({
          address: CONTRACT_ADDRESSES.positionLedger as `0x${string}`,
          abi: POSITION_LEDGER_ABI,
          eventName: 'PositionOpened',
          fromBlock: block,
          toBlock,
        }),
        publicClient.getContractEvents({
          address: CONTRACT_ADDRESSES.multiSigOracle as `0x${string}`,
          abi: MULTISIG_ORACLE_ABI,
          eventName: 'MarketResolved',
          fromBlock: block,
          toBlock,
        }),
      ]);

      for (const log of marketLogs) await handleMarketDeployed(log as any).catch(logError);
      for (const log of reasoningLogs) await handleRegistryReasoningPublished(log as any).catch(logError);
      for (const log of positionLogs) await handlePositionOpened(log as any).catch(logError);
      for (const log of resolutionLogs) await handleMarketResolved(log as any).catch(logError);

      await prisma.blockIndex.upsert({
        where: { chainId: config.ARC_CHAIN_ID },
        create: { chainId: config.ARC_CHAIN_ID, lastBlockNumber: toBlock },
        update: { lastBlockNumber: toBlock },
      });
    } catch (err) {
      logger.error({ err, fromBlock: block, toBlock }, 'Backfill batch failed');
    }
  }

  logger.info('Event backfill complete');
}

async function handleMarketDeployed(log: any): Promise<void> {
  const { market, question, oracle, expiryTimestamp, initialYesPrice, liquiditySeed, reasoningCid } = log.args ?? {};
  const txHash = log.transactionHash;

  if (!market || !txHash) return;

  const existing = await prisma.market.findFirst({
    where: { OR: [{ onChainAddress: String(market) }, { txHash: String(txHash) }] },
  });
  if (existing) return;

  const pendingMarket = await prisma.market.findFirst({
    where: {
      status: 'PENDING',
      OR: [
        { question: { equals: String(question ?? '') } },
        ...(reasoningCid ? [{ reasoningTraces: { some: { ipfsCid: String(reasoningCid) } } }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
  });

  const initialProbability = Number(initialYesPrice ?? 5000) / 10_000;
  const liquidityUsdc = Number(liquiditySeed ?? 0) / 1_000_000;

  if (pendingMarket) {
    await prisma.market.update({
      where: { id: pendingMarket.id },
      data: {
        status: 'ACTIVE',
        onChainAddress: String(market),
        txHash: String(txHash),
        resolutionOracle: String(oracle ?? pendingMarket.resolutionOracle ?? ''),
        totalLiquidity: liquidityUsdc || pendingMarket.totalLiquidity,
      },
    });
  } else {
    await prisma.market.create({
      data: {
        question: String(question ?? `On-chain market ${market}`),
        category: 'MACRO',
        status: 'ACTIVE',
        initialYesProb: clampProbability(initialProbability),
        currentYesProb: clampProbability(initialProbability),
        confidenceInterval: {
          lower: Math.max(0.01, clampProbability(initialProbability) - 0.1),
          upper: Math.min(0.99, clampProbability(initialProbability) + 0.1),
        } as any,
        expiryTimestamp: new Date(Number(expiryTimestamp ?? 0) * 1000 || Date.now()),
        resolutionOracle: String(oracle ?? ''),
        minimumLiquidity: liquidityUsdc || 100,
        totalLiquidity: liquidityUsdc,
        onChainAddress: String(market),
        txHash: String(txHash),
      },
    });
  }

  await prisma.agentLog.create({
    data: {
      agentType: 'MARKET_MAKER',
      level: 'INFO',
      action: 'MARKET_DEPLOYED_INDEXED',
      data: { market, question, oracle, expiryTimestamp: String(expiryTimestamp ?? ''), txHash },
    },
  });
}

async function handleRegistryReasoningPublished(log: any): Promise<void> {
  const { traceId, agentWallet, ipfsCid, sha256Hash, traceType, relatedId, blockTimestamp } = log.args ?? {};
  const txHash = log.transactionHash;

  if (!ipfsCid || !txHash) return;

  const trace = await prisma.reasoningTrace.findFirst({
    where: {
      OR: [
        { ipfsCid: String(ipfsCid) },
        { sha256Hash: normalizeBytes32Hash(sha256Hash) },
      ],
    },
  });

  if (trace && trace.onChainTxHash !== String(txHash)) {
    await prisma.reasoningTrace.update({
      where: { id: trace.id },
      data: {
        onChainTxHash: String(txHash),
        verified: true,
        agentWallet: String(agentWallet ?? trace.agentWallet ?? ''),
      },
    });
  }

  await prisma.agentLog.create({
    data: {
      agentType: trace?.agentType ?? 'TRADER',
      level: 'INFO',
      action: 'REASONING_PUBLISHED_INDEXED',
      marketId: trace?.marketId,
      data: {
        traceId: String(traceId ?? ''),
        ipfsCid: String(ipfsCid),
        sha256Hash: normalizeBytes32Hash(sha256Hash),
        traceType: String(traceType ?? ''),
        relatedId: String(relatedId ?? ''),
        blockTimestamp: String(blockTimestamp ?? ''),
        txHash,
      },
    },
  });
}

async function handlePositionOpened(log: any): Promise<void> {
  const { positionId, conditionId, tokenId, side, usdcSpent, entryPriceBps, edgeBps, reasoningCid, sha256Hash, polygonTxHash } = log.args ?? {};
  const txHash = String(log.transactionHash ?? polygonTxHash ?? '');
  if (!positionId || !txHash) return;

  const trace = await prisma.reasoningTrace.findFirst({
    where: {
      OR: [
        ...(reasoningCid ? [{ ipfsCid: String(reasoningCid) }] : []),
        { sha256Hash: normalizeBytes32Hash(sha256Hash) },
      ],
    },
    include: { market: true },
  });

  if (!trace) {
    logger.warn({ positionId: String(positionId), txHash }, 'PositionOpened had no matching reasoning trace');
    return;
  }

  const existingTrade = await prisma.trade.findFirst({ where: { txHash } });
  if (existingTrade) return;

  const direction = Number(side ?? 0) === 0 ? 'YES' : 'NO';
  const amount = Number(usdcSpent ?? 0) / 1_000_000;
  const price = Number(entryPriceBps ?? 0) / 10_000;
  const edge = Number(edgeBps ?? 0) / 10_000;

  const trade = await prisma.trade.create({
    data: {
      marketId: trace.marketId,
      direction,
      status: 'EXECUTED',
      amount,
      price: clampProbability(price || trace.market.currentYesProb || trace.market.initialYesProb),
      edgeDetected: edge,
      kellyFraction: trace.betFraction ?? 0,
      txHash,
      executedAt: new Date(),
    },
  });

  await prisma.position.create({
    data: {
      marketId: trace.marketId,
      tradeId: trade.id,
      direction,
      status: 'OPEN',
      entryPrice: trade.price,
      currentPrice: trade.price,
      size: amount,
      pnl: 0,
    },
  });

  await prisma.agentLog.create({
    data: {
      agentType: 'TRADER',
      level: 'INFO',
      action: 'POSITION_OPENED_INDEXED',
      marketId: trace.marketId,
      data: {
        positionId: String(positionId),
        conditionId: String(conditionId ?? ''),
        tokenId: String(tokenId ?? ''),
        reasoningCid: String(reasoningCid ?? ''),
        txHash,
      },
    },
  });
}

async function handleMarketResolved(log: any): Promise<void> {
  const { market, yesWon } = log.args ?? {};
  const txHash = log.transactionHash;
  if (!market) return;

  const existing = await prisma.market.findFirst({
    where: { onChainAddress: { equals: String(market), mode: 'insensitive' } },
  });
  if (!existing || existing.status === 'RESOLVED') return;

  await prisma.market.update({
    where: { id: existing.id },
    data: {
      status: 'RESOLVED',
      resolvedOutcome: Boolean(yesWon),
      resolvedAt: new Date(),
    },
  });

  await prisma.agentLog.create({
    data: {
      agentType: 'MARKET_MAKER',
      level: 'INFO',
      action: 'MARKET_RESOLVED_INDEXED',
      marketId: existing.id,
      data: { market: String(market), yesWon: Boolean(yesWon), txHash } as any,
    },
  });
}

const isZeroAddress = (addr: string) =>
  !addr || addr === '0x0000000000000000000000000000000000000000';

const clampProbability = (value: number) => Math.min(0.99, Math.max(0.01, value));

const normalizeBytes32Hash = (value: unknown) =>
  String(value ?? '').replace(/^0x/, '').toLowerCase();

const logError = (err: unknown) => logger.error({ err }, 'Event handler error');
