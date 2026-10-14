import test from 'node:test';
import assert from 'node:assert/strict';
import { wheelSegments } from '../src/betting/wheel.js';
import { walletAvailable, computeBalances, dayKey } from '../src/betting/ledger.js';

test('ten equal segments preserve the exact mean for every possible net allowance', () => {
  for (let amount = 0; amount <= 20; amount++) {
    const segments = wheelSegments(amount);
    assert.equal(segments.length, 10);
    assert.equal(segments.reduce((a, b) => a + b, 0), 10 * amount);
    assert.ok(segments.every(n => Number.isInteger(n) && n >= 0 && n <= 100));
  }
  assert.deepEqual(wheelSegments(20), [0, 0, 0, 10, 10, 10, 20, 20, 30, 100]);
});

test('a saved spin replaces the grant once, zero stays zero, and unused rewards cannot be farmed', () => {
  const now = new Date('2026-10-14T12:00:00Z').getTime();
  const choice = { id: 'spin', kind: 'allowance', mode: 'wheel', bettor: 'S', placedAt: now,
    allowance: 20, repayment: 0, segments: wheelSegments(20), segment: 9, payout: 100 };
  const wallet = (bets, time = now) => walletAvailable('S', bets, [], time);
  assert.equal(wallet([choice]).balance, 100);
  assert.equal(wallet([{ ...choice, payout: 0, segment: 0 }]).balance, 0);
  const bet = { kind: 'house', allowancePolicy: 2, bettor: 'S', stake: 10, odds: 2,
    matchupKey: 'A::B|C::D', outcome: { test: 'winner', team: ['A', 'B'] }, placedAt: now };
  assert.equal(wallet([choice, bet]).balance, 90);
  assert.equal(wallet([choice, { ...bet, void: true }]).balance, 100);
  assert.equal(computeBalances([choice], [], now).get('S').balance, 0);
  assert.equal(wallet([choice], now + 86400000).balance, 20); // unused reward expires
  const loan = { kind: 'credit', bettor: 'S', advance: 10, repayment: 13, placedAt: now - 86400000 };
  const netChoice = { ...choice, repayment: 10, segments: wheelSegments(10), segment: 6, payout: 10 };
  const withLoan = wallet([loan, netChoice, bet]);
  assert.equal(withLoan.balance, 10); // 10 advance + 10 reward - 10 stake, no second deduction
  assert.equal(withLoan.debt, 3);
  assert.equal(dayKey(Date.parse('2026-10-14T22:30:00Z')), dayKey(Date.parse('2026-10-15T09:00:00Z')));
});
