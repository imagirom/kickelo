// Pure team-identity helpers. No DOM, no Firestore.
// A team's key is its sorted player names joined with '::', matching
// createTeamKey() in player-stats-batch.js so keys line up with team-ELO records.

/** Key for a team: trimmed, empties dropped, sorted, '::'-joined. */
export function teamKey(players = []) {
  return [...players]
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .sort()
    .join('::');
}

/** Trim a pair of names, drop empties, dedupe (a player listed twice = 1v1). */
function cleanPair(a, b) {
  const out = [];
  for (const v of [a, b]) {
    const t = (v || '').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** {red, blue} player arrays from the four match-form selects. Red=A, Blue=B. */
export function pairFromSelects(a1, a2, b1, b2) {
  return { red: cleanPair(a1, a2), blue: cleanPair(b1, b2) };
}

/**
 * Choose one entrance record at random among those that have a songUri.
 * @param {Array<{songUri?: string}|null>} records
 * @param {() => number} rng  injectable for tests; defaults to Math.random
 * @returns {object|null} a record with a songUri, or null if none qualify
 */
export function pickEntrance(records, rng = Math.random) {
  const withSong = (records || []).filter((r) => r && r.songUri);
  if (withSong.length === 0) return null;
  return withSong[Math.floor(rng() * withSong.length)];
}

/**
 * Normalize a Spotify track reference to a `spotify:track:<id>` URI.
 * Accepts a bare URI or an open.spotify.com/track/<id> share URL.
 * @param {string} input
 * @returns {string|null} the canonical URI, or null if it isn't a track ref
 */
export function normalizeTrackUri(input) {
  const s = (input || '').trim();
  if (!s) return null;
  let m = s.match(/^spotify:track:([A-Za-z0-9]+)$/);
  if (m) return `spotify:track:${m[1]}`;
  m = s.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
  if (m) return `spotify:track:${m[1]}`;
  return null;
}
