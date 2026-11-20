/**
 * OpenAI structured output (#218): `response_format: json_schema` with the
 * spec's strict schema (`openaiSchema`). For OpenAI-compatible servers that
 * reject `response_format` (`jsonMode: 'prompt'`), the JSON Schema goes into
 * the system prompt instead. Either way the reply is parsed and checked by
 * zod, with one repair turn.
 */
import { sha256Hex } from '../../../utils/hash.util';
import { logger } from '../../logger';
import { estimateTokens, withLease } from '../../llm-budget';
import { dropOptionalNulls, type StructuredSpec } from '../../llm-schema';
import { classifyOpenAIError, clientFor, isOpenAIAvailable } from '../providers/openai';
import type { ModelSpec } from '../types';
import {
  MAX_TOKENS_CEILING,
  StructuredValidationError,
  check,
  raisedBudget,
  type Run,
  type Served,
  type StructuredAdapter,
} from './types';

/** System prompt for `jsonMode: 'prompt'`: the schema is the only format instruction. */
export function promptModeSystem(system: string, spec: Pick<StructuredSpec<unknown>, 'jsonSchema'>): string {
  return `${system}\n\nReply with a single JSON object, and nothing else, that matches this JSON Schema:\n${JSON.stringify(spec.jsonSchema)}`;
}

async function attempt<T>(spec: StructuredSpec<T>, model: ModelSpec, run: Run): Promise<{ value: T } & Served> {
  const client = clientFor(model);
  const strict = model.jsonMode !== 'prompt';
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: strict ? run.prompts.system : promptModeSystem(run.prompts.system, spec) },
    { role: 'user', content: run.prompts.user },
  ];
  let maxTokens = run.maxTokens;
  let raised = false;
  let repaired = false;
  let usage = null as Served['usage'];

  for (;;) {
    run.calls.n++;
    const budget = maxTokens;
    const completion = await withLease(
      'openai',
      run.ctx,
      estimateTokens({ system: '', user: JSON.stringify(messages) }, budget),
      async () => {
        const res = await client.chat.completions.create(
          {
            model: model.model,
            temperature: model.temperature,
            max_tokens: budget,
            messages,
            ...(strict
              ? { response_format: { type: 'json_schema', json_schema: { name: spec.name, schema: spec.openaiSchema, strict: true } } }
              : {}),
          },
          { timeout: model.timeoutMs, signal: run.signal },
        );
        return {
          value: res,
          usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0, model: model.model },
        };
      },
      { signal: run.signal, classify: classifyOpenAIError },
    );

    if (completion.usage) {
      usage = {
        inputTokens: (usage?.inputTokens ?? 0) + (Number(completion.usage.prompt_tokens) || 0),
        outputTokens: (usage?.outputTokens ?? 0) + (Number(completion.usage.completion_tokens) || 0),
      };
    }

    const choice = completion.choices?.[0];
    const message = choice?.message;
    // A refusal is the model declining the content, not a transport failure.
    if (message?.refusal) throw new StructuredValidationError('openai', ['model refused']);

    if (choice?.finish_reason === 'length') {
      const next = raisedBudget(maxTokens, model);
      if (!raised && maxTokens < MAX_TOKENS_CEILING && next > maxTokens) {
        raised = true;
        maxTokens = next;
        logger.warn({ spec: spec.name, maxTokens }, 'OpenAI structured output truncated; retrying with a larger budget');
        continue;
      }
      throw new StructuredValidationError('openai', ['output truncated at max_tokens']);
    }

    const text: string = typeof message?.content === 'string' ? message.content : '';
    let problem: string;
    try {
      // Strict mode sends null for optional keys; zod's .optional() wants them absent.
      const checked = check(spec, dropOptionalNulls(spec.jsonSchema, JSON.parse(text)));
      if (checked.ok) {
        return {
          value: checked.value,
          provider: 'openai',
          model: model.model,
          attempts: run.calls.n,
          outputSha256: sha256Hex(text),
          usage,
          params: { temperature: model.temperature, maxTokens },
        };
      }
      problem = checked.issues;
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      problem = `- output is not valid JSON (${err.message.slice(0, 80)})`;
    }

    if (repaired) throw new StructuredValidationError('openai', [problem]);
    repaired = true;
    messages.push(
      { role: 'assistant', content: text },
      { role: 'user', content: `Your previous output failed validation:\n${problem}\nReturn the corrected JSON only.` },
    );
  }
}

export const openaiStructured: StructuredAdapter = {
  provider: 'openai',
  available: isOpenAIAvailable,
  attempt,
};
