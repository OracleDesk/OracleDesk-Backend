import { logger } from '../lib/logger';
import { runReportJob } from '../services/transparency-report.service';
import { scheduleJob } from './registry';

/** Daily transparency report (#159), at REPORT_CRON (default 00:10 UTC). */
export function startReportCron(): void {
  scheduleJob('transparency-report', async () => {
    const row = await runReportJob();
    logger.info({ date: row.date, cid: row.cid, mode: row.mode }, 'Transparency report published');
    return { outcome: 'SUCCESS' };
  });
}
