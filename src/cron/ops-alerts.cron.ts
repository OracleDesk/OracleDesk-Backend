import cron from 'node-cron';
import { config } from '../config';
import { logger } from '../lib/logger';
import { newId, runWithContext } from '../lib/context';
import { onAgentPaused } from '../services/agent-controls.service';
import { queueAlertEvaluation, runAlertEvaluation } from '../services/ops-alerts/engine';
import { recordCronRun } from './registry';

let isRunning = false;

/** One tick, recorded like every other cron job (its own failures alert too). */
async function evaluateOnce(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  const startedAt = new Date();
  try {
    await runAlertEvaluation();
    recordCronRun('ops-alerts', 'success', startedAt, new Date());
  } catch (err) {
    recordCronRun('ops-alerts', 'failure', startedAt, new Date(), err);
    logger.error({ err }, 'Ops alert evaluation failed');
  } finally {
    isRunning = false;
  }
}

export const PAUSE_BURST_SPACING_MS = 2_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

/**
 * After a pause: ALERT_OPEN_AFTER evaluations a few seconds apart, so the
 * hysteresis is still N consecutive bad readings but a breaker trip opens
 * within seconds rather than N cron periods.
 */
async function evaluateBurst(): Promise<void> {
  for (let i = 0; i < config.ALERT_OPEN_AFTER; i++) {
    if (i > 0) await sleep(PAUSE_BURST_SPACING_MS);
    await evaluateOnce();
  }
}

/**
 * Operational alerts (#226): evaluates on ALERT_EVAL_CRON on every worker;
 * the advisory lock inside makes one instance the evaluator per tick. A pause
 * (breaker trip, drawdown) also queues a debounced evaluation right away.
 * Returns a stop function for the shutdown coordinator.
 */
export function startOpsAlertCron(): () => void {
  const task = cron.schedule(config.ALERT_EVAL_CRON, () => {
    const cycleId = newId('cyc');
    return runWithContext({ requestId: cycleId, cycleId, kind: 'cron', job: 'ops-alerts' }, evaluateOnce);
  });
  const unsubscribe = onAgentPaused(() => queueAlertEvaluation(evaluateBurst));
  logger.info({ cron: config.ALERT_EVAL_CRON }, 'Ops alert evaluation scheduled');
  return () => {
    task.stop();
    unsubscribe();
  };
}
