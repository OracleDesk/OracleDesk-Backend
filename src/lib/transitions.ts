export const STATUS_TRANSITIONS = {
  signerAttestation: {
    PREPARED: ['SUBMITTED', 'FAILED'], SUBMITTED: ['CONFIRMED', 'FAILED'], FAILED: ['PREPARED'], CONFIRMED: [],
  },
  positionExit: {
    SUBMITTED: ['CONFIRMED', 'FAILED'], CONFIRMED: [], FAILED: [], SIMULATED: [],
  },
  adminOperation: {
    PREPARED: ['PARTIALLY_SIGNED', 'READY', 'EXPIRED', 'CANCELLED'],
    PARTIALLY_SIGNED: ['PARTIALLY_SIGNED', 'READY', 'EXPIRED', 'CANCELLED'],
    READY: ['SUBMITTED', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED'],
    SUBMITTED: ['SUCCESS', 'FAILED'], SUCCESS: [], FAILED: [], EXPIRED: [], CANCELLED: [],
  },
  disputeReview: {
    PENDING: ['AGREE', 'DISAGREE', 'INSUFFICIENT', 'ERROR'], ERROR: ['PENDING'],
    AGREE: [], DISAGREE: [], INSUFFICIENT: [],
  },
  alertDelivery: { FAILED: ['SENT', 'FAILED'], SENT: [] },
} as const;

export type TransitionModel = keyof typeof STATUS_TRANSITIONS;

export function canTransition(model: TransitionModel, from: string, to: string): boolean {
  return (STATUS_TRANSITIONS[model] as Record<string, readonly string[]>)[from]?.includes(to) ?? false;
}

/** Conditional update seam: callers provide their ORM's updateMany operation. */
export async function guardedTransition(
  model: TransitionModel,
  from: string,
  to: string,
  update: () => Promise<number>,
): Promise<boolean> {
  if (!canTransition(model, from, to)) return false;
  return (await update()) === 1;
}
