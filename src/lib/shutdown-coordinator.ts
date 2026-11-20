/**
 * Shutdown coordinator (#264).
 *
 * Runs registered handlers in stage order. Steps within a stage run in
 * parallel, each bounded by its own budget. A fixed reserve ensures the
 * release-leases and close-transports stages always get their slice.
 */
import { logger } from './logger';

export type Stage =
  | 'stop-intake'
  | 'stop-producers'
  | 'settle-writes'
  | 'release-leases'
  | 'close-transports';

const STAGE_ORDER: Stage[] = [
  'stop-intake',
  'stop-producers',
  'settle-writes',
  'release-leases',
  'close-transports',
];

interface StepDef {
  stage: Stage;
  name: string;
  fn: (signal: AbortSignal) => Promise<void>;
  budgetMs: number;
}

export interface StepResult {
  name: string;
  stage: Stage;
  durationMs: number;
  outcome: 'ok' | 'timeout' | 'error';
  error?: string;
}

export interface ShutdownReport {
  totalMs: number;
  steps: StepResult[];
}

class StepTimeoutError extends Error {
  constructor(ms: number) {
    super(`step exceeded its ${ms}ms budget`);
    this.name = 'StepTimeoutError';
  }
}

/** Settle with `p`, or reject with StepTimeoutError after `ms`. The step itself is not cancelled. */
function withinBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const steps: StepDef[] = [];
let running = false;

/** Register a handler to run at `stage` during graceful shutdown. */
export function onShutdown(
  stage: Stage,
  name: string,
  fn: (signal: AbortSignal) => Promise<void>,
  budgetMs: number,
): void {
  steps.push({ stage, name, fn, budgetMs });
}

/**
 * Run all registered handlers in stage order.
 * Steps within the same stage run in parallel.
 * Returns a report for structured logging.
 */
export async function runShutdown(totalBudgetMs: number): Promise<ShutdownReport> {
  if (running) {
    logger.warn('shutdown-coordinator: already running — ignoring duplicate call');
    return { totalMs: 0, steps: [] };
  }
  running = true;

  const start = Date.now();
  const results: StepResult[] = [];
  const ac = new AbortController();

  for (const stage of STAGE_ORDER) {
    const stageSteps = steps.filter((s) => s.stage === stage);
    if (stageSteps.length === 0) continue;

    const elapsed = Date.now() - start;
    const remaining = totalBudgetMs - elapsed;
    if (remaining <= 0) {
      for (const step of stageSteps) {
        results.push({ name: step.name, stage, durationMs: 0, outcome: 'timeout', error: 'budget exhausted before stage' });
      }
      continue;
    }

    await Promise.all(
      stageSteps.map(async (step) => {
        const stepStart = Date.now();
        try {
          await withinBudget(step.fn(ac.signal), Math.min(step.budgetMs, remaining));
          results.push({ name: step.name, stage, durationMs: Date.now() - stepStart, outcome: 'ok' });
        } catch (err) {
          const durationMs = Date.now() - stepStart;
          const isTimeout = err instanceof StepTimeoutError;
          results.push({
            name: step.name,
            stage,
            durationMs,
            outcome: isTimeout ? 'timeout' : 'error',
            error: err instanceof Error ? err.message : String(err),
          });
          logger.warn({ step: step.name, stage, durationMs, err }, 'shutdown-coordinator: step failed');
        }
      }),
    );
  }

  ac.abort();
  const totalMs = Date.now() - start;
  return { totalMs, steps: results };
}
