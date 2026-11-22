/**
 * Provider-native structured outputs (#65, #218). No network: Anthropic,
 * Gemini and OpenAI are replaced through setAnthropicClient /
 * setGeminiModelFactory / setOpenAIClient and replay the response shapes in
 * tests/fixtures/llm/. The fixtures follow the
 * Messages API and generateContent response shapes; they are hand-built
 * examples of those shapes, not captures from a live account.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { setupTestEnv } from './helpers/env';

// Never let a developer's real keys make these tests reachable to a provider.
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
setupTestEnv();

const FIXTURES = join(__dirname, '..', '..', 'tests', 'fixtures', 'llm');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

const PROMPTS = { system: 'You create markets.', user: 'Signals: <untrusted_signals nonce="x">…</untrusted_signals nonce="x">' };

function fakeAnthropic(responses: any[]) {
  const calls: any[] = [];
  return {
    calls,
    client: {
      messages: {
        create: async (body: any) => {
          calls.push(JSON.parse(JSON.stringify(body)));
          const r = responses[Math.min(calls.length - 1, responses.length - 1)];
          if (r instanceof Error) throw r;
          return JSON.parse(JSON.stringify(r));
        },
      },
    },
  };
}

function fakeGemini(responses: any[]) {
  const calls: Array<{ params: any; contents: any }> = [];
  return {
    calls,
    factory: (params: any) => ({
      generateContent: async (contents: any) => {
        calls.push({ params, contents: JSON.parse(JSON.stringify(contents)) });
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (r instanceof Error) throw r;
        const text = r.candidates[0].content.parts[0].text;
        return { response: { text: () => text, usageMetadata: r.usageMetadata } };
      },
    }),
  };
}

async function harness() {
  const llm = await import('../src/lib/llm');
  const gemini = await import('../src/lib/gemini');
  const budget = await import('../src/lib/llm-budget');
  const schema = await import('../src/lib/llm-schema');
  const prevStore = budget.setLlmGuardStore(new budget.MemoryGuardStore());
  budget.setLlmGuardSettings({ rpm: { anthropic: 6000, gemini: 6000, openai: 6000 } });
  return {
    llm, gemini, budget, schema,
    cleanup() {
      llm.setAnthropicClient(null);
      llm.setGeminiModelFactory(null);
      llm.setOpenAIClient(null);
      llm.llmRouter.healthBook.reset();
      budget.setLlmGuardStore(prevStore);
      budget.setLlmGuardSettings({});
    },
  };
}

test('wire schemas convert to JSON Schema without unrepresentable types', async () => {
  const { schema } = await import('../src/lib/llm-schema').then((schema) => ({ schema }));
  for (const spec of [schema.marketProposalSpec, schema.traceReasoningSpec]) {
    assert.equal(spec.jsonSchema.type, 'object');
    assert.equal(spec.jsonSchema.$schema, undefined);
    // The #90 price fields and #302 hedge_predicates are the only optional ones;
    // nothing else may have become optional through a .default/.catch.
    assert.deepEqual(
      [...spec.jsonSchema.required].sort(),
      Object.keys(spec.jsonSchema.properties)
        .filter((k) => !k.startsWith('price_') && k !== 'hedge_predicates')
        .sort(),
      'every wire field but the optional price and hedge_predicates fields is required',
    );
  }
  assert.equal(schema.marketProposalSpec.jsonSchema.properties.settlement_currency.const, 'USDC');
  // A type with no JSON Schema form must fail loudly at definition time.
  assert.throws(() => schema.defineStructured('bad', 'bad', z.object({ at: z.date() })));
});

test('toGeminiSchema strips unsupported keywords and maps types (snapshot)', async () => {
  const { marketProposalSpec, toGeminiSchema } = await import('../src/lib/llm-schema');
  assert.deepEqual(marketProposalSpec.geminiSchema, fixture('gemini-market-proposal-schema'));

  const seen: string[] = [];
  const walk = (n: any) => {
    if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) {
        if (k !== 'properties' && k !== 'enum') seen.push(k);
        if (k === 'properties') Object.values(v as object).forEach(walk);
        else walk(v);
      }
    }
  };
  walk(marketProposalSpec.geminiSchema);
  for (const banned of ['additionalProperties', '$schema', 'minLength', 'pattern', 'const', 'exclusiveMinimum']) {
    assert.ok(!seen.includes(banned), `${banned} must not reach Gemini`);
  }

  const converted = toGeminiSchema({
    type: 'object',
    additionalProperties: false,
    properties: {
      a: { type: 'string', minLength: 3, pattern: '^x', const: 'x' },
      b: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] },
    },
    required: ['a'],
  });
  assert.deepEqual(converted, {
    type: 'object',
    properties: {
      a: { type: 'string', enum: ['x'], format: 'enum' },
      b: { type: 'number', minimum: 0, maximum: 1, nullable: true },
    },
    propertyOrdering: ['a', 'b'],
    required: ['a'],
  });
});

test('anthropic forced tool call returns a typed proposal', async () => {
  const h = await harness();
  const a = fakeAnthropic([fixture('anthropic-tool-use-success')]);
  h.llm.setAnthropicClient(a.client);
  try {
    const result = await h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS, { maxTokens: 4096, task: 'market_generation' });
    assert.equal(result.provider, 'anthropic');
    assert.equal(result.attempts, 1);
    assert.equal(result.value.category, 'FED');
    assert.deepEqual(result.value.grounding_signal_ids, ['f1']);

    const req = a.calls[0];
    assert.deepEqual(req.tool_choice, { type: 'tool', name: 'submit_market_proposal' });
    assert.equal(req.tools.length, 1);
    assert.equal(req.tools[0].name, 'submit_market_proposal');
    assert.deepEqual(req.tools[0].input_schema, h.schema.marketProposalSpec.jsonSchema);
    assert.equal(req.max_tokens, 4096);
    assert.doesNotMatch(req.system, /CRITICAL|markdown fences/, 'the schema replaces the prose JSON instructions');
    // the response had a text block before the tool_use block; it was skipped
    assert.equal(fixture('anthropic-tool-use-success').content[0].type, 'text');
  } finally {
    h.cleanup();
  }
});

test('anthropic invalid tool input triggers one repair turn with zod issues, then succeeds', async () => {
  const h = await harness();
  const a = fakeAnthropic([fixture('anthropic-tool-use-bad-probability'), fixture('anthropic-tool-use-success')]);
  h.llm.setAnthropicClient(a.client);
  try {
    const result = await h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS);
    assert.equal(result.attempts, 2);
    assert.equal(result.provider, 'anthropic');
    assert.equal(a.calls.length, 2);

    const repair = a.calls[1].messages;
    assert.equal(repair.length, 3);
    assert.equal(repair[1].role, 'assistant');
    assert.equal(repair[1].content[0].type, 'tool_use');
    const turn = repair[2].content[0];
    assert.equal(turn.type, 'tool_result');
    assert.equal(turn.is_error, true);
    assert.equal(turn.tool_use_id, 'toolu_01RecordedBad');
    assert.match(turn.content, /initial_yes_probability/);
  } finally {
    h.cleanup();
  }
});

test('confidence interval post-validation error is fed back in the repair turn', async () => {
  const h = await harness();
  const a = fakeAnthropic([fixture('anthropic-tool-use-bad-interval'), fixture('anthropic-tool-use-success')]);
  h.llm.setAnthropicClient(a.client);
  try {
    const result = await h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS);
    assert.equal(result.attempts, 2);
    const turn = a.calls[1].messages[2].content[0];
    assert.match(turn.content, /confidence_interval must satisfy lower < initial_yes_probability/);
  } finally {
    h.cleanup();
  }
});

test('anthropic repeated failure falls back to gemini structured output', async () => {
  const h = await harness();
  const a = fakeAnthropic([fixture('anthropic-tool-use-bad-probability')]);
  const g = fakeGemini([fixture('gemini-json-success')]);
  h.llm.setAnthropicClient(a.client);
  h.llm.setGeminiModelFactory(g.factory);
  try {
    const result = await h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS);
    assert.equal(result.provider, 'gemini');
    assert.equal(result.attempts, 3, 'two anthropic calls (one repair) plus one gemini call');
    assert.equal(a.calls.length, 2, 'exactly one repair per provider');

    const cfg = g.calls[0].params.generationConfig;
    assert.equal(cfg.responseMimeType, 'application/json');
    assert.deepEqual(cfg.responseSchema, h.schema.marketProposalSpec.geminiSchema);
  } finally {
    h.cleanup();
  }
});

test('gemini schema violation is repaired once, then fails with LLM_STRUCTURED_OUTPUT_FAILED', async () => {
  const h = await harness();
  const g = fakeGemini([fixture('gemini-schema-violation')]);
  h.llm.setGeminiModelFactory(g.factory);
  try {
    await assert.rejects(
      () => h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS),
      (err: any) => {
        assert.equal(err.code, 'LLM_STRUCTURED_OUTPUT_FAILED');
        assert.equal(err.statusCode, 422);
        assert.equal(err.details.provider, 'gemini');
        assert.match(err.details.issues.join('\n'), /category/);
        return true;
      },
    );
    assert.equal(g.calls.length, 2, 'one call plus exactly one repair');
    const contents = g.calls[1].contents;
    assert.equal(contents.length, 3);
    assert.equal(contents[1].role, 'model');
    assert.match(contents[2].parts[0].text, /failed validation/);
    assert.match(contents[2].parts[0].text, /category/);
  } finally {
    h.cleanup();
  }
});

test('a gemini reply wrapped in markdown fences is rejected, not repaired by stripping', async () => {
  const h = await harness();
  const fenced = {
    candidates: [{ content: { parts: [{ text: '```json\n' + fixture('gemini-json-success').candidates[0].content.parts[0].text + '\n```' }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
  };
  const g = fakeGemini([fenced]);
  h.llm.setGeminiModelFactory(g.factory);
  try {
    await assert.rejects(
      () => h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS),
      (err: any) => err.code === 'LLM_STRUCTURED_OUTPUT_FAILED' && /not valid JSON/.test(err.details.issues.join('\n')),
    );
  } finally {
    h.cleanup();
  }
});

test('a truncated anthropic tool input raises the token budget once instead of repairing', async () => {
  const h = await harness();
  const a = fakeAnthropic([fixture('anthropic-truncated'), fixture('anthropic-tool-use-success')]);
  h.llm.setAnthropicClient(a.client);
  try {
    const result = await h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS, { maxTokens: 1000 });
    assert.equal(result.attempts, 2);
    assert.deepEqual(a.calls.map((c) => c.max_tokens), [1000, 2000]);
    assert.equal(a.calls[1].messages.length, 1, 'no repair turn was appended');
  } finally {
    h.cleanup();
  }
});

test('a budget rejection does not fall back to another provider', async () => {
  const h = await harness();
  const a = fakeAnthropic([fixture('anthropic-tool-use-success')]);
  const g = fakeGemini([fixture('gemini-json-success')]);
  h.llm.setAnthropicClient(a.client);
  h.llm.setGeminiModelFactory(g.factory);
  h.budget.setLlmGuardSettings({ rpm: { anthropic: 6000, gemini: 6000 }, tokenBudget: 10 });
  try {
    await assert.rejects(
      () => h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS),
      (err: any) => err.code === 'LLM_BUDGET_EXCEEDED',
    );
    assert.equal(a.calls.length + g.calls.length, 0);
  } finally {
    h.cleanup();
  }
});

test('callLLMText falls back to a plain-text gemini call, not a JSON one', async () => {
  const h = await harness();
  const err: any = new Error('upstream exploded');
  err.status = 500;
  const a = fakeAnthropic([err]);
  const textResponse = {
    candidates: [{ content: { parts: [{ text: 'A plain-text answer.' }] } }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
  };
  const g = fakeGemini([textResponse]);
  h.llm.setAnthropicClient(a.client);
  h.llm.setGeminiModelFactory(g.factory);
  try {
    const text = await h.llm.callLLMText('sys', 'user');
    assert.equal(text, 'A plain-text answer.');
    assert.equal(a.calls.length, 1);
    assert.equal(g.calls.length, 1);
    assert.equal(g.calls[0].params.generationConfig.responseMimeType, undefined);
    assert.equal(g.calls[0].params.generationConfig.responseSchema, undefined);
  } finally {
    h.cleanup();
  }
});

test('validateMarketQuestion rejects a fenced reply as invalid JSON', async () => {
  const { validateMarketQuestion } = await import('../src/services/market.service');
  const good = fixture('anthropic-tool-use-success').content[1].input;
  assert.equal(validateMarketQuestion(JSON.stringify(good)).category, 'FED');
  assert.throws(
    () => validateMarketQuestion('```json\n' + JSON.stringify(good) + '\n```'),
    (err: any) => err.code === 'INVALID_LLM_JSON',
  );
});

test('no fence-stripping code path remains in llm.ts, gemini.ts or market.service.ts', () => {
  for (const file of ['lib/llm.ts', 'lib/gemini.ts', 'services/market.service.ts']) {
    const source = readFileSync(join(__dirname, '..', '..', 'src', file), 'utf8');
    assert.doesNotMatch(source, /replace\([^)]*`{3}/, `${file} must not strip markdown fences`);
    assert.doesNotMatch(source, /stripFences/, file);
  }
});

// ─── Policy-driven routing and OpenAI structured outputs (#218) ───────────────

function fakeOpenAI(responses: any[]) {
  const calls: any[] = [];
  return {
    calls,
    client: {
      chat: {
        completions: {
          create: async (body: any) => {
            calls.push(JSON.parse(JSON.stringify(body)));
            const r = responses[Math.min(calls.length - 1, responses.length - 1)];
            if (r instanceof Error) throw r;
            return JSON.parse(JSON.stringify(r));
          },
        },
      },
    },
  };
}

/** A Chat Completion as the API returns it. */
function completion(content: unknown, extra: { finish_reason?: string; refusal?: string } = {}) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model: 'gpt-4o-mini',
    choices: [{
      index: 0,
      finish_reason: extra.finish_reason ?? 'stop',
      message: {
        role: 'assistant',
        content: extra.refusal ? null : typeof content === 'string' ? content : JSON.stringify(content),
        refusal: extra.refusal ?? null,
      },
    }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };
}

const goodProposal = () => fixture('anthropic-tool-use-success').content[1].input;
const badProposal = () => fixture('anthropic-tool-use-bad-probability').content[0].input;

const spec = (provider: string, model: string, extra: Record<string, unknown> = {}) =>
  ({ provider, model, temperature: 0.2, maxTokens: 2048, timeoutMs: 1000, ...extra }) as any;

/** Overrides one task's policy for the duration of `fn` (the router reads the same object). */
async function withPolicy<T>(task: string, chain: any[], fn: () => Promise<T>): Promise<T> {
  const { policies } = await import('../src/lib/llm/policy');
  const prev = (policies as any)[task];
  (policies as any)[task] = chain;
  try {
    return await fn();
  } finally {
    (policies as any)[task] = prev;
  }
}

test('dispute_review policy calls gemini before anthropic', async () => {
  const h = await harness();
  const { decisionSpec } = await import('../src/services/dispute-evaluator.service');
  const a = fakeAnthropic([fixture('anthropic-tool-use-success')]);
  const decision = { outcome: 'YES', confidence: 0.8, citations: ['e1'], reasoning: 'The release settles it.' };
  const g = fakeGemini([{ candidates: [{ content: { parts: [{ text: JSON.stringify(decision) }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 } }]);
  h.llm.setAnthropicClient(a.client);
  h.llm.setGeminiModelFactory(g.factory);
  try {
    const r = await h.llm.callLLMStructured(decisionSpec, PROMPTS, { maxTokens: 1024, task: 'dispute_review' });
    assert.equal(r.provider, 'gemini');
    assert.deepEqual(r.value, decision);
    assert.equal(a.calls.length, 0, 'anthropic is the fallback for dispute_review (#92)');
    assert.equal(g.calls[0].params.generationConfig.temperature, 0, 'the policy temperature, not 0.1');
    assert.deepEqual(r.provenance.route, {
      task: 'dispute_review',
      chain: [{ provider: 'gemini', model: 'gemini-2.0-flash', decision: 'served' }],
    });
  } finally {
    h.cleanup();
  }
});

test('policy model and temperature reach the anthropic request body', async () => {
  const h = await harness();
  const a = fakeAnthropic([fixture('anthropic-tool-use-success')]);
  h.llm.setAnthropicClient(a.client);
  try {
    const r = await withPolicy('forecasting', [spec('anthropic', 'claude-test-model', { temperature: 0.55, maxTokens: 900 })], () =>
      h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS, { maxTokens: 4096, task: 'forecasting' }));
    assert.equal(a.calls[0].model, 'claude-test-model');
    assert.equal(a.calls[0].temperature, 0.55);
    assert.equal(a.calls[0].max_tokens, 900, 'min(opts.maxTokens, spec.maxTokens)');
    assert.equal(r.model, 'claude-test-model');
    assert.deepEqual(r.provenance.params, { temperature: 0.55, maxTokens: 900 });
  } finally {
    h.cleanup();
  }
});

test('policy model reaches getGeminiModel (not GEMINI_MODEL) when overridden', async () => {
  const h = await harness();
  const g = fakeGemini([fixture('gemini-json-success')]);
  h.llm.setGeminiModelFactory(g.factory);
  try {
    const r = await withPolicy('generic_json', [spec('gemini', 'gemini-2.5-pro', { temperature: 0.3 })], () =>
      h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS));
    assert.notEqual(h.gemini.GEMINI_MODEL, 'gemini-2.5-pro');
    assert.equal(g.calls[0].params.model, 'gemini-2.5-pro');
    assert.equal(g.calls[0].params.generationConfig.temperature, 0.3);
    assert.equal(r.model, 'gemini-2.5-pro');
    assert.equal(r.provenance.model, 'gemini-2.5-pro');
  } finally {
    h.cleanup();
  }
});

test('openai strict json_schema returns a typed proposal', async () => {
  const h = await harness();
  const o = fakeOpenAI([completion(goodProposal())]);
  h.llm.setOpenAIClient(o.client);
  try {
    const r = await withPolicy('generic_json', [spec('openai', 'gpt-4o-mini')], () =>
      h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS));
    assert.equal(r.provider, 'openai');
    assert.equal(r.value.category, 'FED');
    assert.equal(r.attempts, 1);
    const req = o.calls[0];
    assert.equal(req.model, 'gpt-4o-mini');
    assert.equal(req.max_tokens, 2048);
    assert.deepEqual(req.response_format, {
      type: 'json_schema',
      json_schema: { name: 'submit_market_proposal', schema: h.schema.marketProposalSpec.openaiSchema, strict: true },
    });
    assert.deepEqual(req.messages.map((m: any) => m.role), ['system', 'user']);
    assert.equal(req.messages[0].content, PROMPTS.system, 'the schema replaces any prose format instructions');
    assert.equal(r.provenance.provider, 'openai');
    assert.deepEqual(r.provenance.usage, { inputTokens: 100, outputTokens: 50 });
  } finally {
    h.cleanup();
  }
});

test("jsonMode: 'prompt' sends no response_format and puts the schema in the system prompt", async () => {
  const h = await harness();
  const o = fakeOpenAI([completion(goodProposal())]);
  h.llm.setOpenAIClient(o.client);
  try {
    const r = await withPolicy('generic_json', [spec('openai', 'local-llama', { jsonMode: 'prompt', baseUrl: 'http://localhost:8080/v1' })], () =>
      h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS));
    assert.equal(r.provider, 'openai');
    assert.equal(o.calls[0].response_format, undefined);
    assert.ok(o.calls[0].messages[0].content.startsWith(PROMPTS.system));
    assert.ok(o.calls[0].messages[0].content.includes(JSON.stringify(h.schema.marketProposalSpec.jsonSchema)));
  } finally {
    h.cleanup();
  }
});

test('openai schema violation is repaired once, then falls back', async () => {
  const h = await harness();
  const o = fakeOpenAI([completion(badProposal())]);
  const g = fakeGemini([fixture('gemini-json-success')]);
  h.llm.setOpenAIClient(o.client);
  h.llm.setGeminiModelFactory(g.factory);
  try {
    const r = await withPolicy('generic_json', [spec('openai', 'gpt-4o-mini'), spec('gemini', 'gemini-2.0-flash', { temperature: 0.1 })], () =>
      h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS));
    assert.equal(r.provider, 'gemini');
    assert.equal(o.calls.length, 2, 'one call plus exactly one repair');
    const repair = o.calls[1].messages;
    assert.deepEqual(repair.map((m: any) => m.role), ['system', 'user', 'assistant', 'user']);
    assert.match(repair[3].content, /failed validation/);
    assert.match(repair[3].content, /initial_yes_probability/);
    assert.equal(r.attempts, 3);
    assert.deepEqual(r.provenance.fallbackFrom, { provider: 'openai', model: 'gpt-4o-mini', errorClass: 'validation' });
    assert.deepEqual(r.provenance.route?.chain.map((c) => c.decision), ['validation', 'served']);
  } finally {
    h.cleanup();
  }
});

test('openai refusal is a validation failure, not a transport failure', async () => {
  const h = await harness();
  const o = fakeOpenAI([completion(null, { refusal: 'I cannot help with that.' })]);
  h.llm.setOpenAIClient(o.client);
  try {
    await withPolicy('generic_json', [spec('openai', 'gpt-4o-mini')], () =>
      assert.rejects(
        () => h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS),
        (err: any) => {
          assert.equal(err.code, 'LLM_STRUCTURED_OUTPUT_FAILED');
          assert.equal(err.statusCode, 422);
          assert.deepEqual(err.details, { provider: 'openai', issues: ['model refused'] });
          return true;
        },
      ));
    assert.equal(o.calls.length, 1, 'a refusal is not repaired');
    assert.deepEqual(h.llm.llmRouter.health().openai, { state: 'healthy', consecutiveFailures: 0 });
  } finally {
    h.cleanup();
  }
});

test('optional fields returned as null by openai are normalised before zod', async () => {
  const h = await harness();
  const withNulls = { ...goodProposal(), price_asset: null, price_threshold: null, price_direction: null, price_close_timestamp: null };
  const o = fakeOpenAI([completion(withNulls)]);
  h.llm.setOpenAIClient(o.client);
  try {
    const r = await withPolicy('generic_json', [spec('openai', 'gpt-4o-mini')], () =>
      h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS));
    assert.equal(o.calls.length, 1, 'no repair turn was needed');
    assert.equal('price_asset' in r.value, false);
    assert.equal('price_close_timestamp' in r.value, false);
    assert.equal(r.value.market_question, goodProposal().market_question);
  } finally {
    h.cleanup();
  }
});

test('openai truncation raises the budget once instead of repairing', async () => {
  const h = await harness();
  const o = fakeOpenAI([completion('{"market_q', { finish_reason: 'length' }), completion(goodProposal())]);
  h.llm.setOpenAIClient(o.client);
  try {
    const r = await withPolicy('generic_json', [spec('openai', 'gpt-4o-mini', { maxTokens: 600 })], () =>
      h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS, { maxTokens: 4096 }));
    assert.equal(r.provider, 'openai');
    assert.deepEqual(o.calls.map((c) => c.max_tokens), [600, 1200]);
    assert.equal(o.calls[1].messages.length, 2, 'no repair turn was appended');
  } finally {
    h.cleanup();
  }
});

test('a provider cooled by the router is skipped by structured calls, and recorded as cooling', async () => {
  const h = await harness();
  const { LlmError } = await import('../src/lib/llm/types');
  const a = fakeAnthropic([fixture('anthropic-tool-use-success')]);
  const g = fakeGemini([fixture('gemini-json-success')]);
  h.llm.setAnthropicClient(a.client);
  h.llm.setGeminiModelFactory(g.factory);
  try {
    h.llm.llmRouter.healthBook.recordFailure('anthropic', new LlmError('rate_limited', 'anthropic', 'slow down', 60_000));
    const r = await h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS, { task: 'market_generation' });
    assert.equal(a.calls.length, 0);
    assert.equal(r.provider, 'gemini');
    assert.equal(r.provenance.fallbackFrom, undefined, 'a skipped provider was never attempted');
    assert.deepEqual(r.provenance.route, {
      task: 'market_generation',
      chain: [
        { provider: 'anthropic', model: 'claude-sonnet-4-6', decision: 'cooling' },
        { provider: 'gemini', model: 'gemini-2.0-flash', decision: 'served' },
      ],
    });

    // Everything cooling: the 503 says so instead of "not configured".
    h.llm.llmRouter.healthBook.recordFailure('gemini', new LlmError('quota_exhausted', 'gemini', 'daily quota'));
    await assert.rejects(
      () => h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS, { task: 'market_generation' }),
      (err: any) => {
        assert.equal(err.statusCode, 503);
        assert.equal(err.code, 'LLM_UNAVAILABLE');
        assert.match(err.message, /cooling down/);
        assert.deepEqual(err.details.chain.map((c: any) => c.decision), ['cooling', 'open']);
        return true;
      },
    );
  } finally {
    h.cleanup();
  }
});

test('three structured 5xx failures cool the provider for completeLLM too', async () => {
  const h = await harness();
  const boom = Object.assign(new Error('overloaded'), { status: 529 });
  const a = fakeAnthropic([boom]);
  const g = fakeGemini([fixture('gemini-json-success')]);
  h.llm.setAnthropicClient(a.client);
  h.llm.setGeminiModelFactory(g.factory);
  try {
    for (let i = 0; i < 3; i++) {
      const r = await h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS);
      assert.equal(r.provider, 'gemini');
      assert.equal(r.provenance.fallbackFrom?.errorClass, 'server_error');
    }
    assert.equal(a.calls.length, 3);
    assert.equal(h.llm.llmRouter.health().anthropic.state, 'cooling');

    const text = await h.llm.callLLMJSON('sys', 'user');
    assert.equal(a.calls.length, 3, 'the router skipped the cooled provider');
    assert.equal(JSON.parse(text).category, 'FED');
  } finally {
    h.cleanup();
  }
});

test('validation failures do not change router health', async () => {
  const h = await harness();
  const a = fakeAnthropic([fixture('anthropic-tool-use-bad-probability')]);
  const g = fakeGemini([fixture('gemini-json-success')]);
  h.llm.setAnthropicClient(a.client);
  h.llm.setGeminiModelFactory(g.factory);
  try {
    for (let i = 0; i < 3; i++) {
      const r = await h.llm.callLLMStructured(h.schema.marketProposalSpec, PROMPTS);
      assert.equal(r.provider, 'gemini');
      assert.equal(r.provenance.fallbackFrom?.errorClass, 'validation');
    }
    assert.equal(a.calls.length, 6, 'anthropic was tried (with one repair) every time');
    assert.deepEqual(h.llm.llmRouter.health().anthropic, { state: 'healthy', consecutiveFailures: 0 });
  } finally {
    h.cleanup();
  }
});

test('toOpenAIStrictSchema closes objects, nulls optional fields and strips keywords (snapshot)', async () => {
  const { marketProposalSpec, toOpenAIStrictSchema, OPENAI_STRICT_KEYWORDS, defineStructured } = await import('../src/lib/llm-schema');
  assert.deepEqual(marketProposalSpec.openaiSchema, fixture('openai-market-proposal-schema'));

  const seen = new Set<string>();
  const walk = (n: any) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      if (n.type === 'object') {
        assert.equal(n.additionalProperties, false, 'every object is closed');
        assert.deepEqual(n.required, Object.keys(n.properties), 'every property is required');
      }
      for (const [k, v] of Object.entries(n)) {
        if (k === 'properties') Object.values(v as object).forEach(walk);
        else if (k !== 'enum') { seen.add(k); walk(v); }
      }
    }
  };
  walk(marketProposalSpec.openaiSchema);
  for (const k of seen) assert.ok((OPENAI_STRICT_KEYWORDS as readonly string[]).includes(k), `${k} must not reach OpenAI`);

  assert.deepEqual(
    toOpenAIStrictSchema({
      type: 'object',
      properties: {
        a: { type: 'string', minLength: 3, pattern: '^x', const: 'x' },
        b: { type: 'number', minimum: 0, maximum: 1 },
        c: { type: 'array', minItems: 1, items: { type: 'object', properties: { d: { type: 'integer' } } } },
      },
      required: ['a'],
    }),
    {
      type: 'object',
      properties: {
        a: { type: 'string', enum: ['x'] },
        b: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        c: {
          anyOf: [
            {
              type: 'array',
              items: { type: 'object', properties: { d: { anyOf: [{ type: 'integer' }, { type: 'null' }] } }, required: ['d'], additionalProperties: false },
            },
            { type: 'null' },
          ],
        },
      },
      required: ['a', 'b', 'c'],
      additionalProperties: false,
    },
  );

  // Shapes strict mode cannot express fail at definition time, as for Gemini.
  assert.throws(() => defineStructured('map', 'map', z.object({ m: z.record(z.string(), z.number()) })), /map with free-form keys/);
  assert.throws(() => toOpenAIStrictSchema({ type: 'array', items: { type: 'string' } }), /object at the root/);
});
