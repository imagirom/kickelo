// src/betting/matchup.js
// Pure matchup identity. A team is its sorted pair (teamKey); a matchup is the
// two team keys sorted and '|'-joined. Side (red/blue) and positions never matter,
// so swaps never touch bets.
import { teamKey } from '../teams/team-identity.js';

function clean(players = []) {
  return players.map((p) => (p || '').trim()).filter(Boolean);
}

export function isFullLineup(red = [], blue = []) {
  const r = clean(red);
  const b = clean(blue);
  return r.length === 2 && b.length === 2 && new Set([...r, ...b]).size === 4;
}

export function matchupKey(red = [], blue = []) {
  if (!isFullLineup(red, blue)) return '';
  return [teamKey(red), teamKey(blue)].sort().join('|');
}

/** The four players of a matchup key. */
export function matchupPlayers(key = '') {
  return key ? key.split('|').flatMap((team) => team.split('::')) : [];
}

export function sameTeam(a = [], b = []) {
  return teamKey(a) === teamKey(b);
}
