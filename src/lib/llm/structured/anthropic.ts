/**
 * Anthropic structured output (#65): a forced tool call whose `input_schema`
 * is the spec's JSON Schema. Model and temperature come from the policy
 * ModelSpec (#218).
 */
import { AppError } from '../../../middlewares/error.middleware';
import { canonicalJson, sha256Hex } from '../../../utils/hash.util';
import { logger } from '../../logger';
import { estimateTokens, withLease } from '../../llm-budget';
import type { StructuredSpec } from '../../llm-schema';
import { classifyAnthropicError, getAnthropicClient, isAnthropicAvailable } from '../providers/anthropic';
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

async function attempt<T>(spec: StructuredSpec<T>, model: ModelSpec, run: Run): Promise<{ value: T } & Served> {
  const client = getAnthropicClient(model.baseUrl);
  if (!client) throw new AppError(503, 'LLM_UNAVAILABLE', 'ANTHROPIC_API_KEY is not set');
  const messages: any[] = [{ role: 'user', content: run.prompts.user }];
  let maxTokens = run.maxTokens;
  let raised = false;
  let repaired = false;
  let usage = null as Served['usage'];

  for (;;) {
    run.calls.n++;
    const budget = maxTokens;
    const message = await withLease(
      'anthropic',
      run.ctx,
      estimateTokens({ system: run.prompts.system, user: JSON.stringify(messages) }, budget),
      async () => {
        const res = await client.messages.create(
          {
            model: model.model,
            max_tokens: budget,
            temperature: model.temperature,
            system: run.prompts.system,
            messages,
            tools: [{ name: spec.name, description: spec.description, input_schema: spec.jsonSchema }],
            tool_choice: { type: 'tool', name: spec.name },
          },
          { signal: run.signal },
        );
        return {
          value: res,
          usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0, model: model.model },
        };
      },
      { signal: run.signal, classify: classifyAnthropicError },
    );

    if (message.usage) {
      usage = {
        inputTokens: (usage?.inputTokens ?? 0) + (Number(message.usage.input_tokens) || 0),
        outputTokens: (usage?.outputTokens ?? 0) + (Number(message.usage.output_tokens) || 0),
      };
    }

    // A truncated tool input is not worth a repair turn at the same budget:
    // raise the budget once, then give up with a specific reason.
    if (message.stop_reason === 'max_tokens') {
      const next = raisedBudget(maxTokens, model);
      if (!raised && maxTokens < MAX_TOKENS_CEILING && next > maxTokens) {
        raised = true;
        maxTokens = next;
        logger.warn({ spec: spec.name, maxTokens }, 'Anthropic structured output truncated; retrying with a larger budget');
        continue;
      }
      throw new StructuredValidationError('anthropic', ['output truncated at max_tokens']);
    }

    // The tool_use block may follow a text block; never assume content[0].
    const block = (message.content ?? []).find((b: any) => b.type === 'tool_use' && b.name === spec.name);
    let problem: string;
    if (!block) {
      problem = `- you must call the ${spec.name} tool`;
    } else {
      const checked = check(spec, block.input);
      if (checked.ok) {
        return {
          value: checked.value,
          provider: 'anthropic',
          model: model.model,
          ...(typeof message.model === 'string' && message.model ? { servedModel: message.model } : {}),
          attempts: run.calls.n,
          outputSha256: sha256Hex(canonicalJson(block.input)),
          usage,
          params: { temperature: model.temperature, maxTokens },
        };
      }
      problem = checked.issues;
    }

    if (repaired) throw new StructuredValidationError('anthropic', [problem]);
    repaired = true;
    messages.push({ role: 'assistant', content: message.content });
    messages.push(
      block
        ? {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: block.id,
              is_error: true,
              content: `Your input failed validation:\n${problem}\nCall ${spec.name} again with corrected input.`,
            }],
          }
        : { role: 'user', content: `You did not call the required tool.\n${problem}\nCall ${spec.name} with valid input.` },
    );
  }
}

export const anthropicStructured: StructuredAdapter = {
  provider: 'anthropic',
  available: isAnthropicAvailable,
  attempt,
};
