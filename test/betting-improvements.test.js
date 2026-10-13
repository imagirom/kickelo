import test from 'node:test';
import assert from 'node:assert/strict';
import { lastGoalMs, liveElapsedMs } from '../src/match-timing.js';
import { computeBalances, spendable, canBorrow, creditId, dayKey, firstGoalAt } from '../src/betting/ledger.js';
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

test('credit adds ten now and deducts thirteen from the next active allowance', () => {
  const now = new Date(2026, 9, 13, 12).getTime();
  const next = new Date(2026, 9, 14, 12).getTime();
  const loss = { kind: 'house', bettor: 'S', stake: 20, odds: 2, matchupKey: 'A::B|C::D',
    placedAt: now - 1000, outcome: { test: 'winner', team: ['C', 'D'] } };
  const match = { teamA: ['A', 'B'], teamB: ['C', 'D'], winner: 'A', goalsA: 5, goalsB: 0,
    timestamp: now + 1000, matchStartedAtMs: now, matchDuration: 500,
    goalLog: [{ team: 'red', timestamp: 500 }] };
  assert.equal(canBorrow('S', [loss], [match], now + 2000), true);
  const loan = { kind: 'credit', bettor: 'S', advance: 10, repayment: 13, placedAt: now + 2000 };
  const bets = [loss, loan];
  assert.equal(spendable('S', bets, [match], now + 3000), 10);
  assert.equal(computeBalances(bets, [match], now + 3000).get('S').debt, 13);
  assert.equal(canBorrow('S', bets, [match], now + 3000), false);
  assert.equal(spendable('S', bets, [match], next), 17);
  const nextBet = { ...loss, placedAt: next, stake: 7 };
  assert.equal(spendable('S', [...bets, nextBet], [match], next), 10);
  assert.equal(computeBalances([...bets, nextBet], [match], next).get('S').debt || 0, 0);
  assert.equal(spendable('S', [...bets, { ...nextBet, void: true }], [match], next), 17);
  assert.equal(creditId('S', now), creditId('S', now + 1000));
  assert.equal(canBorrow('New', [], [], now), false);
});
