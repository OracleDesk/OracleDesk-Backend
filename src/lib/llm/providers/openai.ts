import OpenAI from 'openai';
import { config } from '../../../config';
import { AppError } from '../../../middlewares/error.middleware';
import type { LlmErrorKind, LlmProvider, LlmRequest, ModelSpec, ProviderCompletion } from '../types';
import { LlmError } from '../types';
import { estimateTokens, withLease, type Classified } from '../../llm-budget';

/** The slice of the SDK we use; tests and cassettes inject a fake through setOpenAIClient (#218). */
export interface OpenAILike {
  chat: { completions: { create(body: any, options?: any): Promise<any> } };
}

export interface OpenAILike {
  chat: {
    completions: {
      create(body: any, options?: any): Promise<any>;
    };
  };
}

const cache = new Map<string, OpenAI>();
let override: OpenAILike | null = null;

/** Test seam: route every OpenAI-compatible call to `client` (null restores the real SDK). */
export function setOpenAIClient(client: OpenAILike | null): OpenAILike | null {
  const prev = override;
  override = client;
  return prev;
}

export function isOpenAIAvailable(): boolean {
  return override !== null || Boolean(config.OPENAI_API_KEY);
}

/** Client for a spec's base URL, cached per key and URL. */
export function clientFor(spec: ModelSpec): OpenAILike {
  if (override) return override;
  const key = `${config.OPENAI_API_KEY}|${spec.baseUrl ?? config.OPENAI_BASE_URL}`;
  let client = cache.get(key);
  if (!client) {
    client = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      // maxRetries: 0 so the shared limiter sees every HTTP attempt (#71, #218).
      maxRetries: 0,
      ...(spec.baseUrl || config.OPENAI_BASE_URL
        ? { baseURL: spec.baseUrl || config.OPENAI_BASE_URL }
        : {}),
    });
    cache.set(key, client);
  }
  return client;
}

/** An exhausted account will not heal on retry: open the breaker at once. */
export function classifyOpenAIError(err: unknown): Classified {
  const e = err as { code?: unknown; message?: unknown };
  if (e?.code === 'insufficient_quota' || /insufficient_quota|billing/i.test(String(e?.message ?? ''))) return { outcome: 'quota' };
  return { outcome: 'error' };
}

export function mapOpenAIError(err: unknown): LlmError {
  const status = (err as { status?: number })?.status;
  let kind: LlmErrorKind = 'server';
  if (status === 429) kind = classifyOpenAIError(err).outcome === 'quota' ? 'quota_exhausted' : 'rate_limited';
  else if (status === 401 || status === 403) kind = 'auth';
  else if (status === 400) kind = 'invalid_request';
  else if ((err as { name?: string })?.name?.includes('Timeout')) kind = 'timeout';
  return new LlmError(kind, 'openai', `OpenAI-compatible call failed: ${(err as Error)?.message ?? String(err)}`, undefined, [], err);
}

export const openaiProvider: LlmProvider = {
  name: 'openai',
  available: isOpenAIAvailable,
  async complete(spec, req: LlmRequest): Promise<ProviderCompletion> {
    const json = req.mode === 'json';
    const promptOnlyJson = json && spec.jsonMode === 'prompt';
    const maxTokens = Math.min(req.maxTokens ?? spec.maxTokens, spec.maxTokens);
    try {
      // Every request takes a lease on the shared guards, like the other providers (#218).
      const completion = await withLease(
        'openai',
        req.ctx,
        estimateTokens(req, maxTokens),
        async () => {
          const res = await clientFor(spec).chat.completions.create(
            {
              model: spec.model,
              temperature: spec.temperature,
              max_tokens: maxTokens,
              messages: [
                { role: 'system', content: promptOnlyJson ? `${req.system}\n\nReturn only a valid JSON object.` : req.system },
                { role: 'user', content: req.user },
              ],
              ...(json && !promptOnlyJson ? { response_format: { type: 'json_object' as const } } : {}),
            },
            { timeout: spec.timeoutMs, signal: req.signal },
          );
          return {
            value: res,
            usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0, model: spec.model },
          };
        },
        { signal: req.signal, classify: classifyOpenAIError },
      );
    } catch (err) {
      if (err instanceof LlmError || err instanceof AppError) throw err;
      throw mapOpenAIError(err);
    }

    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) throw new LlmError('empty', 'openai', 'OpenAI-compatible provider returned an empty response', undefined, []);
    return {
      text,
      usage: {
        inputTokens: completion.usage?.prompt_tokens,
        outputTokens: completion.usage?.completion_tokens,
      },
    };
  },
};
