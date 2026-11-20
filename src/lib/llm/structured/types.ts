/**
 * Structured-output adapters (#65, #218): one per provider, each turning a
 * zod-derived spec plus a policy ModelSpec into a validated value. The loop in
 * src/lib/llm.ts picks the adapters in policy order.
 */
import type { CallContext } from '../../llm-budget';
import { formatIssues, type StructuredSpec } from '../../llm-schema';
import type { LlmTask, ModelSpec } from '../types';

export type StructuredProvider = ModelSpec['provider'];

/** What the serving provider contributes to provenance (#66). */
export interface Served {
  provider: StructuredProvider;
  model: string;
  /** Provider requests made so far, repairs and 429 retries included. */
  attempts: number;
  outputSha256: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  params: { temperature: number; maxTokens: number };
}

/** One structured call, shared by every adapter the loop tries. */
export interface Run {
  prompts: { system: string; user: string };
  /** Output token budget, already capped by the ModelSpec. */
  maxTokens: number;
  ctx: CallContext;
  signal: AbortSignal;
  task: LlmTask;
  calls: { n: number };
}

export interface StructuredAdapter {
  readonly provider: StructuredProvider;
  /** False when the provider has no key (a configuration skip, not a failure). */
  available(): boolean;
  attempt<T>(spec: StructuredSpec<T>, model: ModelSpec, run: Run): Promise<{ value: T } & Served>;
}

/** Upper bound for the one truncation retry. */
export const MAX_TOKENS_CEILING = 16_384;

/** Budget for the single retry after output was cut at max_tokens (#218: never past twice the policy cap). */
export function raisedBudget(current: number, model: ModelSpec): number {
  return Math.min(current * 2, MAX_TOKENS_CEILING, model.maxTokens * 2);
}

/** Output reached us but did not fit the schema (after one repair round). */
export class StructuredValidationError extends Error {
  constructor(public readonly provider: StructuredProvider, public readonly issues: string[]) {
    super(`${provider} output failed validation: ${issues.join('; ').slice(0, 300)}`);
    this.name = 'StructuredValidationError';
  }
}

export type Checked<T> = { ok: true; value: T } | { ok: false; issues: string };

/** zod parse, then the cross-field rule. Never echoes the raw output. */
export function check<T>(spec: StructuredSpec<T>, candidate: unknown): Checked<T> {
  const parsed = spec.zod.safeParse(candidate);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  const problem = spec.postValidate?.(parsed.data) ?? null;
  return problem ? { ok: false, issues: `- ${problem}` } : { ok: true, value: parsed.data };
}
