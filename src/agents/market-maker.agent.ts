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

// Return shape used by the job tracker
export interface MarketCycleResult {
  marketId: string;
  question: string;
  category: string;
}

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
export async function runMarketMakerCycle(): Promise<MarketCycleResult | null> {
  logger.info('Market Maker Agent: starting cycle');

  try {
    // Step 1: Aggregate signals from all sources
    const signals = await aggregateSignals();
    if (signals.signalCount === 0) {
      logger.warn('Market Maker Agent: no signals available — skipping cycle');
      return null;
    }

    // Step 2: Generate market proposal via Gemini
    let proposal;
    try {
      proposal = await generateMarketQuestion(signals);
    } catch (err) {
      logger.error({ err }, 'Market Maker Agent: Gemini market generation failed');
      return null;
    }

    // Step 3: Deduplicate
    const isDuplicate = await isDuplicateMarket(proposal.market_question);
    if (isDuplicate) {
      logger.info({ question: proposal.market_question },
        'Market Maker Agent: duplicate market — skipping');
      return null;
    }

    // Step 4: Persist market to DB
    const market = await createMarketFromProposal(proposal);
    logger.info({ marketId: market.id, category: market.category }, 'Market Maker Agent: market created');

    // Step 5: Generate reasoning trace for this creation decision
    const { trace, tracePayload } = await generateReasoningTrace({
      marketId:            market.id,
      agentType:           'MARKET_MAKER',
      decisionType:        'MARKET_CREATION',
      sourcesUsed:         signals.news.slice(0, 3).map(s => ({
        source:   s.source,
        weight:   0.7,
        signal:   s.title,
        rawValue: proposal.initial_yes_probability,
      })),
      probabilityEstimate: proposal.initial_yes_probability,
      marketProbability:   0.5,
      edge:                proposal.initial_yes_probability - 0.5,
      confidenceInterval:  proposal.confidence_interval,
    });

    // Step 6: Pin trace to IPFS (non-blocking — don't fail the cycle if this errors)
    uploadTraceToIPFS(tracePayload, trace.id).catch(err =>
      logger.warn({ err, traceId: trace.id }, 'Market Maker Agent: IPFS pin failed'),
    );

    logger.info({ marketId: market.id, traceId: trace.id }, 'Market Maker Agent: cycle complete');

    // ← Return the created market details for the job tracker
    return {
      marketId: market.id,
      question: market.question,
      category: String(market.category),
    };
  } catch (err) {
    logger.error({ err }, 'Market Maker Agent: unhandled cycle error');

    await prisma.agentLog.create({
      data: {
        agentType: 'MARKET_MAKER',
        level:     'ERROR',
        action:    'CYCLE_FAILED',
        error:     String(err),
      },
    }).catch(() => {});

    throw err; // Re-throw so the job tracker records FAILED status
  }
}