import cron from 'node-cron';
import { runMoneyAudit } from '../services/money-audit/run';
import { logger } from '../lib/logger';
import { config } from '../config';
import { newId, runWithContext } from '../lib/context';
import { recordCronRun } from './registry';

let isRunning = false;

/**
 * Money audit (#222): hourly at minute 27, offset from the reconciler. Every
 * instance schedules it; the advisory lock inside runMoneyAudit lets only one
 * of them run.
 */
export function startMoneyAuditCron(): void {
  if (!config.MONEY_AUDIT_ENABLED) {
    logger.info('Money audit cron is disabled by config (MONEY_AUDIT_ENABLED=false)');
    return;
  }

  cron.schedule('27 * * * *', () => {
    const cycleId = newId('cyc');
    return runWithContext({ requestId: cycleId, cycleId, kind: 'cron', job: 'money-audit' }, async () => {
      if (isRunning) {
        logger.warn('Money audit cron: previous run still active — skipping');
        return;
      }
      isRunning = true;
      const startedAt = new Date();
      try {
        const summary = await runMoneyAudit();
        recordCronRun('money-audit', 'success', startedAt, new Date());
        if (!summary) logger.debug('Money audit cron: another instance holds the lock');
      } catch (err) {
        recordCronRun('money-audit', 'failure', startedAt, new Date(), err);
        logger.error({ err }, 'Money audit cron: run failed');
      } finally {
        isRunning = false;
      }
    });
  });

  logger.info('Money audit cron scheduled');
}
