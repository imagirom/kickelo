// Live-mode audio: pure logic tests (no browser, no network).
import { isDangerZone } from '../src/audio/danger-zone.js';
import { buildAuthUrl } from '../src/audio/spotify-client.js';

let passed = 0;
let failed = 0;

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    console.error(`  ✗ ${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  } else {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

console.log('\n=== isDangerZone (4:2 -> 4:3 transition) ===');
// Fires only when the trailing team scores their 3rd while opponent is on 4.
assertEq(isDangerZone(4, 2, 'blue'), true,  '4:2, blue scores -> 4:3');
assertEq(isDangerZone(2, 4, 'red'),  true,  '2:4, red scores  -> 3:4');
assertEq(isDangerZone(3, 3, 'red'),  false, '3:3, red scores  -> 4:3 (leader, not danger)');
assertEq(isDangerZone(3, 3, 'blue'), false, '3:3, blue scores -> 3:4 (leader, not danger)');
assertEq(isDangerZone(4, 3, 'blue'), false, '4:3, blue scores -> 4:4 (deuce, not danger)');
assertEq(isDangerZone(3, 4, 'red'),  false, '3:4, red scores  -> 4:4 (deuce, not danger)');
assertEq(isDangerZone(3, 2, 'red'),  false, '3:2, red scores  -> 4:2 (no, opponent on 2)');
assertEq(isDangerZone(4, 1, 'blue'), false, '4:1, blue scores -> 4:2 (no, scorer reaches 2)');
assertEq(isDangerZone(0, 0, 'red'),  false, '0:0, red scores  -> 1:0 (no)');

console.log('\n=== buildAuthUrl ===');
{
  const url = new URL(buildAuthUrl('CHALLENGE123', 'https://example.test/'));
  assertEq(url.origin + url.pathname, 'https://accounts.spotify.com/authorize', 'auth endpoint');
  assertEq(url.searchParams.get('response_type'), 'code', 'response_type=code');
  assertEq(url.searchParams.get('code_challenge_method'), 'S256', 'S256 method');
  assertEq(url.searchParams.get('code_challenge'), 'CHALLENGE123', 'challenge passed through');
  assertEq(url.searchParams.get('redirect_uri'), 'https://example.test/', 'redirect_uri passed through');
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Audio Tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failed > 0) process.exit(1);
