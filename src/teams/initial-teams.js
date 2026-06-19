// Seed data for the teams collection. Keyed by FIRST names; resolved to the
// stored full player names against the live roster at seed time.

export const INITIAL_TEAMS = [
  // Named + entrance song (Manuel & Marc): name "MaMa", Bohemian Rhapsody from 51s.
  {
    firstNames: ['Manuel', 'Marc'],
    name: 'MaMa',
    songUri: 'spotify:track:3z8h0TU7ReDPLIbEnYhWZb',
    songPositionMs: 51000,
  },
  // Named only.
  { firstNames: ['Sarah', 'Simon'], name: 'SaSi' },
  // Entrance songs only.
  { firstNames: ['Dominic', 'Jannis'], songUri: 'spotify:track:476V2d6iA2tWXgQboKmTtA' },
  { firstNames: ['Tobi', 'Roman'], songUri: 'spotify:track:590NTsqsSXMSDA7zuAPZdu' },
];

/**
 * Resolve a pair of first names to stored roster names.
 * A first name matches a roster name when the roster name's first token
 * (case-insensitive) equals it OR starts with it ("Tobi" -> "Tobias ...").
 * @param {string[]} firstNames  exactly the first names of a pair
 * @param {string[]} rosterNames stored player-name strings (full names)
 * @returns {{ ok: boolean, players: string[]|null, unmatched: string[], ambiguous: Array<{first: string, matches: string[]}> }}
 */
export function resolveTeamPlayers(firstNames, rosterNames) {
  const resolved = [];
  const unmatched = [];
  const ambiguous = [];
  for (const first of firstNames) {
    const needle = String(first).trim().toLowerCase();
    const matches = (rosterNames || []).filter((full) => {
      const token = String(full).trim().split(/\s+/)[0].toLowerCase();
      return token === needle || token.startsWith(needle);
    });
    if (matches.length === 1) resolved.push(matches[0]);
    else if (matches.length === 0) unmatched.push(first);
    else ambiguous.push({ first, matches });
  }
  const ok = resolved.length === firstNames.length;
  return { ok, players: ok ? [...resolved].sort() : null, unmatched, ambiguous };
}
