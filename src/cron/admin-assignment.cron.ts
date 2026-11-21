import cron from 'node-cron';
import { config } from '../config';
import { logger } from '../lib/logger';
import { newId, runWithContext } from '../lib/context';
import { expireAdminAssignments } from '../services/admin-rbac.service';
import { evictAdminsFromRoom } from '../lib/admin-socket';
import { getRealtime } from '../lib/socket-auth';
import { recordCronRun } from './registry';

let isRunning = false;

/** Expires admin assignments and evicts their sockets from the admins room (#276). */
export function startAdminAssignmentCron(): void {
  cron.schedule(config.ADMIN_ASSIGNMENT_EXPIRE_CRON, () => {
    const cycleId = newId('cyc');
    return runWithContext({ requestId: cycleId, cycleId, kind: 'cron', job: 'admin-assignment-expiry' }, async () => {
      if (isRunning) return;
      isRunning = true;
      const startedAt = new Date();
      try {
        const evicted = await expireAdminAssignments();
        const io = getRealtime();
        if (io && evicted.length > 0) evictAdminsFromRoom(io, evicted);
        if (evicted.length > 0) logger.info({ count: evicted.length }, 'Expired admin assignments');
        recordCronRun('admin-assignment-expiry', 'success', startedAt, new Date());
      } catch (err) {
        recordCronRun('admin-assignment-expiry', 'failure', startedAt, new Date(), err);
        logger.error({ err }, 'Admin assignment expiry job failed');
      } finally {
        isRunning = false;
      }
    });
  });
  logger.info({ cron: config.ADMIN_ASSIGNMENT_EXPIRE_CRON }, 'Admin assignment expiry scheduled');
}