// src/betting/bets-service.js
// Real-time 'bets' collection + placing/undoing house bets.
import { db, collection, doc, addDoc, updateDoc, onSnapshot, serverTimestamp, runTransaction, getDoc } from '../firebase-service.js';
import { allMatches } from '../match-data-service.js';
import { BETTING } from './betting-config.js';
import { computeBalances, checkBet, resolveHouseBet, resolveChallenge, walletAvailable, acceptDecision, deniedChallengeReason, spendable, creditId, canBorrow } from './ledger.js';
import { getCurrentMatch } from './current-match-service.js';
import { sameOutcome } from './outcomes.js';
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
      allBets.push({ id: d.id, ...data, placedAt: data.placedAt?.toMillis?.() ?? Date.now(),
        ...(data.acceptedBy ? { acceptedAt: data.acceptedAt?.toMillis?.() ?? Date.now() } : {}) });
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
  const matches = allMatches || [];
  return allBets.filter((b) => !b.void && b.matchupKey === key && (
    (b.kind === 'house' && resolveHouseBet(b, matches, now).status === 'open')
    || (b.kind === 'challenge' && ['open', 'pending'].includes(resolveChallenge(b, matches, now).status))));
}

/** Spendable now: wallet balance, plus today's allowance if no bet placed today. */
export function available(bettor) {
  return spendable(bettor, allBets, allMatches || [], Date.now());
}

export function allowanceStatus(bettor) {
  return walletAvailable(bettor, allBets, allMatches || [], Date.now());
}

export function creditStatus(bettor) {
  return { canBorrow: canBorrow(bettor, allBets, allMatches || [], Date.now()),
    debt: getBalances().get(bettor)?.debt || 0 };
}

export async function borrowFootballs(bettor) {
  const now = Date.now();
  const ref = doc(db, 'bets', creditId(bettor, now));
  await runTransaction(db, async tx => {
    const existing = await tx.get(ref);
    if (existing.exists() || !canBorrow(bettor, allBets, allMatches || [], Date.now())) throw new Error('credit-unavailable');
    tx.set(ref, { kind: 'credit', bettor, advance: BETTING.credit.advance,
      repayment: BETTING.credit.repayment, creditDay: Math.floor(now / 86400000),
      placedAt: serverTimestamp(), void: false });
  });
}

/** outcome: { test, team, threshold?, negate?, propId? }; propId (prop bets) is only used to look up odds.
 *  expectedOdds / matchupKey: what the sheet showed; a republished offer in between throws 'changed'. */
export async function placeHouseBet({ bettor, stake, outcome, expectedOdds, matchupKey }) {
  const cm = getCurrentMatch();
  if (!cm?.offer || cm.firstGoalAt) throw new Error('closed');
  if (matchupKey !== undefined && cm.matchupKey !== matchupKey) throw new Error('changed');
  const { propId, ...rest } = outcome;
  let odds;
  let combined;
  if (rest.test === 'and') {
    combined = cm.offer.combinations?.[rest.comboId];
    if (!combined || !sameOutcome(rest, combined.outcome)) throw new Error('changed');
    odds = combined.odds;
  } else if (rest.test === 'winner') {
    odds = cm.offer.winner[teamKey(rest.team)];
  } else {
    const prop = (cm.offer.props || []).find((pr) => pr.id === propId);
    if (!prop) throw new Error('closed');
    odds = rest.negate ? prop.oddsNo : prop.oddsYes;
  }
  if (expectedOdds !== undefined && odds !== expectedOdds) throw new Error('changed');
  const bet = {
    kind: 'house', allowancePolicy: 2, matchupKey: cm.matchupKey, bettor, stake, odds,
    outcome: combined ? combined.outcome : {
      test: rest.test, team: rest.team ? [...rest.team].sort() : null,
      threshold: rest.threshold ?? null, negate: Boolean(rest.negate),
    },
    void: false,
  };
  const verdict = checkBet(bet, { currentMatch: cm });
  if (!verdict.ok) throw new Error(verdict.reason);
  if (stake > BETTING.maxStake) throw new Error('too-much');
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

const deniedAsClosed = (err) => { throw err?.code === 'permission-denied' ? new Error('closed') : err; };

/** On a rules denial, re-read the challenge to say why (e.g. taken:<name> after a lost race). */
const deniedChallenge = (ref, acceptor) => async (err) => {
  if (err?.code !== 'permission-denied') throw err;
  let snap;
  try { snap = await getDoc(ref); } catch { throw new Error('closed'); }
  throw new Error(deniedChallengeReason(snap.exists() ? snap.data() : null, acceptor));
};

/** outcome: { test, team, threshold?, negate? } claimed by the challenger; the acceptor takes the opposite side.
 *  matchupKey: the match the form was opened on; a replaced lineup in between throws 'changed'. */
export async function placeChallenge({ challenger, opponent, outcome, challengerStake, opponentStake, matchupKey }) {
  const cm = getCurrentMatch();
  if (!cm?.matchupKey) throw new Error('closed');
  if (matchupKey !== undefined && cm.matchupKey !== matchupKey) throw new Error('changed');
  const bet = {
    kind: 'challenge', allowancePolicy: 2, matchupKey: cm.matchupKey, challenger, opponent: opponent || null, challengerStake, opponentStake,
    outcome: {
      test: outcome.test, team: outcome.team ? [...outcome.team].sort() : null,
      threshold: outcome.threshold ?? null, negate: Boolean(outcome.negate),
    },
    acceptedBy: null, acceptedAt: null, void: false,
  };
  const verdict = checkBet(bet, { currentMatch: cm });
  if (!verdict.ok) throw new Error(verdict.reason);
  if (Math.max(challengerStake, opponentStake) > BETTING.maxStake) throw new Error('too-much');
  if (challengerStake > available(challenger)) throw new Error('insufficient');
  // A named opponent is locked in straight away (no accept step), so their stake is checked now too.
  if (bet.opponent && opponentStake > available(bet.opponent)) throw new Error(`insufficient:${bet.opponent}`);
  const now = serverTimestamp();
  const lockIn = bet.opponent ? { acceptedBy: bet.opponent, acceptedAt: now } : {};
  const ref = await addDoc(collection(db, 'bets'), { ...bet, ...lockIn, placedAt: now }).catch(deniedAsClosed);
  return ref.id;
}

export async function acceptChallenge(id, acceptor) {
  const local = allBets.find((b) => b.id === id);
  if (local && local.opponentStake > available(acceptor)) throw new Error('insufficient');
  const ref = doc(db, 'bets', id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('withdrawn');
    const c = snap.data();
    const verdict = checkBet({ ...c, acceptedBy: acceptor });
    if (!verdict.ok) throw new Error(verdict.reason);
    const decision = acceptDecision(c, acceptor);
    if (decision === 'taken') throw new Error(`taken:${c.acceptedBy}`);
    if (decision !== 'ok') throw new Error(decision);
    tx.update(ref, { acceptedBy: acceptor, acceptedAt: serverTimestamp() });
  }).catch(deniedChallenge(ref, acceptor));
}

export async function withdrawChallenge(id) {
  const ref = doc(db, 'bets', id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const c = snap.data();
    // a locked-in challenge can only be undone right after posting (rules: 60 s)
    const lockedIn = c?.acceptedBy && c.acceptedAt?.isEqual?.(c.placedAt);
    if (c?.acceptedBy && !lockedIn) throw new Error(`taken:${c.acceptedBy}`);
    tx.update(ref, { void: true });
  }).catch(deniedChallenge(ref, null));
}
