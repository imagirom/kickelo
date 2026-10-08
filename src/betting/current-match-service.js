// src/betting/current-match-service.js
// Real-time shared live state in meta/currentMatch. Same pattern as team-service.js.
import { db, doc, onSnapshot, setDoc, updateDoc, runTransaction, serverTimestamp } from '../firebase-service.js';
import { getCachedStats } from '../stats-cache-service.js';
import { STARTING_ELO } from '../constants.js';
import { BETTING } from './betting-config.js';
import { matchupKey } from './matchup.js';
import { buildOffer, goalUpdate } from './current-match.js';
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

export async function publishLineup({ red, blue, positions }, { expectedUpdatedAtMs = null } = {}) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref());
    const seenMs = snap.exists() ? snap.data().updatedAt?.toMillis?.() ?? null : null;
    if (expectedUpdatedAtMs !== null && seenMs !== expectedUpdatedAtMs) throw new Error('stale');
    tx.set(ref(), {
      red: [...red].sort(), blue: [...blue].sort(), positions,
      matchupKey: matchupKey(red, blue),
      liveStartedAt: null, liveId: null, goalLog: [], firstGoalAt: null,
      offer: buildOffer(red, blue, eloOf, params, BETTING, `${matchupKey(red, blue)}:${new Date().toLocaleDateString('sv')}`),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function publishPositions({ red, blue, positions }) {
  await updateDoc(ref(), { red: [...red].sort(), blue: [...blue].sort(), positions, updatedAt: serverTimestamp() });
}

/** Claims live scoring for this device. `fields` comes from liveClaimUpdate: the goals so far, and
 *  firstGoalAt: 'SERVER' only when betting must close now (it is never cleared here). */
// ponytail: liveStartedAt is the claim time, so a late claim (teams set after kick-off) shows a short spectator timer.
export async function publishLiveStart(liveId, fields) {
  const update = { ...fields, liveStartedAt: serverTimestamp(), liveId, updatedAt: serverTimestamp() };
  if (update.firstGoalAt === 'SERVER') update.firstGoalAt = serverTimestamp();
  await setDoc(ref(), update, { merge: true });
}

export async function publishGoal(goalLog) {
  const update = goalUpdate(current, goalLog);
  if (update.firstGoalAt === 'SERVER') update.firstGoalAt = serverTimestamp();
  await setDoc(ref(), { ...update, updatedAt: serverTimestamp() }, { merge: true });
}

/** After submit or cancel: live fields cleared; offer cleared so the next lineup publish reprices. */
export async function publishLiveEnd() {
  await setDoc(ref(), { liveStartedAt: null, liveId: null, goalLog: [], firstGoalAt: null, offer: null, updatedAt: serverTimestamp() }, { merge: true });
}
