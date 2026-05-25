"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startEventListener = startEventListener;
exports.backfillEvents = backfillEvents;
const viem_1 = require("viem");
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
const config_1 = require("../config");
const contracts_1 = require("../config/contracts");
const arcChain = {
    id: config_1.config.ARC_CHAIN_ID,
    name: 'Arc Testnet',
    network: 'arc-testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config_1.config.ARC_RPC_URL] } },
};
const publicClient = (0, viem_1.createPublicClient)({
    chain: arcChain,
    transport: (0, viem_1.http)(config_1.config.ARC_RPC_URL),
});
// ─── Block-index write debounce ───────────────────────────────────────────────
// Problem: the backfill loop processes ~87,000 batches (43M blocks ÷ 500) and
// calls prisma.blockIndex.upsert() after EVERY batch — that's 87K slow DB writes
// flooding the logs and hammering the connection pool.
//
// Fix: only write to block_index every WRITE_EVERY_N_BATCHES batches during
// backfill, and always write at the very end. The live watcher uses a time-based
// debounce so it doesn't write more than once per WATCHER_DEBOUNCE_MS.
//
// This reduces ~87K writes to ~175 writes during backfill, with zero data loss
// (we always persist the final block before the function returns).
const WRITE_EVERY_N_BATCHES = 500; // write once per 500 batches (~250K blocks)
const WATCHER_DEBOUNCE_MS = 30000; // live watcher: max 1 write per 30 seconds
let _watcherWriteTimer = null;
let _pendingWatcherBlock = null;
async function persistBlockIndex(blockNumber) {
    await prisma_1.prisma.blockIndex.upsert({
        where: { chainId: config_1.config.ARC_CHAIN_ID },
        create: { chainId: config_1.config.ARC_CHAIN_ID, lastBlockNumber: blockNumber },
        update: { lastBlockNumber: blockNumber },
    });
}
// Debounced write for the live event watcher — collapses rapid successive
// updates into a single write every 30 seconds.
function scheduleDebouncedBlockWrite(blockNumber) {
    _pendingWatcherBlock = blockNumber;
    if (_watcherWriteTimer)
        return; // already scheduled
    _watcherWriteTimer = setTimeout(async () => {
        _watcherWriteTimer = null;
        if (_pendingWatcherBlock !== null) {
            await persistBlockIndex(_pendingWatcherBlock).catch(err => logger_1.logger.error({ err }, 'Failed to persist debounced block index'));
            _pendingWatcherBlock = null;
        }
    }, WATCHER_DEBOUNCE_MS);
}
// ─── Live event watcher ───────────────────────────────────────────────────────
function startEventListener() {
    if (isZeroAddress(contracts_1.CONTRACT_ADDRESSES.marketFactory)) {
        logger_1.logger.warn('MarketFactory address not configured; event indexer disabled');
        return () => { };
    }
    const unwatchers = [
        publicClient.watchContractEvent({
            poll: true,
            pollingInterval: 4000,
            address: contracts_1.CONTRACT_ADDRESSES.marketFactory,
            abi: contracts_1.MARKET_FACTORY_ABI,
            eventName: 'MarketDeployed',
            onLogs: (logs) => {
                logs.forEach((log) => handleMarketDeployed(log).catch(logError));
                if (logs.length)
                    scheduleDebouncedBlockWrite(logs[logs.length - 1].blockNumber);
            },
            onError: (err) => logger_1.logger.error({ err }, 'MarketDeployed watcher error'),
        }),
        publicClient.watchContractEvent({
            poll: true,
            pollingInterval: 4000,
            address: contracts_1.CONTRACT_ADDRESSES.reasoningRegistry,
            abi: contracts_1.REASONING_REGISTRY_ABI,
            eventName: 'ReasoningPublished',
            onLogs: (logs) => {
                logs.forEach((log) => handleRegistryReasoningPublished(log).catch(logError));
                if (logs.length)
                    scheduleDebouncedBlockWrite(logs[logs.length - 1].blockNumber);
            },
            onError: (err) => logger_1.logger.error({ err }, 'ReasoningRegistry watcher error'),
        }),
        publicClient.watchContractEvent({
            poll: true,
            pollingInterval: 4000,
            address: contracts_1.CONTRACT_ADDRESSES.positionLedger,
            abi: contracts_1.POSITION_LEDGER_ABI,
            eventName: 'PositionOpened',
            onLogs: (logs) => {
                logs.forEach((log) => handlePositionOpened(log).catch(logError));
                if (logs.length)
                    scheduleDebouncedBlockWrite(logs[logs.length - 1].blockNumber);
            },
            onError: (err) => logger_1.logger.error({ err }, 'PositionOpened watcher error'),
        }),
        publicClient.watchContractEvent({
            poll: true,
            pollingInterval: 4000,
            address: contracts_1.CONTRACT_ADDRESSES.multiSigOracle,
            abi: contracts_1.MULTISIG_ORACLE_ABI,
            eventName: 'MarketResolved',
            onLogs: (logs) => {
                logs.forEach((log) => handleMarketResolved(log).catch(logError));
                if (logs.length)
                    scheduleDebouncedBlockWrite(logs[logs.length - 1].blockNumber);
            },
            onError: (err) => logger_1.logger.error({ err }, 'MarketResolved watcher error'),
        }),
    ];
    logger_1.logger.info('Blockchain event indexer started');
    return () => {
        if (_watcherWriteTimer)
            clearTimeout(_watcherWriteTimer);
        unwatchers.forEach(unwatch => unwatch());
    };
}
// ─── Backfill ─────────────────────────────────────────────────────────────────
async function backfillEvents(fromBlock) {
    if (isZeroAddress(contracts_1.CONTRACT_ADDRESSES.marketFactory)) {
        logger_1.logger.warn('MarketFactory address not configured; skipping backfill');
        return;
    }
    const blockIndex = await prisma_1.prisma.blockIndex.findUnique({
        where: { chainId: config_1.config.ARC_CHAIN_ID },
    });
    const startBlock = fromBlock ?? ((blockIndex?.lastBlockNumber ?? BigInt(0)) + BigInt(1));
    const currentBlock = await publicClient.getBlockNumber();
    if (startBlock > currentBlock) {
        logger_1.logger.info({ startBlock, currentBlock }, 'Backfill already up to date');
        return;
    }
    const batchSize = BigInt(500);
    const totalBlocks = currentBlock - startBlock;
    const totalBatches = Number(totalBlocks / batchSize) + 1;
    logger_1.logger.info({ startBlock, currentBlock, totalBatches }, 'Starting event backfill');
    let batchCount = 0;
    for (let block = startBlock; block <= currentBlock; block += batchSize) {
        const toBlock = block + batchSize - BigInt(1) < currentBlock
            ? block + batchSize - BigInt(1)
            : currentBlock;
        try {
            const [marketLogs, reasoningLogs, positionLogs, resolutionLogs] = await Promise.all([
                publicClient.getContractEvents({
                    address: contracts_1.CONTRACT_ADDRESSES.marketFactory,
                    abi: contracts_1.MARKET_FACTORY_ABI,
                    eventName: 'MarketDeployed',
                    fromBlock: block,
                    toBlock,
                }),
                publicClient.getContractEvents({
                    address: contracts_1.CONTRACT_ADDRESSES.reasoningRegistry,
                    abi: contracts_1.REASONING_REGISTRY_ABI,
                    eventName: 'ReasoningPublished',
                    fromBlock: block,
                    toBlock,
                }),
                publicClient.getContractEvents({
                    address: contracts_1.CONTRACT_ADDRESSES.positionLedger,
                    abi: contracts_1.POSITION_LEDGER_ABI,
                    eventName: 'PositionOpened',
                    fromBlock: block,
                    toBlock,
                }),
                publicClient.getContractEvents({
                    address: contracts_1.CONTRACT_ADDRESSES.multiSigOracle,
                    abi: contracts_1.MULTISIG_ORACLE_ABI,
                    eventName: 'MarketResolved',
                    fromBlock: block,
                    toBlock,
                }),
            ]);
            for (const log of marketLogs)
                await handleMarketDeployed(log).catch(logError);
            for (const log of reasoningLogs)
                await handleRegistryReasoningPublished(log).catch(logError);
            for (const log of positionLogs)
                await handlePositionOpened(log).catch(logError);
            for (const log of resolutionLogs)
                await handleMarketResolved(log).catch(logError);
            batchCount++;
            // Only write block_index every N batches (not every batch).
            // Always write on the final batch to ensure we never lose progress.
            const isFinalBatch = toBlock >= currentBlock;
            if (batchCount % WRITE_EVERY_N_BATCHES === 0 || isFinalBatch) {
                await persistBlockIndex(toBlock);
                logger_1.logger.debug({ batchCount, totalBatches, toBlock: toBlock.toString() }, 'Block index checkpoint saved');
            }
        }
        catch (err) {
            logger_1.logger.error({ err, fromBlock: block, toBlock }, 'Backfill batch failed');
        }
    }
    logger_1.logger.info('Event backfill complete');
}
// ─── Event handlers (unchanged) ──────────────────────────────────────────────
async function handleMarketDeployed(log) {
    const { market, question, oracle, expiryTimestamp, initialYesPrice, liquiditySeed, reasoningCid } = log.args ?? {};
    const txHash = log.transactionHash;
    if (!market || !txHash)
        return;
    const existing = await prisma_1.prisma.market.findFirst({
        where: { OR: [{ onChainAddress: String(market) }, { txHash: String(txHash) }] },
    });
    if (existing)
        return;
    const pendingMarket = await prisma_1.prisma.market.findFirst({
        where: {
            status: 'PENDING',
            OR: [
                { question: { equals: String(question ?? '') } },
                ...(reasoningCid ? [{ reasoningTraces: { some: { ipfsCid: String(reasoningCid) } } }] : []),
            ],
        },
        orderBy: { createdAt: 'desc' },
    });
    const initialProbability = Number(initialYesPrice ?? 5000) / 10000;
    const liquidityUsdc = Number(liquiditySeed ?? 0) / 1000000;
    if (pendingMarket) {
        await prisma_1.prisma.market.update({
            where: { id: pendingMarket.id },
            data: {
                status: 'ACTIVE',
                onChainAddress: String(market),
                txHash: String(txHash),
                resolutionOracle: String(oracle ?? pendingMarket.resolutionOracle ?? ''),
                totalLiquidity: liquidityUsdc || pendingMarket.totalLiquidity,
            },
        });
    }
    else {
        await prisma_1.prisma.market.create({
            data: {
                question: String(question ?? `On-chain market ${market}`),
                category: 'MACRO',
                status: 'ACTIVE',
                initialYesProb: clampProbability(initialProbability),
                currentYesProb: clampProbability(initialProbability),
                confidenceInterval: {
                    lower: Math.max(0.01, clampProbability(initialProbability) - 0.1),
                    upper: Math.min(0.99, clampProbability(initialProbability) + 0.1),
                },
                expiryTimestamp: new Date(Number(expiryTimestamp ?? 0) * 1000 || Date.now()),
                resolutionOracle: String(oracle ?? ''),
                minimumLiquidity: liquidityUsdc || 100,
                totalLiquidity: liquidityUsdc,
                onChainAddress: String(market),
                txHash: String(txHash),
            },
        });
    }
    await prisma_1.prisma.agentLog.create({
        data: {
            agentType: 'MARKET_MAKER',
            level: 'INFO',
            action: 'MARKET_DEPLOYED_INDEXED',
            data: { market, question, oracle, expiryTimestamp: String(expiryTimestamp ?? ''), txHash },
        },
    });
}
async function handleRegistryReasoningPublished(log) {
    const { traceId, agentWallet, ipfsCid, sha256Hash, traceType, relatedId, blockTimestamp } = log.args ?? {};
    const txHash = log.transactionHash;
    if (!ipfsCid || !txHash)
        return;
    const trace = await prisma_1.prisma.reasoningTrace.findFirst({
        where: {
            OR: [
                { ipfsCid: String(ipfsCid) },
                { sha256Hash: normalizeBytes32Hash(sha256Hash) },
            ],
        },
    });
    if (trace && trace.onChainTxHash !== String(txHash)) {
        await prisma_1.prisma.reasoningTrace.update({
            where: { id: trace.id },
            data: {
                onChainTxHash: String(txHash),
                verified: true,
                agentWallet: String(agentWallet ?? trace.agentWallet ?? ''),
            },
        });
    }
    await prisma_1.prisma.agentLog.create({
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
async function handlePositionOpened(log) {
    const { positionId, conditionId, tokenId, side, usdcSpent, entryPriceBps, edgeBps, reasoningCid, sha256Hash, polygonTxHash } = log.args ?? {};
    const txHash = String(log.transactionHash ?? polygonTxHash ?? '');
    if (!positionId || !txHash)
        return;
    const trace = await prisma_1.prisma.reasoningTrace.findFirst({
        where: {
            OR: [
                ...(reasoningCid ? [{ ipfsCid: String(reasoningCid) }] : []),
                { sha256Hash: normalizeBytes32Hash(sha256Hash) },
            ],
        },
        include: { market: true },
    });
    if (!trace) {
        logger_1.logger.warn({ positionId: String(positionId), txHash }, 'PositionOpened had no matching reasoning trace');
        return;
    }
    const existingTrade = await prisma_1.prisma.trade.findFirst({ where: { txHash } });
    if (existingTrade)
        return;
    const direction = Number(side ?? 0) === 0 ? 'YES' : 'NO';
    const amount = Number(usdcSpent ?? 0) / 1000000;
    const price = Number(entryPriceBps ?? 0) / 10000;
    const edge = Number(edgeBps ?? 0) / 10000;
    const trade = await prisma_1.prisma.trade.create({
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
    await prisma_1.prisma.position.create({
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
    await prisma_1.prisma.agentLog.create({
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
async function handleMarketResolved(log) {
    const { market, yesWon } = log.args ?? {};
    const txHash = log.transactionHash;
    if (!market)
        return;
    const existing = await prisma_1.prisma.market.findFirst({
        where: { onChainAddress: { equals: String(market), mode: 'insensitive' } },
    });
    if (!existing || existing.status === 'RESOLVED')
        return;
    await prisma_1.prisma.market.update({
        where: { id: existing.id },
        data: {
            status: 'RESOLVED',
            resolvedOutcome: Boolean(yesWon),
            resolvedAt: new Date(),
        },
    });
    await prisma_1.prisma.agentLog.create({
        data: {
            agentType: 'MARKET_MAKER',
            level: 'INFO',
            action: 'MARKET_RESOLVED_INDEXED',
            marketId: existing.id,
            data: { market: String(market), yesWon: Boolean(yesWon), txHash },
        },
    });
}
// ─── Utilities ────────────────────────────────────────────────────────────────
const isZeroAddress = (addr) => !addr || addr === '0x0000000000000000000000000000000000000000';
const clampProbability = (value) => Math.min(0.99, Math.max(0.01, value));
const normalizeBytes32Hash = (value) => String(value ?? '').replace(/^0x/, '').toLowerCase();
const logError = (err) => logger_1.logger.error({ err }, 'Event handler error');
