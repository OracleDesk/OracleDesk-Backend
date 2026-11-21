export type MarketOutcomeStatus = 'DONE' | 'SKIPPED_DEADLINE' | 'ABORTED' | 'FAILED';

export interface MarketTask {
  marketId: string;
  deadlineAt: number;
}

export interface MarketOutcome {
  marketId: string;
  status: MarketOutcomeStatus;
  elapsedMs: number;
  error?: string;
}

export interface SchedulerOptions {
  concurrency: number;
  signal?: AbortSignal;
  now?: () => number;
}

/** Runs market analysis concurrently, while leaving commits to the caller. */
export async function runMarketAnalyses<T>(
  tasks: MarketTask[],
  analyze: (task: MarketTask, signal: AbortSignal) => Promise<T>,
  options: SchedulerOptions,
): Promise<Array<MarketOutcome & { value?: T }>> {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const now = options.now ?? Date.now;
  const results: Array<MarketOutcome & { value?: T }> = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++];
      const started = now();
      if (options.signal?.aborted || started >= task.deadlineAt) {
        results.push({ marketId: task.marketId, status: 'SKIPPED_DEADLINE', elapsedMs: 0 });
        continue;
      }
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort('market deadline'), Math.max(0, task.deadlineAt - started));
      try {
        const value = await analyze(task, controller.signal);
        results.push({ marketId: task.marketId, status: 'DONE', elapsedMs: now() - started, value });
      } catch (err) {
        const aborted = controller.signal.aborted;
        results.push({
          marketId: task.marketId,
          status: aborted ? 'ABORTED' : 'FAILED',
          elapsedMs: now() - started,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results.sort((a, b) => tasks.findIndex((t) => t.marketId === a.marketId) - tasks.findIndex((t) => t.marketId === b.marketId));
}
