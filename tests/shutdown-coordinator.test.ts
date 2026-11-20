/**
 * Shutdown coordinator unit tests (#264).
 * No DB or Redis needed — all deps are in-memory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// The coordinator keeps its registry and `running` flag in module state, so
// each test loads a fresh instance.
async function freshCoordinator() {
  const path = require.resolve('../src/lib/shutdown-coordinator');
  delete require.cache[path];
  return import('../src/lib/shutdown-coordinator');
}

test('runs handlers in stage order', async () => {
  const { onShutdown, runShutdown } = await freshCoordinator();
  const order: string[] = [];
  onShutdown('stop-intake',    'a', async () => { order.push('a'); }, 500);
  onShutdown('release-leases', 'b', async () => { order.push('b'); }, 500);
  onShutdown('stop-producers', 'c', async () => { order.push('c'); }, 500);
  await runShutdown(5_000);
  assert.deepEqual(order, ['a', 'c', 'b']);
});

test('reports ok outcome for successful step', async () => {
  const { onShutdown, runShutdown } = await freshCoordinator();
  onShutdown('stop-intake', 'noop', async () => {}, 500);
  const { steps } = await runShutdown(5_000);
  assert.equal(steps[0].name, 'noop');
  assert.equal(steps[0].outcome, 'ok');
});

test('reports timeout when step exceeds budget', async () => {
  const { onShutdown, runShutdown } = await freshCoordinator();
  onShutdown('stop-intake', 'slow', async () => new Promise((r) => setTimeout(r, 2_000).unref()), 50);
  const { steps } = await runShutdown(5_000);
  assert.equal(steps[0].outcome, 'timeout');
});

test('reports error outcome for a thrown step', async () => {
  const { onShutdown, runShutdown } = await freshCoordinator();
  onShutdown('stop-intake', 'boom', async () => { throw new Error('oops'); }, 500);
  const { steps } = await runShutdown(5_000);
  assert.equal(steps[0].outcome, 'error');
  assert.equal(steps[0].error, 'oops');
});

test('ignores duplicate runShutdown calls', async () => {
  const { onShutdown, runShutdown } = await freshCoordinator();
  let calls = 0;
  onShutdown('stop-intake', 'counter', async () => { calls++; }, 500);
  await runShutdown(5_000);
  const second = await runShutdown(5_000);
  assert.equal(calls, 1);
  assert.equal(second.steps.length, 0);
});
