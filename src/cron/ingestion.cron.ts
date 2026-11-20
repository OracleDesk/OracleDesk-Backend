import cron from 'node-cron';
import { runMarketMakerCycle } from '../agents/market-maker.agent';
import { backfillEmbeddings } from '../services/embeddings.service';
import { reconcileUnresolvedAttempts } from '../services/market-idempotency.service';
import { config } from '../config';
import { logger } from '../lib/logger';
import { newId, runWithContext } from '../lib/context';
import { recordCronRun } from './registry';
import { resumeIncomplete } from '../services/market-saga.service';

let runningCycleId: string | null = null;

/** Returns the current in-progress cycle id, or null if no cycle is running. */
export function getRunningCycleId(): string | null { return runningCycleId; }

/**
 * Schedules the Market Maker Agent to run every 15 minutes.
 *
 * The `runningCycleId` guard prevents overlapping executions.
 * If a cycle is still running when the next one is scheduled,
 * the new trigger is skipped.
 *
 * Cron expression: "0,15,30,45 * * * *"
 *   Runs at :00, :15, :30, :45 of every hour
 */
export function startIngestionCron(): void {
  // The context is entered inside the callback: node-cron fires it from its own timer.
  cron.schedule('0,15,30,45 * * * *', () => {
    const cycleId = newId('cyc');
    return runWithContext({ requestId: cycleId, cycleId, kind: 'cron', job: 'market_maker' }, async () => {
      if (runningCycleId) {
        logger.warn({ skippedJob: 'market_maker', runningCycleId }, 'Ingestion cron: previous cycle still running — skipping');
        return;
      }

      runningCycleId = cycleId;
      const startedAt = new Date();
      try {
        await runMarketMakerCycle();
        // Retry sweep (#69): embed markets whose vector is still NULL (a failed
        // fire-and-forget, or created before an embedding provider was set up).
        await backfillEmbeddings(32, { maxBatches: 1 }).catch((err) =>
          logger.warn({ err: (err as Error)?.message?.slice(0, 200) }, 'Ingestion cron: embedding sweep failed'));
        if (config.CHAIN_EXECUTION_MODE === 'live') {
          await reconcileUnresolvedAttempts().catch((err) =>
            logger.warn({ err: (err as Error)?.message?.slice(0, 200) }, 'Ingestion cron: attempt reconciliation failed'));
        }
        recordCronRun('ingestion', 'success', startedAt, new Date());
      } catch (err) {
        recordCronRun('ingestion', 'failure', startedAt, new Date(), err);
        logger.error({ err }, 'Ingestion cron: cycle failed');
      } finally {
        runningCycleId = null;
      }
    });
  });

  // Saga resume sweep (#242): every minute, advance generation runs whose
  // backoff has elapsed. Selection and claiming run under a short advisory
  // lock inside resumeIncomplete; steps run outside any transaction.
  let resuming = false;
  cron.schedule('* * * * *', () => {
    if (resuming) return;
    resuming = true;
    return runWithContext({ requestId: newId('cyc'), kind: 'cron', job: 'saga_resume' }, async () => {
      try {
        await resumeIncomplete();
      } catch (err) {
        logger.warn({ err }, 'Saga resume sweep failed');
      } finally {
        resuming = false;
      }
    });
  });

  logger.info('Ingestion cron started (every 15 minutes)');
}
