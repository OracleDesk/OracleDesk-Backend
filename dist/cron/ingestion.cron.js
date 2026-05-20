"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startIngestionCron = startIngestionCron;
const node_cron_1 = __importDefault(require("node-cron"));
const market_maker_agent_1 = require("../agents/market-maker.agent");
const logger_1 = require("../lib/logger");
let isRunning = false;
/**
 * Schedules the Market Maker Agent to run every 15 minutes.
 *
 * The `isRunning` guard prevents overlapping executions.
 * If a cycle is still running when the next one is scheduled,
 * the new trigger is skipped.
 *
 * Cron expression: "0,15,30,45 * * * *"
 *   Runs at :00, :15, :30, :45 of every hour
 */
function startIngestionCron() {
    node_cron_1.default.schedule('0,15,30,45 * * * *', async () => {
        if (isRunning) {
            logger_1.logger.warn('Ingestion cron: previous cycle still running — skipping');
            return;
        }
        isRunning = true;
        try {
            await (0, market_maker_agent_1.runMarketMakerCycle)();
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Ingestion cron: cycle failed');
        }
        finally {
            isRunning = false;
        }
    });
    logger_1.logger.info('Ingestion cron started (every 15 minutes)');
}
