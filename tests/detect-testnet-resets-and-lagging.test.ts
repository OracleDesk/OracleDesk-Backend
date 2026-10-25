import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDetectTestnetResetsAndLagging } from '../src/services/detect-testnet-resets-and-lagging.service';

test('evaluateDetectTestnetResetsAndLagging: evaluates healthy, degraded, and halted verdicts', () => {
  assert.equal(evaluateDetectTestnetResetsAndLagging({ marketKey: 'mkt-1', primaryUnits: 15, secondaryUnits: 10, maxThreshold: 100 }).verdict, 'healthy');
  assert.equal(evaluateDetectTestnetResetsAndLagging({ marketKey: 'mkt-2', primaryUnits: 35, secondaryUnits: 25 }).verdict, 'degraded');
  assert.equal(evaluateDetectTestnetResetsAndLagging({ marketKey: 'mkt-3', primaryUnits: 70, secondaryUnits: 20, maxThreshold: 100 }).verdict, 'halted');
  assert.throws(() => evaluateDetectTestnetResetsAndLagging({ marketKey: '   ', primaryUnits: 1, secondaryUnits: 1 }), /marketKey is required/);
});
