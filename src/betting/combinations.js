// Price AND bets on complete goal sequences. Multiplying marginal odds would
// overpay correlated events (e.g. winning and winning by two goals).
// Duration uses the fitted time model, assumed independent of the scoring path
// conditional on the lineup's Elo gap. Apply the house margin only once.
import { pathDistribution, toOdds, outcomeProbability } from './model.js';
import { evaluateOutcome } from './outcomes.js';
import { MAX_GOALS } from '../constants.js';

export function buildCombinations(red, blue, gap, params, cfg, props = []) {
  const selections = [];
  function add(test, team = null, threshold = null, negate = false) {
    selections.push({ id: `s${selections.length}`, outcome: { test, team: team ? [...team].sort() : null, threshold, negate } });
  }
  for (const team of [red, blue]) add('winner', team);
  // Combine the same selections as the regular betting board.
  for (const { outcome } of props) {
    for (const negate of [false, true]) add(outcome.test, outcome.team, outcome.threshold, negate);
  }
  const paths = pathDistribution(gap, params).map(({ seq, p }) => {
    const goalsA = [...seq].filter(c => c === 'f').length;
    const match = { teamA: red, teamB: blue, goalsA, goalsB: seq.length - goalsA,
      winner: goalsA === MAX_GOALS ? 'A' : 'B',
      goalLog: [...seq].map((c, timestamp) => ({ team: c === 'f' ? 'red' : 'blue', timestamp })) };
    return { p, results: selections.map(s => s.outcome.test === 'durationOver' ? null : evaluateOutcome(match, s.outcome)) };
  });
  const marginal = selections.map((s, i) => s.outcome.test === 'durationOver'
    ? outcomeProbability(s.outcome, gap, params)
    : paths.reduce((p, path) => p + (path.results[i] ? path.p : 0), 0));
  const combinations = {};
  for (let i = 0; i < selections.length; i++) {
    for (let j = i + 1; j < selections.length; j++) {
      if (!Number.isFinite(marginal[i]) || !Number.isFinite(marginal[j])) continue;
      const a = selections[i].outcome;
      const b = selections[j].outcome;
      const durationCount = [a, b].filter(o => o.test === 'durationOver').length;
      const p = durationCount === 2 ? durationIntersection(a, b, gap, params)
        : durationCount === 1 ? marginal[i] * marginal[j]
        : paths.reduce((sum, path) => sum + (path.results[i] && path.results[j] ? path.p : 0), 0);
      // Neither impossible pairs nor repeated/implied conditions earn extra odds.
      if (p < 1e-12 || p >= Math.min(marginal[i], marginal[j]) - 1e-12) continue;
      const comboId = `${selections[i].id}_${selections[j].id}`;
      combinations[comboId] = { left: selections[i].id, right: selections[j].id,
        outcome: { test: 'and', comboId, legs: [selections[i].outcome, selections[j].outcome] }, odds: toOdds(p, cfg) };
    }
  }
  return { comboSelections: selections, combinations };
}


// Two duration conditions describe an interval, not independent events. This
// also rules out betting on both sides of the same duration threshold.
function durationIntersection(a, b, gap, params) {
  const lower = Math.max(...[a, b].map(o => o.negate ? 0 : o.threshold));
  const upper = Math.min(...[a, b].map(o => o.negate ? o.threshold : Infinity));
  if (lower >= upper) return 0;
  const above = threshold => outcomeProbability({ test: 'durationOver', threshold }, gap, params);
  return above(lower) - (upper === Infinity ? 0 : above(upper));
}
