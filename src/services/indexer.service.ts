import {
  createPublicClient,
  http,
  parseAbi,
  type Log,
} from 'viem';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';

// ─── ABIs for the events we index ───
const MARKET_FACTORY_ABI = parseAbi([
  'event MarketCreated(bytes32 indexed marketId, address market, string question, uint256 expiry)',
]);

const REASONING_REGISTRY_ABI = parseAbi([
  'event ReasoningPublished(bytes32 indexed marketId, address agent, string ipfsCid, bytes32 sha256Hash, uint256 blockTimestamp)',
]);

const POSITION_ABI = parseAbi([
  'event PositionOpened(bytes32 indexed marketId, address trader, bool isYes, uint256 amount, uint256 price)',
]);

const arcChain = {
  id:   config.ARC_CHAIN_ID,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [config.ARC_RPC_URL] } },
} as const;

const publicClient = createPublicClient({
  chain:     arcChain as any,
  transport: http(config.ARC_RPC_URL),
});

/**
 * Starts the real-time event listener for all three event types.
 *
 * Returns unwatch functions so the caller can cleanly stop the listener.
 * Each event type has its own handler that is idempotent — safe to re-run.
 */
export function startEventListener(): () => void {
  if (isZeroAddress(config.MARKET_FACTORY_ADDRESS)) {
    logger.warn('Contracts not deployed — event indexer running in simulation mode');
    return () => {};
  }

  const unwatchers: Array<() => void> = [];

  // ── MarketCreated ──
  const unwatchMarket = publicClient.watchContractEvent({
    address:      config.MARKET_FACTORY_ADDRESS as `0x${string}`,
    abi:          MARKET_FACTORY_ABI,
    eventName:    'MarketCreated',
    onLogs:       (logs) => logs.forEach(log => handleMarketCreated(log as any).catch(logError)),
    onError:      (err) => logger.error({ err }, 'MarketCreated watcher error'),
  });
  unwatchers.push(unwatchMarket);

  // ── ReasoningPublished ──
  const unwatchReasoning = publicClient.watchContractEvent({
    address:      config.REASONING_REGISTRY_ADDRESS as `0x${string}`,
    abi:          REASONING_REGISTRY_ABI,
    eventName:    'ReasoningPublished',
    onLogs:       (logs) => logs.forEach(log => handleReasoningPublished(log as any).catch(logError)),
    onError:      (err) => logger.error({ err }, 'ReasoningPublished watcher error'),
  });
  unwatchers.push(unwatchReasoning);

  // ── PositionOpened ──
  const unwatchPosition = publicClient.watchContractEvent({
    address:      config.MARKET_FACTORY_ADDRESS as `0x${string}`,
    abi:          POSITION_ABI,
    eventName:    'PositionOpened',
    onLogs:       (logs) => logs.forEach(log => handlePositionOpened(log as any).catch(logError)),
    onError:      (err) => logger.error({ err }, 'PositionOpened watcher error'),
  });
  unwatchers.push(unwatchPosition);

  logger.info('Blockchain event indexer started');
  return () => unwatchers.forEach(u => u());
}

/**
 * Backfills events from a given block number to the current head.
 *
 * Used on startup to catch events missed during downtime.
 * Processes in 500-block batches to avoid RPC request size limits.
 * Updates BlockIndex after each batch.
 */
export async function backfillEvents(fromBlock?: bigint): Promise<void> {
  if (isZeroAddress(config.MARKET_FACTORY_ADDRESS)) {
    logger.warn('Contracts not deployed — skipping backfill');
    return;
  }

  // Get last processed block from DB (resume after downtime)
  const blockIndex = await prisma.blockIndex.findUnique({
    where: { chainId: config.ARC_CHAIN_ID },
  });

  const startBlock = fromBlock ?? blockIndex?.lastBlockNumber ?? BigInt(0);
  const currentBlock = await publicClient.getBlockNumber();

  if (startBlock >= currentBlock) {
    logger.info({ startBlock, currentBlock }, 'Backfill: already up to date');
    return;
  }

  const BATCH_SIZE = BigInt(500);
  logger.info({ startBlock, currentBlock }, 'Starting backfill');

  for (let block = startBlock; block < currentBlock; block += BATCH_SIZE) {
    const toBlock = block + BATCH_SIZE < currentBlock ? block + BATCH_SIZE : currentBlock;

    try {
      const [marketLogs, reasoningLogs, positionLogs] = await Promise.all([
        publicClient.getLogs({
          address:   config.MARKET_FACTORY_ADDRESS as `0x${string}`,
          event:     MARKET_FACTORY_ABI[0],
          fromBlock: block,
          toBlock,
        }),
        publicClient.getLogs({
          address:   config.REASONING_REGISTRY_ADDRESS as `0x${string}`,
          event:     REASONING_REGISTRY_ABI[0],
          fromBlock: block,
          toBlock,
        }),
        publicClient.getLogs({
          address:   config.MARKET_FACTORY_ADDRESS as `0x${string}`,
          event:     POSITION_ABI[0],
          fromBlock: block,
          toBlock,
        }),
      ]);

      for (const log of marketLogs)    await handleMarketCreated(log as any).catch(logError);
      for (const log of reasoningLogs) await handleReasoningPublished(log as any).catch(logError);
      for (const log of positionLogs)  await handlePositionOpened(log as any).catch(logError);

      // Persist progress after each batch
      await prisma.blockIndex.upsert({
        where:  { chainId: config.ARC_CHAIN_ID },
        create: { chainId: config.ARC_CHAIN_ID, lastBlockNumber: toBlock },
        update: { lastBlockNumber: toBlock },
      });

      logger.debug({ processed: toBlock.toString() }, 'Backfill batch complete');
    } catch (err) {
      logger.error({ err, fromBlock: block, toBlock }, 'Backfill batch failed');
    }
  }

  logger.info('Backfill complete');
}

// ─── Event Handlers ───

/**
 * Handles MarketCreated events.
 * Idempotent: checks onChainAddress before upserting.
 */
async function handleMarketCreated(log: any): Promise<void> {
  const { marketId, market, question, expiry } = log.args ?? {};
  const txHash = log.transactionHash;

  if (!marketId || !txHash) return;

  // Idempotency check
  const existing = await prisma.market.findFirst({ where: { txHash } });
  if (existing) return;

  // Try to match to a pending market by question similarity
  const pendingMarket = await prisma.market.findFirst({
    where: { status: 'PENDING', question: { contains: String(question ?? '').slice(0, 50) } },
  });

  if (pendingMarket) {
    await prisma.market.update({
      where: { id: pendingMarket.id },
      data:  { status: 'ACTIVE', onChainAddress: market, txHash },
    });
  }

  logger.info({ marketId: marketId.toString(), txHash }, 'MarketCreated event indexed');
}

/**
 * Handles ReasoningPublished events.
 * Updates the trace with on-chain tx hash and marks verified.
 */
async function handleReasoningPublished(log: any): Promise<void> {
  const { ipfsCid, sha256Hash } = log.args ?? {};
  const txHash = log.transactionHash;

  if (!ipfsCid || !txHash) return;

  const trace = await prisma.reasoningTrace.findFirst({ where: { ipfsCid: String(ipfsCid) } });
  if (!trace) return;

  // Idempotency: already indexed
  if (trace.onChainTxHash === txHash) return;

  await prisma.reasoningTrace.update({
    where: { id: trace.id },
    data:  { onChainTxHash: txHash, verified: true },
  });

  logger.info({ traceId: trace.id, txHash }, 'ReasoningPublished event indexed');
}

/**
 * Handles PositionOpened events.
 * Reconciles chain state with DB — updates txHash on existing trade.
 */
async function handlePositionOpened(log: any): Promise<void> {
  const { marketId, amount, price, isYes } = log.args ?? {};
  const txHash = log.transactionHash;

  if (!txHash) return;

  // Find the matching unconfirmed trade
  const trade = await prisma.trade.findFirst({
    where: {
      txHash: null,
      status: 'PENDING',
      direction: isYes ? 'YES' : 'NO',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (trade) {
    await prisma.trade.update({
      where: { id: trade.id },
      data:  { txHash, status: 'EXECUTED', executedAt: new Date() },
    });
  }

  logger.info({ txHash }, 'PositionOpened event indexed');
}

const isZeroAddress = (addr: string) =>
  addr === '0x0000000000000000000000000000000000000000' || !addr;

const logError = (err: unknown) => logger.error({ err }, 'Event handler error');