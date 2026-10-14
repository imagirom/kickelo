const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { randomInt, createHash } = require('node:crypto');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const engine = Promise.all([
  import('./generated/src/betting/ledger.js'),
  import('./generated/src/betting/wheel.js'),
]);
const normalize = (snapshot) => snapshot.docs.map(doc => {
  const data = { id: doc.id, ...doc.data() };
  for (const key of ['placedAt', 'acceptedAt', 'timestamp']) {
    if (data[key]?.toMillis) data[key] = data[key].toMillis();
  }
  return data;
});

exports.chooseAllowance = onCall(async (request) => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const { bettor, mode } = request.data || {};
  if (typeof bettor !== 'string' || !bettor.trim() || bettor.length > 200 || !['normal', 'wheel'].includes(mode)) {
    throw new HttpsError('invalid-argument', 'Choose a bettor and allowance option.');
  }
  const [{ dayKey, walletAvailable }, { wheelSegments }] = await engine;
  const now = Date.now();
  const day = dayKey(now);
  const id = `allowance:${createHash('sha256').update(bettor).digest('hex')}:${day}`;
  const db = getFirestore();
  const ref = db.collection('bets').doc(id);
  return db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const data = existing.data();
      if (mode === 'wheel' && data.mode !== 'wheel') throw new HttpsError('failed-precondition', 'Your normal allowance is already selected today.');
      return { id, ...data, placedAt: data.placedAt.toMillis() };
    }
    // Read in the transaction so a concurrent wager/claim changes the snapshot
    // and retries eligibility. The result is only returned after it is committed.
    const bets = normalize(await tx.get(db.collection('bets')));
    const matches = normalize(await tx.get(db.collection('matches')));
    const wallet = walletAvailable(bettor, bets, matches, now);
    const alreadyBet = bets.some(b => ['house', 'challenge'].includes(b.kind) && (
      ((b.bettor === bettor || b.challenger === bettor) && dayKey(b.placedAt) === day)
      || (b.acceptedBy === bettor && typeof b.acceptedAt === 'number' && dayKey(b.acceptedAt) === day)));
    if (mode === 'wheel' && (alreadyBet || wallet.allowanceCredited)) {
      throw new HttpsError('failed-precondition', 'Today’s allowance has already been used.');
    }
    const choice = { kind: 'allowance', mode, bettor, placedAt: Timestamp.fromMillis(now), void: false };
    if (mode === 'wheel') {
      choice.allowance = wallet.allowance;
      choice.repayment = wallet.repayment;
      choice.segments = wheelSegments(wallet.allowance - wallet.repayment);
      choice.segment = randomInt(choice.segments.length);
      choice.payout = choice.segments[choice.segment];
    }
    tx.create(ref, choice);
    return { id, ...choice, placedAt: now };
  });
});
