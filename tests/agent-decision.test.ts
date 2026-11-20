import test from 'node:test';
import assert from 'node:assert/strict';
import { recordAgentDecision } from '../src/services/agent-decision.service';

test('agent decision writes are stable, digest inputs, and upsert by cycle decision key', async () => {
  const writes: any[] = [];
  const db = {
    agentDecision: {
      upsert: async (input: any) => {
        writes.push(input);
        return input.create;
      },
    },
  };
  const base = {
    cycleId: 'cyc-test',
    agentType: 'TRADER' as const,
    kind: 'SKIP' as const,
    reasonCode: 'EDGE_BELOW_MIN' as const,
    marketId: 'market-1',
    inputs: { edge: 0.02, marketProb: 0.5 },
  };

  await recordAgentDecision(base, db as any);
  await recordAgentDecision({
    ...base,
    inputs: { marketProb: 0.5, edge: 0.02 },
    traceId: 'trace-1',
  }, db as any);

  assert.equal(writes.length, 2);
  assert.equal(writes[0].where.decisionKey, writes[1].where.decisionKey);
  assert.equal(writes[0].create.inputsDigest, writes[1].create.inputsDigest);
  assert.equal(writes[1].update.traceId, 'trace-1');
  assert.match(writes[0].create.inputsDigest, /^[a-f0-9]{64}$/);
});
