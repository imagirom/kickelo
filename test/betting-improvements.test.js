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

test('credit repays gradually without consuming small allowances or permitting a second loan', () => {
  const now = new Date(2026, 9, 13, 12).getTime();
  const next = new Date(2026, 9, 14, 12).getTime();
  const loss = { kind: 'house', bettor: 'S', stake: 20, odds: 2, matchupKey: 'A::B|C::D',
    placedAt: now - 1000, allowancePolicy: 2, outcome: { test: 'winner', team: ['C', 'D'] } };
  const match = { teamA: ['A', 'B'], teamB: ['C', 'D'], winner: 'A', goalsA: 5, goalsB: 0,
    timestamp: now + 1000, matchStartedAtMs: now, matchDuration: 500,
    goalLog: [{ team: 'red', timestamp: 500 }] };
  assert.equal(canBorrow('S', [loss], [match], now + 2000), true);
  const loan = { kind: 'credit', bettor: 'S', advance: 10, repayment: 13, placedAt: now + 2000 };
  const bets = [loss, loan];
  assert.equal(spendable('S', bets, [match], now + 3000), 10);
  assert.equal(computeBalances(bets, [match], now + 3000).get('S').debt, 13);
  assert.equal(canBorrow('S', bets, [match], now + 3000), false);
  assert.equal(spendable('S', bets, [match], next), 20); // 10 held + 20 allowance - 10 repayment
  const nextBet = { ...loss, placedAt: next, stake: 4 };
  assert.equal(spendable('S', [...bets, nextBet], [match], next), 16);
  assert.equal(computeBalances([...bets, nextBet], [match], next).get('S').debt, 3);
  assert.equal(spendable('S', [...bets, { ...nextBet, void: true }], [match], next), 20);
  const nextMatch = { ...match, timestamp: next + 2000, matchStartedAtMs: next + 1000 };
  const later = (n) => new Date(2026, 9, n, 12).getTime();
  const settled = [match, nextMatch];
  const history = [...bets, nextBet];
  assert.equal(spendable('S', history, settled, later(16)), 18); // idle day skipped; 4 allowance - 2 repayment
  assert.equal(canBorrow('S', [...history, { ...loss, placedAt: later(16), stake: 18 }], settled, later(16)), false); // empty wallet on a later day, debt still owed
  const tinyBet = { ...loss, placedAt: later(16), stake: 1 };
  const tinyMatch = { ...match, timestamp: later(16) + 2000, matchStartedAtMs: later(16) + 1000 };
  const tinyHistory = [...history, tinyBet];
  const allMatches = [...settled, tinyMatch];
  assert.equal(computeBalances(tinyHistory, allMatches, later(16) + 3000).get('S').debt, 1);
  assert.equal(spendable('S', tinyHistory, allMatches, later(17)), 18); // allowance 1: repayment zero
  const finalBet = { ...loss, placedAt: later(17), stake: 4 };
  const finalMatch = { ...match, timestamp: later(17) + 2000, matchStartedAtMs: later(17) + 1000 };
  const repaid = [...tinyHistory, finalBet, { ...loss, placedAt: later(18), stake: 1 }];
  assert.equal(computeBalances(repaid, [...allMatches, finalMatch], later(18)).get('S').debt || 0, 0);
  assert.equal(computeBalances(tinyHistory, settled, later(17)).get('S').debt, 3); // refunded day makes no repayment
  const loanOnly = [{ ...loan, placedAt: now }];
  assert.equal(spendable('S', loanOnly, [], now + 3000), 30); // no same-day repayment or extra grant
  assert.equal(creditId('S', now), creditId('S', now + 1000));
  assert.equal(canBorrow('New', [], [], now), false);
});

test('AND odds account for correlation and reject impossible or redundant pairs', async () => {
  const { buildCombinations } = await import('../src/betting/combinations.js');
  const { BETTING } = await import('../src/betting/betting-config.js');
  const { toOdds } = await import('../src/betting/model.js');
  const offer = buildCombinations(['A', 'B'], ['C', 'D'], 0, { s: 1200, c: 0, kappa: Infinity }, BETTING, [
    { outcome: { test: 'scoresFirst', team: ['A', 'B'] } },
    { outcome: { test: 'marginAtLeast', team: ['A', 'B'], threshold: 2 } },
    { outcome: { test: 'durationOver', threshold: 300 } },
  ]);
  const combos = Object.values(offer.combinations);
  const winAndFirst = combos.find(c => c.left === 's0' && c.right === 's2');
  // P(red wins | red scores first) = 163/256, so the joint probability is 163/512.
  assert.equal(winAndFirst.odds, toOdds(163 / 512));
  assert.notEqual(winAndFirst.odds, toOdds(0.5) ** 2);
  assert.equal(combos.some(c => c.left === 's0' && c.right === 's1'), false); // both teams win
  assert.equal(combos.some(c => c.left === 's0' && c.right === 's4'), false); // win AND win by 2
  assert.equal(offer.comboSelections.length, 8);
  assert.equal(offer.comboSelections.some(s => s.outcome.test === 'durationOver'), true);
  const match = { teamA: ['A', 'B'], teamB: ['C', 'D'], winner: 'A', goalsA: 5, goalsB: 2,
    goalLog: [{ team: 'red', timestamp: 1000 }] };
  assert.equal(evaluateOutcome(match, winAndFirst.outcome), true);
  assert.equal(evaluateOutcome({ ...match, winner: 'B' }, winAndFirst.outcome), false);
  assert.equal(evaluateOutcome({ ...match, goalLog: [] }, winAndFirst.outcome), null);
});


test('duration AND bets price both sides and settle at the last goal', async () => {
  const { buildCombinations } = await import('../src/betting/combinations.js');
  const { BETTING } = await import('../src/betting/betting-config.js');
  const { outcomeProbability, toOdds } = await import('../src/betting/model.js');
  const { resolveHouseBet } = await import('../src/betting/ledger.js');
  const params = { s: 1200, c: 0, kappa: Infinity, duration: { lambda: 300, k: 2, b: 0 } };
  const offer = buildCombinations(['A', 'B'], ['C', 'D'], 0, params, BETTING, [
    { outcome: { test: 'durationOver', threshold: 300 } },
    { outcome: { test: 'durationOver', threshold: 360 } },
  ]);
  const pOver = outcomeProbability({ test: 'durationOver', threshold: 300 }, 0, params);
  const over = offer.combinations.s0_s2;
  const under = offer.combinations.s0_s3;
  assert.equal(over.odds, toOdds(0.5 * pOver));
  assert.equal(under.odds, toOdds(0.5 * (1 - pOver)));
  assert.equal(offer.combinations.s2_s3, undefined); // over AND not-over same threshold
  assert.equal(offer.combinations.s2_s4, undefined); // two nested overs are redundant
  assert.equal(offer.combinations.s2_s5.odds, toOdds(pOver - outcomeProbability({ test: 'durationOver', threshold: 360 }, 0, params)));
  const start = new Date(2026, 9, 13, 12).getTime();
  const match = { id: 'duration-match', teamA: ['A', 'B'], teamB: ['C', 'D'], winner: 'A', goalsA: 5, goalsB: 0,
    matchStartedAtMs: start, timestamp: start + 900000, matchDuration: 330000,
    goalLog: [10000, 60000, 120000, 240000, 330000].map(timestamp => ({ team: 'red', timestamp })) };
  const bet = { kind: 'house', matchupKey: 'A::B|C::D', bettor: 'S', placedAt: start - 1000, stake: 10,
    outcome: over.outcome, odds: over.odds };
  assert.equal(resolveHouseBet(bet, [match], start + 900000).payout, Math.round(10 * over.odds));
  assert.equal(resolveHouseBet({ ...bet, ...under }, [match], start + 900000).status, 'lost');
  assert.equal(evaluateOutcome({ ...match, goalLog: [...match.goalLog.slice(0, -1), { team: 'red', timestamp: 300000 }] }, under.outcome), true);
  assert.equal(resolveHouseBet(bet, [{ ...match, goalLog: [] }], start + 900000).status, 'refunded');
});
