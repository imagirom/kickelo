import { db, collection, onSnapshot } from './firebase-service.js';
import { updateStatsCache } from './stats-cache-service.js';
import { INACTIVE_THRESHOLD_DAYS, STARTING_ELO } from './constants.js';
import { filterMatchesBySeason, getSelectedSeason } from './season-service.js';
import { computeAllPlayerStats } from './player-stats-batch.js';
import { getVisibleTournaments } from './tournament/tournament-service.js';

function filterRankedMatches(matches) {
    return matches.filter((match) => match?.ranked !== false);
}

// This array will hold all match data, kept in sync by the listener.
let allMatches = [];
// This flag indicates if the initial data has been loaded.
let isDataReady = false;
// This flag prevents the listener from being attached more than once.
let dataInitialized = false;
let recentActivePlayersCache = [];
let recentActivePlayersLookbackDays = INACTIVE_THRESHOLD_DAYS;

function computeRecentActivePlayers(matches, lookbackDays = INACTIVE_THRESHOLD_DAYS) {
    if (!Array.isArray(matches) || matches.length === 0) {
        return [];
    }
    const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    const activeSet = new Set();

    for (const match of matches) {
        if (typeof match.timestamp !== 'number') {
            continue;
        }
        if (match.timestamp < cutoff) {
            break;
        }
        if (Array.isArray(match.teamA)) {
            match.teamA.forEach(player => activeSet.add(player));
        }
        if (Array.isArray(match.teamB)) {
            match.teamB.forEach(player => activeSet.add(player));
        }
    }

    return Array.from(activeSet);
}

/**
 * Initializes the real-time listener for all match data.
 * Call this once when your application starts.
 * It enables offline persistence to avoid re-fetching all data on every page load.
 */
export function initializeMatchesData() {
    // Prevent re-initializing
    if (dataInitialized) {
        console.log("Match data listener is already initialized.");
        return;
    }
    dataInitialized = true;

    const matchesColRef = collection(db, 'matches');

    // onSnapshot listens for any changes in the 'matches' collection
    return onSnapshot(matchesColRef, (snapshot) => {
        console.log(`Match data updated from Firestore. Snapshot size: ${snapshot.size}`);

        const matchesData = [];
        snapshot.forEach((doc) => {
            matchesData.push({ id: doc.id, ...doc.data() });
        });

        // convert Firestore timestamps to milliseconds
        matchesData.forEach(match => {
            if (match.timestamp && typeof match.timestamp.toMillis === 'function') {
                match.timestamp = match.timestamp.toMillis();
            }
        });

        // Sort all matches by timestamp, newest first.
        // It's more efficient to do this once here, rather than in every function.
        matchesData.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        allMatches = matchesData;
        isDataReady = true;
        recentActivePlayersLookbackDays = INACTIVE_THRESHOLD_DAYS;
        recentActivePlayersCache = computeRecentActivePlayers(allMatches, recentActivePlayersLookbackDays);

        // Update the stats cache with all player statistics
        // This computes all stats in a single efficient pass
        refreshSeasonStats();

        // Dispatch a custom event to let your UI components know
        // that new data is available and they should re-render.
        window.dispatchEvent(new CustomEvent('matches-updated'));

    }, (error) => {
        console.error("Error listening to matches collection:", error);
    });
}

/**
 * Resets the match data listener so it can be re-initialized after going offline.
 */
export function resetMatchDataListener() {
    dataInitialized = false;
}

export function refreshSeasonStats(season = getSelectedSeason()) {
    const seasonMatches = filterMatchesBySeason(allMatches, season);
    // Tournaments feed the medal badges (derived from their finalRankings); all matches feed ⏳ and 🏖.
    updateStatsCache(filterRankedMatches(seasonMatches), { season, tournaments: getVisibleTournaments(), allMatches });
}

// Medals change only when a tournament completes, is re-completed after an edit, or is deleted/restored:
// recompute stats then, not on every tournament game.
let completedTournamentsKey = '';
window.addEventListener('tournaments-updated', () => {
    const key = getVisibleTournaments()
        .filter((t) => t.state === 'completed')
        .map((t) => `${t.id}:${t.completedAt}`)
        .join(',');
    if (key === completedTournamentsKey) return;
    completedTournamentsKey = key;
    if (isDataReady) refreshSeasonStats();
});

/**
 * Current all-time overall Elo per player name, from all ranked matches (ignores the selected season).
 * null until match data has loaded.
 */
export function getAllTimeElos() {
    if (!isDataReady) return null;
    const { players } = computeAllPlayerStats(filterRankedMatches(allMatches));
    const elos = {};
    for (const [name, s] of Object.entries(players)) {
        elos[name] = s.eloTrajectory.at(-1)?.elo ?? STARTING_ELO;
    }
    return elos;
}

export function getRecentActivePlayers(lookbackDays = INACTIVE_THRESHOLD_DAYS) {
    if (!Array.isArray(allMatches) || allMatches.length === 0) {
        return [];
    }
    if (lookbackDays !== recentActivePlayersLookbackDays || recentActivePlayersCache.length === 0) {
        recentActivePlayersLookbackDays = lookbackDays;
        recentActivePlayersCache = computeRecentActivePlayers(allMatches, lookbackDays);
    }
    return recentActivePlayersCache;
}

export { allMatches, isDataReady };
