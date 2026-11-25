import { runReconciliation, defaultDeps } from '../services/market-reconciler.service';
import { logger } from '../lib/logger';
import { scheduleJob } from './registry';

/**
 * Market lifecycle reconciler (#83): every ten minutes, offset from the other
 * jobs. Every instance schedules it; the advisory lock inside
 * runReconciliation lets only one of them run.
 */
export function startReconcileCron(emit?: (event: string, payload: unknown) => void): void {
  scheduleJob('market-reconciler', async () => {
    const summary = await runReconciliation({}, { ...defaultDeps, emit });
    if (!summary) {
      logger.debug('Reconcile cron: another instance holds the lock');
      return { outcome: 'SKIPPED_LOCK_HELD' };
    }
    return {
      outcome: 'SUCCESS',
      counters: {
        scanned: summary.scanned,
        repaired: summary.repaired,
        reported: summary.reported,
        deferred: summary.deferred,
        skippedNewer: summary.skippedNewer,
        rpcCalls: summary.rpcCalls,
        rpcErrors: summary.rpcErrors,
      },
    };
  });
}
