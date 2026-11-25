import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransition, guardedTransition } from '../src/lib/transitions';

test('status maps allow valid moves and reject terminal rewinds', () => {
  assert.equal(canTransition('signerAttestation', 'PREPARED', 'SUBMITTED'), true);
  assert.equal(canTransition('signerAttestation', 'CONFIRMED', 'PREPARED'), false);
  assert.equal(canTransition('adminOperation', 'READY', 'SUBMITTED'), true);
  assert.equal(canTransition('adminOperation', 'SUCCESS', 'FAILED'), false);
});

test('guardedTransition does not call the writer for illegal moves', async () => {
  let calls = 0;
  assert.equal(await guardedTransition('alertDelivery', 'SENT', 'FAILED', async () => { calls++; return 1; }), false);
  assert.equal(calls, 0);
  assert.equal(await guardedTransition('alertDelivery', 'FAILED', 'SENT', async () => { calls++; return 1; }), true);
  assert.equal(calls, 1);
});
