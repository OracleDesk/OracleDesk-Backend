import test from 'node:test';
import assert from 'node:assert/strict';
import { runMarketAnalyses } from '../src/agents/trader-scheduler';

test('trader scheduler bounds concurrent analyses and preserves task order', async () => {
  let active = 0;
  let peak = 0;
  const result = await runMarketAnalyses(
    [{ marketId: 'a', deadlineAt: Date.now() + 1_000 }, { marketId: 'b', deadlineAt: Date.now() + 1_000 }, { marketId: 'c', deadlineAt: Date.now() + 1_000 }],
    async (task) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return task.marketId;
    },
    { concurrency: 2 },
  );
  assert.equal(peak, 2);
  assert.deepEqual(result.map((item) => item.marketId), ['a', 'b', 'c']);
  assert.ok(result.every((item) => item.status === 'DONE'));
});
