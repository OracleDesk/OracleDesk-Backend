import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProjectTradeRedeemedAndFeesswept } from '../src/services/project-trade-redeemed-and-feesswept.service';

test('evaluateProjectTradeRedeemedAndFeesswept: evaluates healthy, degraded, and halted verdicts', () => {
  assert.equal(evaluateProjectTradeRedeemedAndFeesswept({ marketKey: 'mkt-1', primaryUnits: 15, secondaryUnits: 10, maxThreshold: 100 }).verdict, 'healthy');
  assert.equal(evaluateProjectTradeRedeemedAndFeesswept({ marketKey: 'mkt-2', primaryUnits: 35, secondaryUnits: 25 }).verdict, 'degraded');
  assert.equal(evaluateProjectTradeRedeemedAndFeesswept({ marketKey: 'mkt-3', primaryUnits: 70, secondaryUnits: 20, maxThreshold: 100 }).verdict, 'halted');
  assert.throws(() => evaluateProjectTradeRedeemedAndFeesswept({ marketKey: '   ', primaryUnits: 1, secondaryUnits: 1 }), /marketKey is required/);
});
