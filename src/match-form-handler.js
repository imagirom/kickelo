// src/match-form-handler.js

import { db, doc, addDoc, updateDoc, collection } from './firebase-service.js';
import { serverTimestamp } from "firebase/firestore";
import { expectedScore, updateRating } from './elo-service.js';
import { getOrCreatePlayer } from './player-manager.js';
import { getCachedStats, isCacheReady } from './stats-cache-service.js';
import { getSelectedSeason, filterMatchesBySeason } from './season-service.js';
import {
    teamA1Select, teamA2Select, teamB1Select, teamB2Select,
    teamAgoalsInput, teamBgoalsInput, submitMatchBtn,
    toggleLiveMode, liveMatchPanel, btnBlueScored, btnRedScored, goalTimeline, liveModeStatus,

    positionConfirmationContainer, positionsConfirmedCheckbox,
    rankedMatchContainer, rankedMatchCheckbox
} from './dom-elements.js';
import { MAX_GOALS, STARTING_ELO } from './constants.js';
import { evaluateLastSuggestion, clearLastSuggestion } from './pairing-service.js';
import { showToast, showConfirm } from './toast.js';
import { allMatches } from './match-data-service.js';
import { computeAllPlayerStats } from './player-stats-batch.js';
import { getStatusBadges } from './leaderboard-display.js';
import { createTimelineWithLabel } from './match-timeline.js';
import { getActiveTournamentGame, clearActiveTournamentGame, completeTournamentMatch } from './tournament/tournament-ui.js';

/**
 * Compute the emoji/badge diff between the current state and after adding a new match.
 * Returns a DOM element showing gained/lost/changed badges per player, or null if no changes.
 */
function buildEmojiDiffElement(playerNames, teamA, teamB, winner, goalsA, goalsB, season, opts = {}) {
    try {
        const { isRanked = true, goalLogData = null, matchDurationMs = 0 } = opts;

        // Only show emoji diff for ranked matches
        if (!isRanked) return null;

        // Build a synthetic match to append to the current match list
        const syntheticMatch = {
            teamA, teamB, winner,
            goalsA, goalsB,
            timestamp: Date.now(),
            ranked: true,
            ...(goalLogData && goalLogData.length > 0
                ? { goalLog: goalLogData, matchDuration: matchDurationMs }
                : {}),
        };

        // Get current season matches (same filtering as stats cache)
        const seasonMatches = filterMatchesBySeason(allMatches, season)
            .filter(m => m.ranked !== false);

        // Prepend synthetic match (matches are sorted newest-first)
        const matchesWithNew = [syntheticMatch, ...seasonMatches];
        const newStatsResult = computeAllPlayerStats(matchesWithNew, { season });

        // Build badge diff for each player
        const diffs = [];
        for (const name of playerNames) {
            const oldStats = getCachedStats(name);
            const newStats = newStatsResult.players?.[name];
            const oldBadges = getStatusBadges(oldStats);
            const newBadges = getStatusBadges(newStats);

            const oldMap = new Map(oldBadges.map(b => [b.emoji, b]));
            const newMap = new Map(newBadges.map(b => [b.emoji, b]));

            const changes = [];
            // Find gained, increased, or decreased badges
            for (const [emoji, badge] of newMap) {
                const old = oldMap.get(emoji);
                if (!old) {
                    changes.push({ type: 'gained', emoji, value: badge.value, badge });
                } else if (badge.value !== undefined && old.value !== undefined && badge.value > old.value) {
                    changes.push({ type: 'gained', emoji, value: badge.value - old.value, badge });
                } else if (badge.value !== undefined && old.value !== undefined && badge.value < old.value) {
                    changes.push({ type: 'lost', emoji, value: old.value - badge.value, badge });
                }
            }
            // Find fully lost badges
            for (const [emoji, badge] of oldMap) {
                if (!newMap.has(emoji)) {
                    changes.push({ type: 'lost', emoji, value: badge.value, badge });
                }
            }

            if (changes.length > 0) {
                diffs.push({ name, changes });
            }
        }

        if (diffs.length === 0) return null;

        // Build DOM element
        const container = document.createElement('div');
        container.className = 'confirm-emoji-diff';

        const heading = document.createElement('div');
        heading.className = 'confirm-emoji-diff-heading';
        heading.textContent = 'Badge changes';
        container.appendChild(heading);

        for (const { name, changes } of diffs) {
            const row = document.createElement('div');
            row.className = 'confirm-emoji-diff-row';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'confirm-emoji-diff-player';
            nameSpan.textContent = name;
            row.appendChild(nameSpan);

            const badgesSpan = document.createElement('span');
            badgesSpan.className = 'confirm-emoji-diff-badges';

            for (const change of changes) {
                const span = document.createElement('span');
                span.className = 'confirm-emoji-diff-badge';

                if (change.type === 'gained') {
                    span.classList.add('badge-gained');
                    span.textContent = change.value !== undefined && change.value > 1
                        ? `+${change.emoji}${change.value}`
                        : `+${change.emoji}`;
                } else if (change.type === 'lost') {
                    span.classList.add('badge-lost');
                    span.textContent = change.value !== undefined && change.value > 1
                        ? `−${change.emoji}${change.value}`
                        : `−${change.emoji}`;
                }
                badgesSpan.appendChild(span);
            }

            row.appendChild(badgesSpan);
            container.appendChild(row);
        }

        return container;
    } catch (err) {
        console.warn('Failed to compute emoji diff for confirmation:', err);
        return null;
    }
}

function buildWaitingPlayers(activePlayers = [], teamA = [], teamB = []) {
    if (!Array.isArray(activePlayers) || activePlayers.length === 0) return [];
    const playingSet = new Set([...teamA, ...teamB]);
    return activePlayers.filter(player => !playingSet.has(player));
}

function buildPairingMetadata(teamA, teamB) {
    const evaluation = evaluateLastSuggestion(teamA, teamB);
    if (!evaluation.hasSuggestion) {
        return { source: 'manual' };
    }
    const waitingPlayers = buildWaitingPlayers(evaluation.activePlayers, teamA, teamB);
    if (evaluation.pairingMatched) {
        return {
            source: 'suggested',
            suggestedAt: evaluation.suggestedAt,
            waitingPlayers
        };
    }
    if (evaluation.isFresh) {
        return {
            source: 'manual',
            suggestedAt: evaluation.suggestedAt,
            waitingPlayers
        };
    }
    return { source: 'manual' };
}

function getSeasonElo(playerName) {
    if (!isCacheReady()) {
        return STARTING_ELO;
    }
    const stats = getCachedStats(playerName);
    if (!stats || !Array.isArray(stats.eloTrajectory) || stats.eloTrajectory.length === 0) {
        return STARTING_ELO;
    }
    return stats.eloTrajectory[stats.eloTrajectory.length - 1].elo ?? STARTING_ELO;
}

export function setupMatchForm() {
    submitMatchBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const tA1 = teamA1Select.value.trim();
        const tA2 = teamA2Select.value.trim();
        const tB1 = teamB1Select.value.trim();
        const tB2 = teamB2Select.value.trim();

        let parsedGoalsA, parsedGoalsB;
        if (liveMode) {
            parsedGoalsA = goalLog.filter(g => g.team === 'red').length;
            parsedGoalsB = goalLog.filter(g => g.team === 'blue').length;
        } else {
            const goalsA = teamAgoalsInput.value.trim();
            const goalsB = teamBgoalsInput.value.trim();
            if (!/^[0-9]+$/.test(goalsA) || !/^[0-9]+$/.test(goalsB)) {
                return showToast("Goals must be valid numbers.", 'error');
            }
            parsedGoalsA = parseInt(goalsA, 10);
            parsedGoalsB = parseInt(goalsB, 10);
        }
        if (parsedGoalsA === parsedGoalsB) {
            return showToast("Cannot submit a tie.", 'error');
        }
        if (parsedGoalsA > MAX_GOALS || parsedGoalsB > MAX_GOALS) {
            return showToast(`Goals cannot exceed ${MAX_GOALS}.`, 'error');
        }
        // Enforce that one team has exactly MAX_GOALS and the other less
        if (!(parsedGoalsA === MAX_GOALS && parsedGoalsB < MAX_GOALS) && !(parsedGoalsB === MAX_GOALS && parsedGoalsA < MAX_GOALS)) {
            return showToast(`One team must have exactly ${MAX_GOALS} goals, the other less.`, 'error');
        }

        // --- Build teams, allow 1v1 or 2v2 ---
        // For each team, if both positions are the same or one is blank, use only one player
        let teamA = [];
        if (tA1 && tA2) {
            if (tA1 === tA2) teamA = [tA1];
            else teamA = [tA1, tA2];
        } else if (tA1) {
            teamA = [tA1];
        } else if (tA2) {
            teamA = [tA2];
        }
        let teamB = [];
        if (tB1 && tB2) {
            if (tB1 === tB2) teamB = [tB1];
            else teamB = [tB1, tB2];
        } else if (tB1) {
            teamB = [tB1];
        } else if (tB2) {
            teamB = [tB2];
        }

        // Validation: at least one player per team
        if (teamA.length === 0 || teamB.length === 0) {
            return showToast("Each team must have at least one player.", 'error');
        }
        // Validation: no player can be on both teams
        const allPlayers = [...teamA, ...teamB];
        const uniquePlayers = new Set(allPlayers);
        if (uniquePlayers.size < allPlayers.length) {
            return showToast("A player cannot play on both teams.", 'error');
        }
        // Validation: Ensure equal team sizes
        if (teamA.length !== teamB.length) {
            return showToast("Both teams must have the same number of players (1v1 or 2v2).", 'error');
        }

        if (requiresPositionConfirmation() && !isPositionConfirmationChecked()) {
            const proceedWithoutPositions = await showConfirm(
                "You haven't confirmed the offense/defense positions. Submit anyway without logging them?\n\n" +
                "If you want them recorded, check the 'Positions confirmed' box below the player selects before submitting.",
                { confirmLabel: 'Submit anyway', cancelLabel: 'Go back', type: 'warning' }
            );
            if (!proceedWithoutPositions) {
                positionsConfirmedCheckbox?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                positionsConfirmedCheckbox?.focus();
                return;
            }
        }

        const winner = parsedGoalsA > parsedGoalsB ? "A" : "B";

        // Get player documents (getOrCreatePlayer for each unique player)
        const playerNames = Array.from(uniquePlayers);
        const playerDocs = await Promise.all(playerNames.map(getOrCreatePlayer));
        const playerMap = {};
        playerDocs.forEach(p => { playerMap[p.name] = p; });

        // Calculate season-aware team ratings (average of team members)
        const teamARating = teamA.reduce((sum, name) => sum + getSeasonElo(name), 0) / teamA.length;
        const teamBRating = teamB.reduce((sum, name) => sum + getSeasonElo(name), 0) / teamB.length;
        const expectedA = expectedScore(teamARating, teamBRating);
        const scoreA = winner === "A" ? 1 : 0;
        const season = getSelectedSeason();
        const seasonKFactor = season?.kFactor;
        const delta = updateRating(0, expectedA, scoreA, seasonKFactor);

        // Confirmation message
        const winnerNames = winner === "A" ? teamA.join(" & ") : teamB.join(" & ");
        const loserNames = winner === "A" ? teamB.join(" & ") : teamA.join(" & ");
        const eloChange = Math.abs(delta);
        const winnerGoals = winner === "A" ? parsedGoalsA : parsedGoalsB;
        const loserGoals = winner === "A" ? parsedGoalsB : parsedGoalsA;
        const seasonLabel = season?.name ? ` (${season.name})` : '';
        const message = `Confirm match submission:\n\nWinners: ${winnerNames}\nLosers: ${loserNames}\nScore: ${winnerGoals}:${loserGoals}\nElo change${seasonLabel}: ${eloChange}`;

        // Build rich confirmation content
        const confirmContent = document.createElement('div');
        confirmContent.className = 'confirm-match-details';

        // 1. If live mode was used, show SVG goal timeline
        if (liveMode && goalLog.length > 0) {
            const timelineEl = createTimelineWithLabel(goalLog);
            if (timelineEl) {
                const timelineWrapper = document.createElement('div');
                timelineWrapper.className = 'confirm-timeline';
                timelineWrapper.appendChild(timelineEl);
                confirmContent.appendChild(timelineWrapper);
            }
        }

        // 2. Compute emoji diff for players in this match
        const rankedForDiff = getRankedMatchState() ?? true;
        const emojiDiffEl = buildEmojiDiffElement(
            playerNames, teamA, teamB, winner,
            parsedGoalsA, parsedGoalsB, season, {
                isRanked: rankedForDiff,
                goalLogData: liveMode ? goalLog.slice() : null,
                matchDurationMs: liveMode && matchStartTime ? Date.now() - matchStartTime : 0,
            }
        );
        if (emojiDiffEl) {
            confirmContent.appendChild(emojiDiffEl);
        }

        const hasContent = confirmContent.children.length > 0;
        if (!await showConfirm(message, {
            confirmLabel: 'Submit',
            cancelLabel: 'Cancel',
            contentElement: hasContent ? confirmContent : null,
        })) {
            return;
        }

    const pairingMetadata = buildPairingMetadata(teamA, teamB);
    console.log("Pairing metadata for submitted match:", pairingMetadata);
    const positionsConfirmedState = getPositionConfirmationState();
    const rankedMatchState = getRankedMatchState();


        // Update players' games count
        const matchesColRef = collection(db, 'matches');
        const playersColRef = collection(db, 'players');
        // For each player, update games only
        const updatePromises = [];
        teamA.forEach(name => {
            const p = playerMap[name];
            updatePromises.push(updateDoc(doc(playersColRef, name), { games: (p.games || 0) + 1 }));
        });
        teamB.forEach(name => {
            const p = playerMap[name];
            updatePromises.push(updateDoc(doc(playersColRef, name), { games: (p.games || 0) + 1 }));
        });
        await Promise.all(updatePromises);

        // Add match log
        try {
            // 1. Build match data object
            const matchData = {
                teamA: teamA,
                teamB: teamB,
                winner: winner,
                goalsA: parsedGoalsA,
                goalsB: parsedGoalsB,
                timestamp: serverTimestamp(),
                pairingMetadata,
                positionsConfirmed: positionsConfirmedState,
                ranked: rankedMatchState ?? true,
                ...(liveMode && goalLog.length > 0 ? { goalLog: goalLog.slice(), matchDuration: Date.now() - matchStartTime } : {})
            };

            // Add tournament fields if playing a tournament game
            const tournamentGame = getActiveTournamentGame();
            if (tournamentGame) {
                matchData.tournamentId = tournamentGame.tournamentId;
                matchData.tournamentGameId = tournamentGame.gameId;
                matchData.tournamentGameName = tournamentGame.gameName;
                matchData.tournamentName = tournamentGame.tournamentName;
            }

            // 2. Add match to Firestore first
            const matchDocRef = await addDoc(matchesColRef, matchData);
            clearLastSuggestion();

            // 3. If vibration tracking enabled, upload log to Storage and update match doc
            if (vibrationTrackingEnabled && vibrationLog.length > 0) {
                try {
                    uploadIndicator.style.display = 'flex';
                    const { storage, storageRef } = await import('./firebase-service.js');
                    const logPath = `vibrationLogs/${matchDocRef.id}.json`;
                    const fileRef = storageRef(storage, logPath);
                    const logBlob = new Blob([JSON.stringify(vibrationLog)], { type: 'application/json' });
                    await (await import('firebase/storage')).uploadBytes(fileRef, logBlob);
                    await updateDoc(matchDocRef, { vibrationLogPath: logPath });
                    // wait for a second to admire the loading animation
                    await new Promise(res => setTimeout(res, 1000));
                    console.log("Vibration log uploaded successfully.");
                } catch (uploadError) {
                    console.log("Vibration log upload failed:", uploadError.message || uploadError);
                    showToast("Vibration log upload failed. Match was still submitted, but without vibration log.", 'warning');
                } finally {
                    uploadIndicator.style.display = 'none';
                    stopVibrationTracking();
                    // wait until uploadIndicator is hidden
                    await new Promise(res => setTimeout(res, 300));
                }
            }

            showToast("Match submitted!", 'success');

            // Complete tournament game if in tournament mode
            if (tournamentGame) {
                if (!validateTournamentTeams(tournamentGame)) {
                    showToast('Match submitted but tournament result could not be recorded.', 'warning');
                } else {
                    const winnerIndex = getTournamentWinnerIndex(winner);
                    // When teams are swapped, score must also be swapped to match tournament team order
                    const teamsSwapped = tournamentTeamMapping && tournamentTeamMapping.team0Color === 'B';
                    const tScore0 = teamsSwapped ? parsedGoalsB : parsedGoalsA;
                    const tScore1 = teamsSwapped ? parsedGoalsA : parsedGoalsB;
                    await completeTournamentMatch(matchDocRef.id, tScore0, tScore1, winnerIndex);
                }
                setPlayerSelectsLocked(false);
                tournamentTeamMapping = null;
                window.dispatchEvent(new Event('tournament-game-submitted'));
            }

            resetMatchForm();
            setLiveMode(false, true); // Reset to final score mode after submit
            stopLiveMatchTimer(); // Stop timer after submit
        } catch (error) {
            console.error("Error submitting match:", error.message || error);

            showToast("Failed to submit match. Check the console for more details.", 'error');
        }
    });
}


// Function to reset the match form
export function resetMatchForm() {
    teamA1Select.value = "";
    teamA2Select.value = "";
    teamB1Select.value = "";
    teamB2Select.value = "";
    teamAgoalsInput.value = "0";
    teamBgoalsInput.value = "0";
    stopLiveMatchTimer(); // Also stop timer on reset
    updatePositionConfirmationUI();
    if (rankedMatchCheckbox) {
        rankedMatchCheckbox.checked = true;
    }
    removeTournamentBanner();
}

const swapRedTeamHitbox = document.getElementById("swap_red_team_hitbox")
if (swapRedTeamHitbox) {
    swapRedTeamHitbox.style.pointerEvents = "all";
    swapRedTeamHitbox.addEventListener("click", () => {
        [teamA1Select.value, teamA2Select.value] = [teamA2Select.value, teamA1Select.value];
        triggerArrowAnimation('A');
        flashSelectGroup([teamA1Select, teamA2Select]);
        notifyRolesChanged('A');
    });
}

const swapBlueTeamHitbox = document.getElementById("swap_blue_team_hitbox")
if (swapBlueTeamHitbox) {
    swapBlueTeamHitbox.style.pointerEvents = "all";
    swapBlueTeamHitbox.addEventListener("click", () => {
        [teamB1Select.value, teamB2Select.value] = [teamB2Select.value, teamB1Select.value];
        triggerArrowAnimation('B');
        flashSelectGroup([teamB1Select, teamB2Select]);
        notifyRolesChanged('B');
    });
}


// Swap teams button
document.getElementById('swapTeams').addEventListener('click', () => {
    // Temporarily unlock if in tournament mode
    const wasLocked = teamA1Select.disabled;
    if (wasLocked) setPlayerSelectsLocked(false);

    const tempA1 = teamA1Select.value;
    const tempA2 = teamA2Select.value;
    const tempB1 = teamB1Select.value;
    const tempB2 = teamB2Select.value;

    teamA1Select.value = tempB1;
    teamA2Select.value = tempB2;
    teamB1Select.value = tempA1;
    teamB2Select.value = tempA2;

    // Update tournament team mapping if active
    if (tournamentTeamMapping) {
        const { team0Color, team1Color } = tournamentTeamMapping;
        tournamentTeamMapping = { team0Color: team1Color, team1Color: team0Color };
    }

    if (wasLocked) setPlayerSelectsLocked(true);
    flashSelectGroup([teamA1Select, teamA2Select, teamB1Select, teamB2Select]);
    notifyRolesChanged();
});

// Make it so goals dropdowns are set to MAX_GOALS when one is changed
document.getElementById("teamAgoals").addEventListener("change", function () {
  if (this.value === String(MAX_GOALS)) {
    return;
  }
  const other_goal_dropdown = document.getElementById("teamBgoals");
  other_goal_dropdown.value = String(MAX_GOALS);
});

document.getElementById("teamBgoals").addEventListener("change", function () {
  if (this.value === String(MAX_GOALS)) {
    return;
  }
  const other_goal_dropdown = document.getElementById("teamAgoals");
  other_goal_dropdown.value = String(MAX_GOALS);
});

// --- Experimental Vibration Tracking ---
let vibrationTrackingEnabled = false;
let vibrationLog = [];
let vibrationListener = null;
let vibrationDrawInterval = null;

function promptVibrationTracking() {
    return showConfirm(
        'Enable vibration tracking for this match? (Experimental)\n\nThis will record accelerometer data while live mode is active.',
        { confirmLabel: 'Enable', cancelLabel: 'Skip', type: 'info' }
    );
}

function startVibrationTracking() {
    console.log("Starting vibration tracking...");
    vibrationTrackingEnabled = true;
    vibrationLog = [];
    if (!window.DeviceMotionEvent) {
        console.error('DeviceMotion API not supported on this device/browser.');
        showToast('DeviceMotion API not supported on this device/browser.', 'warning');
        vibrationTrackingEnabled = false;
        return;
    }
    vibrationSeismograph.style.display = '';
    // Listen for device motion events
    vibrationListener = function(event) {
        // console.log(event);
        const { x, y, z } = event.acceleration || {};
        if (x == null || y == null || z == null) {
            console.warn('Incomplete accelerometer data received.');
            return;
        }
        vibrationLog.push({
            t: Date.now(),
            x, y, z
        });
    };
    window.addEventListener('devicemotion', vibrationListener);
    // Start drawing the seismograph
    vibrationDrawInterval = setInterval(drawVibrationSeismograph, 50);
}

function stopVibrationTracking() {
    console.log("Stopping vibration tracking...");
    if (vibrationListener) {
        window.removeEventListener('devicemotion', vibrationListener);
        vibrationListener = null;
    }
    if (vibrationDrawInterval) {
        clearInterval(vibrationDrawInterval);
        vibrationDrawInterval = null;
    }
    vibrationSeismograph.style.display = 'none';
    vibrationTrackingEnabled = false;
}

function drawVibrationSeismograph() {
    const ctx = vibrationSeismograph.getContext('2d');
    const width = vibrationSeismograph.width;
    const height = vibrationSeismograph.height;
    ctx.clearRect(0, 0, width, height);
    // Show last 10 seconds
    const now = Date.now();
    const windowMs = 10000;
    const minT = now - windowMs;
    const samples = vibrationLog.filter(d => d.t >= minT);
    if (samples.length < 2) return;
    // Compute magnitude
    const mags = samples.map(d => Math.sqrt(d.x*d.x + d.y*d.y + d.z*d.z));
    // Normalize
    const maxMag = Math.max(1, ...mags);
    ctx.strokeStyle = '#6cabc2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < samples.length; ++i) {
        const x = (samples[i].t - minT) / windowMs * width;
        const y = height - (mags[i] / maxMag) * height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// --- Live Mode Integration ---
let liveMode = false;
let goalLog = [];
let matchStartTime = 0;
let liveTimerInterval = null; // Timer interval for live match

async function setLiveMode(enabled, skipPrompt = false) {
    if (enabled === liveMode) return;
    if (!enabled && goalLog.length > 0 && !skipPrompt) {
        if (!await showConfirm('Switching to Final Score Mode will discard the live goal log. Continue?', { confirmLabel: 'Discard', cancelLabel: 'Keep playing', type: 'warning' })) return;
        goalLog = [];
    }
    liveMode = enabled;
    liveMatchPanel.style.display = enabled ? 'flex' : 'none';
    toggleLiveMode.style.display = enabled ? 'none' : '';
    const cancelBtn = document.getElementById('cancelLiveMode');
    if (cancelBtn) cancelBtn.style.display = enabled ? '' : 'none';
    toggleLiveMode.classList.toggle('active', enabled);
    toggleLiveMode.textContent = enabled ? 'Live Match Mode' : 'Start live mode';
    // Fix: Hide liveModeStatus span when not needed to remove gap
    liveModeStatus.style.display = enabled ? '' : 'none';
    liveModeStatus.textContent = '';
    teamAgoalsInput.disabled = enabled;
    teamBgoalsInput.disabled = enabled;
    if (enabled) {
        matchStartTime = Date.now();
        goalLog = [];
        renderGoalTimeline();
        teamAgoalsInput.value = '0';
        teamBgoalsInput.value = '0';
        startLiveMatchTimer();
        // Fix: Always show timer when live mode starts
        const timerElem = document.getElementById('liveMatchTimer');
        if (timerElem) timerElem.style.display = 'inline-block';
    } else {
        matchStartTime = null;
        goalLog = [];
        renderGoalTimeline();
        stopLiveMatchTimer();
        // Fix: Hide timer when not in live mode
        const timerElem = document.getElementById('liveMatchTimer');
        if (timerElem) timerElem.style.display = 'none';
    }
}

toggleLiveMode.addEventListener('click', () => setLiveMode(!liveMode));


function syncScoreSelectors() {
    // Always update selectors in live mode
    let redGoals = goalLog.filter(g => g.team === 'red').length;
    let blueGoals = goalLog.filter(g => g.team === 'blue').length;
    teamAgoalsInput.value = redGoals;
    teamBgoalsInput.value = blueGoals;
}

// Cancel button logic
const cancelBtn = document.getElementById('cancelLiveMode');
if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
        setLiveMode(false);
    });
}

function startLiveMatchTimer() {
    const timerElem = document.getElementById('liveMatchTimer');
    if (!timerElem) return;
    timerElem.style.display = 'inline-block';
    function updateTimer() {
        if (!liveMode || !matchStartTime) return;
        const elapsed = Date.now() - matchStartTime;
        timerElem.textContent = formatMsToMMSS(elapsed);
    }
    updateTimer();
    liveTimerInterval = setInterval(updateTimer, 1000);
}

function stopLiveMatchTimer() {
    const timerElem = document.getElementById('liveMatchTimer');
    if (liveTimerInterval) {
        clearInterval(liveTimerInterval);
        liveTimerInterval = null;
    }
    if (timerElem) {
        timerElem.textContent = '00:00';
        timerElem.style.display = 'none';
    }
}


function formatMsToMMSS(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function renderGoalTimeline() {
    goalTimeline.innerHTML = '';
    let redGoals = 0, blueGoals = 0;
    goalLog.forEach((goal, idx) => {
        if (goal.team === 'red') redGoals++;
        else blueGoals++;
        const div = document.createElement('span');
        div.className = 'goal-log-item ' + goal.team;
        const timeStr = formatMsToMMSS(goal.timestamp);
        div.textContent = `${goal.team === 'red' ? 'Red' : 'Blue'} #${goal.team === 'red' ? redGoals : blueGoals} (${timeStr})`;
        // Add remove button
        const btn = document.createElement('button');
        btn.className = 'goal-remove-btn';
        btn.type = 'button';
        btn.title = 'Remove this goal';
        btn.innerHTML = '&times;';
        btn.onclick = async () => {
            if (await showConfirm('Remove this goal from the log?', { confirmLabel: 'Remove', cancelLabel: 'Keep', type: 'warning' })) {
                goalLog.splice(idx, 1);
                renderGoalTimeline();
                syncScoreSelectors();
                updateScoredButtons();
            }
        };
        div.appendChild(btn);
        goalTimeline.appendChild(div);
    });
    syncScoreSelectors();
    updateScoredButtons();
}

function updateScoredButtons() {
    if (!liveMode) {
        btnRedScored.disabled = false;
        btnBlueScored.disabled = false;
        return;
    }
    const redGoals = goalLog.filter(g => g.team === 'red').length;
    const blueGoals = goalLog.filter(g => g.team === 'blue').length;
    btnRedScored.disabled = redGoals >= MAX_GOALS;
    btnBlueScored.disabled = blueGoals >= MAX_GOALS;
}

btnRedScored.addEventListener('click', () => {
    if (!liveMode) return;
    const redGoals = goalLog.filter(g => g.team === 'red').length;
    if (redGoals >= MAX_GOALS) return;
    goalLog.push({ team: 'red', timestamp: Date.now() - matchStartTime });
    renderGoalTimeline();
    syncScoreSelectors(); // Ensure score display updates
});
btnBlueScored.addEventListener('click', () => {
    if (!liveMode) return;
    const blueGoals = goalLog.filter(g => g.team === 'blue').length;
    if (blueGoals >= MAX_GOALS) return;
    goalLog.push({ team: 'blue', timestamp: Date.now() - matchStartTime });
    renderGoalTimeline();
    syncScoreSelectors(); // Ensure score display updates
});


// Initialize drag functionality for foosball rods (remains in app.js for now, or move to a separate `foosball-table-interactions.js`)
function makeRodDraggable(rod, options = {}) {
  let isDragging = false;
  let startX;
  let initialMatrix;
  let initialX; // saved once at load
  let currentDX = 0; // tracks current offset from initialX

  const {
    speed = 0.4,
    maxLeft = -15,
    maxRight = 15
  } = options;

  // Parse initial transform once at setup
  const tf = rod.getAttribute("transform");
  const match = tf.match(/matrix\(([^)]+)\)/);
  initialMatrix = match
    ? match[1].split(',').map(parseFloat)
    : [1, 0, 0, 1, 0, 0];
  initialX = initialMatrix[4];

  rod.addEventListener("mousedown", startDrag);
  rod.addEventListener("touchstart", startDrag, { passive: false });

  function startDrag(e) {
    e.preventDefault();
    isDragging = true;
    startX = e.touches ? e.touches[0].clientX : e.clientX;

    window.addEventListener("mousemove", drag);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchmove", drag, { passive: false });
    window.addEventListener("touchend", endDrag);
  }

  function drag(e) {
    if (!isDragging) return;
    e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const dx = (clientX - startX) * speed;
    let newDX = currentDX + dx;

    // Clamp relative to initialX
    newDX = Math.max(maxLeft, Math.min(maxRight, newDX));

    const newMatrix = [...initialMatrix];
    newMatrix[4] = initialX + newDX;
    rod.setAttribute("transform", `matrix(${newMatrix.join(',')})`);
  }

  function endDrag(e) {
    isDragging = false;

    // Update currentDX so we accumulate properly
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const delta = (clientX - startX) * speed;
    currentDX = Math.max(maxLeft, Math.min(maxRight, currentDX + delta));

    window.removeEventListener("mousemove", drag);
    window.removeEventListener("mouseup", endDrag);
    window.removeEventListener("touchmove", drag);
    window.removeEventListener("touchend", endDrag);
  }
}

makeRodDraggable(document.getElementById("red-defense-rod"), {maxLeft: -7, maxRight: 5});
makeRodDraggable(document.getElementById("red-offense-rod"), {maxLeft: -9, maxRight: 5});
makeRodDraggable(document.getElementById("blue-defense-rod"), {maxLeft: -5, maxRight: 7});
makeRodDraggable(document.getElementById("blue-offense-rod"), {maxLeft: -5, maxRight: 9});


const redTeamArrow = document.querySelector('#red-swap-arrow');
const blueTeamArrow = document.querySelector('#blue-swap-arrow');

function triggerArrowAnimation(team) {
    const arrow = team === 'A' ? redTeamArrow : blueTeamArrow;
    if (!arrow) return;
    arrow.classList.remove('is-animating');
    arrow.getBoundingClientRect();
    requestAnimationFrame(() => {
        arrow.classList.add('is-animating');
    });
}

function flashSelect(select) {
    if (!select) return;
    select.classList.remove('flash-border');
    select.getBoundingClientRect();
    requestAnimationFrame(() => {
        select.classList.add('flash-border');
        select.addEventListener('animationend', () => {
            select.classList.remove('flash-border');
        }, { once: true });
    });
}

function flashSelectGroup(selects = []) {
    selects.forEach(flashSelect);
}

export function updateTeamArrowState(team, reset = false) {
    const isTeamA = team === 'A';
    const select1 = isTeamA ? teamA1Select : teamB1Select;
    const select2 = isTeamA ? teamA2Select : teamB2Select;
    const arrow = isTeamA ? redTeamArrow : blueTeamArrow;

    if (!arrow) {
        return;
    }

    // Check if reset is set or if both dropdowns have values
    const isComplete = !reset && (select1.value.trim() || select2.value.trim());

    // Update arrow color - using team colors from your existing code
    // const color = isComplete ? (isTeamA ? '#ce848c' : '#6cabc2') : '#00000000';
    const color = isComplete ? (isTeamA ? '#999999' : '#999999') : '#00000000';
    arrow.querySelectorAll('path').forEach(path => {
        path.style.stroke = color;
    });
}

// Add event listeners to all dropdowns
[teamA1Select, teamA2Select].forEach(select => {
    if (!select) return;
    select.addEventListener('change', () => handleRoleSelectionChange('A'));
});

[teamB1Select, teamB2Select].forEach(select => {
    if (!select) return;
    select.addEventListener('change', () => handleRoleSelectionChange('B'));
});

// Initial state update
updateTeamArrowState('A', true);
updateTeamArrowState('B', true);
updatePositionConfirmationUI();

if (positionsConfirmedCheckbox) {
    positionsConfirmedCheckbox.addEventListener('change', () => {
        updateSubmitMatchButtonState();
    });
}

if (rankedMatchCheckbox) {
    rankedMatchCheckbox.addEventListener('change', () => {
        updateSubmitMatchButtonState();
    });
}

function areAllRolesFilled() {
    const selects = [teamA1Select, teamA2Select, teamB1Select, teamB2Select];
    return selects.every(select => Boolean(getFilledRoleValue(select)));
}

function requiresPositionConfirmation() {
    return positionConfirmationContainer && positionConfirmationContainer.classList.contains('visible');
}

function isPositionConfirmationChecked() {
    return positionsConfirmedCheckbox && positionsConfirmedCheckbox.checked;
}

function isRankedMatchChecked() {
    return rankedMatchCheckbox && rankedMatchCheckbox.checked;
}

function updatePositionConfirmationUI() {
    if (!positionConfirmationContainer || !positionsConfirmedCheckbox) return;
    const shouldShow = areAllRolesFilled();
    positionConfirmationContainer.classList.toggle('visible', shouldShow);
    positionConfirmationContainer.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    if (!shouldShow) {
        positionsConfirmedCheckbox.checked = false;
    }
    if (rankedMatchContainer && rankedMatchCheckbox) {
        rankedMatchContainer.classList.toggle('visible', shouldShow);
        rankedMatchContainer.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
        if (shouldShow && rankedMatchCheckbox.checked === false) {
            rankedMatchCheckbox.checked = true;
        }
    }
    updateSubmitMatchButtonState();
}

function updateSubmitMatchButtonState() {
    if (!submitMatchBtn) return;
    const needsPositionConfirmation = requiresPositionConfirmation() && !isPositionConfirmationChecked();
    submitMatchBtn.disabled = false;
    submitMatchBtn.title = needsPositionConfirmation
        ? "Positions aren't confirmed yet. Check the box if you want them logged."
        : '';
}

function handleRoleSelectionChange(team) {
    updateTeamArrowState(team);
    if (positionsConfirmedCheckbox && positionsConfirmedCheckbox.checked) {
        positionsConfirmedCheckbox.checked = false;
    }
    updatePositionConfirmationUI();
}

function getFilledRoleValue(select) {
    if (!select) return '';
    const value = (select.value || '').trim();
    if (!value || value === '__add_new__') return '';
    return value;
}

function getPositionConfirmationState() {
    if (!positionConfirmationContainer) return null;
    const isVisible = positionConfirmationContainer.classList.contains('visible');
    if (!isVisible) return null;
    return Boolean(isPositionConfirmationChecked());
}

function getRankedMatchState() {
    if (!rankedMatchContainer) return null;
    const isVisible = rankedMatchContainer.classList.contains('visible');
    if (!isVisible) return null;
    return Boolean(isRankedMatchChecked());
}

export function notifyRolesChanged(team = null) {
    if (team === 'A' || team === 'B') {
        handleRoleSelectionChange(team);
        return;
    }
    handleRoleSelectionChange('A');
    handleRoleSelectionChange('B');
}

// =========================================================================
// Tournament Game Pre-fill
// =========================================================================

let tournamentBannerEl = null;
let tournamentTeamMapping = null; // tracks which tournament team is in which color

window.addEventListener('tournament-game-selected', (e) => {
    const { tournamentName, gameName, team0, team1 } = e.detail;

    // Pre-fill players: team0 → teamA (red), team1 → teamB (blue)
    // For single-player teams, fill both offense and defense
    if (team0?.players) {
        teamA1Select.value = team0.players[0] || '';
        teamA2Select.value = team0.players.length > 1 ? team0.players[1] : (team0.players[0] || '');
    }
    if (team1?.players) {
        teamB1Select.value = team1.players[0] || '';
        teamB2Select.value = team1.players.length > 1 ? team1.players[1] : (team1.players[0] || '');
    }

    // Track original mapping: team0 starts as teamA (red)
    tournamentTeamMapping = { team0Color: 'A', team1Color: 'B' };

    // Lock player selects (disable them)
    setPlayerSelectsLocked(true);

    // Reset scores
    teamAgoalsInput.value = '0';
    teamBgoalsInput.value = '0';

    // Show tournament banner
    showTournamentBanner(tournamentName, gameName);

    // Notify roles changed
    notifyRolesChanged();
});

function setPlayerSelectsLocked(locked) {
    [teamA1Select, teamA2Select, teamB1Select, teamB2Select].forEach(sel => {
        sel.disabled = locked;
        if (locked) {
            // Make background fully opaque to signal locked state
            const isBlue = sel.classList.contains('blue_select');
            sel.style.backgroundColor = isBlue ? 'rgb(49, 76, 86)' : 'rgb(106, 37, 45)';
            sel.style.opacity = '';
        } else {
            sel.style.backgroundColor = '';
            sel.style.opacity = '';
        }
    });
}

/**
 * Get the correct winner index (0 or 1 in tournament game slots)
 * accounting for potential team swaps via the swap-teams button.
 */
function getTournamentWinnerIndex(matchWinner) {
    if (!tournamentTeamMapping) return matchWinner === 'A' ? 0 : 1;
    // team0Color tells us which match side team0 is on
    if (tournamentTeamMapping.team0Color === 'A') {
        return matchWinner === 'A' ? 0 : 1;
    } else {
        return matchWinner === 'A' ? 1 : 0;
    }
}

/**
 * Validate that current form players match the expected tournament teams.
 * Returns true if valid, false otherwise (shows a toast).
 */
function validateTournamentTeams(tournamentGame) {
    if (!tournamentGame) return true;
    const { team0, team1 } = tournamentGame;

    const formTeamA = [teamA1Select.value, teamA2Select.value].filter(Boolean).sort();
    const formTeamB = [teamB1Select.value, teamB2Select.value].filter(Boolean).sort();

    const t0Players = (team0?.players || []).slice().sort();
    const t1Players = (team1?.players || []).slice().sort();
    // For single-player teams, the same player appears in both selects
    const t0Unique = [...new Set(t0Players)].sort();
    const t1Unique = [...new Set(t1Players)].sort();
    const formAUnique = [...new Set(formTeamA)].sort();
    const formBUnique = [...new Set(formTeamB)].sort();

    const arrEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    // Normal order: team0=A, team1=B
    if (arrEq(formAUnique, t0Unique) && arrEq(formBUnique, t1Unique)) {
        tournamentTeamMapping = { team0Color: 'A', team1Color: 'B' };
        return true;
    }
    // Swapped order: team0=B, team1=A
    if (arrEq(formAUnique, t1Unique) && arrEq(formBUnique, t0Unique)) {
        tournamentTeamMapping = { team0Color: 'B', team1Color: 'A' };
        return true;
    }

    showToast('Teams do not match the tournament game. Please cancel and re-select the game.', 'error', 5000);
    return false;
}

function showTournamentBanner(tournamentName, gameName) {
    removeTournamentBanner();
    const matchForm = document.getElementById('matchForm');
    if (!matchForm) return;

    tournamentBannerEl = document.createElement('div');
    tournamentBannerEl.className = 'tournament-match-banner';
    tournamentBannerEl.innerHTML = `
        <div class="banner-title">🏆 ${escapeFormHtml(tournamentName)}</div>
        <div class="banner-game">${escapeFormHtml(gameName)}</div>
        <button class="banner-cancel" id="tournamentCancelBtn">✕ Cancel</button>
    `;
    matchForm.insertBefore(tournamentBannerEl, matchForm.firstChild);

    tournamentBannerEl.querySelector('#tournamentCancelBtn')?.addEventListener('click', () => {
        clearActiveTournamentGame();
        removeTournamentBanner();
        setPlayerSelectsLocked(false);
        tournamentTeamMapping = null;
        resetMatchForm();
    });
}

function removeTournamentBanner() {
    if (tournamentBannerEl && tournamentBannerEl.parentElement) {
        tournamentBannerEl.parentElement.removeChild(tournamentBannerEl);
    }
    tournamentBannerEl = null;
}

function escapeFormHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Clean up banner on form reset
const _originalResetMatchForm = resetMatchForm;
// Extend resetMatchForm via event
window.addEventListener('tournament-game-submitted', () => {
    removeTournamentBanner();
});