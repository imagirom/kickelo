// test/betting.test.js
// Betting: pure-logic tests (no browser, no Firestore).
import { BETTING, houseBetsActive } from '../src/betting/betting-config.js';
import { matchupKey, isFullLineup, sameTeam } from '../src/betting/matchup.js';
import { goalProbability, scorelineDistribution, winProbability, toOdds, logLikelihood } from '../src/betting/model.js';
import { dayKey, firstGoalAt, resolveHouseBet, computeBalances, checkBet } from '../src/betting/ledger.js';
import params from '../src/betting/model-params.json' with { type: 'json' };

let passed = 0;
let failed = 0;

function assertEq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`  ✗ ${message}: expected ${e}, got ${a}`);
    failed++;
  } else {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

function assertClose(actual, expected, tol, message) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) { console.error(`  ✗ ${message}: expected ${expected}±${tol}, got ${actual}`); failed++; }
  else { console.log(`  ✓ ${message}`); passed++; }
}

console.log('\n=== config ===');
assertEq(houseBetsActive(BETTING), true, 'house bets active by default');
assertEq(houseBetsActive({ ...BETTING, liveSync: false }), false, 'house bets need liveSync');
assertEq(houseBetsActive({ ...BETTING, enabled: false }), false, 'master switch disables house bets');

console.log('\n=== matchup identity ===');
{
  const k = matchupKey(['Marc', 'Manuel'], ['Tobi', 'Roman']);
  assertEq(k, 'Manuel::Marc|Roman::Tobi', 'sorted pairs, sorted teams');
  assertEq(matchupKey(['Manuel', 'Marc'], ['Roman', 'Tobi']), k, 'position swap within team -> same key');
  assertEq(matchupKey(['Tobi', 'Roman'], ['Marc', 'Manuel']), k, 'red/blue side swap -> same key');
  assertEq(matchupKey(['Marc'], ['Tobi', 'Roman']), '', 'incomplete lineup -> empty key');
  assertEq(isFullLineup(['A', 'B'], ['C', 'D']), true, 'full 2v2');
  assertEq(isFullLineup(['A', 'B'], ['B', 'D']), false, 'player on both sides -> not full');
  assertEq(isFullLineup(['A', ''], ['C', 'D']), false, 'empty slot -> not full');
  assertEq(sameTeam(['A', 'B'], ['B', 'A']), true, 'sameTeam ignores order');
  assertEq(sameTeam(['A', 'B'], ['A', 'C']), false, 'sameTeam detects difference');
}

console.log('\n=== race-to-5 model ===');
{
  const P = { s: 1200, c: 0, kappa: Infinity };
  const d = scorelineDistribution(0, P);
  const total = [...d.win, ...d.lose].reduce((a, b) => a + b, 0);
  assertClose(total, 1, 1e-9, 'binomial scoreline distribution sums to 1');
  assertClose(winProbability(0, P), 0.5, 1e-9, 'gap 0, no bias -> 0.5');
  assertClose(d.win[0], Math.pow(0.5, 5), 1e-12, 'P(5:0) at p=0.5 is 1/32');
  assertClose(winProbability(200, P) + winProbability(-200, P), 1, 1e-9, 'symmetry: P(gap)+P(-gap)=1');
  assertEq(winProbability(200, P) > winProbability(100, P), true, 'monotone in gap');

  const B = { s: 1200, c: 0, kappa: 20 };
  const db = scorelineDistribution(150, B);
  assertClose([...db.win, ...db.lose].reduce((a, b) => a + b, 0), 1, 1e-9, 'beta-binomial sums to 1');
  const lopsidedBin = scorelineDistribution(150, { ...B, kappa: Infinity });
  assertEq(db.win[0] + db.lose[0] > lopsidedBin.win[0] + lopsidedBin.lose[0], true, 'finite kappa fattens 5:0 tails');
  assertClose(scorelineDistribution(150, { ...B, kappa: 1e7 }).win[2], lopsidedBin.win[2], 1e-5, 'kappa -> inf approaches binomial');

  assertClose(goalProbability(0, { s: 1200, c: 0.02, kappa: Infinity }), 1 / (1 + Math.pow(10, -0.02)), 1e-12, 'gap 0 -> sigma(c)');

  assertEq(toOdds(0.5), 1.9, 'odds at 0.5 with 5% margin');
  assertEq(toOdds(0.99), 1.05, 'odds clamped low');
  assertEq(toOdds(0.01), 10, 'odds clamped high');

  const ll = logLikelihood([{ gap: 0, goalsFor: 5, goalsAgainst: 0 }], P);
  assertClose(ll, Math.log(1 / 32), 1e-9, 'log-likelihood of a single 5:0 at p=0.5');
}

console.log('\n=== shipped model params ===');
assertEq(Number.isFinite(params.s) && params.s > 0, true, 'fitted s is positive');
assertEq(params.kappa > 0, true, 'fitted kappa is positive');
assertEq(Math.abs(winProbability(0, params) - 0.5) < 0.05, true, 'gap 0 is near even (season start behaviour)');
assertEq(winProbability(300, params) > 0.7, true, 'a 300-point favourite is a clear favourite');
assertEq(params.n > 0 && params.trainN + params.testN === params.n, true, 'params come from a real fit');

console.log('\n=== ledger ===');
{
  const day = new Date(2026, 9, 8, 12, 0, 0).getTime();
  const red = ['Manuel', 'Marc']; const blue = ['Roman', 'Tobi'];
  const key = 'Manuel::Marc|Roman::Tobi';
  const live = (id, ts, winner, extra = {}) => ({
    id, timestamp: ts, teamA: red, teamB: blue, winner, goalsA: winner === 'A' ? 5 : 2, goalsB: winner === 'A' ? 2 : 5,
    matchDuration: 240000, goalLog: [{ team: 'red', timestamp: 30000 }], ...extra,
  });
  const bet = (placedAt, extra = {}) => ({
    kind: 'house', matchupKey: key, placedAt, bettor: 'Simon', stake: 20, odds: 1.9,
    outcome: { test: 'winner', team: red }, void: false, ...extra,
  });

  const m1 = live('m1', day + 300000, 'A'); // started day+60s, first goal at day+90s
  assertEq(firstGoalAt(m1), day + 300000 - 240000 + 30000, 'firstGoalAt from server timestamp, duration, offset');
  assertEq(firstGoalAt({ ...m1, goalLog: undefined }), null, 'no goal log -> null');

  assertEq(resolveHouseBet(bet(day), [m1], day + 400000), { status: 'won', matchId: 'm1', payout: 38 }, 'bet before first goal wins');
  assertEq(resolveHouseBet(bet(day, { outcome: { test: 'winner', team: blue } }), [m1], day + 400000).status, 'lost', 'losing side loses');
  assertEq(resolveHouseBet(bet(day + 100000), [m1], day + 400000), { status: 'refunded', matchId: 'm1', payout: 20 }, 'bet after first goal refunded');
  assertEq(resolveHouseBet(bet(day), [{ ...m1, goalLog: undefined, matchDuration: undefined }], day + 400000).status, 'refunded', 'non-live match -> refund');
  assertEq(resolveHouseBet(bet(day), [], day + 1000).status, 'open', 'no match yet, same day -> open');
  assertEq(resolveHouseBet(bet(day), [], day + 24 * 3600 * 1000).status, 'refunded', 'no match by day end -> refund');
  assertEq(resolveHouseBet(bet(day), [{ ...m1, deleted: true }], day + 400000).status, 'open', 'deleted match ignored');
  assertEq(resolveHouseBet(bet(day), [{ ...m1, winner: 'B' }], day + 400000).status, 'lost', 'edited winner flips result');
  const swapped = { ...m1, teamA: blue, teamB: red, winner: 'B' };
  assertEq(resolveHouseBet(bet(day), [swapped], day + 400000).status, 'won', 'sides swapped in logged match: bet follows the pair');

  // Repeated lineup: bet placed between two matches goes to the second.
  const m2 = live('m2', day + 900000, 'B');
  assertEq(resolveHouseBet(bet(day + 500000), [m2, m1], day + 1000000).matchId, 'm2', 'bet between repeats -> next match');
  // Cancelled live game then restart: bet placed before the cancelled game's goal counts for the restart.
  assertEq(resolveHouseBet(bet(day), [m2], day + 1000000).status, 'lost', 'carry-over to restart counts');

  // Balances: allowance per day with a non-void bet, stakes, payouts, refunds.
  const bets = [
    bet(day),                                   // won -> +38
    bet(day + 100000),                          // refunded -> net 0
    bet(day, { bettor: 'Marc', stake: 10, outcome: { test: 'winner', team: blue } }), // lost
    bet(day, { bettor: 'Peter', void: true }),  // ignored entirely
  ];
  const bal = computeBalances(bets, [m1], day + 400000);
  assertEq(bal.get('Simon').balance, 100 - 20 + 38 - 20 + 20, 'Simon: allowance, win, refund');
  assertEq(bal.get('Marc').balance, 90, 'Marc: allowance minus lost stake');
  assertEq(bal.has('Peter'), false, 'void-only bettor has no wallet');
  assertEq(bal.get('Simon').todayDelta, 18, 'todayDelta excludes allowance: +18 net from bets');
  const open = computeBalances([bet(day)], [], day + 1000);
  assertEq(open.get('Simon'), { balance: 80, todayDelta: -20, open: 1 }, 'open bet: stake held');
  const twoDays = computeBalances([bet(day), bet(day + 24 * 3600 * 1000)], [], day + 3 * 24 * 3600 * 1000);
  assertEq(twoDays.get('Simon').balance, 200, 'two days of allowance, both refunded');
  assertEq(dayKey(day + 3600 * 1000), dayKey(day), 'dayKey groups by local day');

  assertEq(checkBet(bet(day), {}), { ok: true }, 'checkBet allows everything for now');
}

// --- further sections are appended by later tasks above this line ---

console.log('\n' + '='.repeat(60));
console.log(`Betting Tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
