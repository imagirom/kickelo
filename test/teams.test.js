// Team subsystem: pure-logic tests (no browser, no Firestore).
import { teamKey, pairFromSelects, pickEntrance } from '../src/teams/team-identity.js';

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

console.log('\n=== teamKey ===');
assertEq(teamKey(['Bob', 'Alice']), 'Alice::Bob', 'sorts players');
assertEq(teamKey(['Alice', 'Bob']), 'Alice::Bob', 'order-independent');
assertEq(teamKey(['Alice']), 'Alice', 'single player');
assertEq(teamKey([]), '', 'empty list -> empty string');
assertEq(teamKey(['Bob', '', 'Alice']), 'Alice::Bob', 'drops empties');

console.log('\n=== pairFromSelects ===');
assertEq(pairFromSelects('Alice', 'Bob', 'Carol', 'Dan'),
  { red: ['Alice', 'Bob'], blue: ['Carol', 'Dan'] }, '2v2');
assertEq(pairFromSelects(' Alice ', '', 'Carol', ''),
  { red: ['Alice'], blue: ['Carol'] }, 'trims + drops empties (1v1)');
assertEq(pairFromSelects('Alice', 'Alice', 'Bob', 'Bob'),
  { red: ['Alice'], blue: ['Bob'] }, 'dedupes a repeated player');
assertEq(pairFromSelects('', '', '', ''),
  { red: [], blue: [] }, 'all empty');

console.log('\n=== pickEntrance ===');
{
  const a = { songUri: 'spotify:track:A' };
  const b = { songUri: 'spotify:track:B' };
  // Deterministic rng: 0 -> first match, 0.99 -> last match.
  assertEq(pickEntrance([a, b], () => 0), a, 'rng=0 picks first with a song');
  assertEq(pickEntrance([a, b], () => 0.99), b, 'rng~1 picks last with a song');
  assertEq(pickEntrance([null, b], () => 0), b, 'skips records without a song');
  assertEq(pickEntrance([{ name: 'X' }, null], () => 0), null, 'null when no record has a song');
  assertEq(pickEntrance([], () => 0), null, 'empty -> null');
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Teams Tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failed > 0) process.exit(1);
