import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePersistRawEventXdrAnd } from '../src/services/persist-raw-event-xdr-and.service';

test('evaluatePersistRawEventXdrAnd: evaluates healthy, degraded, and halted verdicts', () => {
  assert.equal(evaluatePersistRawEventXdrAnd({ marketKey: 'mkt-1', primaryUnits: 15, secondaryUnits: 10, maxThreshold: 100 }).verdict, 'healthy');
  assert.equal(evaluatePersistRawEventXdrAnd({ marketKey: 'mkt-2', primaryUnits: 35, secondaryUnits: 25 }).verdict, 'degraded');
  assert.equal(evaluatePersistRawEventXdrAnd({ marketKey: 'mkt-3', primaryUnits: 70, secondaryUnits: 20, maxThreshold: 100 }).verdict, 'halted');
  assert.throws(() => evaluatePersistRawEventXdrAnd({ marketKey: '   ', primaryUnits: 1, secondaryUnits: 1 }), /marketKey is required/);
});
