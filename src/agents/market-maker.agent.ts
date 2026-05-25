import { aggregateSignals } from '../services/ingestion.service';
import {
  generateMarketQuestion,
  isDuplicateMarket,
  createMarketFromProposal,
} from '../services/market.service';
import { generateReasoningTrace } from '../services/reasoning.service';
import { uploadTraceToIPFS } from '../services/ipfs.service';
import { deployMarket } from '../services/chain.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config';
import { keccak256, toBytes } from 'viem';

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
    logger.info({ marketId: market.id, category: market.category }, 'Market Maker Agent: market created in DB');

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

    // Step 6: Pin trace to IPFS (CRITICAL for deployment)
    let ipfsResult;
    try {
      ipfsResult = await uploadTraceToIPFS(tracePayload, trace.id);
    } catch (err) {
      logger.error({ err, traceId: trace.id }, 'Market Maker Agent: IPFS pin failed — cannot deploy');
      return null;
    }

    // Step 7: Deploy to Arc via MarketFactory
    try {
      const txHash = await deployMarket({
        question:              market.question,
        expiryTimestamp:       Math.floor(market.expiryTimestamp.getTime() / 1000),
        initialYesPriceBps:    Math.round(market.initialYesProb * 10000),
        liquiditySeedUsdc:     market.minimumLiquidity,
        reasoningCid:          ipfsResult.cid,
        sha256Hash:            ipfsResult.sha256Hash,
        confidenceIntervalBps: 800, // ±8% default confidence
      });

      logger.info({ marketId: market.id, txHash }, 'Market Maker Agent: market deployment submitted to Arc');

      // Derive a deterministic mock on-chain address in non-production environments.
      // In production the blockchain indexer watches for the real MarketCreated event
      // and sets onChainAddress once the tx is mined.  In dev/mock mode no real event
      // ever fires, so we simulate it here so the market is immediately resolvable.
      const isMockMode = config.CHAIN_EXECUTION_MODE === 'mock' || config.NODE_ENV !== 'production';
      const mockOnChainAddress = isMockMode
        ? `0x${keccak256(toBytes(`onchain:${market.id}`)).slice(26)}` // last 20 bytes → valid address length
        : null;

      await prisma.market.update({
        where: { id: market.id },
        data: {
          txHash,
          ...(mockOnChainAddress
            ? { onChainAddress: mockOnChainAddress, status: 'ACTIVE' }
            : {}),
        },
      });

      if (mockOnChainAddress) {
        logger.info(
          { marketId: market.id, onChainAddress: mockOnChainAddress },
          'Market Maker Agent: mock on-chain address assigned (dev mode)',
        );
      }
    } catch (err) {
      logger.error({ err, marketId: market.id }, 'Market Maker Agent: Arc deployment failed');
      // We keep it PENDING in DB, could be retried later
    }

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