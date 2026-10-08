// src/betting/outcomes.js
// Pure outcome tests on a logged match. Teams are pairs, resolved to a side per
// match, so a Red/Blue swap never changes a result. null = cannot be decided
// (missing data or team not in match) -> the bet is refunded.
import { teamKey } from '../teams/team-identity.js';
import { MAX_GOALS } from '../constants.js';

export const OUTCOME_TESTS = [
  { id: 'winner', needsGoalLog: false, hasTeam: true, thresholds: null },
  { id: 'marginAtLeast', needsGoalLog: false, hasTeam: true, thresholds: [2, 3, 4] },
  { id: 'shutout', needsGoalLog: false, hasTeam: true, thresholds: null },
  { id: 'goesToFourFour', needsGoalLog: false, hasTeam: false, thresholds: null },
  { id: 'durationOver', needsGoalLog: true, hasTeam: false, thresholds: [180, 210, 240, 270, 300, 330, 360] },
  { id: 'scoresFirst', needsGoalLog: true, hasTeam: true, thresholds: null },
  { id: 'firstScorerWins', needsGoalLog: true, hasTeam: false, thresholds: null },
  { id: 'comebackAtLeast', needsGoalLog: true, hasTeam: true, thresholds: [1, 2] },
];

function sideOf(match, team) {
  const k = teamKey(team || []);
  if (k && teamKey(match.teamA) === k) return 'A';
  if (k && teamKey(match.teamB) === k) return 'B';
  return null;
}

const colourOf = (side) => (side === 'A' ? 'red' : 'blue');

function raw(match, { test, team, threshold }) {
  const side = sideOf(match, team);
  const def = OUTCOME_TESTS.find((t) => t.id === test);
  if (!def || (def.hasTeam && !side)) return null;
  const log = Array.isArray(match.goalLog) && match.goalLog.length ? match.goalLog : null;
  const goalsFor = side === 'A' ? match.goalsA : match.goalsB;
  const goalsAgainst = side === 'A' ? match.goalsB : match.goalsA;
  const won = match.winner === side;
  switch (test) {
    case 'winner': return won;
    case 'marginAtLeast': return won && goalsFor - goalsAgainst >= threshold;
    case 'shutout': return won && goalsAgainst === 0;
    case 'goesToFourFour': return Math.min(match.goalsA, match.goalsB) === MAX_GOALS - 1;
    case 'durationOver':
      return typeof match.matchDuration === 'number' ? match.matchDuration > threshold * 1000 : null;
    case 'scoresFirst': return log ? log[0].team === colourOf(side) : null;
    case 'firstScorerWins': return log ? match.winner === (log[0].team === 'red' ? 'A' : 'B') : null;
    case 'comebackAtLeast': {
      if (!log) return null;
      if (!won) return false;
      let diff = 0; let worst = 0;
      for (const goal of log) {
        diff += goal.team === colourOf(side) ? 1 : -1;
        worst = Math.min(worst, diff);
      }
      return -worst >= threshold;
    }
    default: return null;
  }
}

export function evaluateOutcome(match, outcome) {
  const r = raw(match, outcome);
  if (r === null) return null;
  return outcome.negate ? !r : r;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function describeOutcome(outcome, labelOf) {
  const t = outcome.team ? labelOf(outcome.team) : '';
  const k = outcome.threshold;
  const text = {
    winner: `${t} win`,
    marginAtLeast: `${t} win by ${k}+`,
    shutout: `${t} win 5:0`,
    goesToFourFour: 'Goes to 4:4',
    durationOver: `Over ${mmss(k)}`,
    scoresFirst: `${t} score first`,
    firstScorerWins: 'First scorer wins',
    comebackAtLeast: `${t} comeback from ${k} down`,
  }[outcome.test] || outcome.test;
  return outcome.negate ? `Not: ${text}` : text;
}
