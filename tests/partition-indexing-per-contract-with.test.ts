import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePartitionIndexingPerContractWith } from '../src/services/partition-indexing-per-contract-with.service';

test('evaluatePartitionIndexingPerContractWith: evaluates healthy, degraded, and halted verdicts', () => {
  assert.equal(evaluatePartitionIndexingPerContractWith({ marketKey: 'mkt-1', primaryUnits: 15, secondaryUnits: 10, maxThreshold: 100 }).verdict, 'healthy');
  assert.equal(evaluatePartitionIndexingPerContractWith({ marketKey: 'mkt-2', primaryUnits: 35, secondaryUnits: 25 }).verdict, 'degraded');
  assert.equal(evaluatePartitionIndexingPerContractWith({ marketKey: 'mkt-3', primaryUnits: 70, secondaryUnits: 20, maxThreshold: 100 }).verdict, 'halted');
  assert.throws(() => evaluatePartitionIndexingPerContractWith({ marketKey: '   ', primaryUnits: 1, secondaryUnits: 1 }), /marketKey is required/);
});
