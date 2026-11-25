import { runMarketMakerCycle } from '../agents/market-maker.agent';
import { backfillEmbeddings } from '../services/embeddings.service';
import { reconcileUnresolvedAttempts } from '../services/market-idempotency.service';
import { config } from '../config';
import { logger } from '../lib/logger';
import { resumeIncomplete } from '../services/market-saga.service';
import { getRunningCycleIdForJob, scheduleJob } from './registry';

/** Returns the current in-progress ingestion cycle id, or null if no cycle is running. */
export function getRunningCycleId(): string | null {
  return getRunningCycleIdForJob('ingestion');
}

/**
 * Schedules the Market Maker Agent (every 15 minutes) and the saga resume
 * sweep (every minute) through the central `scheduleJob` helper (#336).
 */
export function startIngestionCron(): void {
  scheduleJob('ingestion', async ({ signal }) => {
    let paused = false;
    const result = await runMarketMakerCycle({ signal, onPaused: () => { paused = true; } });
    if (paused) {
      return { outcome: 'SKIPPED_PAUSED' };
    }
    // Retry sweep (#69): embed markets whose vector is still NULL (a failed
    // fire-and-forget, or created before an embedding provider was set up).
    await backfillEmbeddings(32, { maxBatches: 1 }).catch((err) =>
      logger.warn({ err: (err as Error)?.message?.slice(0, 200) }, 'Ingestion cron: embedding sweep failed'));
    if (config.CHAIN_EXECUTION_MODE === 'live') {
      await reconcileUnresolvedAttempts().catch((err) =>
        logger.warn({ err: (err as Error)?.message?.slice(0, 200) }, 'Ingestion cron: attempt reconciliation failed'));
    }
    return { outcome: 'SUCCESS', counters: { created: result ? 1 : 0 } };
  });

  // Saga resume sweep (#242): every minute, advance generation runs whose
  // backoff has elapsed. Selection and claiming run under a short advisory
  // lock inside resumeIncomplete; steps run outside any transaction.
  scheduleJob('saga-resume', async () => {
    const resumed = await resumeIncomplete();
    return { outcome: 'SUCCESS', counters: { resumed } };
  });
}
