import { confirmPendingPaymentIntents } from '../services/payment-intent.service';
import { expireAllowanceReservations } from '../services/x402-allowance.service';
import { recordCronRun } from './registry';

let isRunning = false;

/**
 * Confirms submitted payment intents and expires abandoned ones (#52), then
 * expires x402 allowance reservations past their TTL (#219). The per-hash
 * advisory lock inside submitPaymentIntent and FOR UPDATE SKIP LOCKED in the
 * reservation sweep make this safe to run on every instance; the in-process
 * guard only avoids duplicate work per process.
 */
export function startPaymentIntentCron(): void {
  if (!config.PAYMENT_INTENT_CONFIRM_ENABLED) {
    logger.info('Payment intent confirmer is disabled by config');
    return;
  }

  cron.schedule(config.PAYMENT_INTENT_CONFIRM_CRON, () => {
    const cycleId = newId('cyc');
    return runWithContext({ requestId: cycleId, cycleId, kind: 'cron', job: 'payment-intent-confirmer' }, async () => {
      if (isRunning) return;
      isRunning = true;
      const startedAt = new Date();
      try {
        await confirmPendingPaymentIntents();
        await expireAllowanceReservations();
        recordCronRun('payment-intent-confirmer', 'success', startedAt, new Date());
      } catch (err) {
        recordCronRun('payment-intent-confirmer', 'failure', startedAt, new Date(), err);
        logger.error({ err }, 'Payment intent confirmer failed');
      } finally {
        isRunning = false;
      }
    });
  });
}
