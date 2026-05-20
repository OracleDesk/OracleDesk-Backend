"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMonitorCron = startMonitorCron;
const node_cron_1 = __importDefault(require("node-cron"));
const trader_agent_1 = require("../agents/trader.agent");
const subscription_service_1 = require("../services/subscription.service");
const logger_1 = require("../lib/logger");
let traderRunning = false;
/**
 * Position Monitor Cron — runs every 15 minutes.
 *
 * Responsibilities:
 * 1. Run the Trader Agent cycle (scan markets, update positions, hedge)
 * 2. Expire stale subscriptions
 *
 * Separate guard flags prevent the Trader Agent from overlapping with itself.
 */
function startMonitorCron() {
    // Trader Agent — every 15 minutes
    node_cron_1.default.schedule('5,20,35,50 * * * *', async () => {
        if (traderRunning) {
            logger_1.logger.warn('Monitor cron: trader cycle still running — skipping');
            return;
        }
        traderRunning = true;
        try {
            await (0, trader_agent_1.runTraderCycle)();
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Monitor cron: trader cycle failed');
        }
        finally {
            traderRunning = false;
        }
    });
    // Subscription expiry — every hour
    node_cron_1.default.schedule('0 * * * *', async () => {
        try {
            await (0, subscription_service_1.expireStaleSubscriptions)();
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Monitor cron: subscription expiry failed');
        }
    });
    logger_1.logger.info('Monitor cron started');
}
