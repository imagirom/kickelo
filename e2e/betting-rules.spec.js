// e2e/betting-rules.spec.js
// Firestore rules for bets and meta/currentMatch, checked against the emulator as the app's user.
import { test, expect } from '@playwright/test';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { ensureTestUser, resetBettingState, DOCS, OWNER, TEST_EMAIL, TEST_PASSWORD } from './helpers.js';

const KEY = 'A::B|C::D';
const OFFER = { winner: { 'A::B': 1.8, 'C::D': 2.01 }, gap: 40, props: [] };
let db;

test.beforeAll(async () => {
  await ensureTestUser();
  const app = initializeApp({ apiKey: 'fake-api-key', projectId: 'kickelo' }, `rules-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 7070);
  await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
});
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'rules do not depend on the viewport');
  await resetBettingState();
  await setDoc(doc(db, 'meta', 'currentMatch'), { matchupKey: KEY, red: ['A', 'B'], blue: ['C', 'D'], offer: OFFER, firstGoalAt: null, goalLog: [], liveId: null, liveStartedAt: null });
});
test.afterAll(async () => { await resetBettingState(); });

const allowed = (p) => p.then(() => true, (e) => { if (e?.code !== 'permission-denied') throw e; return false; });
const house = (extra = {}) => ({ kind: 'house', matchupKey: KEY, bettor: 'S', stake: 10, odds: 1.8,
  outcome: { test: 'winner', team: ['A', 'B'], threshold: null, negate: false }, void: false, placedAt: serverTimestamp(), ...extra });
const challenge = (extra = {}) => ({ kind: 'challenge', matchupKey: KEY, challenger: 'S', opponent: null, challengerStake: 10, opponentStake: 10,
  outcome: { test: 'goesToFourFour', team: null, threshold: null, negate: false }, acceptedBy: null, acceptedAt: null, void: false, placedAt: serverTimestamp(), ...extra });
const addBet = (data) => addDoc(collection(db, 'bets'), data);
const closeBetting = () => updateDoc(doc(db, 'meta', 'currentMatch'), { firstGoalAt: serverTimestamp(), goalLog: [{ team: 'red', timestamp: 1000 }] });

test('house bets: published odds only, whole bounded stakes, no extra keys', async () => {
  expect(await allowed(addBet(house()))).toBe(true);
  expect(await allowed(addBet(house({ odds: 1000 })))).toBe(false);
  expect(await allowed(addBet(house({ odds: 1.9 })))).toBe(false); // winner odds not in the offer
  expect(await allowed(addBet(house({ odds: 11, outcome: { test: 'shutout', team: ['A', 'B'], threshold: null, negate: false } })))).toBe(false);
  for (const stake of [0.5, 1e12, 0]) expect(await allowed(addBet(house({ stake })))).toBe(false);
  expect(await allowed(addBet(house({ bettor: '' })))).toBe(false);
  expect(await allowed(addBet(house({ foo: 1 })))).toBe(false);
  await closeBetting();
  expect(await allowed(addBet(house()))).toBe(false);
});

test('undo: a fresh house bet only, never an old one', async () => {
  const ref = await addBet(house());
  expect(await allowed(updateDoc(ref, { void: true }))).toBe(true);
  // seeded with the owner token: a bet placed two minutes ago
  const old = new Date(Date.now() - 120000).toISOString();
  await fetch(`${DOCS}/bets/old`, { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: {
    kind: { stringValue: 'house' }, matchupKey: { stringValue: KEY }, void: { booleanValue: false }, placedAt: { timestampValue: old } } }) });
  expect(await allowed(updateDoc(doc(db, 'bets', 'old'), { void: true }))).toBe(false);
});

test('challenges: no self-challenge, no empty acceptor, pre-match ones close at the first goal', async () => {
  expect(await allowed(addBet(challenge({ opponent: 'S' })))).toBe(false);
  expect(await allowed(addBet(challenge({ challengerStake: 0.5 })))).toBe(false);
  const pre = await addBet(challenge());
  expect(await allowed(updateDoc(pre, { acceptedBy: '', acceptedAt: serverTimestamp() }))).toBe(false);
  await closeBetting();
  expect(await allowed(updateDoc(pre, { acceptedBy: 'P', acceptedAt: serverTimestamp() }))).toBe(false);
  const mid = await addBet(challenge());
  expect(await allowed(updateDoc(mid, { acceptedBy: 'P', acceptedAt: serverTimestamp() }))).toBe(true);
  expect(await allowed(updateDoc(pre, { void: true }))).toBe(true); // still withdrawable
});

test('meta/currentMatch: no delete, closed betting is not reopened in place', async () => {
  const ref = doc(db, 'meta', 'currentMatch');
  await closeBetting();
  expect(await allowed(updateDoc(ref, { firstGoalAt: null }))).toBe(false);
  expect(await allowed(deleteDoc(ref))).toBe(false);
  expect(await allowed(updateDoc(ref, { firstGoalAt: null, offer: null, goalLog: [] }))).toBe(true); // match ended
  expect(await allowed(updateDoc(ref, { matchupKey: 'A::C|B::D', firstGoalAt: null, offer: OFFER }))).toBe(true);
});
