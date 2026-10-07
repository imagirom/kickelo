// test/betting.test.js
// Betting: pure-logic tests (no browser, no Firestore).
import { BETTING, houseBetsActive } from '../src/betting/betting-config.js';
import { matchupKey, isFullLineup, sameTeam } from '../src/betting/matchup.js';
import { goalProbability, scorelineDistribution, winProbability, toOdds, logLikelihood } from '../src/betting/model.js';

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

// --- further sections are appended by later tasks above this line ---

console.log('\n' + '='.repeat(60));
console.log(`Betting Tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
