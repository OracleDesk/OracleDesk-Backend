import { logger } from '../lib/logger';
import { escalateOpenReviews, pollProposals } from '../services/dispute-monitor.service';
import { scheduleJob } from './registry';

/**
 * Dispute monitor crons (#92).
 *  - every 5 minutes: review pending proposals and escalate (INSUFFICIENT → CRITICAL
 *    as the window shrinks, unless acknowledged);
 *  - every 30 minutes: find proposals whose event was missed and close reviews
 *    whose proposal is gone.
 */
export function startDisputeCron(): void {
  scheduleJob('dispute-escalation', async () => {
    const escalated = await escalateOpenReviews();
    return { outcome: 'SUCCESS', counters: { escalated } };
  });

  scheduleJob('dispute-polling', async () => {
    const result = await pollProposals();
    if (result.created > 0 || result.closed > 0) logger.info(result, 'Dispute cron: polling pass');
    return { outcome: 'SUCCESS', counters: { created: result.created, closed: result.closed } };
  });
}
