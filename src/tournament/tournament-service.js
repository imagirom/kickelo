// Tournament Firestore Service — CRUD, listeners, and state management.

import {
  db, collection, doc, addDoc, getDoc, getDocs, updateDoc,
  query, where, orderBy, onSnapshot
} from '../firebase-service.js';
import { serverTimestamp } from 'firebase/firestore';
import {
  initializeBracket, completeGame, isTournamentComplete,
  computeFinalRankings, validateTournamentSetup, generateTeamName,
  isSwissRoundComplete, getCurrentSwissRound
} from './tournament-engine.js';
import {
  generateSingleElimBracket, generateDoubleElimBracket,
  generateSwissFirstRound, generateSwissRound, generateRoundRobinSchedule
} from './tournament-formats.js';

const TOURNAMENTS_COLLECTION = 'tournaments';

// Reactive state
let allTournaments = [];
let isDataReady = false;
let dataInitialized = false;
let unsubscribe = null;

/**
 * Initialize real-time listener for tournaments.
 * Call once at app startup.
 */
export function initializeTournamentsData() {
  if (dataInitialized) return;
  dataInitialized = true;

  const colRef = collection(db, TOURNAMENTS_COLLECTION);

  unsubscribe = onSnapshot(colRef, (snapshot) => {
    const tournaments = [];
    snapshot.forEach((docSnap) => {
      tournaments.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Convert Firestore timestamps
    for (const t of tournaments) {
      if (t.createdAt && typeof t.createdAt.toMillis === 'function') {
        t.createdAt = t.createdAt.toMillis();
      }
    }

    // Sort by creation date, newest first
    tournaments.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    allTournaments = tournaments;
    isDataReady = true;

    window.dispatchEvent(new CustomEvent('tournaments-updated'));
  }, (error) => {
    console.error('Error listening to tournaments:', error);
  });
}

/**
 * Get all visible (non-deleted) tournaments.
 */
export function getVisibleTournaments() {
  return allTournaments.filter(t => t.state !== 'deleted');
}

/**
 * Get a tournament by ID from the local cache.
 */
export function getTournamentById(id) {
  return allTournaments.find(t => t.id === id) || null;
}

/**
 * Get a tournament directly from Firestore (for guaranteed fresh data).
 */
export async function fetchTournament(id) {
  const docRef = doc(db, TOURNAMENTS_COLLECTION, id);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// =========================================================================
// Create & Setup
// =========================================================================

/**
 * Create a new tournament in setup state.
 */
export async function createTournament(name, adminPassword = null) {
  if (!name || !name.trim()) throw new Error('Tournament name is required');

  const data = {
    name: name.trim(),
    format: null,
    state: 'setup',
    createdAt: serverTimestamp(),
    lockedAt: null,
    completedAt: null,
    deletedAt: null,
    adminPassword: adminPassword || null,
    teams: [],
    config: { seedingMode: 'elo' },
    games: [],
    defaultGameOrder: [],
    finalRankings: null,
  };

  const docRef = await addDoc(collection(db, TOURNAMENTS_COLLECTION), data);
  return docRef.id;
}

/**
 * Add a team to a tournament in setup state.
 * Returns the new team object.
 */
export async function addTeam(tournamentId, players) {
  const t = await fetchTournament(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.state !== 'setup') throw new Error('Cannot add teams after setup');

  const teamId = 't' + (t.teams.length + 1);
  const teamName = generateTeamName(players);
  const newTeam = {
    id: teamId,
    name: teamName,
    players,
    seed: t.teams.length + 1,
    avgElo: null,
  };

  const updatedTeams = [...t.teams, newTeam];
  await updateDoc(doc(db, TOURNAMENTS_COLLECTION, tournamentId), {
    teams: updatedTeams,
  });

  return newTeam;
}

/**
 * Remove a team from a tournament in setup state.
 */
export async function removeTeam(tournamentId, teamId) {
  const t = await fetchTournament(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.state !== 'setup') throw new Error('Cannot remove teams after setup');

  const updatedTeams = t.teams
    .filter(team => team.id !== teamId)
    .map((team, i) => ({ ...team, seed: i + 1, id: 't' + (i + 1) }));

  await updateDoc(doc(db, TOURNAMENTS_COLLECTION, tournamentId), {
    teams: updatedTeams,
  });
}

/**
 * Update a team's name in a tournament in setup state.
 */
export async function updateTeamName(tournamentId, teamId, newName) {
  const t = await fetchTournament(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.state !== 'setup') throw new Error('Cannot edit teams after setup');

  const updatedTeams = t.teams.map(team =>
    team.id === teamId ? { ...team, name: newName } : team
  );

  await updateDoc(doc(db, TOURNAMENTS_COLLECTION, tournamentId), {
    teams: updatedTeams,
  });
}

/**
 * Update tournament configuration (format, seeding mode, etc.)
 */
export async function updateTournamentConfig(tournamentId, updates) {
  const t = await fetchTournament(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.state !== 'setup') throw new Error('Cannot change config after setup');

  const allowedFields = ['format', 'config', 'name'];
  const docUpdate = {};
  for (const key of allowedFields) {
    if (key in updates) {
      docUpdate[key] = updates[key];
    }
  }

  if (Object.keys(docUpdate).length > 0) {
    await updateDoc(doc(db, TOURNAMENTS_COLLECTION, tournamentId), docUpdate);
  }
}

// =========================================================================
// Lock & Start
// =========================================================================

/**
 * Lock the tournament: assign seeds, generate bracket, transition to in_progress.
 * @param {string} tournamentId
 * @param {Object} playerElos - Map of player name → current Elo (for seeding)
 */
export async function lockTournament(tournamentId, playerElos = {}) {
  const t = await fetchTournament(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.state !== 'setup') throw new Error('Tournament is not in setup state');
  if (!t.format) throw new Error('No format selected');

  const validation = validateTournamentSetup(t.teams, t.format, t.config);
  if (!validation.valid) {
    throw new Error('Invalid setup: ' + validation.errors.join(', '));
  }

  // Compute avg Elo per team
  const teamsWithElo = t.teams.map(team => {
    const elos = team.players.map(p => playerElos[p] || 1500);
    const avgElo = elos.reduce((a, b) => a + b, 0) / elos.length;
    return { ...team, avgElo };
  });

  // Assign seeds
  const seedingMode = t.config?.seedingMode || 'elo';
  let seededTeams;
  if (seedingMode === 'random') {
    const shuffled = [...teamsWithElo];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    seededTeams = shuffled.map((team, i) => ({ ...team, seed: i + 1 }));
  } else {
    // Sort by Elo descending — highest Elo = seed 1
    const sorted = [...teamsWithElo].sort((a, b) => b.avgElo - a.avgElo);
    seededTeams = sorted.map((team, i) => ({ ...team, seed: i + 1 }));
  }

  // Re-assign team IDs to match seed order
  seededTeams = seededTeams.map((team, i) => ({ ...team, id: 't' + (i + 1) }));

  // Generate bracket
  let bracket;
  switch (t.format) {
    case 'single_elim':
      bracket = generateSingleElimBracket(seededTeams, t.config);
      break;
    case 'double_elim':
      bracket = generateDoubleElimBracket(seededTeams, t.config);
      break;
    case 'swiss':
      bracket = generateSwissFirstRound(seededTeams, t.config);
      break;
    case 'round_robin':
      bracket = generateRoundRobinSchedule(seededTeams, t.config);
      break;
    default:
      throw new Error('Unknown format: ' + t.format);
  }

  // Build tournament object for initialization
  const tournamentObj = {
    ...t,
    teams: seededTeams,
    games: bracket.games,
    defaultGameOrder: bracket.defaultGameOrder,
    state: 'in_progress',
  };

  // Initialize bracket (resolve seeds, auto-complete byes)
  initializeBracket(tournamentObj);

  // Persist
  await updateDoc(doc(db, TOURNAMENTS_COLLECTION, tournamentId), {
    teams: tournamentObj.teams,
    games: tournamentObj.games,
    defaultGameOrder: tournamentObj.defaultGameOrder,
    state: 'in_progress',
    lockedAt: Date.now(),
  });

  return tournamentObj;
}

// =========================================================================
// Game Completion
// =========================================================================

/**
 * Submit a tournament game result.
 * Updates the tournament (cascades results) and returns the updated tournament.
 *
 * @param {string} tournamentId
 * @param {string} gameId
 * @param {number} winnerIndex - 0 or 1
 * @param {string} matchId - ID of the match document in /matches
 * @param {number[]} score - [team0Goals, team1Goals]
 */
export async function submitTournamentGameResult(tournamentId, gameId, winnerIndex, matchId, score) {
  const t = await fetchTournament(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.state !== 'in_progress') throw new Error('Tournament is not in progress');

  // Use engine to complete the game and cascade
  completeGame(t, gameId, winnerIndex, matchId, score);

  // Check if tournament is complete
  const updates = { games: t.games };
  if (isTournamentComplete(t)) {
    t.finalRankings = computeFinalRankings(t);
    t.state = 'completed';
    t.completedAt = Date.now();
    updates.finalRankings = t.finalRankings;
    updates.state = 'completed';
    updates.completedAt = t.completedAt;
  }

  await updateDoc(doc(db, TOURNAMENTS_COLLECTION, tournamentId), updates);
  return t;
}

/**
 * Generate next Swiss round. Only applicable for swiss format.
 */
export async function generateNextSwissRound(tournamentId) {
  const t = await fetchTournament(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.format !== 'swiss') throw new Error('Not a Swiss tournament');
  if (t.state !== 'in_progress') throw new Error('Tournament is not in progress');

  const currentRound = getCurrentSwissRound(t);
  if (!isSwissRoundComplete(t, currentRound)) {
    throw new Error(`Round ${currentRound} is not yet complete`);
  }

  const nextRound = currentRound + 1;
  const maxRounds = t.config?.swissRounds || Math.ceil(Math.log2(t.teams.length));
  if (nextRound > maxRounds) {
    throw new Error('All Swiss rounds have been played');
  }

  const { newGames, newGameOrder } = generateSwissRound(t, nextRound);
  const updatedGames = [...t.games, ...newGames];
  const updatedOrder = [...t.defaultGameOrder, ...newGameOrder];

  await updateDoc(doc(db, TOURNAMENTS_COLLECTION, tournamentId), {
    games: updatedGames,
    defaultGameOrder: updatedOrder,
  });

  return { newGames, newGameOrder };
}

// =========================================================================
// Deletion & Restoration
// =========================================================================

/**
 * Soft-delete a tournament (sets state to 'deleted').
 */
export async function softDeleteTournament(tournamentId) {
  await updateDoc(doc(db, TOURNAMENTS_COLLECTION, tournamentId), {
    state: 'deleted',
    deletedAt: Date.now(),
  });
}

/**
 * Restore a soft-deleted tournament to its previous state.
 */
export async function restoreTournament(tournamentId) {
  const t = await fetchTournament(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (t.state !== 'deleted') throw new Error('Tournament is not deleted');

  // Determine the state to restore to
  let restoredState = 'setup';
  if (t.completedAt) {
    restoredState = 'completed';
  } else if (t.lockedAt) {
    restoredState = 'in_progress';
  }

  await updateDoc(doc(db, TOURNAMENTS_COLLECTION, tournamentId), {
    state: restoredState,
    deletedAt: null,
  });
}

// =========================================================================
// Clone (Re-do)
// =========================================================================

/**
 * Clone a tournament: creates a new tournament in setup state
 * with the same teams, format, and config. Ready to be locked again.
 * @param {string} tournamentId - ID of the tournament to clone
 * @param {string} newName - Name for the new tournament
 * @returns {Promise<string>} ID of the new tournament
 */
export async function cloneTournament(tournamentId, newName) {
  const t = await fetchTournament(tournamentId);
  if (!t) throw new Error('Tournament not found');
  if (!newName || !newName.trim()) throw new Error('New tournament name is required');

  // Clone teams (reset seeds to insertion order, clear avgElo)
  const clonedTeams = t.teams.map((team, i) => ({
    id: 't' + (i + 1),
    name: team.name,
    players: [...team.players],
    seed: i + 1,
    avgElo: null,
  }));

  const data = {
    name: newName.trim(),
    format: t.format,
    state: 'setup',
    createdAt: serverTimestamp(),
    lockedAt: null,
    completedAt: null,
    deletedAt: null,
    adminPassword: t.adminPassword || null,
    teams: clonedTeams,
    config: { ...t.config },
    games: [],
    defaultGameOrder: [],
    finalRankings: null,
  };

  const docRef = await addDoc(collection(db, TOURNAMENTS_COLLECTION), data);
  return docRef.id;
}

// =========================================================================
// Exports
// =========================================================================

export { allTournaments, isDataReady };
