import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRunALiveModePreflight } from '../src/services/run-a-live-mode-preflight.service';

test('evaluateRunALiveModePreflight: evaluates healthy, degraded, and halted verdicts', () => {
  assert.equal(evaluateRunALiveModePreflight({ marketKey: 'mkt-1', primaryUnits: 15, secondaryUnits: 10, maxThreshold: 100 }).verdict, 'healthy');
  assert.equal(evaluateRunALiveModePreflight({ marketKey: 'mkt-2', primaryUnits: 35, secondaryUnits: 25 }).verdict, 'degraded');
  assert.equal(evaluateRunALiveModePreflight({ marketKey: 'mkt-3', primaryUnits: 70, secondaryUnits: 20, maxThreshold: 100 }).verdict, 'halted');
  assert.throws(() => evaluateRunALiveModePreflight({ marketKey: '   ', primaryUnits: 1, secondaryUnits: 1 }), /marketKey is required/);
});
