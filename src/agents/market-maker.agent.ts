import { startRun, advance } from '../services/market-saga.service';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

// Return shape used by the job tracker
export interface MarketCycleResult {
  marketId: string;
  question: string;
  category: string;
  onChainMarketId: string | null;
}

/**
 * Market Maker Agent — main execution loop.
 * Runs via the market-maker saga state machine.
 */
export async function runMarketMakerCycle(
  trigger: 'cron' | 'admin' = 'cron',
): Promise<MarketCycleResult | null> {
  logger.info({ trigger }, 'Market Maker Agent: starting cycle via saga');

  try {
    const runId = await startRun(trigger);
    const run = await advance(runId, { maxSteps: 50 });

    if (run.state === 'SKIPPED') {
      return null;
    }

    if (run.marketId) {
      const market = await prisma.market.findUnique({
        where: { id: run.marketId },
      });
      if (market) {
        const outputs = (run.outputs as any) || {};
        return {
          marketId: market.id,
          question: market.question,
          category: String(market.category),
          onChainMarketId:
            outputs.onChainMarketId ??
            (market.onChainMarketId ? market.onChainMarketId.toString() : null),
        };
      }
    }

    return null;
  } catch (err) {
    logger.error({ err }, 'Market Maker Agent: unhandled cycle error');

    await prisma.agentLog
      .create({
        data: {
          agentType: 'MARKET_MAKER',
          level: 'ERROR',
          action: 'CYCLE_FAILED',
          error: String(err),
        },
      })
      .catch(() => {});

    throw err;
  }
}
