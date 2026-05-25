"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMarketMakerCycle = runMarketMakerCycle;
const ingestion_service_1 = require("../services/ingestion.service");
const market_service_1 = require("../services/market.service");
const reasoning_service_1 = require("../services/reasoning.service");
const ipfs_service_1 = require("../services/ipfs.service");
const chain_service_1 = require("../services/chain.service");
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
/**
 * Market Maker Agent — main execution loop.
 *
 * Called by the ingestion cron every 15 minutes AND manually via
 * POST /markets/generate. Returns market details on success so the
 * job tracker can surface them in GET /markets/generation-status/:jobId.
 *
 * Returns null when the cycle is intentionally skipped (no signals,
 * duplicate detected, etc.) — not an error condition.
 */
async function runMarketMakerCycle() {
    logger_1.logger.info('Market Maker Agent: starting cycle');
    try {
        // Step 1: Aggregate signals from all sources
        const signals = await (0, ingestion_service_1.aggregateSignals)();
        if (signals.signalCount === 0) {
            logger_1.logger.warn('Market Maker Agent: no signals available — skipping cycle');
            return null;
        }
        // Step 2: Generate market proposal via Gemini
        let proposal;
        try {
            proposal = await (0, market_service_1.generateMarketQuestion)(signals);
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Market Maker Agent: Gemini market generation failed');
            return null;
        }
        // Step 3: Deduplicate
        const isDuplicate = await (0, market_service_1.isDuplicateMarket)(proposal.market_question);
        if (isDuplicate) {
            logger_1.logger.info({ question: proposal.market_question }, 'Market Maker Agent: duplicate market — skipping');
            return null;
        }
        // Step 4: Persist market to DB
        const market = await (0, market_service_1.createMarketFromProposal)(proposal);
        logger_1.logger.info({ marketId: market.id, category: market.category }, 'Market Maker Agent: market created in DB');
        // Step 5: Generate reasoning trace for this creation decision
        const { trace, tracePayload } = await (0, reasoning_service_1.generateReasoningTrace)({
            marketId: market.id,
            agentType: 'MARKET_MAKER',
            decisionType: 'MARKET_CREATION',
            sourcesUsed: signals.news.slice(0, 3).map(s => ({
                source: s.source,
                weight: 0.7,
                signal: s.title,
                rawValue: proposal.initial_yes_probability,
            })),
            probabilityEstimate: proposal.initial_yes_probability,
            marketProbability: 0.5,
            edge: proposal.initial_yes_probability - 0.5,
            confidenceInterval: proposal.confidence_interval,
        });
        // Step 6: Pin trace to IPFS (CRITICAL for deployment)
        let ipfsResult;
        try {
            ipfsResult = await (0, ipfs_service_1.uploadTraceToIPFS)(tracePayload, trace.id);
        }
        catch (err) {
            logger_1.logger.error({ err, traceId: trace.id }, 'Market Maker Agent: IPFS pin failed — cannot deploy');
            return null;
        }
        // Step 7: Deploy to Arc via MarketFactory
        try {
            const txHash = await (0, chain_service_1.deployMarket)({
                question: market.question,
                expiryTimestamp: Math.floor(market.expiryTimestamp.getTime() / 1000),
                initialYesPriceBps: Math.round(market.initialYesProb * 10000),
                liquiditySeedUsdc: market.minimumLiquidity,
                reasoningCid: ipfsResult.cid,
                sha256Hash: ipfsResult.sha256Hash,
                confidenceIntervalBps: 800, // ±8% default confidence
            });
            logger_1.logger.info({ marketId: market.id, txHash }, 'Market Maker Agent: market deployment submitted to Arc');
            // Update market with txHash (indexer will set ACTIVE and onChainAddress later)
            await prisma_1.prisma.market.update({
                where: { id: market.id },
                data: { txHash },
            });
        }
        catch (err) {
            logger_1.logger.error({ err, marketId: market.id }, 'Market Maker Agent: Arc deployment failed');
            // We keep it PENDING in DB, could be retried later
        }
        logger_1.logger.info({ marketId: market.id, traceId: trace.id }, 'Market Maker Agent: cycle complete');
        // ← Return the created market details for the job tracker
        return {
            marketId: market.id,
            question: market.question,
            category: String(market.category),
        };
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Market Maker Agent: unhandled cycle error');
        await prisma_1.prisma.agentLog.create({
            data: {
                agentType: 'MARKET_MAKER',
                level: 'ERROR',
                action: 'CYCLE_FAILED',
                error: String(err),
            },
        }).catch(() => { });
        throw err; // Re-throw so the job tracker records FAILED status
    }
}
