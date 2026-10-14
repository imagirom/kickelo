/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require('firebase-admin');

// Initialize the Firebase Admin SDK
admin.initializeApp();

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// Notify opted-in users when a new match is created
exports.notifyOnMatchCreate = onDocumentCreated('matches/{matchId}', async (event) => {
    const snap = event.data;
    if (!snap) return null;
    const match = snap.data() || {};
    const matchTimestamp = match.timestamp?.toMillis?.();
    if (!matchTimestamp) return null;

    const SESSION_GAP_MS = Number(process.env.SESSION_GAP_MS || 30 * 60 * 1000);
    const cutoffTimestamp = matchTimestamp - SESSION_GAP_MS;
    const previousMatches = await admin.firestore()
      .collection('matches')
      .where('timestamp', '<', match.timestamp)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    if (!previousMatches.empty) {
      const previousMatch = previousMatches.docs[0].data();
      const previousTimestamp = previousMatch.timestamp?.toMillis?.();
      if (previousTimestamp && previousTimestamp >= cutoffTimestamp) {
        return null;
      }
    }
    const winner = match.winner === 'A' ? 'Team A' : 'Team B';
    const goalsA = match.goalsA ?? '-';
    const goalsB = match.goalsB ?? '-';

    const title = 'New match submitted';
    const body = `${winner} won ${goalsA}:${goalsB}. Join the session?`;

    const usersSnapshot = await admin.firestore()
      .collection('users')
      .where('notificationsEnabled', '==', true)
      .get();

    if (usersSnapshot.empty) {
      return null;
    }

    const tokenToUser = new Map();
    usersSnapshot.forEach((doc) => {
      const data = doc.data() || {};
      const tokens = data.fcmTokens || {};
      Object.keys(tokens).forEach((token) => {
        tokenToUser.set(token, doc.id);
      });
    });

    const tokens = Array.from(tokenToUser.keys());
    if (tokens.length === 0) {
      return null;
    }

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { url: '/' }
    });

    const invalidTokensByUser = new Map();
    response.responses.forEach((resp, idx) => {
      if (resp.success) return;
      const errorCode = resp.error?.code;
      if (errorCode === 'messaging/registration-token-not-registered'
          || errorCode === 'messaging/invalid-registration-token') {
        const token = tokens[idx];
        const userId = tokenToUser.get(token);
        if (!userId) return;
        if (!invalidTokensByUser.has(userId)) {
          invalidTokensByUser.set(userId, []);
        }
        invalidTokensByUser.get(userId).push(token);
      }
    });

    const cleanupPromises = [];
    invalidTokensByUser.forEach((tokensForUser, userId) => {
      const updates = {};
      tokensForUser.forEach((token) => {
        updates[`fcmTokens.${token}`] = admin.firestore.FieldValue.delete();
      });
      updates.notificationsEnabled = false;
      cleanupPromises.push(admin.firestore().collection('users').doc(userId).update(updates));
    });

    if (cleanupPromises.length > 0) {
      await Promise.all(cleanupPromises);
    }

    return null;
  });

// Optional daily allowance wheel. Results are drawn and persisted server-side.
exports.chooseAllowance = require('./allowance-wheel').chooseAllowance;
