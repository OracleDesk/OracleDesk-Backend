import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './helpers/env';
import { loadPolicies, setDemotedModels, getEffectiveChain, DEFAULT_POLICIES } from '../src/lib/llm/policy';
import { createRouter } from '../src/lib/llm/router';
import { twoProportionTest } from '../src/lib/stats';
import { evaluateDrift } from '../src/services/llm-canary.service';

setupTestEnv();

test('pinned model policy requires an explicit distinct fallback', () => {
  assert.throws(
    () =>
      loadPolicies(
        JSON.stringify({
          forecasting: [
            {
              provider: 'gemini',
              model: 'gemini-2.0-flash-001',
              temperature: 0.1,
              maxTokens: 2048,
              timeoutMs: 60000,
              pinned: true,
            },
          ],
        }),
      ),
    /explicit fallback/,
  );

  const valid = loadPolicies(
    JSON.stringify({
      forecasting: [
        {
          provider: 'gemini',
          model: 'gemini-2.0-flash-001',
          temperature: 0.1,
          maxTokens: 2048,
          timeoutMs: 60000,
          pinned: true,
        },
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          temperature: 0.2,
          maxTokens: 2048,
          timeoutMs: 60000,
        },
      ],
    }),
  );
  assert.equal(valid.forecasting[0].pinned, true);
  assert.equal(valid.forecasting.length, 2);
});

test('setDemotedModels reorders demoted models behind healthy fallbacks', () => {
  setDemotedModels([{ task: 'forecasting', provider: 'anthropic', model: 'claude-sonnet-4-6' }]);
  const chain = getEffectiveChain('forecasting', DEFAULT_POLICIES);
  assert.equal(chain[0].provider, 'gemini');
  assert.equal(chain[1].provider, 'anthropic');
  setDemotedModels([]);
});

test('twoProportionTest and evaluateDrift flag statistically significant drops', () => {
  const stat = twoProportionTest(48, 50, 10, 50);
  assert.ok(stat.pValue < 0.001);

  const drift = evaluateDrift(
    { passCount: 10, sampleCount: 50, meanScore: 0.2, servedModel: 'gemini-2.0-flash-002' },
    { passCount: 48, sampleCount: 50, passRate: 0.96, meanScore: 0.96, scoreStdDev: 0.1 },
    0.05,
  );
  assert.equal(drift.drifted, true);
  assert.ok(drift.driftReason?.includes('pass_rate_drop'));
});

test('router records provider-reported servedModel in provenance', async () => {
  const router = createRouter(
    DEFAULT_POLICIES,
    {
      anthropic: {
        name: 'anthropic',
        available: () => true,
        complete: async () => ({
          text: '{"ok":true}',
          servedModel: 'claude-sonnet-4-6-20260217',
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      },
    },
  );
  const res = await router.complete({
    task: 'generic_json',
    system: 'Return JSON',
    user: 'ping',
    mode: 'json',
  });
  assert.equal(res.provenance.model, 'claude-sonnet-4-6');
  assert.equal(res.provenance.servedModel, 'claude-sonnet-4-6-20260217');
});
