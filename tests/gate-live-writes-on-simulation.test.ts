import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGateLiveWritesOnSimulation } from '../src/services/gate-live-writes-on-simulation.service';

test('evaluateGateLiveWritesOnSimulation: evaluates healthy, degraded, and halted verdicts', () => {
  assert.equal(evaluateGateLiveWritesOnSimulation({ marketKey: 'mkt-1', primaryUnits: 15, secondaryUnits: 10, maxThreshold: 100 }).verdict, 'healthy');
  assert.equal(evaluateGateLiveWritesOnSimulation({ marketKey: 'mkt-2', primaryUnits: 35, secondaryUnits: 25 }).verdict, 'degraded');
  assert.equal(evaluateGateLiveWritesOnSimulation({ marketKey: 'mkt-3', primaryUnits: 70, secondaryUnits: 20, maxThreshold: 100 }).verdict, 'halted');
  assert.throws(() => evaluateGateLiveWritesOnSimulation({ marketKey: '   ', primaryUnits: 1, secondaryUnits: 1 }), /marketKey is required/);
});
