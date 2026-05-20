import { aggregateSignals } from '../services/ingestion.service';
import {
  generateMarketQuestion,
  isDuplicateMarket,
  createMarketFromProposal,
} from '../services/market.service';
import { generateReasoningTrace } from '../services/reasoning.service';
import { uploadTraceToIPFS } from '../services/ipfs.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Market Maker Agent — main execution loop.
 *
 * Called by the ingestion cron every 15 minutes.
 * 
 * Full flow:
 *   1. Aggregate signals from all data sources
 *   2. Generate a market proposal via Claude
 *   3. Deduplicate against existing markets
 *   4. Persist the market to DB
 *   5. Generate a reasoning trace for the creation decision
 *   6. Pin the trace to IPFS
 */
export async function runMarketMakerCycle(): Promise<void> {
  logger.info('Market Maker Agent: starting cycle');

  try {
    // Step 1: Fetch signals
    const signals = await aggregateSignals();
    if (signals.signalCount === 0) {
      logger.warn('Market Maker Agent: no signals available — skipping cycle');
      return;
    }

    // Step 2: Generate market proposal via Claude
    let proposal;
    try {
      proposal = await generateMarketQuestion(signals);
    } catch (err) {
      logger.error({ err }, 'Market Maker Agent: market generation failed');
      return;
    }

    // Step 3: Deduplication check
    const isDuplicate = await isDuplicateMarket(proposal.market_question);
    if (isDuplicate) {
      logger.info({ question: proposal.market_question }, 'Market Maker Agent: duplicate market — skipping');
      return;
    }

    // Step 4: Create market in DB
    const market = await createMarketFromProposal(proposal);
    logger.info({ marketId: market.id }, 'Market Maker Agent: market created');

    // Step 5: Generate reasoning trace for this creation decision
    const { trace, tracePayload } = await generateReasoningTrace({
      marketId:            market.id,
      agentType:           'MARKET_MAKER',
      decisionType:        'MARKET_CREATION',
      sourcesUsed: signals.news.slice(0, 3).map(s => ({
        source:   s.source,
        weight:   0.7,
        signal:   s.title,
        rawValue: proposal.initial_yes_probability,
      })),
      probabilityEstimate: proposal.initial_yes_probability,
      marketProbability:   0.5, // New market — default 50%
      edge:                proposal.initial_yes_probability - 0.5,
      confidenceInterval:  proposal.confidence_interval,
    });

    // Step 6: Pin to IPFS
    try {
      await uploadTraceToIPFS(tracePayload, trace.id);
    } catch (err) {
      logger.warn({ err, traceId: trace.id }, 'Market Maker Agent: IPFS pin failed — continuing');
    }

    logger.info({ marketId: market.id, traceId: trace.id }, 'Market Maker Agent: cycle complete');
  } catch (err) {
    logger.error({ err }, 'Market Maker Agent: unhandled cycle error');

    await prisma.agentLog.create({
      data: {
        agentType: 'MARKET_MAKER',
        level:     'ERROR',
        action:    'CYCLE_FAILED',
        error:     String(err),
      },
    });
  }
}