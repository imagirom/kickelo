// src/betting/current-match-service.js
// Real-time shared live state in meta/currentMatch. Same pattern as team-service.js.
import { db, doc, onSnapshot, runTransaction, serverTimestamp } from '../firebase-service.js';
import { getCachedStats } from '../stats-cache-service.js';
import { STARTING_ELO } from '../constants.js';
import { BETTING } from './betting-config.js';
import { matchupKey } from './matchup.js';
import { buildOffer, goalUpdate, liveClaimUpdate } from './current-match.js';
import params from './model-params.json';

const ref = () => doc(db, 'meta', 'currentMatch');
let current = null;
let initialized = false;

export function getCurrentMatch() {
  return current;
}

function eloOf(name) {
  const traj = getCachedStats(name)?.eloTrajectory;
  return traj?.length ? traj[traj.length - 1].elo : STARTING_ELO;
}

export function initializeCurrentMatch() {
  if (initialized || !BETTING.enabled || !BETTING.liveSync) return () => {};
  initialized = true;
  return onSnapshot(ref(), (snap) => {
    current = snap.exists() ? snap.data() : null;
    window.dispatchEvent(new CustomEvent('current-match-updated', { detail: current }));
  }, (error) => console.error('Error listening to meta/currentMatch:', error));
}

export function resetCurrentMatchListener() {
  initialized = false;
}

// Every write is a transaction that re-reads the doc and checks it is still the match this device
// means (spec Concurrency #3): a phone with a stale or offline snapshot must not write its goals,
// end or lineup onto a newer shared match. Offline these fail instead of queueing; that is intended.

const staleError = (fresh) => Object.assign(new Error('stale'), { current: fresh });

async function readIn(tx) {
  const snap = await tx.get(ref());
  return snap.exists() ? snap.data() : null;
}

/** Replaces the shared match. `guard(fresh)` false -> throws 'stale' with err.current = the fresh doc.
 *  With `liveId`, live scoring is claimed in the same write (goals so far close betting at once). */
export async function publishLineup({ red, blue, positions }, { guard = () => true, liveId = null, goalLog = [] } = {}) {
  const key = matchupKey(red, blue);
  await runTransaction(db, async (tx) => {
    const fresh = await readIn(tx);
    if (!guard(fresh)) throw staleError(fresh);
    tx.set(ref(), {
      red: [...red].sort(), blue: [...blue].sort(), positions,
      matchupKey: key,
      liveStartedAt: liveId ? serverTimestamp() : null, liveId,
      goalLog: liveId ? goalLog : [],
      firstGoalAt: liveId && goalLog.length ? serverTimestamp() : null,
      offer: buildOffer(red, blue, eloOf, params, BETTING, `${key}:${new Date().toLocaleDateString('sv')}`),
      updatedAt: serverTimestamp(),
    });
  });
}

/** Position / side change on the same matchup; `guard(fresh)` as for publishLineup. */
export async function publishPositions({ red, blue, positions }, { guard = () => true } = {}) {
  await runTransaction(db, async (tx) => {
    const fresh = await readIn(tx);
    if (!fresh || !guard(fresh)) throw staleError(fresh);
    tx.update(ref(), { red: [...red].sort(), blue: [...blue].sort(), positions, updatedAt: serverTimestamp() });
  });
}

/** Claims live scoring for this device on matchup `key`. firstGoalAt is stamped from the goals so far
 *  only if this matchup's betting has not closed yet (liveClaimUpdate); it is never cleared here. */
// ponytail: liveStartedAt is the claim time, so a late claim (teams set after kick-off) shows a short spectator timer.
export async function publishLiveStart(liveId, key, goalLog) {
  await runTransaction(db, async (tx) => {
    const fresh = await readIn(tx);
    if (fresh?.matchupKey !== key) throw staleError(fresh);
    const update = { ...liveClaimUpdate(fresh, key, goalLog), liveStartedAt: serverTimestamp(), liveId, updatedAt: serverTimestamp() };
    if (update.firstGoalAt === 'SERVER') update.firstGoalAt = serverTimestamp();
    tx.update(ref(), update);
  });
}

/** Writes the goal log only while the shared doc still carries this device's liveId. Returns false otherwise. */
export async function publishGoal(liveId, goalLog) {
  return runTransaction(db, async (tx) => {
    const fresh = await readIn(tx);
    if (!liveId || fresh?.liveId !== liveId) return false;
    const update = goalUpdate(fresh, goalLog);
    if (update.firstGoalAt === 'SERVER') update.firstGoalAt = serverTimestamp();
    tx.update(ref(), { ...update, updatedAt: serverTimestamp() });
    return true;
  });
}

/** After submit or cancel: live fields cleared; offer cleared so the next lineup publish reprices.
 *  Only if the doc is still this device's live match (`liveId`) or the logged matchup (`matchupKey`). */
export async function publishLiveEnd({ liveId = null, matchupKey: key = null } = {}) {
  await runTransaction(db, async (tx) => {
    const fresh = await readIn(tx);
    if (!fresh || (liveId && fresh.liveId !== liveId) || (key && fresh.matchupKey !== key)) return;
    tx.update(ref(), { liveStartedAt: null, liveId: null, goalLog: [], firstGoalAt: null, offer: null, updatedAt: serverTimestamp() });
  });
}
