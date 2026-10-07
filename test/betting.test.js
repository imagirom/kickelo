// test/betting.test.js
// Betting: pure-logic tests (no browser, no Firestore).
import { BETTING, houseBetsActive } from '../src/betting/betting-config.js';

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

// --- further sections are appended by later tasks above this line ---

console.log('\n' + '='.repeat(60));
console.log(`Betting Tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
