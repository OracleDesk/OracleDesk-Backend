/**
 * Shared LLM guards (#71, #327): per-purpose-class daily token/cost budgets
 * (guaranteed shares, hard caps, borrowing), per-provider rate limiting with
 * protected bucket slices for time-critical dispute reviews, deadline-aware
 * acquisition, and tier-fair circuit breaking across every instance.
 *
 *   const lease = await acquire('anthropic', ctx, estimate);
 *   ... call the provider ...
 *   await record(lease, usage, 'ok');
 *
 * `withLease` wraps that pair. Reservations are released in `record`, also on
 * errors and responses without usage metadata; a lease that is never recorded
 * is reclaimed by the next `acquire` once its TTL passes.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { AppError } from '../middlewares/error.middleware';
import { logger } from './logger';
import { getRedis } from './redis';
import { nowMs, sleep as clockSleep } from './clock';
import {
  DEFAULT_CLASS_POLICY,
  MemoryGuardStore,
  PROVIDERS,
  PURPOSE_CLASSES,
  RedisGuardStore,
  checkClassAdmission,
  type AcquireResult,
  type BreakerState,
  type BudgetRejectReason,
  type CallOutcome,
  type ClassPolicy,
  type ClassPolicyMap,
  type ClassUsage,
  type LlmGuardStore,
  type Priority,
  type Provider,
  type PurposeClass,
  type UsageSnapshot,
} from './llm-budget-store';

export type {
  BreakerState,
  BudgetRejectReason,
  CallOutcome,
  ClassPolicy,
  ClassPolicyMap,
  ClassUsage,
  LlmGuardStore,
  Priority,
  Provider,
  PurposeClass,
  UsageSnapshot,
};
export {
  DEFAULT_CLASS_POLICY,
  MemoryGuardStore,
  PROVIDERS,
  PURPOSE_CLASSES,
  RedisGuardStore,
  checkClassAdmission,
};

export interface CallContext {
  /** e.g. dispute_review, market_generation, forecast, trace_hedge, admin_generation */
  purpose: string;
  priority: Priority;
  /** Optional wall-clock deadline (epoch ms) for deadline-aware waiting (#327). */
  deadlineMs?: number;
}

export const DEFAULT_CALL_CONTEXT: CallContext = { purpose: 'unspecified', priority: 'cron' };

export const PURPOSE_CLASS: Record<string, PurposeClass> = {
  dispute_review: 'dispute',
  admin_generation: 'admin',
  admin_trace_hedge: 'admin',
  eval: 'admin',
  market_generation: 'generation',
  forecast: 'forecast',
  trace_hedge: 'hedge',
};

/** Maps a CallContext to its PurposeClass; priority 'admin' maps to 'admin' and unknown purposes to 'other'. */
export function classOf(ctx: CallContext): PurposeClass {
  const mapped = PURPOSE_CLASS[ctx.purpose];
  if (mapped) return mapped;
  if (ctx.priority === 'admin') return 'admin';
  return 'other';
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface Lease {
  id: string;
  provider: Provider;
  ctx: CallContext;
  purposeClass: PurposeClass;
  day: string;
  estimate: number;
  probe: boolean;
  /** Acquired from the in-process fallback limiter (Redis down, fail-open). */
  local: boolean;
}

export class LlmBudgetExceeded extends AppError {
  constructor(details: Record<string, unknown> = {}) {
    super(429, 'LLM_BUDGET_EXCEEDED', 'Daily LLM budget exhausted', details);
    this.name = 'LlmBudgetExceeded';
  }
}

export class LlmCircuitOpen extends AppError {
  constructor(details: Record<string, unknown> = {}) {
    super(503, 'LLM_CIRCUIT_OPEN', 'LLM provider circuit is open', details);
    this.name = 'LlmCircuitOpen';
  }
}

/**
 * LLM prices live in `./llm/prices.ts` as versioned tables (#238). `LLM_PRICES`
 * is kept for backwards compatibility with existing callers; new code should
 * import `priceFor` from the versioned module so stored costs carry a
 * `priceVersion` label.
 */
import { CURRENT_PRICE_VERSION, PRICE_TABLES, priceFor } from './llm/prices';

export const LLM_PRICES: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  ...PRICE_TABLES[CURRENT_PRICE_VERSION],
};

export function estimateCostMicros(usage: Usage | null): number {
  if (!usage) return 0;
  const price = priceFor(usage.model);
  return Math.ceil((usage.inputTokens * price.inputPer1k + usage.outputTokens * price.outputPer1k) / 1000);
}

/** Tokens to reserve before a call: ~4 chars per input token plus the output cap. */
export function estimateTokens(prompts: { system: string; user: string }, maxTokens: number): number {
  return Math.ceil((prompts.system.length + prompts.user.length) / 4) + maxTokens;
}

// ─── Settings (from config; overridable in tests) ─────────────────────────────

export interface GuardSettings {
  tokenBudget: number;
  costBudgetMicros: number;
  /** @deprecated Mapped onto classPolicy.admin.guaranteePct (#327). */
  reservePct: number;
  classPolicy: ClassPolicyMap;
  rpm: Record<Provider, number>;
  failureThreshold: number;
  openMs: number;
  failMode: 'closed' | 'open';
  /** Max time routine acquire() waits for the bucket before giving up. */
  maxWaitMs: number;
  /** Max time a dispute review acquire() may wait up to its window deadline (#327). */
  disputeMaxWaitMs: number;
  leaseTtlMs: number;
  probeTtlMs: number;
}

export type GuardSettingsOverride = Partial<Omit<GuardSettings, 'rpm' | 'classPolicy'>> & {
  rpm?: Partial<Record<Provider, number>>;
  classPolicy?: Partial<ClassPolicyMap>;
};

export function resolveClassPolicyFromConfig(
  rawJson = config.LLM_CLASS_POLICY,
  adminReservePct = config.LLM_ADMIN_RESERVE_PCT,
): ClassPolicyMap {
  const base: ClassPolicyMap = {
    dispute: { ...DEFAULT_CLASS_POLICY.dispute },
    admin: { ...DEFAULT_CLASS_POLICY.admin, guaranteePct: adminReservePct },
    generation: { ...DEFAULT_CLASS_POLICY.generation },
    forecast: { ...DEFAULT_CLASS_POLICY.forecast },
    hedge: { ...DEFAULT_CLASS_POLICY.hedge },
    other: { ...DEFAULT_CLASS_POLICY.other },
  };
  if (!rawJson || !rawJson.trim()) return base;
  try {
    const parsed = JSON.parse(rawJson) as Partial<ClassPolicyMap>;
    for (const c of PURPOSE_CLASSES) {
      if (parsed[c]) {
        base[c] = { ...base[c], ...parsed[c] };
      }
    }
  } catch {
    // Validated at config load; keep defaults if malformed in ad-hoc test mutation.
  }
  return base;
}

function defaultSettings(): GuardSettings {
  return {
    tokenBudget: config.LLM_DAILY_TOKEN_BUDGET,
    costBudgetMicros: config.LLM_DAILY_COST_BUDGET_MICROS,
    reservePct: config.LLM_ADMIN_RESERVE_PCT,
    rpm: { anthropic: config.LLM_ANTHROPIC_RPM, gemini: config.LLM_GEMINI_RPM, openai: config.LLM_OPENAI_RPM },
    failureThreshold: config.LLM_BREAKER_FAILURE_THRESHOLD,
    openMs: config.LLM_BREAKER_OPEN_MS,
    failMode: config.LLM_REDIS_FAIL_MODE,
    maxWaitMs: 30_000,
    disputeMaxWaitMs: config.LLM_DISPUTE_MAX_WAIT_MS,
    leaseTtlMs: config.TIMEOUT_LLM_MS * 2,
    probeTtlMs: config.TIMEOUT_LLM_MS,
  };
}

/** `rpm` may name only some providers; the rest keep their configured rate. */
export type GuardSettingsOverride = Partial<Omit<GuardSettings, 'rpm'>> & { rpm?: Partial<Record<Provider, number>> };

let overrides: GuardSettingsOverride = {};
export function settings(): GuardSettings {
  const base = defaultSettings();
  return { ...base, ...overrides, rpm: { ...base.rpm, ...overrides.rpm } };
}

/** Test seam. Pass `{}` to restore config-derived settings. */
export function setLlmGuardSettings(next: GuardSettingsOverride): void {
  overrides = next;
}

// ─── Store ────────────────────────────────────────────────────────────────────

let store: LlmGuardStore | null = null;
export function getLlmGuardStore(): LlmGuardStore {
  return (store ??= new RedisGuardStore(getRedis));
}
/** Test seam. Returns the previous store. */
export function setLlmGuardStore(next: LlmGuardStore | null): LlmGuardStore | null {
  const prev = store;
  store = next;
  return prev;
}

// ─── Redis-down fallback ──────────────────────────────────────────────────────

let localStore = new MemoryGuardStore();
let lastStoreWarnAt = 0;
function warnStoreDown(err: unknown, failMode: string): void {
  const now = Date.now();
  if (now - lastStoreWarnAt < 60_000) return;
  lastStoreWarnAt = now;
  logger.warn({ err: (err as Error)?.message, failMode }, 'LLM guard store unavailable');
}
export function resetLocalLlmLimiter(): void {
  localStore = new MemoryGuardStore();
  lastStoreWarnAt = 0;
}

let waitFn: (ms: number, signal?: AbortSignal) => Promise<void> = (ms, signal) => clockSleep(ms, signal);
/** Test seam for the RATE_LIMITED wait. */
export function setLlmWait(fn: typeof waitFn | null): void {
  waitFn = fn ?? ((ms, signal) => clockSleep(ms, signal));
}

// ─── Dispute rejection alerting (#327) ────────────────────────────────────────

type DisputeRejectionAlertFn = (info: {
  provider: Provider;
  kind: 'BUDGET_EXCEEDED' | 'RATE_LIMITED';
  reason: string;
  purpose: string;
}) => Promise<void>;

let disputeAlertOverride: DisputeRejectionAlertFn | null = null;

export function setDisputeRejectionAlertForTest(fn: DisputeRejectionAlertFn | null): void {
  disputeAlertOverride = fn;
}

function notifyDisputeRejection(info: {
  provider: Provider;
  kind: 'BUDGET_EXCEEDED' | 'RATE_LIMITED';
  reason: string;
  purpose: string;
}): void {
  logger.warn(
    { provider: info.provider, kind: info.kind, reason: info.reason, purpose: info.purpose, class: 'dispute' },
    'Dispute review LLM call rejected by guard',
  );
  if (disputeAlertOverride) {
    void disputeAlertOverride(info).catch(() => undefined);
    return;
  }
  import('../services/alerts.service')
    .then(({ AlertService }) => {
      const svc = new AlertService();
      const day = new Date().toISOString().slice(0, 10);
      return svc.send(`llm-dispute:${day}:${info.provider}:${info.kind}`, {
        level: 'WARN',
        title: `Dispute review LLM call rejected (${info.kind})`,
        marketId: 'llm-budget',
        onChainMarketId: 'llm-budget',
        proposedOutcome: 'N/A',
        verdict: info.kind,
        windowRemainingSecs: null,
        links: { market: '/api/v1/admin/status', cancelTx: '/api/v1/admin/disputes' },
        detail: `Provider: ${info.provider}, reason: ${info.reason}, purpose: ${info.purpose}`,
      });
    })
    .catch(() => undefined);
}

// ─── acquire / record ─────────────────────────────────────────────────────────

function effectiveWaitLimitMs(ctx: CallContext, purposeClass: PurposeClass, s: GuardSettings, now: number): number {
  if (purposeClass === 'dispute' && typeof ctx.deadlineMs === 'number' && Number.isFinite(ctx.deadlineMs)) {
    const untilDeadline = ctx.deadlineMs - now - config.TIMEOUT_LLM_MS;
    return Math.max(0, Math.min(untilDeadline, s.disputeMaxWaitMs));
  }
  return s.maxWaitMs;
}

export async function acquire(
  provider: Provider,
  ctx: CallContext,
  estimatedTokens: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Lease> {
  const s = settings();
  const purposeClass = classOf(ctx);
  const leaseId = randomUUID();
  const started = nowMs();
  let local = false;
  let active: LlmGuardStore = getLlmGuardStore();

  for (;;) {
    let res: AcquireResult;
    try {
      res = await active.acquire({
        provider,
        leaseId,
        priority: ctx.priority,
        purposeClass,
        classPolicy: s.classPolicy,
        estimate: estimatedTokens,
        rpm: s.rpm[provider] ?? config.LLM_OPENAI_RPM,
        tokenBudget: s.tokenBudget,
        costBudgetMicros: s.costBudgetMicros,
        reservePct: s.reservePct,
        leaseTtlMs: s.leaseTtlMs,
        probeTtlMs: s.probeTtlMs,
      });
    } catch (err) {
      if (active === localStore) throw err;
      warnStoreDown(err, s.failMode);
      if (s.failMode === 'closed') {
        throw new LlmCircuitOpen({ provider, reason: 'GUARD_STORE_UNAVAILABLE' });
      }
      active = localStore;
      local = true;
      continue;
    }

    if (res.ok) {
      return {
        id: leaseId,
        provider,
        ctx,
        purposeClass,
        day: res.day,
        estimate: estimatedTokens,
        probe: res.probe,
        local,
      };
    }
    if (res.reason === 'BUDGET_EXCEEDED') {
      const budgetReason = res.budgetReason ?? 'CLASS_CAP';
      if (purposeClass === 'dispute') {
        notifyDisputeRejection({
          provider,
          kind: 'BUDGET_EXCEEDED',
          reason: budgetReason,
          purpose: ctx.purpose,
        });
      }
      throw new LlmBudgetExceeded({
        provider,
        purpose: ctx.purpose,
        priority: ctx.priority,
        class: res.purposeClass ?? purposeClass,
        reason: budgetReason,
        retryAfterMs: res.retryAfterMs,
      });
    }
    if (res.reason === 'CIRCUIT_OPEN') {
      throw new LlmCircuitOpen({ provider, retryAfterMs: res.retryAfterMs });
    }
    // RATE_LIMITED: wait for a token, with jitter, up to the class/deadline wait limit.
    const now = nowMs();
    const waitLimit = effectiveWaitLimitMs(ctx, purposeClass, s, started);
    const wait = res.retryAfterMs + Math.floor(Math.random() * Math.min(250, res.retryAfterMs + 1));
    if (now - started + wait > waitLimit) {
      if (purposeClass === 'dispute') {
        notifyDisputeRejection({
          provider,
          kind: 'RATE_LIMITED',
          reason: `wait_exceeded_${waitLimit}ms`,
          purpose: ctx.purpose,
        });
      }
      throw new AppError(429, 'LLM_RATE_LIMITED', `LLM rate limit for ${provider} not available within ${waitLimit}ms`, {
        provider,
        class: purposeClass,
        retryAfterMs: res.retryAfterMs,
      });
    }
    logger.debug({ provider, class: purposeClass, waitMs: wait }, 'LLM rate limit: waiting for a token');
    await waitFn(wait, opts.signal);
  }
}

export interface RecordOptions {
  /** For outcome 'quota': keep the breaker open at least this long. */
  quotaOpenMs?: number;
  /** For outcome 'quota': also hold it until the next UTC midnight. */
  untilMidnight?: boolean;
}

export async function record(
  lease: Lease,
  usage: Usage | null,
  outcome: CallOutcome,
  opts: RecordOptions = {},
): Promise<void> {
  const s = settings();
  const costMicros = estimateCostMicros(usage);
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const purposeClass = lease.purposeClass ?? classOf(lease.ctx);

  logger.info(
    {
      provider: lease.provider,
      model: usage?.model ?? null,
      purpose: lease.ctx.purpose,
      priority: lease.ctx.priority,
      class: purposeClass,
      inputTokens,
      outputTokens,
      estimatedCostMicros: costMicros,
      outcome,
    },
    'LLM call recorded',
  );

  try {
    await (lease.local ? localStore : getLlmGuardStore()).record({
      provider: lease.provider,
      leaseId: lease.id,
      day: lease.day,
      estimate: lease.estimate,
      purposeClass,
      probe: lease.probe,
      inputTokens,
      outputTokens,
      costMicros,
      outcome,
      failureThreshold: s.failureThreshold,
      openMs: opts.quotaOpenMs ?? s.openMs,
      openUntilMidnight: opts.untilMidnight ?? false,
    });
  } catch (err) {
    // The reservation expires on its own; never fail the caller's response.
    warnStoreDown(err, s.failMode);
  }
}

export interface Classified {
  outcome: 'error' | 'quota';
  options?: RecordOptions;
}

/**
 * Runs `fn` between acquire and record. `fn` returns the value plus the usage
 * to bill; a throw records 'error' (or 'quota' via `classify`) and rethrows.
 */
export async function withLease<T>(
  provider: Provider,
  ctx: CallContext | undefined,
  estimatedTokens: number,
  fn: (lease: Lease) => Promise<{ value: T; usage: Usage | null }>,
  opts: { signal?: AbortSignal; classify?: (err: unknown) => Classified } = {},
): Promise<T> {
  if (ctx?.isolated) {
    const syntheticLease: Lease = {
      id: 'isolated',
      provider,
      ctx,
      day: new Date().toISOString().slice(0, 10),
      estimate: estimatedTokens,
      probe: false,
      local: true,
    };
    const res = await fn(syntheticLease);
    return res.value;
  }
  const lease = await acquire(provider, ctx ?? DEFAULT_CALL_CONTEXT, estimatedTokens, { signal: opts.signal });
  let result: { value: T; usage: Usage | null };
  try {
    result = await fn(lease);
  } catch (err) {
    const c = opts.classify?.(err) ?? { outcome: 'error' as const };
    await record(lease, null, c.outcome, c.options);
    throw err;
  }
  await record(lease, result.usage, 'ok');
  return result.value;
}

// ─── Visibility ───────────────────────────────────────────────────────────────

export async function breakerState(provider: Provider): Promise<BreakerState> {
  try {
    return await getLlmGuardStore().breakerState(provider);
  } catch {
    return 'closed';
  }
}

export interface ClassUsageView extends ClassUsage {
  guarantee: number;
  cap: number;
  costGuaranteeMicros: number;
  costCapMicros: number;
}

export interface LlmUsageReport extends Omit<UsageSnapshot, 'byClass'> {
  tokenBudget: number;
  costBudgetMicros: number;
  total: {
    tokens: number;
    costMicros: number;
    reserved: number;
    tokenBudget: number;
    costBudgetMicros: number;
  };
  byClass: Record<PurposeClass, ClassUsageView>;
}

export async function getLlmUsage(): Promise<LlmUsageReport> {
  const s = settings();
  const snap = await getLlmGuardStore().usage();
  const byClass = {} as Record<PurposeClass, ClassUsageView>;
  for (const c of PURPOSE_CLASSES) {
    const raw = snap.byClass?.[c] ?? { tokens: 0, costMicros: 0, reserved: 0 };
    const pol = s.classPolicy[c];
    byClass[c] = {
      tokens: raw.tokens,
      costMicros: raw.costMicros,
      reserved: raw.reserved,
      guarantee: Math.floor((s.tokenBudget * pol.guaranteePct) / 100),
      cap: Math.floor((s.tokenBudget * pol.capPct) / 100),
      costGuaranteeMicros: Math.floor((s.costBudgetMicros * pol.guaranteePct) / 100),
      costCapMicros: Math.floor((s.costBudgetMicros * pol.capPct) / 100),
    };
  }
  return {
    ...snap,
    tokenBudget: s.tokenBudget,
    costBudgetMicros: s.costBudgetMicros,
    total: {
      tokens: snap.tokens,
      costMicros: snap.costMicros,
      reserved: snap.reserved,
      tokenBudget: s.tokenBudget,
      costBudgetMicros: s.costBudgetMicros,
    },
    byClass,
  };
}

/** True the first time `name` is claimed today (UTC); used to log once per day. */
export async function claimDailyOnce(name: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    return await getLlmGuardStore().setOnce(`${name}:${day}`, 48 * 3600);
  } catch {
    return true; // can't dedupe without the store; log rather than hide it
  }
}
