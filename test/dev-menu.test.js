// Dev-menu triple-tap logic tests (pure, no DOM).
import { registerTap } from '../src/dev-menu.js';

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

console.log('\n=== registerTap (3 taps within 1500ms) ===');
// First tap.
assertEq(registerTap([], 0), { timestamps: [0], reveal: false }, 'first tap, no reveal');
// Second tap within window.
assertEq(registerTap([0], 100), { timestamps: [0, 100], reveal: false }, 'second tap, no reveal');
// Third tap within window -> reveal and reset.
assertEq(registerTap([0, 100], 200), { timestamps: [], reveal: true }, 'third tap within window reveals + resets');
// Taps spread beyond the window never accumulate to 3.
assertEq(registerTap([0, 100], 2000), { timestamps: [2000], reveal: false }, 'stale taps pruned, no reveal');
// Oldest tap just outside the window when the 3rd arrives.
assertEq(registerTap([0, 800], 1600), { timestamps: [800, 1600], reveal: false }, 'oldest pruned at boundary, no reveal');
// Window boundary is exclusive (now - t < windowMs).
assertEq(registerTap([0], 1500), { timestamps: [1500], reveal: false }, 'tap exactly windowMs later prunes the old one');
// Counting resumes cleanly after a reveal.
assertEq(registerTap([], 5000), { timestamps: [5000], reveal: false }, 'fresh tap after reveal');
// Custom thresholds honored.
assertEq(registerTap([10], 20, 1500, 2), { timestamps: [], reveal: true }, 'custom needed=2 reveals on 2nd tap');

console.log(`\n${'='.repeat(60)}`);
console.log(`Dev Menu Tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failed > 0) process.exit(1);
