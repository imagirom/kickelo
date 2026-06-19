// Team subsystem: pure-logic tests (no browser, no Firestore).
import { teamKey, pairFromSelects, pickEntrance } from '../src/teams/team-identity.js';
import { INITIAL_TEAMS, resolveTeamPlayers } from '../src/teams/initial-teams.js';

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

console.log('\n=== resolveTeamPlayers ===');
{
  const roster = ['Manuel Klockow', 'Marc Ickler', 'Sarah Seibert', 'Simon Wagner', 'Tobias Rieger', 'Roman Remme'];
  assertEq(resolveTeamPlayers(['Manuel', 'Marc'], roster).players, ['Manuel Klockow', 'Marc Ickler'].sort(), 'exact first names resolve + sort');
  assertEq(resolveTeamPlayers(['Tobi', 'Roman'], roster).players, ['Roman Remme', 'Tobias Rieger'].sort(), 'prefix match: Tobi -> Tobias Rieger');
  assertEq(resolveTeamPlayers(['Sarah', 'Simon'], roster).ok, true, 'resolvable pair -> ok true');
  const missing = resolveTeamPlayers(['Zelda', 'Roman'], roster);
  assertEq(missing.ok, false, 'unmatched name -> ok false');
  assertEq(missing.unmatched, ['Zelda'], 'reports the unmatched first name');
  assertEq(missing.players, null, 'no players when not fully resolved');
  const ambiguous = resolveTeamPlayers(['Mar', 'Sarah'], ['Marc Ickler', 'Maria Lopez', 'Sarah Seibert']);
  assertEq(ambiguous.ok, false, 'prefix matching two roster names -> ambiguous, not ok');
  assertEq(ambiguous.ambiguous.length, 1, 'reports the ambiguous entry');
}

console.log('\n=== INITIAL_TEAMS shape ===');
assertEq(Array.isArray(INITIAL_TEAMS), true, 'INITIAL_TEAMS is an array');
assertEq(INITIAL_TEAMS.every(t => Array.isArray(t.firstNames) && t.firstNames.length === 2), true, 'each entry names a pair');
{
  const mama = INITIAL_TEAMS.find(t => t.name === 'MaMa');
  assertEq(Boolean(mama), true, 'MaMa entry present');
  assertEq(mama.songUri, 'spotify:track:3z8h0TU7ReDPLIbEnYhWZb', 'MaMa carries the Bohemian Rhapsody song');
  assertEq(mama.songPositionMs, 51000, 'MaMa song starts at 51s');
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Teams Tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failed > 0) process.exit(1);
