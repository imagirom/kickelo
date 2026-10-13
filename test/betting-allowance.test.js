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

test('allowances sum prior active-day stakes, cap at 20, and credit once', () => {
  assert.equal(wallet([], [], 10).balance, 20);
  const bets = [house(10, 1), house(10, 3), house(20, 4)];
  const matches = [match(10), match(20)];
  assert.equal(wallet(bets.slice(0, 2), matches, 19).allowance, 4);
  assert.equal(wallet(bets, matches, 20).balance, 16);
  assert.equal(wallet(bets, matches, 21).balance, 20);
  assert.equal(wallet([house(10, 30)], [match(10)], 11).allowance, 20);
  const ones = [house(10, 1), house(11, 1), house(12, 1)];
  assert.equal(wallet(ones, [match(10), match(11), match(12)], 13).balance, 20);
});

test('refunds and voids cannot earn allowances; winning stakes and both challenge stakes count', () => {
  const bets = [house(10, 4, { outcome: { test: 'winner', team: red } }),
    house(10, 16, { placedAt: day(10) + 100000 }), house(11, 20), house(12, 20, { void: true })];
  assert.equal(wallet(bets, [match(10)], 13).allowance, 4);
  assert.equal(wallet(bets, [match(10)], 13).balance, 28);
  assert.equal(computeBalances([house(10, 20)], [], day(13)).get('S').balance, 0);
  const challenge = { kind: 'challenge', allowancePolicy: 2, matchupKey: 'A::B|C::D',
    challenger: 'S', challengerStake: 4, opponentStake: 7, placedAt: day(10),
    acceptedBy: 'T', acceptedAt: day(10), outcome: { test: 'winner', team: red } };
  assert.equal(wallet([challenge], [match(10)], 11).allowance, 4);
  assert.equal(wallet([challenge], [match(10)], 11, 'T').allowance, 7);
  assert.equal(computeBalances([{ ...challenge, acceptedBy: null }], [match(10)], day(11)).get('S').balance, 0);
});

test('legacy grants survive rollout; the next new day uses eligible stakes', () => {
  const bets = [house(8, 1, { allowancePolicy: undefined }), house(9, 1, { allowancePolicy: undefined })];
  assert.equal(computeBalances(bets, [], day(10)).get('S').balance, 40);
  const settled = [match(8), match(9)];
  assert.equal(wallet(bets, settled, 10).balance, 39);
  assert.equal(wallet([...bets, house(9, 3)], settled, 9).allowance, 20);
  assert.equal(wallet([...bets, house(9, 3)], settled, 10).allowance, 4);
});
