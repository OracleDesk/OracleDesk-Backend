import assert from 'node:assert/strict';
import test from 'node:test';
import { resolutionTimeline } from '../src/services/resolution-timeline.service';

test('resolution timeline uses ledger seconds for dispute and expiry boundaries', () => {
  const timeline = resolutionTimeline({
    now: 115n,
    closeTime: 100n,
    resolutionGrace: 100n,
    proposedAt: 110n,
    disputeWindow: 20n,
  });
  assert.equal(timeline.disputeWindowEndsAt, 130n);
  assert.equal(timeline.resolutionDeadline, 200n);
  assert.equal(timeline.nextAction, 'dispute_window');
});

test('expired escalation becomes expirable and terminal timelines stay terminal', () => {
  assert.equal(resolutionTimeline({ now: 200n, closeTime: 100n, resolutionGrace: 50n, disputeOpenedAt: 120n, escalationTimeout: 30n }).nextAction, 'expirable');
  assert.equal(resolutionTimeline({ now: 200n, closeTime: 100n, resolutionGrace: 50n, terminal: true }).nextAction, 'terminal');
});
