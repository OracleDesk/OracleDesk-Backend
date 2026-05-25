import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      config.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ]
        : [{ emit: 'event', level: 'error' }],
  });

if (config.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// ─── Slow query logger ────────────────────────────────────────────────────────
// Previous threshold was 200ms. This produced hundreds of warnings per session
// because:
//   1. block_index upserts during backfill flood the log (fixed in indexer.service.ts)
//   2. Cold connection on startup takes 400-600ms for the first few queries
//   3. Remote Postgres (Supabase/Neon/Railway) adds ~100-200ms network RTT to
//      every write, so even healthy writes hit 200ms on a remote host
//
// New thresholds:
//   - 1000ms for reads (SELECT) — a read taking >1s is genuinely problematic
//   - 1500ms for writes (INSERT/UPDATE/UPSERT) — writes are slower on remote DB;
//     flag only egregiously slow ones
//   - 500ms for health checks (SELECT 1) — expected on a remote host; only flag
//     if it exceeds 500ms which indicates real connectivity problems

if (config.NODE_ENV === 'development') {
  prisma.$on('query' as never, (e: any) => {
    const q: string   = e.query ?? '';
    const ms: number  = e.duration ?? 0;

    const isHealthCheck = q.trim() === 'SELECT 1';
    const isWrite       = /^\s*(INSERT|UPDATE|DELETE|UPSERT)/i.test(q);
    const isRead        = !isWrite && !isHealthCheck;

    const threshold =
      isHealthCheck ? 500 :
      isWrite       ? 1500 :
      /* isRead */   1000;

    if (ms > threshold) {
      logger.warn({ query: q, duration: ms }, 'Slow query detected');
    }
  });
}

prisma.$on('error' as never, (e: any) => {
  logger.error({ message: e.message }, 'Prisma error');
});

export default prisma;