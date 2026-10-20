import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQuarantineUndecodableEventsInsteadOf } from '../src/services/quarantine-undecodable-events-instead-of.service';

test('evaluateQuarantineUndecodableEventsInsteadOf: evaluates healthy, degraded, and halted verdicts', () => {
  assert.equal(evaluateQuarantineUndecodableEventsInsteadOf({ marketKey: 'mkt-1', primaryUnits: 15, secondaryUnits: 10, maxThreshold: 100 }).verdict, 'healthy');
  assert.equal(evaluateQuarantineUndecodableEventsInsteadOf({ marketKey: 'mkt-2', primaryUnits: 35, secondaryUnits: 25 }).verdict, 'degraded');
  assert.equal(evaluateQuarantineUndecodableEventsInsteadOf({ marketKey: 'mkt-3', primaryUnits: 70, secondaryUnits: 20, maxThreshold: 100 }).verdict, 'halted');
  assert.throws(() => evaluateQuarantineUndecodableEventsInsteadOf({ marketKey: '   ', primaryUnits: 1, secondaryUnits: 1 }), /marketKey is required/);
});
