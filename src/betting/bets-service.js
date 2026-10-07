// src/betting/bets-service.js
// Real-time 'bets' collection + placing/undoing house bets.
import { db, collection, doc, addDoc, updateDoc, onSnapshot, serverTimestamp } from '../firebase-service.js';
import { allMatches } from '../match-data-service.js';
import { BETTING } from './betting-config.js';
import { computeBalances, checkBet, resolveHouseBet, dayKey } from './ledger.js';
import { getCurrentMatch } from './current-match-service.js';
import { teamKey } from '../teams/team-identity.js';

let allBets = [];
let initialized = false;

export function getBets() {
  return allBets;
}

export function initializeBets() {
  if (initialized || !BETTING.enabled) return () => {};
  initialized = true;
  return onSnapshot(collection(db, 'bets'), { includeMetadataChanges: false }, (snap) => {
    allBets = [];
    snap.forEach((d) => {
      const data = d.data({ serverTimestamps: 'estimate' });
      allBets.push({ id: d.id, ...data, placedAt: data.placedAt?.toMillis?.() ?? Date.now() });
    });
    window.dispatchEvent(new CustomEvent('bets-updated'));
  }, (error) => console.error('Error listening to bets:', error));
}

export function resetBetsListener() {
  initialized = false;
}

export function getBalances() {
  return computeBalances(allBets, allMatches || [], Date.now());
}

export function getOpenBetsFor(key) {
  const now = Date.now();
  return allBets.filter((b) => !b.void && b.kind === 'house' && b.matchupKey === key
    && resolveHouseBet(b, allMatches || [], now).status === 'open');
}

/** Spendable now: wallet balance, plus today's allowance if no bet placed today. */
export function available(bettor) {
  const w = getBalances().get(bettor);
  const hasBetToday = allBets.some((b) => !b.void && b.bettor === bettor && dayKey(b.placedAt) === dayKey(Date.now()));
  return (w?.balance ?? 0) + (hasBetToday ? 0 : BETTING.dailyAllowance);
}

export async function placeHouseBet({ bettor, stake, team }) {
  const cm = getCurrentMatch();
  if (!cm?.offer || cm.firstGoalAt) throw new Error('closed');
  const odds = cm.offer.winner[teamKey(team)];
  const bet = {
    kind: 'house', matchupKey: cm.matchupKey, bettor, stake, odds,
    outcome: { test: 'winner', team: [...team].sort() }, void: false,
  };
  const verdict = checkBet(bet, { currentMatch: cm });
  if (!verdict.ok) throw new Error(verdict.reason);
  if (stake > available(bettor)) throw new Error('insufficient');
  try {
    const ref = await addDoc(collection(db, 'bets'), { ...bet, placedAt: serverTimestamp() });
    return ref.id;
  } catch (err) {
    if (err?.code === 'permission-denied') throw new Error('closed');
    throw err;
  }
}

export async function undoBet(id) {
  await updateDoc(doc(db, 'bets', id), { void: true });
}
