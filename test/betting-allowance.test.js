import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBalances, walletAvailable } from '../src/betting/ledger.js';

const red = ['A', 'B'];
const blue = ['C', 'D'];
const day = (n) => new Date(2026, 9, n, 12).getTime();
const house = (n, stake, extra = {}) => ({
  kind: 'house', allowancePolicy: 2, bettor: 'S', placedAt: day(n),
  matchupKey: 'A::B|C::D', stake, odds: 2,
  outcome: { test: 'winner', team: blue }, void: false, ...extra,
});
const match = (n, extra = {}) => ({
  id: `match-${n}`, timestamp: day(n) + 300000, teamA: red, teamB: blue,
  winner: 'A', goalsA: 5, goalsB: 2, matchDuration: 240000,
  goalLog: [{ team: 'red', timestamp: 30000 }], ...extra,
});
const wallet = (bets, matches, n, player = 'S') => walletAvailable(player, bets, matches, day(n) + 600000);

test('initial allowance, repeated one-ball losses, and no duplicate allowance on the same day', () => {
  assert.deepEqual(wallet([], [], 10), { balance: 20, allowance: 20, allowanceCredited: false });
  const bets = [house(10, 1), house(11, 1), house(12, 1)];
  const matches = [match(10), match(11), match(12)];
  assert.equal(computeBalances(bets, matches, day(13)).get('S').balance, 19);
  assert.deepEqual(wallet(bets, matches, 12), { balance: 19, allowance: 1, allowanceCredited: true });
  assert.deepEqual(wallet(bets, matches, 13), { balance: 20, allowance: 1, allowanceCredited: false });
});

test('sum all stakes on the previous active day, ignoring inactive days', () => {
  const bets = [house(10, 1), house(10, 3)];
  assert.equal(wallet(bets, [match(10)], 11).allowance, 4);
  assert.equal(wallet(bets, [match(10)], 20).balance, 20);
  assert.equal(wallet([...bets, house(20, 4)], [match(10), match(20)], 20).balance, 16);
});

test('winning stakes count, winnings remain, and allowance is capped at 20', () => {
  const bets = [house(10, 20, { outcome: { test: 'winner', team: red } }), house(11, 30)];
  assert.equal(wallet(bets.slice(0, 1), [match(10)], 11).balance, 60);
  assert.equal(wallet(bets, [match(10), match(11)], 12).allowance, 20);
  assert.equal(wallet(bets, [match(10), match(11)], 12).balance, 50);
});

test('refunds, voids and inactive days do not manufacture or reset allowances', () => {
  const bets = [house(10, 4), house(11, 20), house(12, 20, { void: true })];
  assert.deepEqual(wallet(bets, [match(10)], 13), { balance: 20, allowance: 4, allowanceCredited: false });
  assert.equal(wallet([house(10, 20)], [], 13).balance, 20);
  assert.equal(computeBalances([house(10, 20)], [], day(13)).get('S').balance, 0);
});

test('refunds on a mixed day are excluded from the next allowance', () => {
  const bets = [house(10, 4), house(10, 16, { placedAt: day(10) + 100000 })];
  assert.equal(wallet(bets, [match(10)], 11).allowance, 4);
});

test('open bets reserve stakes and credit the allowance once', () => {
  const bets = [house(10, 4), house(11, 2), house(11, 2)];
  assert.deepEqual(wallet(bets, [match(10)], 11), { balance: 16, allowance: 4, allowanceCredited: true });
  assert.equal(computeBalances(bets, [match(10)], day(11) + 600000).get('S').open, 2);
  assert.equal(wallet(bets, [match(10)], 12).balance, 20); // both new bets now refunded
});

test('editing or deleting a result recomputes eligibility without order dependence', () => {
  const bets = [house(10, 4), house(11, 10)];
  assert.deepEqual(wallet(bets, [match(10), match(11)], 12), wallet([...bets].reverse(), [match(11), match(10)], 12));
  assert.equal(wallet(bets, [match(10), match(11, { deleted: true })], 12).allowance, 4);
  assert.equal(wallet(bets, [match(10), match(11, { winner: 'B' })], 12).allowance, 10);
});

test('historical grants and a mixed deployment day are preserved', () => {
  const bets = [house(8, 1, { allowancePolicy: undefined }), house(9, 1, { allowancePolicy: undefined })];
  assert.equal(computeBalances(bets, [], day(10)).get('S').balance, 40); // historical refunds unchanged
  const settled = [match(8), match(9)];
  assert.equal(wallet(bets, settled, 10).balance, 39); // 38 earned before rollout + 1 today
  assert.equal(wallet([...bets, house(9, 3)], settled, 9).allowance, 20);
  assert.equal(wallet([...bets, house(9, 3)], settled, 10).allowance, 4);
  assert.equal(wallet([...bets, house(10, 1)], [...settled, match(10)], 10).balance, 38);
});

test('challenges use each participant’s own stake and skip unaccepted cancellations', () => {
  const challenge = { kind: 'challenge', allowancePolicy: 2, matchupKey: 'A::B|C::D',
    challenger: 'S', challengerStake: 4, opponentStake: 7, placedAt: day(10),
    acceptedBy: 'T', acceptedAt: day(10), outcome: { test: 'winner', team: red } };
  assert.equal(wallet([challenge], [match(10)], 11).allowance, 4);
  assert.equal(wallet([challenge], [match(10)], 11, 'T').allowance, 7);
  const cancelled = { ...challenge, acceptedBy: null, acceptedAt: null };
  assert.equal(computeBalances([cancelled], [match(10)], day(11)).get('S').balance, 0);
  assert.equal(wallet([cancelled], [match(10)], 11).balance, 20);
});

test('local days still work across daylight saving transitions', () => {
  const bets = [house(24, 4), house(25, 4)];
  assert.equal(wallet(bets, [match(24), match(25)], 26).balance, 20);
  assert.equal(wallet(bets, [match(24), match(25)], 26).allowance, 4);
});
