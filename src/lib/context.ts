import { AsyncLocalStorage } from 'node:async_hooks';
import { v7 as uuidv7 } from 'uuid';
import { config } from '../config';

export interface RequestContext {
  requestId: string;
  kind: 'http' | 'cron' | 'job' | 'indexer';
  cycleId?: string;
  jobId?: string;
  userId?: string;
  job?: string;
  /**
   * Inbound `X-Request-Id` from the client, retained for log search only.
   * The durable `requestId` above is always server-generated (#236), so an
   * untrusted inbound id is never written to a database column.
   */
  clientRequestId?: string;
  /**
   * The root of the correlation chain when a worker resumes work another
   * cycle or request created. Workers set this to the row's `correlationId`
   * so logs can be joined back to the originating cycle/request even after
   * the resume has moved to its own `requestId`.
   */
  rootCorrelationId?: string;
  startedAt: number;
}

export interface Durable {
  correlationId: string | null;
  causationId: string | null;
}

/**
 * The correlation pair to stamp onto a durable row created in the current
 * context. `correlationId` is the root of the chain (`cycleId` for cron
 * work, the server-generated `requestId` for HTTP; never the inbound
 * `clientRequestId`); `causationId` is the immediate parent record or job.
 */
export function durableCorrelation(causation?: string | null): Durable {
  const ctx = als.getStore();
  if (!ctx) return { correlationId: null, causationId: causation ?? null };
  const correlationId = ctx.cycleId ?? ctx.rootCorrelationId ?? ctx.requestId;
  return { correlationId, causationId: causation ?? ctx.jobId ?? null };
}

/**
 * Run `fn` with a fresh context that resumes work another request/cycle
 * created. The row's `correlationId` becomes the root; `fn` runs under its
 * own `requestId` so its logs are distinguishable from the originator, but
 * `rootCorrelationId` keeps a database join back to it.
 */
export function resumeContext<T>(
  row: { id: string; correlationId: string | null },
  job: string,
  fn: () => T,
): T {
  const rootCorrelationId = row.correlationId ?? undefined;
  const cycleId = rootCorrelationId?.startsWith('cyc_') ? rootCorrelationId : undefined;
  return runWithContext(
    {
      kind: 'job',
      job,
      requestId: newId('job'),
      cycleId,
      jobId: row.id,
      rootCorrelationId,
    },
    fn,
  );
}

const als = new AsyncLocalStorage<RequestContext>();

/** The context of the current request, cron tick, poll or job, if any. */
export function currentContext(): RequestContext | undefined {
  return als.getStore();
}

/** Re-enter an existing context object (e.g. after a library dropped it). */
export function runInContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/**
 * Run `fn` with a fresh context. The store object is shared by everything
 * running inside, so auth middleware may set `userId` on it; each call gets
 * its own object, so nothing leaks across requests.
 */
export function runWithContext<T>(ctx: Omit<RequestContext, 'startedAt'>, fn: () => T): T {
  return als.run({ ...ctx, startedAt: Date.now() }, fn);
}

/** Time-sortable id (uuid v7), e.g. `req_018f...`. */
export function newId(prefix: 'req' | 'cyc' | 'job'): string {
  return `${prefix}_${uuidv7()}`;
}

/** The ids to stamp onto log lines and AgentLog rows. */
export function correlation(): {
  requestId?: string;
  cycleId?: string;
  jobId?: string;
  clientRequestId?: string;
  rootCorrelationId?: string;
} {
  const ctx = als.getStore();
  if (!ctx) return {};
  return {
    requestId: ctx.requestId,
    ...(ctx.cycleId ? { cycleId: ctx.cycleId } : {}),
    ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
    ...(ctx.clientRequestId ? { clientRequestId: ctx.clientRequestId } : {}),
    ...(ctx.rootCorrelationId ? { rootCorrelationId: ctx.rootCorrelationId } : {}),
  };
}

/**
 * Run a fire-and-forget task in a child context: it keeps the originating
 * requestId (if any) and adds `extra`, so it stays correlated after the
 * response has finished.
 */
export function bindDetached<T>(fn: () => Promise<T>, extra: Partial<Omit<RequestContext, 'startedAt'>> = {}): Promise<T> {
  const parent = als.getStore();
  return runWithContext(
    {
      kind: 'job',
      requestId: parent?.requestId ?? newId('req'),
      cycleId: parent?.cycleId,
      userId: parent?.userId,
      ...extra,
    },
    fn,
  );
}

const INBOUND_ID = /^[A-Za-z0-9._:-]{8,64}$/;

/**
 * Accept an inbound X-Request-Id only if it is well formed. The caller must
 * never log a rejected value (log injection); log only its length.
 */
export function acceptInboundId(value: string | undefined): string | undefined {
  if (!config.TRUST_INBOUND_REQUEST_ID || !value) return undefined;
  return INBOUND_ID.test(value) ? value : undefined;
}
