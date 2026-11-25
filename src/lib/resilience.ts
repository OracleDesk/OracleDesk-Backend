import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { config } from '../config';
import { logger } from './logger';
import { AppError } from '../middlewares/error.middleware';
import { CALLER_CLASSES, currentCallerClass, type CallerClass } from './context';

export type Dependency =
  | 'rpc-read'
  | 'rpc-write'
  | 'rpc-confirm'
  | 'rpc-events'
  | 'llm'
  | 'ipfs-pin'
  | 'ipfs-fetch'
  | 'datasource';

export interface ClassPolicy {
  weight: number;
  reserved: number;
  maxQueue: number;
  maxWaitMs: number;
}

export interface ClassBulkheadStats {
  active: number;
  queued: number;
  rejected: number;
  shed: number;
  p50WaitMs: number;
  p99WaitMs: number;
}

export interface BulkheadStats {
  active: number;
  queued: number;
  rejected: number;
  shed: number;
  byClass: Record<CallerClass, ClassBulkheadStats>;
}

export class TimeoutError extends AppError {
  constructor(public readonly dependency: Dependency, public readonly timeoutMs: number) {
    super(504, 'UPSTREAM_TIMEOUT', `${dependency} timed out after ${timeoutMs}ms`, {
      dependency,
      timeoutMs,
    });
    this.name = 'TimeoutError';
  }
}

export class SaturatedError extends AppError {
  public readonly callerClass?: CallerClass;
  public readonly retryAfter?: number;

  constructor(
    public readonly dependency: Dependency,
    extra?: { callerClass?: CallerClass; retryAfter?: number },
  ) {
    const details: Record<string, unknown> = { dependency };
    if (extra?.callerClass) details.class = extra.callerClass;
    if (extra?.retryAfter !== undefined) details.retryAfter = extra.retryAfter;
    super(503, 'UPSTREAM_SATURATED', `${dependency} bulkhead saturated`, details);
    this.name = 'SaturatedError';
    this.callerClass = extra?.callerClass;
    this.retryAfter = extra?.retryAfter;
  }
}

export class ClientAbortedError extends AppError {
  constructor(message = 'Client aborted request') {
    super(499, 'CLIENT_ABORTED', message);
    this.name = 'ClientAbortedError';
  }
}

export function getDefaultTimeout(dep: Dependency): number {
  switch (dep) {
    case 'rpc-read':
      return config.TIMEOUT_RPC_READ_MS;
    case 'rpc-write':
      return config.TIMEOUT_RPC_WRITE_MS;
    case 'rpc-confirm':
      return config.TIMEOUT_RPC_CONFIRM_MS;
    case 'rpc-events':
      return config.TIMEOUT_RPC_EVENTS_MS;
    case 'llm':
      return config.TIMEOUT_LLM_MS;
    case 'ipfs-pin':
      return config.TIMEOUT_IPFS_PIN_MS;
    case 'ipfs-fetch':
      return config.TIMEOUT_IPFS_FETCH_MS;
    case 'datasource':
      return config.TIMEOUT_DATASOURCE_MS;
  }
}

export interface DeadlineHandle {
  signal: AbortSignal;
  ms: number;
  remaining(): number;
  cleanup?: () => void;
}

export function deadline(
  dep: Dependency,
  parent?: AbortSignal,
  overrideMs?: number,
): DeadlineHandle {
  const ms = overrideMs ?? getDefaultTimeout(dep);
  const start = Date.now();
  const controller = new AbortController();

  const remaining = () => Math.max(0, ms - (Date.now() - start));

  let timer: NodeJS.Timeout | null = null;
  let onParentAbort: (() => void) | null = null;

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (parent && onParentAbort) {
      parent.removeEventListener('abort', onParentAbort);
      onParentAbort = null;
    }
  };

  if (parent?.aborted) {
    controller.abort(parent.reason ?? new ClientAbortedError());
    return { signal: controller.signal, ms, remaining, cleanup };
  }

  timer = setTimeout(() => {
    controller.abort(new TimeoutError(dep, ms));
  }, ms);

  if (parent) {
    onParentAbort = () => {
      cleanup();
      controller.abort(parent.reason ?? new ClientAbortedError());
    };
    parent.addEventListener('abort', onParentAbort, { once: true });
  }

  return {
    signal: controller.signal,
    ms,
    remaining,
    cleanup,
  };
}

// ─── Bulkhead Slot & Load-Start Tracking (#300) ─────────────────────────────

const bulkheadSlotAls = new AsyncLocalStorage<{ dependency: Dependency; slotActive: boolean }>();

/** True when the current async execution holds an active bulkhead slot. */
export function isInsideBulkhead(): boolean {
  return bulkheadSlotAls.getStore()?.slotActive === true;
}

export interface LoadTracker {
  started: boolean;
}

const loadTrackerAls = new AsyncLocalStorage<LoadTracker>();

/**
 * Attaches a tracker to the current async execution so callers (such as
 * `chain-cache.ts`) can observe whether a load is still queued in a bulkhead
 * or has started executing.
 */
export function withLoadTracker<T>(tracker: LoadTracker, fn: () => T): T {
  return loadTrackerAls.run(tracker, fn);
}

// ─── Class Policy Configuration & Validation (#300) ─────────────────────────

const DEPENDENCIES: readonly Dependency[] = [
  'rpc-read',
  'rpc-write',
  'rpc-confirm',
  'rpc-events',
  'llm',
  'ipfs-pin',
  'ipfs-fetch',
  'datasource',
] as const;

const classPolicyPatchSchema = z
  .object({
    weight: z.number().positive().optional(),
    reserved: z.number().int().min(0).optional(),
    maxQueue: z.number().int().min(0).optional(),
    maxWaitMs: z.number().positive().optional(),
  })
  .strict();

const CALLER_CLASS_SET = new Set<string>(CALLER_CLASSES);
const DEPENDENCY_SET = new Set<string>(DEPENDENCIES);

const perClassMapSchema = z
  .record(z.string(), classPolicyPatchSchema)
  .refine((obj) => Object.keys(obj).every((k) => CALLER_CLASS_SET.has(k)), {
    message: `Unknown caller class; expected one of: ${CALLER_CLASSES.join(', ')}`,
  });

const perDependencyMapSchema = z
  .record(z.string(), perClassMapSchema)
  .refine((obj) => Object.keys(obj).every((k) => DEPENDENCY_SET.has(k)), {
    message: `Unknown dependency; expected one of: ${DEPENDENCIES.join(', ')}`,
  });

export type PolicyOverrides = Partial<Record<Dependency, Partial<Record<CallerClass, Partial<ClassPolicy>>>>>;

export function parseClassPolicyOverrides(raw: string): PolicyOverrides {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid RPC_CLASS_POLICY_JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Invalid RPC_CLASS_POLICY_JSON: expected a JSON object');
  }
  const keys = Object.keys(json as Record<string, unknown>);
  if (keys.length === 0) return {};
  if (keys.every((k) => CALLER_CLASS_SET.has(k))) {
    const parsed = perClassMapSchema.parse(json);
    return { 'rpc-read': parsed as Partial<Record<CallerClass, Partial<ClassPolicy>>> };
  }
  const parsed = perDependencyMapSchema.parse(json);
  return parsed as PolicyOverrides;
}

function defaultUniformPolicies(maxQueue: number, maxWaitMs = Number.POSITIVE_INFINITY): Record<CallerClass, ClassPolicy> {
  return {
    critical: { weight: 8, reserved: 0, maxQueue, maxWaitMs },
    agent: { weight: 4, reserved: 0, maxQueue, maxWaitMs },
    interactive: { weight: 3, reserved: 0, maxQueue, maxWaitMs },
    public: { weight: 2, reserved: 0, maxQueue, maxWaitMs },
    background: { weight: 1, reserved: 0, maxQueue, maxWaitMs },
  };
}

export function defaultPoliciesFor(dep: Dependency, maxConcurrent: number, fallbackQueue: number): Record<CallerClass, ClassPolicy> {
  let base: Record<CallerClass, ClassPolicy>;
  switch (dep) {
    case 'rpc-read':
      base = {
        critical: { weight: 8, reserved: 4, maxQueue: fallbackQueue, maxWaitMs: 15_000 },
        agent: { weight: 4, reserved: 3, maxQueue: Math.min(24, fallbackQueue), maxWaitMs: 15_000 },
        interactive: { weight: 3, reserved: 2, maxQueue: Math.min(16, fallbackQueue), maxWaitMs: 10_000 },
        public: { weight: 2, reserved: 0, maxQueue: 8, maxWaitMs: 5_000 },
        background: { weight: 1, reserved: 0, maxQueue: 8, maxWaitMs: 30_000 },
      };
      break;
    case 'rpc-write':
      base = {
        critical: { weight: 8, reserved: Math.max(0, maxConcurrent - 1), maxQueue: fallbackQueue, maxWaitMs: 30_000 },
        agent: { weight: 4, reserved: 0, maxQueue: Math.min(16, fallbackQueue), maxWaitMs: 20_000 },
        interactive: { weight: 2, reserved: 0, maxQueue: 8, maxWaitMs: 10_000 },
        public: { weight: 1, reserved: 0, maxQueue: 4, maxWaitMs: 5_000 },
        background: { weight: 1, reserved: 0, maxQueue: 4, maxWaitMs: 15_000 },
      };
      break;
    case 'rpc-confirm':
      base = {
        critical: { weight: 8, reserved: Math.min(5, Math.max(0, maxConcurrent - 1)), maxQueue: fallbackQueue, maxWaitMs: 15_000 },
        agent: { weight: 4, reserved: Math.min(2, Math.max(0, maxConcurrent - 6)), maxQueue: Math.min(24, fallbackQueue), maxWaitMs: 15_000 },
        interactive: { weight: 2, reserved: 0, maxQueue: 8, maxWaitMs: 10_000 },
        public: { weight: 1, reserved: 0, maxQueue: 4, maxWaitMs: 5_000 },
        background: { weight: 1, reserved: 0, maxQueue: 8, maxWaitMs: 30_000 },
      };
      break;
    default:
      base = defaultUniformPolicies(fallbackQueue, 60_000);
      break;
  }

  // Clamp reservations if an operator configured a small maxConcurrent.
  let remaining = maxConcurrent;
  for (const cls of CALLER_CLASSES) {
    const r = Math.min(base[cls].reserved, remaining);
    base[cls].reserved = r;
    remaining -= r;
  }
  return base;
}

// ─── Fixed-Size Reservoir for Percentiles ───────────────────────────────────

class SampleReservoir {
  private readonly samples: number[];
  private count = 0;
  private cursor = 0;

  constructor(private readonly capacity = 256) {
    this.samples = new Array<number>(capacity);
  }

  record(value: number): void {
    this.samples[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  percentile(p: number): number {
    if (this.count === 0) return 0;
    const slice = this.samples.slice(0, this.count).sort((a, b) => a - b);
    const idx = Math.min(slice.length - 1, Math.max(0, Math.ceil(p * slice.length) - 1));
    return Math.round(slice[idx]);
  }
}

// ─── Weighted Fair Bulkhead (#300) ──────────────────────────────────────────

interface QueueEntry {
  cls: CallerClass;
  enqueuedAt: number;
  resolve: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const CRITICAL_WAIT_WARN_MS = 250;
const CRITICAL_WAIT_WARN_INTERVAL_MS = 60_000;

export class Bulkhead {
  private activeCount = 0;
  private readonly policies: Record<CallerClass, ClassPolicy>;
  private readonly activeByClass: Record<CallerClass, number>;
  private readonly queues: Record<CallerClass, QueueEntry[]>;
  private readonly deficits: Record<CallerClass, number>;
  private readonly rejectedByClass: Record<CallerClass, number>;
  private readonly shedByClass: Record<CallerClass, number>;
  private readonly waitReservoirs: Record<CallerClass, SampleReservoir>;
  private readonly serviceTimeReservoir = new SampleReservoir(64);
  private readonly shedAfterMs: number;
  private rrIndex = 0;
  private saturatedSince: number | null = null;
  private pressureTimer: NodeJS.Timeout | null = null;
  private lastCriticalWaitWarnAt = 0;

  constructor(
    public readonly name: Dependency,
    public readonly maxConcurrent: number,
    policiesOrMaxQueue: number | Record<CallerClass, ClassPolicy>,
    opts?: { shedAfterMs?: number },
  ) {
    const rawPolicies =
      typeof policiesOrMaxQueue === 'number'
        ? defaultUniformPolicies(policiesOrMaxQueue)
        : policiesOrMaxQueue;

    this.policies = {
      critical: { ...rawPolicies.critical },
      agent: { ...rawPolicies.agent },
      interactive: { ...rawPolicies.interactive },
      public: { ...rawPolicies.public },
      background: { ...rawPolicies.background },
    };

    this.shedAfterMs = opts?.shedAfterMs ?? config.RPC_SHED_AFTER_MS;

    this.activeByClass = { critical: 0, agent: 0, interactive: 0, public: 0, background: 0 };
    this.queues = { critical: [], agent: [], interactive: [], public: [], background: [] };
    this.deficits = { critical: 0, agent: 0, interactive: 0, public: 0, background: 0 };
    this.rejectedByClass = { critical: 0, agent: 0, interactive: 0, public: 0, background: 0 };
    this.shedByClass = { critical: 0, agent: 0, interactive: 0, public: 0, background: 0 };
    this.waitReservoirs = {
      critical: new SampleReservoir(),
      agent: new SampleReservoir(),
      interactive: new SampleReservoir(),
      public: new SampleReservoir(),
      background: new SampleReservoir(),
    };
  }

  stats(): BulkheadStats {
    let totalQueued = 0;
    let totalRejected = 0;
    let totalShed = 0;
    const byClass = {} as Record<CallerClass, ClassBulkheadStats>;

    for (const cls of CALLER_CLASSES) {
      const q = this.queues[cls].length;
      const rej = this.rejectedByClass[cls];
      const sh = this.shedByClass[cls];
      totalQueued += q;
      totalRejected += rej;
      totalShed += sh;
      byClass[cls] = {
        active: this.activeByClass[cls],
        queued: q,
        rejected: rej,
        shed: sh,
        p50WaitMs: this.waitReservoirs[cls].percentile(0.5),
        p99WaitMs: this.waitReservoirs[cls].percentile(0.99),
      };
    }

    return {
      active: this.activeCount,
      queued: totalQueued,
      rejected: totalRejected,
      shed: totalShed,
      byClass,
    };
  }

  private canAdmit(cls: CallerClass): boolean {
    if (this.activeCount >= this.maxConcurrent) return false;
    if (this.activeByClass[cls] < this.policies[cls].reserved) return true;

    let otherReserved = 0;
    for (const other of CALLER_CLASSES) {
      if (other === cls) continue;
      const remaining = this.policies[other].reserved - this.activeByClass[other];
      if (remaining > 0) otherReserved += remaining;
    }
    return this.activeCount < this.maxConcurrent - otherReserved;
  }

  private estimateWaitMs(cls: CallerClass): number {
    const p50Service = this.serviceTimeReservoir.percentile(0.5);
    if (p50Service <= 0) return 0;

    let totalWeight = 0;
    for (const c of CALLER_CLASSES) {
      if (c === cls || this.activeByClass[c] > 0 || this.queues[c].length > 0) {
        totalWeight += this.policies[c].weight;
      }
    }
    const share = totalWeight > 0 ? this.policies[cls].weight / totalWeight : 1;
    const effectiveSlots = Math.max(0.1, this.maxConcurrent * share);
    return ((this.queues[cls].length + 1) * p50Service) / effectiveSlots;
  }

  private retryAfterSeconds(cls: CallerClass, estimatedWaitMs: number): number {
    if (estimatedWaitMs > 0) {
      return Math.max(1, Math.ceil(estimatedWaitMs / 1000));
    }
    const p50Service = this.serviceTimeReservoir.percentile(0.5) || 1000;
    const q = Math.max(1, this.queues[cls].length);
    return Math.max(1, Math.ceil((q * p50Service) / (1000 * Math.max(1, this.maxConcurrent))));
  }

  private updatePressureState(): void {
    if (this.activeCount >= this.maxConcurrent) {
      if (this.saturatedSince === null) {
        this.saturatedSince = Date.now();
        if (this.shedAfterMs === 0) {
          this.shedUnderPressure();
        } else if (!this.pressureTimer) {
          this.pressureTimer = setTimeout(() => {
            this.pressureTimer = null;
            this.shedUnderPressure();
          }, this.shedAfterMs);
          if (typeof this.pressureTimer.unref === 'function') {
            this.pressureTimer.unref();
          }
        }
      } else if (Date.now() - this.saturatedSince >= this.shedAfterMs) {
        this.shedUnderPressure();
      }
    } else {
      this.saturatedSince = null;
      if (this.pressureTimer) {
        clearTimeout(this.pressureTimer);
        this.pressureTimer = null;
      }
    }
  }

  /**
   * Under sustained saturation (`active === maxConcurrent` for longer than
   * `RPC_SHED_AFTER_MS`), proactively drop queued `background` and then
   * `public` callers with `SaturatedError` so higher classes stay responsive.
   */
  private shedUnderPressure(): void {
    if (this.activeCount < this.maxConcurrent || this.saturatedSince === null) return;
    if (Date.now() - this.saturatedSince < this.shedAfterMs) return;

    for (const cls of ['background', 'public'] as const) {
      const queue = this.queues[cls];
      if (queue.length === 0) continue;
      const dropped = queue.splice(0, queue.length);
      this.deficits[cls] = 0;
      const retryAfter = this.retryAfterSeconds(cls, this.estimateWaitMs(cls));
      for (const entry of dropped) {
        if (entry.signal && entry.onAbort) {
          entry.signal.removeEventListener('abort', entry.onAbort);
        }
        if (entry.signal?.aborted) continue;
        this.shedByClass[cls]++;
        entry.reject(new SaturatedError(this.name, { callerClass: cls, retryAfter }));
      }
    }
  }

  private recordWait(cls: CallerClass, waitMs: number): void {
    this.waitReservoirs[cls].record(waitMs);
    if (cls === 'critical' && waitMs > CRITICAL_WAIT_WARN_MS) {
      const now = Date.now();
      if (now - this.lastCriticalWaitWarnAt >= CRITICAL_WAIT_WARN_INTERVAL_MS) {
        this.lastCriticalWaitWarnAt = now;
        logger.warn(
          {
            dependency: this.name,
            waitMs: Math.round(waitMs),
            active: this.activeCount,
            queued: CALLER_CLASSES.reduce((acc, c) => acc + this.queues[c].length, 0),
          },
          'critical RPC caller waited more than 250ms for a bulkhead slot',
        );
      }
    }
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      throw signal.reason instanceof AppError ? signal.reason : new ClientAbortedError();
    }

    const cls = currentCallerClass();
    const policy = this.policies[cls];

    if (this.canAdmit(cls)) {
      this.activeCount++;
      this.activeByClass[cls]++;
      this.recordWait(cls, 0);
      this.updatePressureState();
    } else {
      // Proactive pressure check before deciding whether to queue.
      this.updatePressureState();

      if (
        (cls === 'background' || cls === 'public') &&
        this.activeCount >= this.maxConcurrent &&
        this.saturatedSince !== null &&
        Date.now() - this.saturatedSince >= this.shedAfterMs
      ) {
        this.shedByClass[cls]++;
        throw new SaturatedError(this.name, {
          callerClass: cls,
          retryAfter: this.retryAfterSeconds(cls, this.estimateWaitMs(cls)),
        });
      }

      // Queue capacity check.
      if (this.queues[cls].length >= policy.maxQueue) {
        this.rejectedByClass[cls]++;
        throw new SaturatedError(this.name, {
          callerClass: cls,
          retryAfter: this.retryAfterSeconds(cls, this.estimateWaitMs(cls)),
        });
      }

      // Estimated wait-time shedding (critical is never shed by lower classes' pressure).
      if (cls !== 'critical' && Number.isFinite(policy.maxWaitMs)) {
        const estimated = this.estimateWaitMs(cls);
        if (estimated > policy.maxWaitMs) {
          this.rejectedByClass[cls]++;
          throw new SaturatedError(this.name, {
            callerClass: cls,
            retryAfter: this.retryAfterSeconds(cls, estimated),
          });
        }
      }

      const enqueuedAt = Date.now();
      await new Promise<void>((resolve, reject) => {
        let entry: QueueEntry;
        const onAbort = () => {
          const queue = this.queues[cls];
          const idx = queue.indexOf(entry);
          if (idx !== -1) {
            queue.splice(idx, 1);
            if (queue.length === 0) this.deficits[cls] = 0;
          }
          reject(signal?.reason instanceof AppError ? signal.reason : new ClientAbortedError());
        };

        entry = { cls, enqueuedAt, resolve, reject, signal, onAbort };
        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
        }
        this.queues[cls].push(entry);
      });

      this.recordWait(cls, Date.now() - enqueuedAt);
    }

    const serviceStart = Date.now();
    try {
      if (signal?.aborted) {
        throw signal.reason instanceof AppError ? signal.reason : new ClientAbortedError();
      }
      const tracker = loadTrackerAls.getStore();
      if (tracker) tracker.started = true;
      return await bulkheadSlotAls.run({ dependency: this.name, slotActive: true }, fn);
    } finally {
      this.serviceTimeReservoir.record(Math.max(1, Date.now() - serviceStart));
      this.activeCount--;
      this.activeByClass[cls]--;
      this.updatePressureState();
      this.dequeueNext();
    }
  }

  private popValid(cls: CallerClass): QueueEntry | null {
    const queue = this.queues[cls];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      if (next.signal?.aborted) continue;
      if (queue.length === 0) this.deficits[cls] = 0;
      return next;
    }
    this.deficits[cls] = 0;
    return null;
  }

  private dequeueNext(): void {
    while (this.activeCount < this.maxConcurrent) {
      // Collect admissible classes that have waiting entries.
      const candidates: CallerClass[] = [];
      for (const cls of CALLER_CLASSES) {
        if (this.queues[cls].length > 0 && this.canAdmit(cls)) {
          candidates.push(cls);
        }
      }
      if (candidates.length === 0) break;

      // Ensure at least one admissible candidate has deficit >= 1 (DRR quantum refill).
      let hasPositiveDeficit = candidates.some((cls) => this.deficits[cls] >= 1);
      if (!hasPositiveDeficit) {
        for (const cls of candidates) {
          this.deficits[cls] += this.policies[cls].weight;
        }
      }

      // Deficit round-robin selection across CALLER_CLASSES.
      let picked: QueueEntry | null = null;
      for (let i = 0; i < CALLER_CLASSES.length; i++) {
        const idx = (this.rrIndex + i) % CALLER_CLASSES.length;
        const cls = CALLER_CLASSES[idx];
        if (this.queues[cls].length === 0 || !this.canAdmit(cls)) continue;
        if (this.deficits[cls] < 1) continue;

        const entry = this.popValid(cls);
        if (entry) {
          this.deficits[cls] = Math.max(0, this.deficits[cls] - 1);
          this.rrIndex = (idx + 1) % CALLER_CLASSES.length;
          picked = entry;
          break;
        }
      }

      if (!picked) {
        // Every popped item was aborted; loop to check remaining candidates.
        continue;
      }

      this.activeCount++;
      this.activeByClass[picked.cls]++;
      this.updatePressureState();
      picked.resolve();
    }
  }
}

function buildBulkheads(): Record<Dependency, Bulkhead> {
  const overrides: PolicyOverrides = config.RPC_CLASS_POLICY_JSON
    ? parseClassPolicyOverrides(config.RPC_CLASS_POLICY_JSON)
    : {};

  const maxConcurrency: Record<Dependency, number> = {
    'llm': config.BULKHEAD_LLM,
    'ipfs-pin': config.BULKHEAD_IPFS,
    'ipfs-fetch': config.BULKHEAD_IPFS,
    'rpc-read': config.BULKHEAD_RPC_READ,
    'rpc-write': config.BULKHEAD_RPC_WRITE,
    'rpc-confirm': config.BULKHEAD_RPC_CONFIRM,
    'rpc-events': config.BULKHEAD_RPC_EVENTS,
    'datasource': config.BULKHEAD_DATASOURCE,
  };

  const result = {} as Record<Dependency, Bulkhead>;
  for (const dep of DEPENDENCIES) {
    const maxConc = maxConcurrency[dep];
    const policies = defaultPoliciesFor(dep, maxConc, config.BULKHEAD_QUEUE);
    const depOverride = overrides[dep];
    if (depOverride) {
      for (const cls of CALLER_CLASSES) {
        const patch = depOverride[cls];
        if (patch) {
          policies[cls] = { ...policies[cls], ...patch };
        }
      }
      // Validate total reserved does not exceed maxConcurrent.
      const totalReserved = CALLER_CLASSES.reduce((sum, cls) => sum + policies[cls].reserved, 0);
      if (totalReserved > maxConc) {
        throw new Error(
          `RPC_CLASS_POLICY_JSON invalid for ${dep}: sum of reserved slots (${totalReserved}) exceeds maxConcurrent (${maxConc})`,
        );
      }
    }
    result[dep] = new Bulkhead(dep, maxConc, policies, { shedAfterMs: config.RPC_SHED_AFTER_MS });
  }
  return result;
}

export const bulkheads: Record<Dependency, Bulkhead> = buildBulkheads();

export function getBulkheadStats(): Record<Dependency, BulkheadStats> {
  const out = {} as Record<Dependency, BulkheadStats>;
  for (const dep of DEPENDENCIES) {
    out[dep] = bulkheads[dep].stats();
  }
  return out;
}

export async function withTimeout<T>(
  dep: Dependency,
  fn: (signal: AbortSignal) => Promise<T>,
  opts?: { signal?: AbortSignal; ms?: number },
): Promise<T> {
  const bulkhead = bulkheads[dep];

  return bulkhead.run(async () => {
    const handle = deadline(dep, opts?.signal, opts?.ms);
    try {
      return await fn(handle.signal);
    } catch (err: any) {
      if (opts?.signal?.aborted) {
        if (err instanceof ClientAbortedError) throw err;
        throw new ClientAbortedError(err?.message ?? 'Client aborted request');
      }
      if (handle.signal.aborted) {
        if (handle.signal.reason instanceof TimeoutError) {
          throw handle.signal.reason;
        }
        if (err instanceof TimeoutError) {
          throw err;
        }
        if (
          err?.name === 'AbortError' ||
          err?.code === 'ERR_ABORTED' ||
          err?.message?.includes('aborted') ||
          err?.message?.includes('timeout')
        ) {
          throw new TimeoutError(dep, handle.ms);
        }
      }
      throw err;
    } finally {
      handle.cleanup?.();
    }
  }, opts?.signal);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    const reason = signal.reason instanceof AppError ? signal.reason : new ClientAbortedError();
    return Promise.reject(reason);
  }
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const onAbort = () => {
      clearTimeout(timer);
      const reason = signal!.reason instanceof AppError ? signal.reason : new ClientAbortedError();
      reject(reason);
    };
    timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
