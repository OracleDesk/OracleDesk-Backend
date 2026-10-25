import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSupportMultipleStellarNetworksWith } from '../src/services/support-multiple-stellar-networks-with.service';

test('evaluateSupportMultipleStellarNetworksWith: evaluates healthy, degraded, and halted verdicts', () => {
  assert.equal(evaluateSupportMultipleStellarNetworksWith({ marketKey: 'mkt-1', primaryUnits: 15, secondaryUnits: 10, maxThreshold: 100 }).verdict, 'healthy');
  assert.equal(evaluateSupportMultipleStellarNetworksWith({ marketKey: 'mkt-2', primaryUnits: 35, secondaryUnits: 25 }).verdict, 'degraded');
  assert.equal(evaluateSupportMultipleStellarNetworksWith({ marketKey: 'mkt-3', primaryUnits: 70, secondaryUnits: 20, maxThreshold: 100 }).verdict, 'halted');
  assert.throws(() => evaluateSupportMultipleStellarNetworksWith({ marketKey: '   ', primaryUnits: 1, secondaryUnits: 1 }), /marketKey is required/);
});
