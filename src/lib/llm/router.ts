import { nowMs, sleep as clockSleep } from '../clock';
import { logger } from '../logger';
import type {
  Attempt,
  LlmErrorKind,
  LlmProvider,
  LlmRequest,
  LlmResult,
  ModelSpec,
} from './types';
import { LlmError } from './types';
import type { LlmPolicies } from './policy';
import { getEffectiveChain } from './policy';
import { LlmBudgetExceeded } from '../llm-budget';

export interface ProviderHealth {
  state: 'healthy' | 'cooling' | 'open';
  consecutiveFailures: number;
  until?: number;
  lastError?: LlmErrorKind;
}

export interface Router {
  complete(req: LlmRequest): Promise<LlmResult>;
  health(): Record<string, ProviderHealth>;
  /** Provider health shared with the structured path (#218). */
  readonly healthBook: ProviderHealthBook;
}

export interface RouterOptions {
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (attempt: Attempt) => void;
  retryInlineMaxMs?: number;
  quotaCooldownMs?: number;
  failureCooldownMs?: number;
  failureThreshold?: number;
}

const RETRY_INLINE_MAX_MS = 5_000;
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 60_000;
const FAILURE_THRESHOLD = 3;

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/** Normalises any provider failure into an LlmError (router and structured path). */
export function asLlmError(err: unknown, provider: string): LlmError {
  if (err instanceof LlmError) return err;
  const message = (err as Error)?.message ?? String(err);
  const status = (err as { status?: number })?.status;
  let kind: LlmErrorKind = 'server';
  if (status === 429) kind = 'rate_limited';
  else if (status === 401 || status === 403) kind = 'auth';
  else if (status === 400) kind = 'invalid_request';
  else if ((err as { name?: string })?.name?.includes('Timeout')) kind = 'timeout';
  return new LlmError(kind, provider, message, undefined, [], err);
}

export interface HealthBookOptions {
  clock: () => number;
  quotaCooldownMs: number;
  failureCooldownMs: number;
  failureThreshold: number;
}

/**
 * Per-provider health (#157), shared by `complete()` and the structured path
 * (#218) so a provider cooled by one is skipped by the other. In-process only:
 * the cross-instance breaker lives in the shared guards (src/lib/llm-budget.ts).
 */
export class ProviderHealthBook {
  private readonly health = new Map<string, ProviderHealth>();

  constructor(private readonly opts: HealthBookOptions) {}

  /** Current state; an expired cooldown reads as healthy (failures are kept). */
  stateOf(provider: string): ProviderHealth {
    const current = this.health.get(provider);
    if (!current) return { state: 'healthy', consecutiveFailures: 0 };
    if (current.until !== undefined && current.until <= this.opts.clock() && current.state !== 'healthy') {
      return { state: 'healthy', consecutiveFailures: current.consecutiveFailures };
    }
    return current;
  }

  /** True while the provider is cooling or open and its window has not passed. */
  isSkippable(provider: string): { skip: boolean; state: ProviderHealth['state'] } {
    const current = this.stateOf(provider);
    const skip = (current.state === 'cooling' || current.state === 'open') && (current.until ?? 0) > this.opts.clock();
    return { skip, state: current.state };
  }

  recordSuccess(provider: string): void {
    this.health.set(provider, { state: 'healthy', consecutiveFailures: 0 });
  }

  /**
   * A failed attempt. Rate limits cool the provider for their retry-after,
   * quota exhaustion opens it, `failureThreshold` server/timeout failures in a
   * row cool it; anything else only counts the failure. (Inline retries of a
   * short rate limit are the caller's business and are not recorded.)
   */
  recordFailure(provider: string, err: LlmError): void {
    const clock = this.opts.clock;
    const currentHealth = this.stateOf(provider);

    if (err.kind === 'rate_limited') {
      const retryAfter = err.retryAfterMs ?? 30_000;
      this.health.set(provider, {
        state: 'cooling',
        consecutiveFailures: currentHealth.consecutiveFailures + 1,
        until: clock() + Math.max(retryAfter, 1_000),
        lastError: err.kind,
      });
      return;
    }

    if (err.kind === 'quota_exhausted') {
      this.health.set(provider, {
        state: 'open',
        consecutiveFailures: currentHealth.consecutiveFailures + 1,
        until: clock() + this.opts.quotaCooldownMs,
        lastError: err.kind,
      });
      return;
    }

    if (err.kind === 'server' || err.kind === 'timeout') {
      const failures = currentHealth.consecutiveFailures + 1;
      this.health.set(provider, {
        state: failures >= this.opts.failureThreshold ? 'cooling' : 'healthy',
        consecutiveFailures: failures,
        until: failures >= this.opts.failureThreshold ? clock() + this.opts.failureCooldownMs : undefined,
        lastError: err.kind,
      });
      return;
    }

    // auth / invalid_request / empty / parse / content_filtered: count only.
    this.health.set(provider, {
      state: currentHealth.state,
      consecutiveFailures: currentHealth.consecutiveFailures + 1,
      until: currentHealth.until,
      lastError: err.kind,
    });
  }

  /** Test seam: forget every provider's history. */
  reset(): void {
    this.health.clear();
  }
}

export function createRouter(
  policies: LlmPolicies,
  providers: Partial<Record<ModelSpec['provider'], LlmProvider>>,
  options: RouterOptions = {},
): Router {
  // Defaults read the shared clock (#72), so a test clock removes real waiting.
  const clock = options.clock ?? nowMs;
  const sleep = options.sleep ?? ((ms: number) => clockSleep(ms));
  const retryInlineMaxMs = options.retryInlineMaxMs ?? RETRY_INLINE_MAX_MS;
  const healthBook = new ProviderHealthBook({
    clock,
    quotaCooldownMs: options.quotaCooldownMs ?? QUOTA_COOLDOWN_MS,
    failureCooldownMs: options.failureCooldownMs ?? FAILURE_COOLDOWN_MS,
    failureThreshold: options.failureThreshold ?? FAILURE_THRESHOLD,
  });

  return {
    healthBook,

    health() {
      return Object.fromEntries(Object.keys(providers).map((name) => [name, healthBook.stateOf(name)]));
    },

    async complete(req) {
      const policy = getEffectiveChain(req.task, policies);
      if (!policy || policy.length === 0) {
        throw new LlmError('invalid_request', 'router', `No LLM policy configured for task "${req.task}"`);
      }

      const attempts: Attempt[] = [];
      const startedAt = clock();
      let lastError: LlmError | null = null;
      let previousProvider: string | null = null;

      for (const spec of policy) {
        const provider = providers[spec.provider];
        if (!provider || !provider.available()) {
          // Missing key is a configuration skip, not a provider failure.
          continue;
        }

        if (healthBook.isSkippable(spec.provider).skip) {
          previousProvider = spec.provider;
          continue;
        }

        if (previousProvider && previousProvider !== spec.provider) {
          logger.warn(
            { task: req.task, from: previousProvider, to: spec.provider, kind: lastError?.kind },
            'LLM failover',
          );
        }

        const maxAttempts = 1 + Math.max(0, spec.retries ?? 1);
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const attemptStarted = clock();
          try {
            const completion = await provider.complete(spec, req);
            const text = req.mode === 'json' ? stripFences(completion.text) : completion.text.trim();
            if (req.mode === 'json') {
              try {
                JSON.parse(text);
              } catch {
                throw new LlmError('parse', spec.provider, 'LLM returned non-parseable JSON', undefined, [], undefined);
              }
            }
            const succeeded: Attempt = {
              provider: spec.provider,
              model: spec.model,
              latencyMs: clock() - attemptStarted,
            };
            attempts.push(succeeded);
            options.onAttempt?.(succeeded);
            healthBook.recordSuccess(spec.provider);
            return {
              text,
              provenance: {
                task: req.task,
                provider: spec.provider,
                model: spec.model,
                ...(completion.servedModel ? { servedModel: completion.servedModel } : {}),
                attempts,
                latencyMs: clock() - startedAt,
                usage: completion.usage,
              },
            };
          } catch (err) {
            // The budget is global: another provider would draw on the same one.
            if (err instanceof LlmBudgetExceeded) throw err;
            const normalized = asLlmError(err, spec.provider);
            lastError = normalized;
            const failed: Attempt = {
              provider: spec.provider,
              model: spec.model,
              kind: normalized.kind,
              message: normalized.message.slice(0, 200),
              latencyMs: clock() - attemptStarted,
              retryAfterMs: normalized.retryAfterMs,
            };
            attempts.push(failed);
            options.onAttempt?.(failed);

            if (normalized.kind === 'rate_limited') {
              const retryAfter = normalized.retryAfterMs ?? 30_000;
              if (retryAfter <= retryInlineMaxMs && attempt < maxAttempts) {
                logger.warn(
                  { provider: spec.provider, attempt, retryAfterMs: retryAfter },
                  'LLM rate limited — retrying inline',
                );
                await sleep(retryAfter);
                continue;
              }
            }

            if (normalized.kind === 'auth' || normalized.kind === 'invalid_request') {
              logger.error(
                { provider: spec.provider, kind: normalized.kind, task: req.task },
                'LLM provider rejected the request — failing over',
              );
            }

            // empty / parse / content_filtered also land here: try the next spec.
            healthBook.recordFailure(spec.provider, normalized);
            break;
          }
        }
        previousProvider = spec.provider;
      }

      throw new LlmError(
        lastError?.kind ?? 'server',
        lastError?.provider ?? 'router',
        lastError?.message ?? `All LLM providers are unavailable for task "${req.task}"`,
        lastError?.retryAfterMs,
        attempts,
        lastError ?? undefined,
      );
    },
  };
}
