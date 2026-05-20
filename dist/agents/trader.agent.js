"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTraderCycle = runTraderCycle;
const ingestion_service_1 = require("../services/ingestion.service");
const market_service_1 = require("../services/market.service");
const trade_service_1 = require("../services/trade.service");
const correlation_service_1 = require("../services/correlation.service");
const reasoning_service_1 = require("../services/reasoning.service");
const ipfs_service_1 = require("../services/ipfs.service");
const hedging_service_1 = require("../services/hedging.service");
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
const config_1 = require("../config");
const BANKROLL = 10000; // $10,000 USDC starting bankroll
const MIN_MARKET_LIQUIDITY = 500;
const MIN_EDGE = 0.08;
/**
 * Trader Agent — main execution loop.
 *
 * Called by the monitor cron every 15 minutes.
 *
 * Full flow:
 *   1. Check daily drawdown — pause if limit hit
 *   2. Update all open positions (P&L + stop-loss check)
 *   3. Check for hedge opportunities on deteriorating positions
 *   4. Scan active markets for +EV opportunities
 *   5. For each mispriced market: compute Kelly size, check correlation, execute
 *   6. Generate reasoning trace + pin to IPFS for each trade
 */
async function runTraderCycle() {
    logger_1.logger.info('Trader Agent: starting cycle');
    try {
        // Step 1: Check daily drawdown limit
        const drawdown = await (0, hedging_service_1.checkDailyDrawdown)(BANKROLL);
        if (drawdown.isPaused) {
            logger_1.logger.warn({ drawdownPct: drawdown.drawdownPct }, 'Trader Agent: paused due to drawdown limit');
            return;
        }
        // Step 2: Update all open positions
        const openPositions = await prisma_1.prisma.position.findMany({
            where: { status: 'OPEN' },
        });
        for (const position of openPositions) {
            const { shouldClose, reason } = await (0, hedging_service_1.enforceStopLoss)(position.id);
            if (shouldClose && reason) {
                await (0, trade_service_1.closePosition)(position.id, position.currentPrice ?? position.entryPrice, 'STOP_LOSS');
                logger_1.logger.info({ positionId: position.id, reason }, 'Stop-loss triggered');
            }
        }
        // Step 3: Hedge opportunities
        const hedgeRecs = await (0, hedging_service_1.detectHedgeOpportunities)();
        for (const rec of hedgeRecs) {
            try {
                await (0, hedging_service_1.autoHedge)(rec);
            }
            catch (err) {
                logger_1.logger.warn({ err, rec }, 'Trader Agent: hedge failed');
            }
        }
        // Step 4: Scan markets for opportunities
        const signals = await (0, ingestion_service_1.aggregateSignals)();
        const activeMarkets = await prisma_1.prisma.market.findMany({
            where: {
                status: 'ACTIVE',
                totalLiquidity: { gte: MIN_MARKET_LIQUIDITY },
                expiryTimestamp: {
                    gt: new Date(),
                    lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // Within 14 days
                },
            },
        });
        for (const market of activeMarkets) {
            await analyzeAndTradeMarket(market, signals);
        }
        logger_1.logger.info('Trader Agent: cycle complete');
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Trader Agent: unhandled cycle error');
        await prisma_1.prisma.agentLog.create({
            data: { agentType: 'TRADER', level: 'ERROR', action: 'CYCLE_FAILED', error: String(err) },
        });
    }
}
async function analyzeAndTradeMarket(market, signals) {
    try {
        // Skip if we already have an open position in this market
        const existingPosition = await prisma_1.prisma.position.findFirst({
            where: { marketId: market.id, status: 'OPEN' },
        });
        if (existingPosition)
            return;
        // Estimate probability using signal weighting
        const marketProb = market.currentYesProb ?? market.initialYesProb;
        const sourceSignals = signals.news.slice(0, 3).map((s) => ({
            source: s.source,
            weight: 0.7,
            signal: s.title,
            rawValue: marketProb,
        }));
        const { probability: agentProb, confidenceInterval } = (0, market_service_1.calculateProbability)(sourceSignals, marketProb);
        // Compute edge
        const edge = agentProb - marketProb;
        // Guard: insufficient edge
        if (Math.abs(edge) < MIN_EDGE)
            return;
        // Kelly sizing — use conservative end of CI
        const conservativeProb = edge > 0 ? confidenceInterval.lower : 1 - confidenceInterval.upper;
        const kellyResult = (0, trade_service_1.calculateKellySize)({
            agentProbability: Math.max(0.01, conservativeProb),
            marketProbability: marketProb,
            bankroll: BANKROLL,
            netOdds: edge > 0 ? (1 - marketProb) / marketProb : marketProb / (1 - marketProb),
        });
        if (kellyResult.betSize <= 0)
            return;
        // Correlation check — may reduce position size
        const correlation = await (0, correlation_service_1.checkCorrelation)(market.id, kellyResult.betSize, BANKROLL);
        const finalSize = correlation.adjustedPositionSize;
        if (finalSize < 1) {
            logger_1.logger.debug({ marketId: market.id }, 'Position size too small after correlation adjustment — skipping');
            return;
        }
        const direction = edge > 0 ? 'YES' : 'NO';
        const price = direction === 'YES' ? marketProb : 1 - marketProb;
        // Generate reasoning trace BEFORE executing
        const { trace, tracePayload } = await (0, reasoning_service_1.generateReasoningTrace)({
            marketId: market.id,
            agentType: 'TRADER',
            decisionType: 'OPEN_POSITION',
            sourcesUsed: sourceSignals,
            probabilityEstimate: agentProb,
            marketProbability: marketProb,
            edge,
            confidenceInterval,
            betFraction: kellyResult.halfKelly,
            betSizeUsdc: finalSize,
        });
        // Execute trade
        await (0, trade_service_1.executeTrade)({
            marketId: market.id,
            direction,
            amount: finalSize,
            price,
            kellyFraction: kellyResult.halfKelly,
            edgeDetected: edge,
            builderCode: config_1.config.POLYMARKET_BUILDER_CODE,
            traceId: trace.id,
        });
        // Pin to IPFS async — don't block
        (0, ipfs_service_1.uploadTraceToIPFS)(tracePayload, trace.id).catch(err => logger_1.logger.warn({ err }, 'Trade trace IPFS pin failed'));
        logger_1.logger.info({ marketId: market.id, direction, amount: finalSize, edge }, 'Trader Agent: trade executed');
    }
    catch (err) {
        logger_1.logger.warn({ err, marketId: market.id }, 'Trader Agent: market analysis failed');
    }
}
