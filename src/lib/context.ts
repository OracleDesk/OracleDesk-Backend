import { AsyncLocalStorage } from 'node:async_hooks';
import { v7 as uuidv7 } from 'uuid';
import { config } from '../config';

export type CallerClass = 'critical' | 'agent' | 'interactive' | 'public' | 'background';

export const CALLER_CLASSES: readonly CallerClass[] = [
  'critical',
  'agent',
  'interactive',
  'public',
  'background',
] as const;

export const CALLER_CLASS_RANK: Record<CallerClass, number> = {
  critical: 4,
  agent: 3,
  interactive: 2,
  public: 1,
  background: 0,
};

export function isHigherCallerClass(a: CallerClass, b: CallerClass): boolean {
  return CALLER_CLASS_RANK[a] > CALLER_CLASS_RANK[b];
}

export interface RequestContext {
  requestId: string;
  kind: 'http' | 'cron' | 'job' | 'indexer';
  cycleId?: string;
  jobId?: string;
  userId?: string;
  job?: string;
  /** RPC traffic priority class carried through AsyncLocalStorage (#300). */
  callerClass?: CallerClass;
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

/**
 * Run `fn` inside a nested context with the given RPC caller class (#300).
 * Never lowers an enclosing `critical` class so write-path simulations and
 * confirmations remain protected even when calling shared helpers.
 */
export function withCallerClass<T>(cls: CallerClass, fn: () => T): T {
  const parent = als.getStore();
  const effective: CallerClass = parent?.callerClass === 'critical' ? 'critical' : cls;
  if (parent) {
    return als.run({ ...parent, callerClass: effective }, fn);
  }
  return als.run(
    {
      requestId: newId('job'),
      kind: 'job',
      callerClass: effective,
      startedAt: Date.now(),
    },
    fn,
  );
}

/**
 * Effective RPC caller class for the current async context (#300).
 * Defaults by context kind when no explicit class is set:
 *   http -> interactive (when authenticated) | public
 *   cron | job | indexer -> background
 */
export function currentCallerClass(): CallerClass {
  const ctx = als.getStore();
  if (!ctx) return 'background';
  if (ctx.callerClass) {
    if (ctx.kind === 'http' && ctx.userId && ctx.callerClass === 'public') {
      return 'interactive';
    }
    return ctx.callerClass;
  }
  if (ctx.kind === 'http') {
    return ctx.userId ? 'interactive' : 'public';
  }
  return 'background';
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

// ─── Active Advisory Lock Tracking (#305) ───────────────────────────────────

const activeLockAls = new AsyncLocalStorage<readonly string[]>();

/** Runs `fn` with the currently held advisory-lock keys recorded in ALS. */
export function withActiveLockContext<T>(keys: readonly string[], fn: () => T): T {
  const existing = activeLockAls.getStore();
  const merged = existing ? [...existing, ...keys] : [...keys];
  return activeLockAls.run(merged, fn);
}

/** Advisory-lock keys held by the current async execution, if any. */
export function activeLockKeys(): readonly string[] | undefined {
  return activeLockAls.getStore();
}

/** True when the current async execution holds a payment advisory lock (`payment:*`). */
export function isInPaymentLock(): boolean {
  const keys = activeLockAls.getStore();
  if (!keys) return false;
  return keys.some((k) => k.startsWith('payment:'));
}
