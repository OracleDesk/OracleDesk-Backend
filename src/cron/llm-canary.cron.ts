import cron from 'node-cron';
import { logger } from '../lib/logger';
import { newId, runWithContext } from '../lib/context';
import { withAdvisoryLock } from '../lib/advisory-lock';
import { recordCronRun } from './registry';
import { runLlmCanaryPass, syncActiveDemotions } from '../services/llm-canary.service';

let isRunning = false;

/**
 * Daily LLM model-drift canary (#296): runs once a day under a Postgres
 * advisory lock so only one instance executes the live probes.
 */
export function startLlmCanaryCron(): void {
  // Sync any active demotions on startup
  void syncActiveDemotions().catch((err) =>
    logger.warn({ err: err instanceof Error ? err.message : err }, 'Failed to sync LLM demotions on startup'),
  );

  cron.schedule('15 3 * * *', () => {
    const cycleId = newId('cyc');
    return runWithContext({ requestId: cycleId, cycleId, kind: 'cron', job: 'llm-canary' }, async () => {
      if (isRunning) {
        logger.warn('LLM canary cron: previous run still active — skipping');
        return;
      }
      isRunning = true;
      const startedAt = new Date();
      try {
        const lockRes = await withAdvisoryLock('llm-canary:daily', async () => runLlmCanaryPass());
        recordCronRun('llm-canary', 'success', startedAt, new Date());
        if (!lockRes.acquired) {
          logger.debug('LLM canary cron: another instance holds the lock');
        } else {
          const drifted = lockRes.value.filter((r) => r.drifted);
          logger.info(
            { evaluated: lockRes.value.length, drifted: drifted.length },
            'LLM canary cron: daily pass complete',
          );
        }
      } catch (err) {
        recordCronRun('llm-canary', 'failure', startedAt, new Date(), err);
        logger.error({ err }, 'LLM canary cron: run failed');
      } finally {
        isRunning = false;
      }
    });
  });

  logger.info('LLM canary cron scheduled');
}
