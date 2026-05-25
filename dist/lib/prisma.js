"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const config_1 = require("../config");
const logger_1 = require("./logger");
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.prisma ??
    new client_1.PrismaClient({
        log: config_1.config.NODE_ENV === 'development'
            ? [
                { emit: 'event', level: 'query' },
                { emit: 'event', level: 'error' },
                { emit: 'event', level: 'warn' },
            ]
            : [{ emit: 'event', level: 'error' }],
    });
if (config_1.config.NODE_ENV !== 'production') {
    globalForPrisma.prisma = exports.prisma;
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
if (config_1.config.NODE_ENV === 'development') {
    exports.prisma.$on('query', (e) => {
        const q = e.query ?? '';
        const ms = e.duration ?? 0;
        const isHealthCheck = q.trim() === 'SELECT 1';
        const isWrite = /^\s*(INSERT|UPDATE|DELETE|UPSERT)/i.test(q);
        const isRead = !isWrite && !isHealthCheck;
        const threshold = isHealthCheck ? 500 :
            isWrite ? 1500 :
                /* isRead */ 1000;
        if (ms > threshold) {
            logger_1.logger.warn({ query: q, duration: ms }, 'Slow query detected');
        }
    });
}
exports.prisma.$on('error', (e) => {
    logger_1.logger.error({ message: e.message }, 'Prisma error');
});
exports.default = exports.prisma;
