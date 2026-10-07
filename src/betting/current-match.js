// src/betting/current-match.js
// Pure helpers for the shared meta/currentMatch doc.
import { matchupKey, isFullLineup } from './matchup.js';
import { winProbability, toOdds } from './model.js';
import { teamKey } from '../teams/team-identity.js';

const avg = (pair, eloOf) => (eloOf(pair[0]) + eloOf(pair[1])) / 2;

export function buildOffer(red, blue, eloOf, params, cfg) {
  const gap = avg(red, eloOf) - avg(blue, eloOf);
  const pRed = winProbability(gap, params);
  return {
    winner: { [teamKey(red)]: toOdds(pRed, cfg), [teamKey(blue)]: toOdds(1 - pRed, cfg) },
    gap: Math.round(gap),
  };
}

export function shouldPublishLineup(current, red, blue, positions) {
  if (!isFullLineup(red, blue)) return 'skip';
  const key = matchupKey(red, blue);
  if (!current || current.matchupKey !== key || !current.offer) return 'replace';
  const samePositions = JSON.stringify(current.positions || {}) === JSON.stringify(positions || {});
  const sameSides = teamKey(current.red || []) === teamKey(red);
  return samePositions && sameSides ? 'skip' : 'positions';
}

export function needsOverwriteConfirm(current, newKey, openBets) {
  if (!current?.matchupKey || current.matchupKey === newKey) return false;
  return Boolean(current.liveStartedAt) || openBets > 0;
}

/** Fields for a goal-log change. 'SERVER' is replaced by serverTimestamp() in the service. */
export function goalUpdate(current, goalLog) {
  const update = { goalLog };
  if (goalLog.length > 0 && !current?.firstGoalAt) update.firstGoalAt = 'SERVER';
  return update;
}
