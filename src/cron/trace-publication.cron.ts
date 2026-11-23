import { processTracePublications } from '../jobs/trace-publication.worker';
import { scheduleJob } from './registry';

/**
 * Trace publication cron (#131). Every TRACE_PUBLISH_CRON (default 30 s) it
 * advances queued trace publications: pin, wait for the on-chain market,
 * publish once, and re-check unconfirmed submissions. Rows are claimed with
 * FOR UPDATE SKIP LOCKED, so several processes can run this safely.
 */
export function startTracePublicationCron(): void {
  scheduleJob('trace-publication', async () => {
    const res = await processTracePublications();
    return {
      outcome: 'SUCCESS',
      counters: { processed: res.processed, ...res.byStatus },
    };
  });
}
