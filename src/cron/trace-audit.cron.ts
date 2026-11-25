import { runTraceAudit } from '../services/trace-audit.service';
import { logger } from '../lib/logger';
import { scheduleJob } from './registry';

/**
 * Trace Audit Cron (#150, #306).
 * - Full audit (`TRACE_AUDIT_CRON`): walks the reasoning-registry on-chain
 *   index, verifies IPFS content hashes, evaluates `trace_verdict`, detects
 *   discrepancies, and relinks missed records.
 * - Fast lane (`TRACE_VERDICT_CRON`, default every 10 minutes): re-checks
 *   flagged/non-VALID traces and traces of revoked agents only.
 * Both schedules share `isRunning` so they never overlap.
 */
export function startTraceAuditCron(): void {
  scheduleJob('trace-audit', async () => {
    logger.info('Trace audit cron: starting trace audit cycle');
    const summary = await runTraceAudit();
    logger.info(
      {
        runId: summary.runId,
        totalAudited: summary.totalAudited,
        relinked: summary.relinked,
        counts: summary.counts,
      },
      'Trace audit cron completed',
    );
    return {
      outcome: 'SUCCESS',
      counters: {
        totalAudited: summary.totalAudited,
        relinked: summary.relinked,
      },
    };
  });
}
