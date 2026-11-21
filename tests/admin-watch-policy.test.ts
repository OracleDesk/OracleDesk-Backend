import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAdminAction } from '../src/services/admin-watch/policy';

test('unmatched treasury admin actions are critical and pause all scopes', () => {
  assert.deepEqual(classifyAdminAction({ contract: 'treasury', functionName: 'withdraw' }), {
    severity: 'critical', scopes: ['ALL'], source: 'chain_admin', reason: 'unexpected treasury.withdraw',
  });
});

test('matched console actions are not treated as unexpected', () => {
  assert.equal(classifyAdminAction({ contract: 'treasury', functionName: 'withdraw', matchedOperation: true }), null);
});
