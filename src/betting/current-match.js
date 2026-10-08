// src/betting/current-match.js
// Pure helpers for the shared meta/currentMatch doc.
import { matchupKey, isFullLineup } from './matchup.js';
import { winProbability, toOdds } from './model.js';
import { teamKey } from '../teams/team-identity.js';
import { propsActive } from './betting-config.js';
import { candidateProps, eligible, drawProps } from './props.js';

const avg = (pair, eloOf) => (eloOf(pair[0]) + eloOf(pair[1])) / 2;

export function buildOffer(red, blue, eloOf, params, cfg, seed = '') {
  const gap = avg(red, eloOf) - avg(blue, eloOf);
  const pRed = winProbability(gap, params);
  const props = propsActive(cfg)
    ? drawProps(eligible(candidateProps(red, blue, gap, params, { minSamples: cfg.houseProps.minSamples }), cfg.houseProps.maxRatio), cfg.houseProps.count, seed)
        .map(({ id, outcome, p }) => ({ id, outcome, oddsYes: toOdds(p, cfg), oddsNo: toOdds(1 - p, cfg) }))
    : [];
  return {
    winner: { [teamKey(red)]: toOdds(pRed, cfg), [teamKey(blue)]: toOdds(1 - pRed, cfg) },
    gap: Math.round(gap),
    props,
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
  return Boolean(current.liveStartedAt || current.liveId) || openBets > 0;
}

/** A logged match on the shared matchup ends it: clear the offer (live or final-score mode alike). */
export function shouldClearAfterSubmit(current, teamA, teamB) {
  return Boolean(current?.offer) && current.matchupKey === matchupKey(teamA, teamB);
}

/** Fields for a goal-log change. 'SERVER' is replaced by serverTimestamp() in the service. */
export function goalUpdate(current, goalLog) {
  const update = { goalLog };
  if (goalLog.length > 0 && !current?.firstGoalAt) update.firstGoalAt = 'SERVER';
  return update;
}

/** Starting live mode on a matchup that is already live elsewhere is a takeover (spec Concurrency #7). */
export function isLiveTakeover(current, newKey) {
  return Boolean(current?.liveStartedAt || current?.liveId) && current.matchupKey === newKey;
}

/** Only the device whose liveId is in the shared doc writes goals / ends the live match. */
export function ownsLive(current, liveId) {
  return Boolean(liveId) && current?.liveId === liveId;
}

/** Goals scored before this device claimed the live match (e.g. live started before the teams were set).
 *  firstGoalAt is stamped only if this matchup's betting has not closed yet; never cleared or moved. */
export function liveClaimUpdate(current, key, goalLog) {
  return goalUpdate(current?.matchupKey === key ? current : null, goalLog);
}

/** "Your lineup isn't shared": a full local lineup the shared doc does not carry,
 *  or live mode here on a shared matchup another phone scores (declined takeover). */
export function showNotSharedHint(current, localKey, { live = false, liveId = null } = {}) {
  if (!localKey) return false;
  if (current?.matchupKey !== localKey) return true;
  return live && !ownsLive(current, liveId);
}
