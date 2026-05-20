"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const config_1 = require("./config");
const logger_1 = require("./lib/logger");
const prisma_1 = require("./lib/prisma");
const ingestion_cron_1 = require("./cron/ingestion.cron");
const monitor_cron_1 = require("./cron/monitor.cron");
const indexer_service_1 = require("./services/indexer.service");
let stopEventListener = null;
async function bootstrap() {
    // 1. Connect to database
    try {
        await prisma_1.prisma.$connect();
        logger_1.logger.info('Database connected');
    }
    catch (err) {
        logger_1.logger.fatal({ err }, 'Failed to connect to database');
        process.exit(1);
    }
    // 2. Backfill blockchain events missed during downtime
    // try {
    //   await backfillEvents();
    // } catch (err) {
    //   logger.warn({ err }, 'Backfill failed — continuing without backfill');
    // }
    (0, indexer_service_1.backfillEvents)().catch((err) => {
        logger_1.logger.warn({ err }, 'Backfill failed');
    });
    // 3. Start real-time event listener
    stopEventListener = (0, indexer_service_1.startEventListener)();
    // 4. Start cron jobs
    (0, ingestion_cron_1.startIngestionCron)();
    (0, monitor_cron_1.startMonitorCron)();
    // 5. Start HTTP server
    const server = app_1.default.listen(config_1.config.PORT, () => {
        logger_1.logger.info({ port: config_1.config.PORT, env: config_1.config.NODE_ENV }, `OracleDesk backend running on port ${config_1.config.PORT}`);
    });
    // ─── Graceful Shutdown ───
    const shutdown = async (signal) => {
        logger_1.logger.info({ signal }, 'Shutting down gracefully...');
        server.close(async () => {
            if (stopEventListener)
                stopEventListener();
            await prisma_1.prisma.$disconnect();
            logger_1.logger.info('Database disconnected');
            process.exit(0);
        });
        // Force exit if shutdown takes too long
        setTimeout(() => {
            logger_1.logger.error('Forced shutdown after timeout');
            process.exit(1);
        }, 15000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
        logger_1.logger.error({ reason }, 'Unhandled promise rejection');
    });
    process.on('uncaughtException', (err) => {
        logger_1.logger.fatal({ err }, 'Uncaught exception — shutting down');
        process.exit(1);
    });
}
bootstrap();
