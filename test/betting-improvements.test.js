import test from 'node:test';
import assert from 'node:assert/strict';
import { lastGoalMs, liveElapsedMs } from '../src/match-timing.js';
import { firstGoalAt } from '../src/betting/ledger.js';
import { evaluateOutcome } from '../src/betting/outcomes.js';

test('duration stops at the winning goal; undo resumes the live clock', () => {
  const goalLog = [10, 20, 30, 40, 50].map(t => ({ team: 'red', timestamp: t * 1000 }));
  assert.equal(lastGoalMs(goalLog), 50000);
  assert.equal(liveElapsedMs(goalLog, 90000), 50000);
  assert.equal(liveElapsedMs(goalLog.slice(0, -1), 90000), 90000);
  const match = { goalLog, matchDuration: 50000, matchStartedAtMs: 100000, timestamp: 190000 };
  assert.equal(firstGoalAt(match), 110000);
  assert.equal(evaluateOutcome(match, { test: 'durationOver', threshold: 60 }), false);
  assert.equal(firstGoalAt({ goalLog, matchDuration: 90000, timestamp: 190000 }), 110000);
});
