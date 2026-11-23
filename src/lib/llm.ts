/**
 * LLM entry point (#157, #65, #71, #218).
 *
 * Free-form calls (`completeLLM`, `callLLMJSON`, `callLLMText`) go through the
 * provider-agnostic router. The default policy reproduces the historical
 * behaviour (Anthropic Claude first, Gemini fallback) while allowing per-task
 * policies via LLM_POLICY / LLM_POLICY_FILE.
 *
 * `callLLMStructured` is for output that must fit a zod schema. It walks the
 * same per-task policy as the router, in order, with each spec's provider,
 * model, temperature and max tokens: Anthropic via a forced tool call, Gemini
 * via `responseSchema`, OpenAI via a strict `json_schema` response format (or
 * the schema in the prompt for `jsonMode: 'prompt'` servers). Each provider
 * gets one repair round that feeds the validation issues back; there is no
 * fence stripping anywhere. Provider health (cooldowns) is shared with the
 * router, and `dispute_review` structured calls are Gemini-first like its
 * policy.
 *
 * Every call runs inside the `llm` bulkhead and honours the shared deadline,
 * and every provider attempt takes a lease on the shared Redis guards
 * (src/lib/llm-budget.ts).
 */
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { AppError } from '../middlewares/error.middleware';
import { logger } from './logger';
import { asLlmError, createRouter } from './llm/router';
import { policies, getEffectiveChain } from './llm/policy';
import { anthropicProvider, geminiProvider, openaiProvider } from './llm/providers';
import { getAnthropicClient, setAnthropicClient } from './llm/providers/anthropic';
import { mapGeminiError } from './llm/providers/gemini';
import { mapOpenAIError, setOpenAIClient } from './llm/providers/openai';
import { LlmError, type LlmRequest, type LlmResult, type LlmTask, type ModelSpec } from './llm/types';
import { setGeminiModelFactory } from './gemini';
import type { ErrorClass, LlmProvenance, LlmRoute, RouteDecision } from './llm/provenance';
import { sha256Hex } from '../utils/hash.util';
import type { StructuredSpec } from './llm-schema';
import { anthropicStructured } from './llm/structured/anthropic';
import { geminiStructured } from './llm/structured/gemini';
import { openaiStructured } from './llm/structured/openai';
import {
  StructuredValidationError,
  check,
  type Checked,
  type Served,
  type StructuredAdapter,
  type StructuredProvider,
} from './llm/structured/types';
import { DEFAULT_CALL_CONTEXT, LlmBudgetExceeded, type CallContext } from './llm-budget';
import { bulkheads, deadline } from './resilience';

export const llmRouter = createRouter(policies, {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  openai: openaiProvider,
});

export type { LlmRequest, LlmResult, LlmTask };
export { LlmError } from './llm/types';
export { getAnthropicClient, setAnthropicClient, setGeminiModelFactory, setOpenAIClient };
export type { StructuredProvider };

// ─── Provider transport seams (#72, #218) ─────────────────────────────────────
// Every Anthropic, Gemini and OpenAI request (router, structured output,
// repairs and fallbacks) leaves through these functions when a transport is
// set, so a test can record and replay provider traffic without keys or a
// network. Production never sets one: the SDK clients are used as before.

/** One Anthropic Messages call, as sent and as answered. */
export interface AnthropicTransport {
  create(req: Anthropic.MessageCreateParamsNonStreaming, opts?: { signal?: AbortSignal }): Promise<Anthropic.Message>;
}

/** One Gemini generateContent call: the model parameters and the prompt (text or contents). */
export interface GeminiTransport {
  generate(req: {
    model: string;
    systemInstruction: string;
    generationConfig: object;
    prompt: unknown;
  }, opts?: { signal?: AbortSignal }): Promise<{ text: string; usage?: { promptTokenCount?: number; candidatesTokenCount?: number } }>;
}

/** One OpenAI-compatible Chat Completions call, as sent and as answered. */
export interface OpenAITransport {
  create(
    req: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    opts?: { signal?: AbortSignal },
  ): Promise<OpenAI.Chat.Completions.ChatCompletion>;
}

let anthropicTransport: AnthropicTransport | null = null;
let geminiTransport: GeminiTransport | null = null;
let openaiTransport: OpenAITransport | null = null;

/** Routes Anthropic calls to `t`; null restores the SDK. Returns the previous transport. */
export function setAnthropicTransport(t: AnthropicTransport | null): AnthropicTransport | null {
  const prev = anthropicTransport;
  anthropicTransport = t;
  setAnthropicClient(t ? { messages: { create: (body: any, opts?: any) => t.create(body, { signal: opts?.signal }) } } : null);
  return prev;
}

/** Routes Gemini calls to `t`; null restores the SDK. Returns the previous transport. */
export function setGeminiTransport(t: GeminiTransport | null): GeminiTransport | null {
  const prev = geminiTransport;
  geminiTransport = t;
  setGeminiModelFactory(
    t
      ? (params) => ({
          async generateContent(prompt: unknown, opts?: { signal?: AbortSignal }) {
            const r = await t.generate({
              model: params.model,
              systemInstruction: String((params as { systemInstruction?: unknown }).systemInstruction ?? ''),
              generationConfig: (params.generationConfig ?? {}) as object,
              prompt,
            }, opts);
            return { response: { text: () => r.text, usageMetadata: r.usage } };
          },
        })
      : null,
  );
  return prev;
}

/** Routes OpenAI-compatible calls to `t`; null restores the SDK. Returns the previous transport. */
export function setOpenAITransport(t: OpenAITransport | null): OpenAITransport | null {
  const prev = openaiTransport;
  openaiTransport = t;
  setOpenAIClient(t ? { chat: { completions: { create: (body: any, opts?: any) => t.create(body, { signal: opts?.signal }) } } } : null);
  return prev;
}

/** Complete a request and return the text plus provenance. */
export async function completeLLM(req: LlmRequest): Promise<LlmResult> {
  return bulkheads.llm.run(async () => {
    const handle = deadline('llm', req.signal);
    try {
      return await llmRouter.complete({ ...req, signal: handle.signal });
    } finally {
      handle.cleanup?.();
    }
  }, req.signal);
}

// ─── Transport seam (#67) ─────────────────────────────────────────────────────

/**
 * One JSON completion, as the offline evaluation sees the model: raw text plus
 * who produced it. The default delegates to the router (Anthropic → Gemini);
 * `setLlmTransport` swaps in a recording transport so replay needs no keys and
 * no provider code runs.
 */
export interface LlmTransport {
  /**
   * With `opts.spec` the call is schema-constrained (the production path) and
   * the validated value comes back as JSON text; without it, free-form JSON.
   */
  json(
    system: string,
    user: string,
    maxTokens: number,
    opts?: { spec?: StructuredSpec<any> },
  ): Promise<{ text: string; provider: string; model: string }>;
}

const EVAL_CTX: CallContext = { purpose: 'eval', priority: 'admin' };

const defaultTransport: LlmTransport = {
  async json(system, user, maxTokens, opts) {
    if (opts?.spec) {
      const r = await callLLMStructured(opts.spec, { system, user }, { maxTokens, ctx: EVAL_CTX, task: 'market_generation' });
      return { text: JSON.stringify(r.value), provider: r.provider, model: r.model };
    }
    const result = await completeLLM({ task: 'market_generation', system, user, mode: 'json', maxTokens, ctx: EVAL_CTX });
    return { text: result.text, provider: result.provenance.provider, model: result.provenance.model };
  },
};

let transport: LlmTransport = defaultTransport;

/** Test/eval seam. Pass null to restore the provider-backed default. Returns the previous transport. */
export function setLlmTransport(next: LlmTransport | null): LlmTransport {
  const prev = transport;
  transport = next ?? defaultTransport;
  return prev;
}

export function getLlmTransport(): LlmTransport {
  return transport;
}

/** Backwards-compatible JSON wrapper. Invalid JSON triggers provider failover. */
export async function callLLMJSON(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 2048,
  task: LlmTask = 'generic_json',
  opts?: { signal?: AbortSignal; ctx?: CallContext },
): Promise<string> {
  const result = await completeLLM({
    task,
    system: systemPrompt,
    user: userPrompt,
    mode: 'json',
    maxTokens,
    signal: opts?.signal,
    ctx: opts?.ctx,
  });
  return result.text;
}

/** Backwards-compatible plain-text wrapper. Never requests a JSON MIME type. */
export async function callLLMText(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 2048,
  task: LlmTask = 'generic_text',
  opts?: { signal?: AbortSignal; ctx?: CallContext },
): Promise<string> {
  const result = await completeLLM({
    task,
    system: systemPrompt,
    user: userPrompt,
    mode: 'text',
    maxTokens,
    signal: opts?.signal,
    ctx: opts?.ctx,
  });
  return result.text;
}

// ─── Structured output (#65, #218) ────────────────────────────────────────────

export interface StructuredResult<T> {
  value: T;
  provider: StructuredProvider;
  model: string;
  /** Provider calls made, repairs included. */
  attempts: number;
  /** Who produced `value`, with which prompt and parameters (#66). */
  provenance: LlmProvenance;
}

/**
 * Temperature recorded for `setLlmJsonCaller` replays. Live calls use the
 * policy's temperature (the default policies keep this value for Anthropic).
 */
export const ANTHROPIC_STRUCTURED_TEMPERATURE = 0.2;

/** Identifies the registered prompt a call renders (src/lib/prompts). */
export interface PromptRef {
  id: string;
  version: number;
  hash: string;
}

export interface StructuredOptions {
  maxTokens?: number;
  ctx?: CallContext;
  signal?: AbortSignal;
  /** Selects the policy chain: provider order, models, temperatures, token caps. */
  task?: LlmTask;
  /** Registered prompt, for provenance. Omitted calls are recorded as `adhoc`. */
  prompt?: PromptRef;
}

let jsonCaller: ((system: string, user: string, maxTokens: number) => Promise<string>) | null = null;

/**
 * Test seam: replaces the providers with a function returning the model's raw
 * JSON text (recorded outputs). The text still goes through JSON.parse, the zod
 * schema and `postValidate`, with no repair round.
 */
export function setLlmJsonCaller(fn: typeof jsonCaller): typeof jsonCaller {
  const prev = jsonCaller;
  jsonCaller = fn;
  return prev;
}

/** Category of a provider failure for provenance. Never carries the provider's message. */
export function errorClassOf(err: unknown): ErrorClass {
  if (err instanceof StructuredValidationError) return 'validation';
  if (err instanceof LlmBudgetExceeded) return 'budget';
  const e = err as { code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown; message?: unknown };
  if (e?.code === 'LLM_CIRCUIT_OPEN') return 'circuit_open';
  if (e?.code === 'LLM_UNAVAILABLE') return 'unavailable';
  const status = Number(e?.status ?? e?.statusCode);
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server_error';
  const name = String(e?.name ?? '');
  if (name.includes('Timeout') || e?.code === 'UPSTREAM_TIMEOUT') return 'timeout';
  const message = String(e?.message ?? '');
  if (/RESOURCE_EXHAUSTED|Too Many Requests/.test(message)) return 'rate_limited';
  return 'error';
}

const adapters: Record<StructuredProvider, StructuredAdapter> = {
  anthropic: anthropicStructured,
  gemini: geminiStructured,
  openai: openaiStructured,
};

/**
 * A structured transport failure as the router's health book sees it (#218).
 * Guard errors (AppError: circuit open, limiter wait) take the router's
 * generic mapping, exactly as in `complete()`. Raw SDK errors take the
 * provider's own mapping, so a Gemini daily quota opens the provider here as
 * it does for free-form calls; Anthropic errors carry an HTTP status, which
 * the generic mapping already reads.
 */
function healthErrorOf(provider: StructuredProvider, err: unknown): LlmError {
  if (err instanceof LlmError || err instanceof AppError) return asLlmError(err, provider);
  if (provider === 'gemini') return mapGeminiError(err);
  if (provider === 'openai') return mapOpenAIError(err);
  return asLlmError(err, provider);
}

/**
 * Calls the model for output that must satisfy `spec` and returns it typed and
 * validated. Walks `policies[task]` in order (#218) with each spec's provider,
 * model and temperature: a provider with no key is skipped (`unconfigured`),
 * one the router has cooling or open is skipped and recorded, and each tried
 * provider gets at most one repair round. The output cap is
 * min(opts.maxTokens ?? 2048, spec.maxTokens), as in the router.
 *
 * A budget rejection never falls back (the budget is global); an open circuit
 * does. Transport failures update the router's provider health; schema misses
 * fall back without touching it (a content problem, not a provider failure).
 *
 * Failure: `LLM_STRUCTURED_OUTPUT_FAILED` (422, details `{ provider, issues }`)
 * when a provider answered with output that never validated; otherwise the
 * transport/guard error of the last provider tried; otherwise 503
 * `LLM_UNAVAILABLE` (nothing configured, or every configured provider cooling).
 */
export async function callLLMStructured<T>(
  spec: StructuredSpec<T>,
  prompts: { system: string; user: string },
  opts: StructuredOptions = {},
): Promise<StructuredResult<T>> {
  const maxTokens = opts.maxTokens ?? 2048;
  const startedAt = performance.now();
  const prompt: PromptRef = opts.prompt ?? { id: 'adhoc', version: 0, hash: sha256Hex(prompts.system) };
  const provenanceOf = (
    served: Served,
    fallbackFrom?: LlmProvenance['fallbackFrom'],
    route?: LlmRoute,
  ): LlmProvenance => ({
    source: 'llm',
    provider: served.provider,
    model: served.model,
    ...(served.servedModel ? { servedModel: served.servedModel } : {}),
    promptId: prompt.id,
    promptVersion: prompt.version,
    promptHash: prompt.hash,
    params: served.params,
    usage: served.usage,
    latencyMs: Math.round(performance.now() - startedAt),
    attempts: served.attempts,
    ...(fallbackFrom ? { fallbackFrom } : {}),
    ...(route ? { route } : {}),
    outputSha256: served.outputSha256,
  });

  if (jsonCaller) {
    const raw = await jsonCaller(prompts.system, prompts.user, maxTokens);
    let checked: Checked<T>;
    try {
      checked = check(spec, JSON.parse(raw));
    } catch {
      checked = { ok: false, issues: '- output is not valid JSON' };
    }
    if (!checked.ok) {
      throw new AppError(422, 'LLM_STRUCTURED_OUTPUT_FAILED', 'LLM output did not satisfy the schema', {
        provider: 'anthropic',
        issues: checked.issues.split('\n'),
      });
    }
    const served: Served = {
      provider: 'anthropic',
      model: 'recorded',
      attempts: 1,
      outputSha256: sha256Hex(raw),
      usage: null,
      params: { temperature: ANTHROPIC_STRUCTURED_TEMPERATURE, maxTokens },
    };
    return { value: checked.value, provider: 'anthropic', model: 'recorded', attempts: 1, provenance: provenanceOf(served) };
  }

  return bulkheads.llm.run(async () => {
    const handle = deadline('llm', opts.signal);
    const task = opts.task ?? 'generic_json';
    const ctx = opts.ctx ?? DEFAULT_CALL_CONTEXT;
    const calls = { n: 0 };
    const chain: ModelSpec[] = getEffectiveChain(task, policies);
    const route: LlmRoute = { task, chain: [] };
    const decide = (model: ModelSpec, decision: RouteDecision) =>
      route.chain.push({ provider: model.provider, model: model.model, decision });
    let validation: StructuredValidationError | null = null;
    let transport: unknown = null;
    let fallbackFrom: LlmProvenance['fallbackFrom'];

    try {
      for (const model of chain) {
        const adapter = adapters[model.provider];
        if (!adapter || !adapter.available()) {
          // Missing key is a configuration skip, not a provider failure.
          decide(model, 'unconfigured');
          continue;
        }
        const health = llmRouter.healthBook.isSkippable(model.provider);
        if (health.skip) {
          decide(model, health.state === 'open' ? 'open' : 'cooling');
          logger.warn({ spec: spec.name, task, provider: model.provider, state: health.state }, 'LLM structured call skipped a cooled provider');
          continue;
        }

        try {
          const served = await adapter.attempt(spec, model, {
            prompts,
            maxTokens: Math.min(maxTokens, model.maxTokens),
            ctx,
            signal: handle.signal,
            task,
            calls,
          });
          llmRouter.healthBook.recordSuccess(model.provider);
          decide(model, 'served');
          const result: StructuredResult<T> = {
            value: served.value,
            provider: served.provider,
            model: served.model,
            attempts: served.attempts,
            provenance: provenanceOf(served, fallbackFrom, route),
          };
          logger.info(
            { spec: spec.name, task, provider: result.provider, model: result.model, attempts: result.attempts, purpose: ctx.purpose },
            'LLM structured output validated',
          );
          return result;
        } catch (err) {
          if (err instanceof LlmBudgetExceeded) throw err;
          if (handle.signal.aborted) throw handle.signal.reason;
          const errorClass = errorClassOf(err);
          decide(model, errorClass);
          fallbackFrom ??= { provider: model.provider, model: model.model, errorClass };
          if (err instanceof StructuredValidationError) {
            // A schema miss is a content problem: provider health is untouched.
            validation = err;
            logger.warn({ spec: spec.name, provider: model.provider, calls: calls.n }, 'LLM structured output failed validation after repair');
          } else {
            transport = err;
            llmRouter.healthBook.recordFailure(model.provider, healthErrorOf(model.provider, err));
            logger.warn({ spec: spec.name, provider: model.provider, err: (err as Error)?.message?.slice(0, 200) }, 'LLM structured call failed');
          }
        }
      }

      if (validation) {
        throw new AppError(422, 'LLM_STRUCTURED_OUTPUT_FAILED', 'LLM output did not satisfy the schema after repair', {
          provider: validation.provider,
          issues: validation.issues,
        });
      }
      if (transport instanceof AppError) throw transport;
      if (transport) throw new AppError(502, 'LLM_CALL_FAILED', `LLM call failed: ${(transport as Error)?.message ?? transport}`);
      if (route.chain.some((d) => d.decision === 'cooling' || d.decision === 'open')) {
        throw new AppError(
          503,
          'LLM_UNAVAILABLE',
          `Every configured LLM provider for task "${task}" is cooling down after recent failures`,
          { task, chain: route.chain },
        );
      }
      throw new AppError(503, 'LLM_UNAVAILABLE', 'No LLM provider is configured');
    } finally {
      handle.cleanup?.();
    }
  }, opts.signal);
}
