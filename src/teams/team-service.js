// Real-time service for the 'teams' Firestore collection.
// Mirrors player-data-service.js: onSnapshot -> in-memory Map -> debounced event.

import { db, collection, doc, getDoc, setDoc, onSnapshot } from '../firebase-service.js';
import { serverTimestamp } from 'firebase/firestore';
import { teamA1Select, teamA2Select, teamB1Select, teamB2Select } from '../dom-elements.js';
import { allPlayers } from '../player-data-service.js';
import { teamKey, pairFromSelects } from './team-identity.js';
import { INITIAL_TEAMS, resolveTeamPlayers } from './initial-teams.js';

// teamKey -> { key, players, name?, songUri?, songPositionMs?, updatedAt? }
const teamRecords = new Map();
let initialized = false;
let debounceTimer;

function teamsCol() {
  return collection(db, 'teams');
}

/** Record for a team key, or null. */
export function getTeamRecord(key) {
  return teamRecords.get(key) || null;
}

/** {red, blue} records (or null) for the teams currently in the match-form selects. */
export function getCurrentTeamRecords() {
  const { red, blue } = pairFromSelects(
    teamA1Select?.value, teamA2Select?.value, teamB1Select?.value, teamB2Select?.value
  );
  return {
    red: getTeamRecord(teamKey(red)),
    blue: getTeamRecord(teamKey(blue)),
  };
}

/** Persist a team name (merge; does not touch songUri). Pass empty string to clear. */
export async function setTeamName(key, players, name) {
  const clean = (name || '').trim();
  await setDoc(doc(teamsCol(), key), {
    players: [...players].sort(),
    name: clean || null,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/** Attach the real-time listener. Returns the unsubscribe fn (for goOffline). */
export function initializeTeams() {
  if (initialized) return () => {};
  initialized = true;
  return onSnapshot(teamsCol(), (snapshot) => {
    teamRecords.clear();
    snapshot.forEach((d) => teamRecords.set(d.id, { key: d.id, ...d.data() }));
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('teams-updated'));
    }, 200);
  }, (error) => {
    console.error('Error listening to teams collection:', error);
  });
}

/** Reset the listener guard so it can be re-attached after going offline. */
export function resetTeamsListener() {
  initialized = false;
}

/**
 * Seed INITIAL_TEAMS idempotently against the live roster. For each entry,
 * only writes fields that are ABSENT on the existing doc (never clobbers a
 * manually-edited name/song). Returns a summary for the caller to surface.
 * @returns {Promise<{ written: number, skipped: Array<{ entry: object, resolution: object }> }>}
 */
export async function seedInitialTeams() {
  const roster = (allPlayers || []).map((p) => p.name);
  let written = 0;
  const skipped = [];
  for (const entry of INITIAL_TEAMS) {
    const resolution = resolveTeamPlayers(entry.firstNames, roster);
    if (!resolution.ok) {
      skipped.push({ entry, resolution });
      continue;
    }
    const key = teamKey(resolution.players);
    const ref = doc(teamsCol(), key);
    const existing = (await getDoc(ref)).data() || {};
    const update = {};
    if (entry.name != null && existing.name == null) update.name = entry.name;
    if (entry.songUri != null && existing.songUri == null) {
      update.songUri = entry.songUri;
      update.songPositionMs = entry.songPositionMs || 0;
    }
    if (!('players' in existing)) update.players = resolution.players;
    if (Object.keys(update).length === 0) continue; // nothing new to write
    update.updatedAt = serverTimestamp();
    await setDoc(ref, update, { merge: true });
    written++;
  }
  return { written, skipped };
}
