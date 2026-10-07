// test/betting.test.js
// Betting: pure-logic tests (no browser, no Firestore).
import { BETTING, houseBetsActive } from '../src/betting/betting-config.js';
import { matchupKey, isFullLineup, sameTeam } from '../src/betting/matchup.js';

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

// --- further sections are appended by later tasks above this line ---

console.log('\n' + '='.repeat(60));
console.log(`Betting Tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
