import { MAX_GOALS, STARTING_ELO, INACTIVE_THRESHOLD_DAYS, BADGE_THRESHOLDS, BADGE_INFO, CAKE_TEAM, TOURNAMENT_BADGE_DURATION_DAYS } from "./constants.js";
import { expectedScore, updateRating } from "./elo-service.js";
import { computeTournamentMedals } from "./tournament/tournament-engine.js";
import { rate as rateOpenSkill, rating as createOpenSkillRating, ordinal as openskillOrdinal } from "openskill";

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const MEDIC_LOOKBACK_MS = (BADGE_THRESHOLDS?.medic?.lookbackDays ?? 7) * MILLIS_PER_DAY;
const MEDIC_MIN_TEAMMATE_LOSS_STREAK = BADGE_THRESHOLDS?.medic?.teammateLossStreakLength ?? 3;
const ROLLERCOASTER_MIN_LEAD_CHANGES = BADGE_THRESHOLDS?.rollercoaster?.minLeadChanges ?? 3;

const FAST_WIN_THRESHOLD_MS = 2.5 * 60 * 1000; // 2 minutes 30 seconds
const ZOMBIE_MAX_OWN_GOALS = 2; // 🧟: own goals at most when the opponents reached match point
const MEDAL_EMOJIS = { gold: '🥇', silver: '🥈', bronze: '🥉', participant: '⚽' };

// Local midnight of each badge's introducedAt: awards before it are not tallied.
const BADGE_INTRODUCED_MS = Object.fromEntries(Object.entries(BADGE_INFO).map(([emoji, { introducedAt }]) => {
    const [y, m, d] = introducedAt.split('-').map(Number);
    return [emoji, new Date(y, m - 1, d).getTime()];
}));

/**
 * Adds an award to a player's emoji tally (stats.emojiTally[emoji] = { count, firstAt, lastAt, maxLength? }).
 * amount: points or levels to add; length: streak length reached (streak badges only).
 */
function awardEmoji(playerStats, emoji, timestamp, amount = 1, length) {
    if (!(amount > 0) || !(timestamp >= BADGE_INTRODUCED_MS[emoji])) return;
    const entry = playerStats.emojiTally[emoji] ??= { count: 0, firstAt: timestamp, lastAt: timestamp };
    entry.count += amount;
    entry.firstAt = Math.min(entry.firstAt, timestamp);
    entry.lastAt = Math.max(entry.lastAt, timestamp);
    if (length !== undefined) entry.maxLength = Math.max(entry.maxLength || 0, length);
}

/** Awards a streak badge for the level just reached, if it is at least the badge's minLength. */
function awardStreakLevel(playerStats, emoji, timestamp, length) {
    if (length >= BADGE_INFO[emoji].minLength) awardEmoji(playerStats, emoji, timestamp, 1, length);
}

/** Awards a per-day badge at most once per day (dayKey). */
function awardDaily(playerStats, emoji, dayKey) {
    if (playerStats._lastAwardDay[emoji] === dayKey) return;
    playerStats._lastAwardDay[emoji] = dayKey;
    awardEmoji(playerStats, emoji, dayKey);
}

function getDayKey(timestamp) {
    const day = new Date(timestamp);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
}

/**
 * Computes all statistics for all players present in a list of matches.
 * Matches must be sorted by timestamp (newest first, as they come from Firestore).
 * @param {Array<Object>} matches - Array of match objects sorted by timestamp descending.
 * @returns {{ players: Object<string, Object>, teams: Object<string, Object> }}
 *          Aggregated statistics keyed by player plus derived team Elo records.
 */
export function computeAllPlayerStats(matches, options = {}) {
    const startTime = performance.now();
    const seasonKFactor = options.season?.kFactor;
    const matchDeltas = {};
    
    // Extract all unique player IDs from matches
    const playerSet = new Set();
    for (const match of matches) {
        for (const team of ['teamA', 'teamB']) {
            if (Array.isArray(match[team])) {
                for (const pid of match[team]) {
                    playerSet.add(pid);
                }
            }
        }
    }
    const players = Array.from(playerSet);

    // Prepare start of day timestamp for daily stats
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayTimestamp = startOfDay.getTime();

    // Initialize stats for each player
    const stats = {};
    for (const playerName of players) {
        stats[playerName] = {
            eloTrajectory: [],
            openskillTrajectory: [],
            winLossRatios: {},
            winLossRatiosWithTeammates: {},
            eloGainsAndLosses: {},
            currentStreak: { type: 'none', length: 0 },
            longestStreaks: { longestWinStreak: 0, longestLossStreak: 0 },
            streakType: null,
            streakLength: 0,
            currentWinStreak: 0,
            currentLossStreak: 0,
            longestWinStreak: 0,
            longestLossStreak: 0,
            dailyEloChange: 0,
            streakyness: { score: 1, totalWins: 0, totalLosses: 0 },
            winCount: 0,
            lossCount: 0,
            consecutiveSame: 0,
            lastResult: null,
            goalStats: { goalsFor: 0, goalsAgainst: 0, resultHistogram: {} },
            highestElo: 0,  // Will be set properly as we process matches
            isAllTimeEloRecordHolder: false,
            goldenRatio: null,
            goldenCounts: { won54: 0, lost45: 0 },
            comebackCounts: { games: 0, wins: 0 },
            avgTimeBetweenGoals: { totalTimePlayed: 0, totalTeamGoals: 0, totalOpponentGoals: 0 },
            lastPlayed: null,  // Will be set to the most recent match timestamp
            statusEvents: {
                extinguisherCount: 0,
                underdogPointSum: 0,
                comebackGoalSum: 0,
                shutoutCount: 0,
                fastWinCount: 0,
                rollercoasterCount: 0,
                chillComebackCount: 0,
                hattrickCount: 0,
                zombieCount: 0,
                pingPongCount: 0,
                iceColdCount: 0,
                marathonCount: 0,
                patienceCount: 0,
                welcomeBackCount: 0,
                cakeCount: 0
            },
            dailyDeltas: {},
            alternatingRunLength: 0,
            lastAlternatingResult: null,
            currentAlternatingRun: 0,
            currentPositiveDayRun: 0,
            phoenix: { isActive: false, recoveredAmount: 0 },
            medicTeammatesHelped: 0,
            gardenerWeekdayStreak: 0,
            goldenPhiStreak: 0,
            openskillRating: null,
            roleElo: { offense: STARTING_ELO, defense: STARTING_ELO },
            roleEloTrajectory: { offense: [], defense: [] },
            roleGames: { offense: 0, defense: 0 },
            _wallStreak: 0,
            wallStreak: 0,
            tournamentBadges: { gold: 0, silver: 0, bronze: 0, participant: 0 },
            // Every badge earned in the matches passed in (the season), unlike statusEvents (today only)
            emojiTally: {},
        };
        stats[playerName]._lastAwardDay = {};
        stats[playerName]._medicEvents = [];
        stats[playerName]._weekdayActivityDays = new Set();
        stats[playerName]._goldenPhiCurrent = 0;
        stats[playerName]._goldenPhiLongest = 0;
        const initialOpenSkillRating = createOpenSkillRating();
        stats[playerName]._openskillState = initialOpenSkillRating;
        stats[playerName].openskillRating = {
            mu: initialOpenSkillRating.mu,
            sigma: initialOpenSkillRating.sigma,
            ordinal: openskillOrdinal(initialOpenSkillRating)
        };
    }

    console.log(`Computing stats for ${players.length} players over ${matches.length} matches..`);

    // ⏳ and 🏖️ depend on matches outside the season too (presence, last played): options.allMatches
    // (newest first, unranked included) when the caller has them.
    const presenceMatches = options.allMatches ?? matches;
    const patienceWins = computePatienceWins(presenceMatches);
    const welcomeBackWins = computeWelcomeBackWins(presenceMatches);

    const teamEloMap = new Map();
    let seasonRecordElo = STARTING_ELO + 100; // 👑 needs a record above this

    // Process all matches in reverse order (oldest to most recent)
    for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        const hasGoalLog = Array.isArray(match.goalLog) && match.goalLog.length > 0;
        
        // Defensive: skip invalid matches add log a warning
        if (!Array.isArray(match.teamA) || !Array.isArray(match.teamB)) {
            console.warn(`Skipping invalid match with id ${match.id}: missing teamA or teamB array`);
            continue;
        }

        // Skip soft-deleted matches
        if (match.deleted) {
            continue;
        }
        
        const dayKey = getDayKey(match.timestamp);
        const matchIsToday = match.timestamp >= startOfDayTimestamp;
        const allPlayersInMatch = [...match.teamA, ...match.teamB];

        const playerMeta = {};
        for (const playerId of allPlayersInMatch) {
            const playerStats = stats[playerId];
            if (!playerStats) continue;
            const lastEloPoint = playerStats.eloTrajectory.length > 0
                ? playerStats.eloTrajectory[playerStats.eloTrajectory.length - 1].elo
                : STARTING_ELO;
            playerMeta[playerId] = {
                preMatchElo: lastEloPoint,
                streakType: playerStats.streakType,
                streakLength: playerStats.streakLength,
                alternatingRunLength: playerStats.alternatingRunLength || 0,
                lastAlternatingResult: playerStats.lastAlternatingResult
            };
        }

        const teamAAvgElo = match.teamA.length > 0
            ? match.teamA.reduce((sum, pid) => sum + (playerMeta[pid]?.preMatchElo ?? STARTING_ELO), 0) / match.teamA.length
            : STARTING_ELO;
        const teamBAvgElo = match.teamB.length > 0
            ? match.teamB.reduce((sum, pid) => sum + (playerMeta[pid]?.preMatchElo ?? STARTING_ELO), 0) / match.teamB.length
            : STARTING_ELO;

        const expectedA = expectedScore(teamAAvgElo, teamBAvgElo);
        const scoreA = match.winner === 'A' ? 1 : 0;
        const matchEloDelta = Math.abs(updateRating(0, expectedA, scoreA, seasonKFactor));
        const matchKey = match.id || `${match.timestamp}-${match.teamA?.join(',') ?? ''}-${match.teamB?.join(',') ?? ''}`;
        matchDeltas[matchKey] = matchEloDelta;
        
        // Count how many players on each team are breaking opponent win streaks of 5 or more
        const streakBreaksAgainstA = match.teamB.reduce((count, pid) => {
            const meta = playerMeta[pid];
            return count + (meta?.streakType === 'win' && (meta.streakLength || 0) >= 5 ? 1 : 0);
        }, 0);
        const streakBreaksAgainstB = match.teamA.reduce((count, pid) => {
            const meta = playerMeta[pid];
            return count + (meta?.streakType === 'win' && (meta.streakLength || 0) >= 5 ? 1 : 0);
        }, 0);

        let underdogPoints = 0;
        const winningAvg = match.winner === 'A' ? teamAAvgElo : teamBAvgElo;
        const losingAvg = match.winner === 'A' ? teamBAvgElo : teamAAvgElo;
        if (!Number.isNaN(winningAvg) && !Number.isNaN(losingAvg)) {
            const diff = losingAvg - winningAvg;
            if (diff >= 100) {
                underdogPoints = Math.floor(diff / 100);
            }
        }

        const maxDeficits = computeMaxDeficits(match.goalLog);
        const matchDurationMs = getMatchDurationMs(match);
        const isFastMatch = typeof matchDurationMs === 'number' && matchDurationMs > 0 && matchDurationMs <= FAST_WIN_THRESHOLD_MS;
        const leadChangeCount = computeLeadChanges(match.goalLog);
        const isRollercoasterWin = leadChangeCount >= ROLLERCOASTER_MIN_LEAD_CHANGES;
        const isChillComebackWin = detectChillComeback(match, match.goalLog);
        const comebackDeficit = match.winner === 'A' ? maxDeficits.A : maxDeficits.B;
        const winningGoals = match.winner === 'A' ? match.goalsA : match.goalsB;
        const losingGoals = match.winner === 'A' ? match.goalsB : match.goalsA;
        const isShutoutWin = winningGoals === MAX_GOALS && losingGoals === 0;
        const winnerOppStreakCount = match.winner === 'A' ? streakBreaksAgainstA : streakBreaksAgainstB;
        const hattrickA = hasGoalLog ? detectHattrick(match.goalLog, 'red') : false;
        const hattrickB = hasGoalLog ? detectHattrick(match.goalLog, 'blue') : false;
        const narrowWin = getNarrowWinScoreline(match);
        const isMarathonWin = typeof matchDurationMs === 'number'
            && matchDurationMs >= BADGE_THRESHOLDS.marathon.minDurationMs
            && matchDurationMs <= BADGE_THRESHOLDS.marathon.maxDurationMs;
        // Badges every winner of this match earns: [emoji, statusEvents key, amount]
        const winnerEvents = [
            ['🌊', 'extinguisherCount', winnerOppStreakCount],
            ['🐕', 'underdogPointSum', underdogPoints],
            ['🪃', 'comebackGoalSum', comebackDeficit >= 2 ? comebackDeficit : 0],
            ['📄', 'shutoutCount', isShutoutWin ? 1 : 0],
            ['☕', 'fastWinCount', isFastMatch ? 1 : 0],
            ['🎢', 'rollercoasterCount', isRollercoasterWin ? 1 : 0],
            ['🐧', 'chillComebackCount', isChillComebackWin ? 1 : 0],
            ['🎩', 'hattrickCount', (match.winner === 'A' ? hattrickA : hattrickB) ? 1 : 0],
            ['🧟', 'zombieCount', isZombieWin(narrowWin) ? 1 : 0],
            // A ping-pong game that is also a rollercoaster only earns 🎢
            ['🏓', 'pingPongCount', isPingPongWin(narrowWin) && !isRollercoasterWin ? 1 : 0],
            ['🧊', 'iceColdCount', isIceColdWin(narrowWin) ? 1 : 0],
            ['🐢', 'marathonCount', isMarathonWin ? 1 : 0],
        ];

        // Only update role-based Elo if positions are confirmed
        const includeRoleBasedElo = match.positionsConfirmed == true;
        if (includeRoleBasedElo) {
            const teamARoles = buildRoleAssignments(match.teamA);
            const teamBRoles = buildRoleAssignments(match.teamB);
            if (teamARoles.length > 0 && teamBRoles.length > 0) {
                updateRoleElosForMatch(stats, teamARoles, teamBRoles, match.winner, match.timestamp, seasonKFactor);
            }
        }

        updateTeamEloRatings(teamEloMap, match.teamA, match.teamB, match.winner, match.timestamp, seasonKFactor);

    updateOpenSkillRatingsForMatch(stats, match);

        // Process each player involved in the match
        for (const playerId of allPlayersInMatch) {
            if (!stats[playerId]) continue;
            const s = stats[playerId];
            
            // Determine which team the player is on
            const isTeamA = match.teamA.includes(playerId);
            const team = isTeamA ? 'A' : 'B';
            const teamPlayers = isTeamA ? match.teamA : match.teamB;
            const oppPlayers = isTeamA ? match.teamB : match.teamA;
            const teamGoals = isTeamA ? match.goalsA : match.goalsB;
            const oppGoals = isTeamA ? match.goalsB : match.goalsA;
            if (isWeekdayTimestamp(match.timestamp)) {
                s._weekdayActivityDays.add(dayKey);
            }
            
            // ELO trajectory
            let currentElo = s.eloTrajectory.length > 0 ? s.eloTrajectory[s.eloTrajectory.length - 1].elo : STARTING_ELO;
            const playerWasWinner = (team === match.winner);
            const eloDelta = matchEloDelta;
            if (playerWasWinner) {
                for (const teammateId of teamPlayers) {
                    if (teammateId === playerId) continue;
                    const teammateMeta = playerMeta[teammateId];
                    if (teammateMeta?.streakType === 'loss' && (teammateMeta.streakLength || 0) >= MEDIC_MIN_TEAMMATE_LOSS_STREAK) {
                        s._medicEvents.push({ timestamp: match.timestamp, teammateId });
                        if (computeMedicUniqueCount(s._medicEvents, MEDIC_LOOKBACK_MS, match.timestamp) >= BADGE_THRESHOLDS.medic.minUniqueTeammates) {
                            awardDaily(s, '🩹', dayKey);
                        }
                    }
                }
            }
            if (playerWasWinner) currentElo += eloDelta;
            else currentElo -= eloDelta;
            const oppAvgElo = isTeamA ? teamBAvgElo : teamAAvgElo;
            const isGoldenGoalWin = playerWasWinner && teamGoals === MAX_GOALS && oppGoals === MAX_GOALS - 1;
            s.eloTrajectory.push({ elo: Math.round(currentElo), timestamp: match.timestamp, oppAvgElo: Math.round(oppAvgElo), isGoldenGoalWin });
            if (Math.round(currentElo) > s.highestElo) {
                s.highestElo = Math.round(currentElo);
                if (s.highestElo > STARTING_ELO) awardDaily(s, '⛰', dayKey);
            }
            if (Math.round(currentElo) > seasonRecordElo) {
                seasonRecordElo = Math.round(currentElo);
                awardDaily(s, '👑', dayKey);
            }

            const perMatchDelta = playerWasWinner ? eloDelta : -eloDelta;
            s.dailyDeltas[dayKey] = (s.dailyDeltas[dayKey] || 0) + perMatchDelta;

            // Track last played timestamp (will end up with the newest match since we process oldest->newest)
            if (!s.lastPlayed || match.timestamp > s.lastPlayed) {
                s.lastPlayed = match.timestamp;
            }

            // Win/loss ratios vs opponents
            for (const opp of oppPlayers) {
                if (!s.winLossRatios[opp]) s.winLossRatios[opp] = { wins: 0, losses: 0 };
                if (playerWasWinner) s.winLossRatios[opp].wins++;
                else s.winLossRatios[opp].losses++;
                if (!s.eloGainsAndLosses[opp]) s.eloGainsAndLosses[opp] = 0;
                const perOpponentDelta = eloDelta / oppPlayers.length;
                if (playerWasWinner) s.eloGainsAndLosses[opp] += perOpponentDelta;
                else s.eloGainsAndLosses[opp] -= perOpponentDelta;
            }

            // Win/loss ratios with teammates
            for (const teammate of teamPlayers) {
                if (teammate === playerId) continue;
                if (!s.winLossRatiosWithTeammates[teammate]) s.winLossRatiosWithTeammates[teammate] = { wins: 0, losses: 0 };
                if (playerWasWinner) s.winLossRatiosWithTeammates[teammate].wins++;
                else s.winLossRatiosWithTeammates[teammate].losses++;
            }
            
            // Goal stats
            if (teamGoals !== undefined && oppGoals !== undefined) {
                s.goalStats.goalsFor += teamGoals;
                s.goalStats.goalsAgainst += oppGoals;
                const key = `${teamGoals}:${oppGoals}`;
                s.goalStats.resultHistogram[key] = (s.goalStats.resultHistogram[key] || 0) + 1;
            }

            if (playerWasWinner && teamGoals === MAX_GOALS && oppGoals === MAX_GOALS - 1) {
                s._goldenPhiCurrent = (s._goldenPhiCurrent || 0) + 1;
                if (s._goldenPhiCurrent > s._goldenPhiLongest) s._goldenPhiLongest = s._goldenPhiCurrent;
                awardStreakLevel(s, 'φ', match.timestamp, s._goldenPhiCurrent);
            } else if (!playerWasWinner && teamGoals === MAX_GOALS - 1 && oppGoals === MAX_GOALS) {
                s._goldenPhiCurrent = 0;
            }
            
            // Golden ratio
            if (playerWasWinner && oppGoals === MAX_GOALS-1) s.goldenCounts.won54++;
            else if (!playerWasWinner && teamGoals === MAX_GOALS-1) s.goldenCounts.lost45++;
            
            // Comeback percentage
            if (hasGoalLog) {
                let teamAGoals = 0, teamBGoals = 0, fellBehind = false;
                for (const goal of match.goalLog) {
                    if (goal.team === 'red') teamAGoals++;
                    else if (goal.team === 'blue') teamBGoals++;
                    if (team === 'A' && teamAGoals < teamBGoals) fellBehind = true;
                    if (team === 'B' && teamBGoals < teamAGoals) fellBehind = true;
                }
                if (fellBehind) {
                    s.comebackCounts.games++;
                    if (playerWasWinner) s.comebackCounts.wins++;
                }
            }
            
            // Avg time between goals
            if (hasGoalLog) {
                const matchDuration = matchDurationMs ?? Math.max(...match.goalLog.map(g => g.timestamp));
                s.avgTimeBetweenGoals.totalTimePlayed += matchDuration;
                s.avgTimeBetweenGoals.totalTeamGoals += match.goalLog.filter(g => g.team === (team === 'A' ? 'red' : 'blue')).length;
                s.avgTimeBetweenGoals.totalOpponentGoals += match.goalLog.filter(g => g.team === (team === 'A' ? 'blue' : 'red')).length;
            }
            
            // Inline streak calculations
            const result = playerWasWinner ? 'win' : 'loss';
            if (s.streakType === null) {
                s.streakType = result;
                s.streakLength = 1;
            } else if (s.streakType === result) {
                s.streakLength++;
            } else {
                s.streakType = result;
                s.streakLength = 1;
            }
            s.currentStreak = { type: s.streakType, length: s.streakLength };
            if (result === 'win') awardStreakLevel(s, '🔥', match.timestamp, s.streakLength);

            const previousAltResult = playerMeta[playerId]?.lastAlternatingResult;
            const previousAltLength = playerMeta[playerId]?.alternatingRunLength || 0;
            if (previousAltResult === null || previousAltResult === undefined) {
                s.alternatingRunLength = 1;
            } else if (previousAltResult !== result) {
                s.alternatingRunLength = previousAltLength + 1;
            } else {
                s.alternatingRunLength = 1;
            }
            s.lastAlternatingResult = result;
            awardStreakLevel(s, '🐍', match.timestamp, s.alternatingRunLength);
            
            // Longest streaks
            if (result === 'win') {
                s.currentWinStreak++;
                s.currentLossStreak = 0;
                if (s.currentWinStreak > s.longestWinStreak) s.longestWinStreak = s.currentWinStreak;
            } else {
                s.currentLossStreak++;
                s.currentWinStreak = 0;
                if (s.currentLossStreak > s.longestLossStreak) s.longestLossStreak = s.currentLossStreak;
            }
            s.longestStreaks = { longestWinStreak: s.longestWinStreak, longestLossStreak: s.longestLossStreak };
            
            if (playerWasWinner) {
                for (const [emoji, key, amount] of winnerEvents) {
                    if (amount <= 0) continue;
                    if (matchIsToday) s.statusEvents[key] += amount;
                    awardEmoji(s, emoji, match.timestamp, amount);
                }
                // Per-player wins: ⏳ (sat out before) and 🏖️ (back after a break)
                for (const [emoji, key, winsByMatch] of [['⏳', 'patienceCount', patienceWins], ['🏖️', 'welcomeBackCount', welcomeBackWins]]) {
                    if (!winsByMatch.get(match)?.has(playerId)) continue;
                    if (matchIsToday) s.statusEvents[key] += 1;
                    awardEmoji(s, emoji, match.timestamp);
                }
            }

            // Wall badge: track consecutive defense games conceding 0 or 1 goals
            if (includeRoleBasedElo && teamPlayers.length === 2) {
                const isDefense = teamPlayers[0] === playerId;
                if (isDefense) {
                    if (oppGoals <= 1) {
                        s._wallStreak++;
                        awardStreakLevel(s, '🧱', match.timestamp, s._wallStreak);
                    } else {
                        s._wallStreak = 0;
                    }
                }
            }

            // Streakyness
            if (s.lastResult !== null && s.lastResult === result) s.consecutiveSame++;
            s.lastResult = result;
            if (result === 'win') s.winCount++;
            else s.lossCount++;
        }

        // Cake: if CAKE_TEAM players are on the same winning team today, everyone gets cake
        if (CAKE_TEAM.length === 2) {
            const winningTeam = match.winner === 'A' ? match.teamA : match.teamB;
            if (CAKE_TEAM.every(p => winningTeam.includes(p))) {
                const waitingPlayers = match.pairingMetadata?.waitingPlayers || [];
                const allActivePlayers = [...match.teamA, ...match.teamB, ...waitingPlayers];
                for (const playerId of allActivePlayers) {
                    if (!stats[playerId]) continue;
                    if (matchIsToday) stats[playerId].statusEvents.cakeCount += 1;
                    awardEmoji(stats[playerId], '🎂', match.timestamp);
                }
            }
        }
    }

    // Tournament medals: derived from completed tournaments (options.tournaments) finished within the
    // badge window and, when a season is selected, inside that season.
    if (options.tournaments) {
        const season = options.season;
        const medals = computeTournamentMedals(options.tournaments, {
            since: Math.max(Date.now() - TOURNAMENT_BADGE_DURATION_DAYS * MILLIS_PER_DAY, season?.start?.getTime() ?? 0),
            until: season?.end?.getTime() ?? Infinity,
        });
        for (const [player, counts] of Object.entries(medals)) {
            if (stats[player]) stats[player].tournamentBadges = counts;
        }
        // Emoji tally: every tournament completed in the season, one award per placement.
        for (const tournament of options.tournaments) {
            const placements = computeTournamentMedals([tournament], {
                since: season?.start?.getTime() ?? 0,
                until: season?.end?.getTime() ?? Infinity,
            });
            for (const [player, counts] of Object.entries(placements)) {
                if (!stats[player]) continue;
                for (const [kind, emoji] of Object.entries(MEDAL_EMOJIS)) {
                    awardEmoji(stats[player], emoji, tournament.completedAt, counts[kind]);
                }
            }
        }
    }

    // Finalize stats for each player
    for (const playerName of players) {
        const s = stats[playerName];
        
        const todayKeyStr = String(startOfDayTimestamp);
        s.dailyEloChange = s.dailyDeltas[todayKeyStr] || 0;

        const finalOpenSkillState = s._openskillState || createOpenSkillRating();
        s.openskillRating = {
            mu: finalOpenSkillState.mu,
            sigma: finalOpenSkillState.sigma,
            ordinal: openskillOrdinal(finalOpenSkillState)
        };
        if (!Array.isArray(s.openskillTrajectory) || s.openskillTrajectory.length === 0) {
            s.openskillTrajectory = [{
                mu: finalOpenSkillState.mu,
                sigma: finalOpenSkillState.sigma,
                ordinal: openskillOrdinal(finalOpenSkillState),
                timestamp: s.lastPlayed
            }];
        }

        const dailyEntries = Object.entries(s.dailyDeltas)
            .map(([dayKey, delta]) => ({ day: Number(dayKey), delta }))
            .sort((a, b) => a.day - b.day);

        let positiveRun = 0;
        for (let idx = dailyEntries.length - 1; idx >= 0; idx--) {
            if (dailyEntries[idx].delta > 0) {
                positiveRun++;
            } else {
                break;
            }
        }
        s.currentPositiveDayRun = positiveRun;

        // 🐦‍🔥: every played day that won back more than the previous played day lost
        for (let idx = 1; idx < dailyEntries.length; idx++) {
            const { day, delta } = dailyEntries[idx];
            const previousDelta = dailyEntries[idx - 1].delta;
            if (delta > 0 && previousDelta < 0 && delta > Math.abs(previousDelta)) awardEmoji(s, '🐦‍🔥', day);
        }

        let phoenix = { isActive: false, recoveredAmount: 0 };
        if (dailyEntries.length >= 2) {
            const latest = dailyEntries[dailyEntries.length - 1];
            const previous = dailyEntries[dailyEntries.length - 2];
            const recoveredToday = latest.day === startOfDayTimestamp;
            if (
                recoveredToday &&
                latest.delta > 0 &&
                previous.delta < 0 &&
                latest.delta > Math.abs(previous.delta)
            ) {
                phoenix = { isActive: true, recoveredAmount: latest.delta };
            }
        }
        s.phoenix = phoenix;
        s.currentAlternatingRun = s.alternatingRunLength || 0;
        
        // Streakyness
        const n = s.winCount + s.lossCount;
        if (n >= 2) {
            const pConsecutive = s.consecutiveSame / (n - 1);
            const pWin = s.winCount / n;
            const pLoss = s.lossCount / n;
            const pRandomSame = (pWin * pWin) + (pLoss * pLoss);
            s.streakyness = pRandomSame === 0 ? { score: 1, totalWins: s.winCount, totalLosses: s.lossCount }
                : { score: pConsecutive / pRandomSame, totalWins: s.winCount, totalLosses: s.lossCount };
        } else {
            s.streakyness = { score: 1, totalWins: s.winCount, totalLosses: s.lossCount };
        }
        // Golden ratio
        const totalGolden = s.goldenCounts.won54 + s.goldenCounts.lost45;
        s.goldenRatio = totalGolden === 0 ? null : s.goldenCounts.won54 / totalGolden;
        // Comeback percentage
        s.comebackPercentage = s.comebackCounts.games === 0 ? null : s.comebackCounts.wins / s.comebackCounts.games;
        // Avg time between goals
        s.avgTimeBetweenGoals = {
            avgTimePerTeamGoal: s.avgTimeBetweenGoals.totalTeamGoals > 0 ? s.avgTimeBetweenGoals.totalTimePlayed / s.avgTimeBetweenGoals.totalTeamGoals : null,
            avgTimePerOpponentGoal: s.avgTimeBetweenGoals.totalOpponentGoals > 0 ? s.avgTimeBetweenGoals.totalTimePlayed / s.avgTimeBetweenGoals.totalOpponentGoals : null
        };
        
        // Determine if player is active (played within last 2 weeks)
        const inactiveThresholdMs = INACTIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
        const activityCutoff = Date.now() - inactiveThresholdMs;
        s.isActive = s.lastPlayed && s.lastPlayed >= activityCutoff;
    s.medicTeammatesHelped = computeMedicUniqueCount(s._medicEvents, MEDIC_LOOKBACK_MS);
    s.gardenerWeekdayStreak = computeWeekdayActivityStreak(s._weekdayActivityDays);
        // 🪴 tally: every level of every run of consecutive weekdays (weekends skipped)
        let weekdayRun = 0, previousWeekdayKey = null;
        for (const day of [...s._weekdayActivityDays].sort((a, b) => a - b)) {
            weekdayRun = getPreviousWeekday(day)?.getTime() === previousWeekdayKey ? weekdayRun + 1 : 1;
            previousWeekdayKey = day;
            awardStreakLevel(s, '🪴', day, weekdayRun);
        }
    s.goldenPhiStreak = s._goldenPhiCurrent || 0;
    s.longestGoldenPhiStreak = s._goldenPhiLongest || 0;

        // Longest consecutive positive day run (ever)
        let longestRun = 0, currentRun = 0;
        for (const { day, delta } of dailyEntries) {
            if (delta > 0) {
                currentRun++;
                if (currentRun > longestRun) longestRun = currentRun;
                awardStreakLevel(s, '🧗', day, currentRun);
            } else {
                currentRun = 0;
            }
        }
        s.longestPositiveDayRun = longestRun;
        s.wallStreak = s._wallStreak || 0;
        
        // Remove helper fields
        delete s.streakType;
        delete s.streakLength;
        delete s.currentWinStreak;
        delete s.currentLossStreak;
        delete s.longestWinStreak;
        delete s.longestLossStreak;
        delete s.winCount;
        delete s.lossCount;
        delete s.consecutiveSame;
        delete s.lastResult;
        delete s.goldenCounts;
        delete s.comebackCounts;
        delete s.avgTimeBetweenGoals.totalTimePlayed;
        delete s.avgTimeBetweenGoals.totalTeamGoals;
        delete s.avgTimeBetweenGoals.totalOpponentGoals;
        delete s.dailyDeltas;
        delete s.alternatingRunLength;
        delete s.lastAlternatingResult;
        delete s._medicEvents;
        delete s._weekdayActivityDays;
        delete s._goldenPhiCurrent;
        delete s._goldenPhiLongest;
        delete s._openskillState;
        delete s._wallStreak;
        delete s._lastAwardDay;
    }
    let globalHighestElo = STARTING_ELO;
    for (const playerName of players) {
        const playerHighest = stats[playerName]?.highestElo ?? STARTING_ELO;
        if (playerHighest > globalHighestElo) {
            globalHighestElo = playerHighest;
        }
    }

    for (const playerName of players) {
        const playerHighest = stats[playerName]?.highestElo ?? STARTING_ELO;
        stats[playerName].isAllTimeEloRecordHolder = globalHighestElo > STARTING_ELO && playerHighest === globalHighestElo;
    }

    const teamStats = serializeTeamEloMap(teamEloMap);

    const endTime = performance.now();
    const elapsedSeconds = ((endTime - startTime) / 1000).toFixed(3);
    console.log(`computeAllPlayerStats: total time taken = ${elapsedSeconds} seconds`);
    console.debug({ players: stats, teams: teamStats });
    return { players: stats, teams: teamStats, matchDeltas };
}

function updateOpenSkillRatingsForMatch(stats, match) {
    if (!match || (match.winner !== 'A' && match.winner !== 'B')) {
        return;
    }
    if (!Array.isArray(match.teamA) || !Array.isArray(match.teamB)) {
        return;
    }

    const teamAPlayers = match.teamA.filter(pid => stats[pid]);
    const teamBPlayers = match.teamB.filter(pid => stats[pid]);
    if (teamAPlayers.length === 0 || teamBPlayers.length === 0) {
        return;
    }

    const getPlayerRatings = (playerIds) => playerIds.map(pid => {
        const playerStats = stats[pid];
        if (!playerStats._openskillState) {
            playerStats._openskillState = createOpenSkillRating();
        }
        return playerStats._openskillState;
    });

    const winnersFirst = match.winner === 'A'
        ? getPlayerRatings(teamAPlayers)
        : getPlayerRatings(teamBPlayers);
    const losersSecond = match.winner === 'A'
        ? getPlayerRatings(teamBPlayers)
        : getPlayerRatings(teamAPlayers);

    let updatedWinners;
    let updatedLosers;
    try {
        const ratedTeams = rateOpenSkill([winnersFirst, losersSecond]);
        [updatedWinners, updatedLosers] = ratedTeams;
    } catch (err) {
        console.warn(`Failed to update OpenSkill ratings for match ${match.id}`, err);
        return;
    }

    const recordUpdates = (playerIds, updatedRatings) => {
        if (!Array.isArray(updatedRatings)) return;
        playerIds.forEach((pid, idx) => {
            const playerStats = stats[pid];
            const newRating = updatedRatings[idx];
            if (!playerStats || !newRating) return;
            playerStats._openskillState = newRating;
            playerStats.openskillTrajectory.push({
                mu: newRating.mu,
                sigma: newRating.sigma,
                ordinal: openskillOrdinal(newRating),
                timestamp: match.timestamp
            });
        });
    };

    if (match.winner === 'A') {
        recordUpdates(teamAPlayers, updatedWinners);
        recordUpdates(teamBPlayers, updatedLosers);
    } else {
        recordUpdates(teamBPlayers, updatedWinners);
        recordUpdates(teamAPlayers, updatedLosers);
    }
}

function buildRoleAssignments(teamPlayers = []) {
    if (!Array.isArray(teamPlayers) || teamPlayers.length === 0) return [];
    if (teamPlayers.length === 1) {
        const playerId = teamPlayers[0];
        if (!playerId) return [];
        return [
            { playerId, role: 'defense' },
            { playerId, role: 'offense' }
        ];
    }
    const [defensePlayer, offensePlayer] = teamPlayers;
    const assignments = [];
    if (defensePlayer) assignments.push({ playerId: defensePlayer, role: 'defense' });
    if (offensePlayer) assignments.push({ playerId: offensePlayer, role: 'offense' });
    return assignments;
}

function updateRoleElosForMatch(stats, teamA, teamB, winner, timestamp, kFactor) {
    if (!stats || (winner !== 'A' && winner !== 'B')) return;
    const ratingA = computeRoleTeamRating(stats, teamA);
    const ratingB = computeRoleTeamRating(stats, teamB);
    if (ratingA === null || ratingB === null) return;

    const scoreA = winner === 'A' ? 1 : 0;
    const expectedA = expectedScore(ratingA, ratingB);
    const newRatingA = updateRating(ratingA, expectedA, scoreA, kFactor);
    const deltaA = newRatingA - ratingA;
    const deltaB = -deltaA;

    teamA.forEach((assignment) => applyRoleDelta(stats[assignment.playerId], assignment.role, deltaA, timestamp));
    teamB.forEach((assignment) => applyRoleDelta(stats[assignment.playerId], assignment.role, deltaB, timestamp));
}

function computeRoleTeamRating(stats, assignments) {
    if (!Array.isArray(assignments) || assignments.length === 0) return null;
    const values = [];
    for (const { playerId, role } of assignments) {
        const player = stats[playerId];
        if (!player) continue;
        const roleValue = player.roleElo?.[role];
        values.push(typeof roleValue === 'number' ? roleValue : STARTING_ELO);
    }
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function applyRoleDelta(playerStats, role, delta, timestamp) {
    if (!playerStats || typeof delta !== 'number' || Number.isNaN(delta)) return;
    if (!playerStats.roleElo) {
        playerStats.roleElo = { offense: STARTING_ELO, defense: STARTING_ELO };
    }
    if (!playerStats.roleEloTrajectory) {
        playerStats.roleEloTrajectory = { offense: [], defense: [] };
    }
    if (!playerStats.roleGames) {
        playerStats.roleGames = { offense: 0, defense: 0 };
    }
    const current = playerStats.roleElo[role] ?? STARTING_ELO;
    const next = Math.round(current + delta);
    playerStats.roleElo[role] = next;
    playerStats.roleGames[role] = (playerStats.roleGames[role] || 0) + 1;
    if (!Array.isArray(playerStats.roleEloTrajectory[role])) {
        playerStats.roleEloTrajectory[role] = [];
    }
    playerStats.roleEloTrajectory[role].push({ rating: next, timestamp });
}

function updateTeamEloRatings(teamEloMap, teamAPlayers, teamBPlayers, winner, timestamp, kFactor) {
    if (!teamEloMap || winner !== 'A' && winner !== 'B') return;
    if (!Array.isArray(teamAPlayers) || !Array.isArray(teamBPlayers)) return;
    if (teamAPlayers.length !== 2 || teamBPlayers.length !== 2) return;
    const uniqueA = new Set(teamAPlayers);
    const uniqueB = new Set(teamBPlayers);
    if (uniqueA.size !== 2 || uniqueB.size !== 2) return;

    const teamAEntry = getOrCreateTeamEntry(teamEloMap, teamAPlayers);
    const teamBEntry = getOrCreateTeamEntry(teamEloMap, teamBPlayers);
    const expectedA = expectedScore(teamAEntry.rating, teamBEntry.rating);
    const scoreA = winner === 'A' ? 1 : 0;
    const newRatingA = updateRating(teamAEntry.rating, expectedA, scoreA, kFactor);
    const delta = newRatingA - teamAEntry.rating;

    teamAEntry.rating = newRatingA;
    teamBEntry.rating -= delta;
    teamAEntry.games += 1;
    teamBEntry.games += 1;
    if (scoreA === 1) {
        teamAEntry.wins += 1;
        teamBEntry.losses += 1;
    } else {
        teamBEntry.wins += 1;
        teamAEntry.losses += 1;
    }
    const ts = typeof timestamp === 'number' ? timestamp : Date.now();
    teamAEntry.lastPlayed = Math.max(teamAEntry.lastPlayed || 0, ts);
    teamBEntry.lastPlayed = Math.max(teamBEntry.lastPlayed || 0, ts);
    teamAEntry.trajectory.push({ rating: teamAEntry.rating, timestamp: ts });
    teamBEntry.trajectory.push({ rating: teamBEntry.rating, timestamp: ts });
}

function getOrCreateTeamEntry(teamEloMap, playerList) {
    const key = createTeamKey(playerList);
    if (!teamEloMap.has(key)) {
        const sortedPlayers = [...playerList].sort();
        teamEloMap.set(key, {
            key,
            players: sortedPlayers,
            rating: STARTING_ELO,
            games: 0,
            wins: 0,
            losses: 0,
            lastPlayed: null,
            trajectory: []
        });
    }
    return teamEloMap.get(key);
}

function createTeamKey(playerList = []) {
    return [...playerList].sort().join('::');
}

function serializeTeamEloMap(teamEloMap) {
    const result = {};
    for (const [key, value] of teamEloMap.entries()) {
        result[key] = {
            key,
            players: value.players,
            rating: value.rating,
            games: value.games,
            wins: value.wins,
            losses: value.losses,
            lastPlayed: value.lastPlayed,
            trajectory: value.trajectory
        };
    }
    return result;
}

function getMatchDurationMs(match) {
    if (Array.isArray(match.goalLog) && match.goalLog.length > 0) {
        return Math.max(...match.goalLog.map(g => g.timestamp));
    }
    if (typeof match.matchDuration === 'number' && match.matchDuration > 0) {
        return match.matchDuration;
    }
    return null;
}

function computeMaxDeficits(goalLog) {
    if (!Array.isArray(goalLog) || goalLog.length === 0) {
        return { A: 0, B: 0 };
    }
    let teamAGoals = 0;
    let teamBGoals = 0;
    let maxDeficitA = 0;
    let maxDeficitB = 0;
    for (const goal of goalLog) {
        if (goal.team === 'red') {
            teamAGoals++;
        } else if (goal.team === 'blue') {
            teamBGoals++;
        } else {
            continue;
        }
        maxDeficitA = Math.max(maxDeficitA, teamBGoals - teamAGoals);
        maxDeficitB = Math.max(maxDeficitB, teamAGoals - teamBGoals);
    }
    return { A: maxDeficitA, B: maxDeficitB };
}

function computeLeadChanges(goalLog) {
    if (!Array.isArray(goalLog) || goalLog.length === 0) {
        return 0;
    }
    let scoreA = 0;
    let scoreB = 0;
    let previousLeader = null;
    let leadChanges = 0;
    for (const goal of goalLog) {
        if (goal.team === 'red') scoreA++;
        else if (goal.team === 'blue') scoreB++;
        const leader = scoreA === scoreB ? null : (scoreA > scoreB ? 'A' : 'B');
        if (leader && previousLeader && leader !== previousLeader) {
            leadChanges++;
        }
        if (leader) {
            previousLeader = leader;
        }
    }
    return leadChanges;
}

function detectChillComeback(match, goalLog) {
    if (!match || !Array.isArray(goalLog) || goalLog.length < 2) {
        return false;
    }
    const winner = match.winner;
    if (winner !== 'A' && winner !== 'B') return false;
    const winningGoals = winner === 'A' ? match.goalsA : match.goalsB;
    const losingGoals = winner === 'A' ? match.goalsB : match.goalsA;
    if (winningGoals !== MAX_GOALS || losingGoals !== MAX_GOALS - 1) {
        return false;
    }
    const winningColor = winner === 'A' ? 'red' : 'blue';
    const lastTwoGoals = goalLog.slice(-2);
    if (lastTwoGoals.length < 2 || lastTwoGoals[0].team !== winningColor || lastTwoGoals[1].team !== winningColor) {
        return false;
    }
    let scoreA = 0;
    let scoreB = 0;
    const secondLastIndex = goalLog.length - 2;
    for (let i = 0; i < goalLog.length; i++) {
        const totalGoals = scoreA + scoreB;
        const winnerScoreBefore = winner === 'A' ? scoreA : scoreB;
        const loserScoreBefore = winner === 'A' ? scoreB : scoreA;
        if (i < secondLastIndex && totalGoals > 0 && winnerScoreBefore >= loserScoreBefore) {
            return false;
        }
        const goal = goalLog[i];
        if (goal.team === 'red') scoreA++;
        else if (goal.team === 'blue') scoreB++;
    }
    return true;
}

/**
 * Score after each goal from the winner's view ({ own, opp, timestamp }) for a 5:4 win whose goal log
 * adds up to 5:4; null otherwise. Feeds 🧟 🏓 🧊.
 */
export function getNarrowWinScoreline(match) {
    if (!match || !Array.isArray(match.goalLog) || match.goalLog.length === 0) return null;
    const winnerColor = match.winner === 'A' ? 'red' : match.winner === 'B' ? 'blue' : null;
    const winningGoals = match.winner === 'A' ? match.goalsA : match.goalsB;
    const losingGoals = match.winner === 'A' ? match.goalsB : match.goalsA;
    if (!winnerColor || winningGoals !== MAX_GOALS || losingGoals !== MAX_GOALS - 1) return null;
    let own = 0;
    let opp = 0;
    const scoreline = match.goalLog
        .filter(goal => goal.team === 'red' || goal.team === 'blue')
        .map(goal => {
            if (goal.team === winnerColor) own++;
            else opp++;
            return { own, opp, timestamp: goal.timestamp };
        });
    return own === MAX_GOALS && opp === MAX_GOALS - 1 ? scoreline : null;
}

/** 🧟: the opponents reached match point (4) while the winners had at most 2. */
export function isZombieWin(scoreline) {
    return !!scoreline?.some(({ own, opp }) => opp === MAX_GOALS - 1 && own <= ZOMBIE_MAX_OWN_GOALS);
}

/** 🏓: the score was never more than one goal apart. */
export function isPingPongWin(scoreline) {
    return !!scoreline?.every(({ own, opp }) => Math.abs(own - opp) <= 1);
}

/** 🧊: the 4:4 lasted at least BADGE_THRESHOLDS.iceCold.minTiedMs before the winning goal. */
export function isIceColdWin(scoreline) {
    if (!scoreline || scoreline.length < 2) return false;
    const tie = scoreline[scoreline.length - 2];
    const winningGoal = scoreline[scoreline.length - 1];
    return tie.own === MAX_GOALS - 1 && tie.opp === MAX_GOALS - 1
        && winningGoal.timestamp - tie.timestamp >= BADGE_THRESHOLDS.iceCold.minTiedMs;
}

function addPlayerWin(winsByMatch, match, playerId) {
    if (!winsByMatch.has(match)) winsByMatch.set(match, new Set());
    winsByMatch.get(match).add(playerId);
}

function isPlayableMatch(match) {
    // a match still waiting for its server timestamp (null) would sort as 1970 and fake a long absence
    return match && !match.deleted && typeof match.timestamp === 'number' && Array.isArray(match.teamA) && Array.isArray(match.teamB);
}

/**
 * ⏳: a player's first win after sitting out minSatOut+ matches in a row on the same day.
 * "Sat out" = listed in match.pairingMetadata.waitingPlayers (recorded when the lineup came from or
 * near a Suggest); matches without that list neither extend nor break a run.
 * @param {Array<Object>} matches - newest first
 * @returns {Map<Object, Set<string>>} match -> players who earned it there
 */
export function computePatienceWins(matches, minSatOut = BADGE_THRESHOLDS.patience.minSatOut) {
    const wins = new Map();
    let currentDay = null;
    let satOut = {};
    let waited = new Set();
    for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        if (!isPlayableMatch(match)) continue;
        const dayKey = getDayKey(match.timestamp);
        if (dayKey !== currentDay) {
            currentDay = dayKey;
            satOut = {};
            waited = new Set();
        }
        const winners = match.winner === 'A' ? match.teamA : match.winner === 'B' ? match.teamB : [];
        for (const playerId of [...match.teamA, ...match.teamB]) {
            if ((satOut[playerId] || 0) >= minSatOut) waited.add(playerId);
            satOut[playerId] = 0;
            // unranked matches count as presence, but only a ranked win can earn (and use up) the badge
            if (match.ranked !== false && winners.includes(playerId) && waited.delete(playerId)) addPlayerWin(wins, match, playerId);
        }
        for (const playerId of match.pairingMetadata?.waitingPlayers || []) {
            satOut[playerId] = (satOut[playerId] || 0) + 1;
        }
    }
    return wins;
}

/**
 * 🏖️: a player's first win after minDaysAway+ calendar days without playing any match.
 * Players without an earlier match do not qualify.
 * @param {Array<Object>} matches - newest first; pass all matches (any season, unranked too)
 * @returns {Map<Object, Set<string>>} match -> players who earned it there
 */
export function computeWelcomeBackWins(matches, minDaysAway = BADGE_THRESHOLDS.welcomeBack.minDaysAway) {
    const wins = new Map();
    const lastPlayedDay = {};
    const away = new Set();
    for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        if (!isPlayableMatch(match)) continue;
        const dayKey = getDayKey(match.timestamp);
        const winners = match.winner === 'A' ? match.teamA : match.winner === 'B' ? match.teamB : [];
        for (const playerId of [...match.teamA, ...match.teamB]) {
            // Math.round: a day across a DST switch is 23 or 25 hours
            if (Math.round((dayKey - lastPlayedDay[playerId]) / MILLIS_PER_DAY) >= minDaysAway) away.add(playerId);
            lastPlayedDay[playerId] = dayKey;
            // unranked matches count as playing, but only a ranked win can earn (and use up) the badge
            if (match.ranked !== false && winners.includes(playerId) && away.delete(playerId)) addPlayerWin(wins, match, playerId);
        }
    }
    return wins;
}

const HATTRICK_WINDOW_MS = BADGE_THRESHOLDS.hattrick.windowMs;

function detectHattrick(goalLog, teamColor) {
    if (!Array.isArray(goalLog) || goalLog.length < 3) return false;
    let run = [];
    for (const goal of goalLog) {
        if (goal.team === teamColor) {
            run.push(goal.timestamp);
            if (run.length >= 3 && run[run.length - 1] - run[run.length - 3] <= HATTRICK_WINDOW_MS) return true;
        } else {
            run = [];
        }
    }
    return false;
}

function computeMedicUniqueCount(events, lookbackMs, now = Date.now()) {
    if (!Array.isArray(events) || events.length === 0) return 0;
    const cutoff = now - lookbackMs;
    const uniqueTeammates = new Set();
    for (const event of events) {
        if (!event) continue;
        if (event.timestamp >= cutoff && event.teammateId) {
            uniqueTeammates.add(event.teammateId);
        }
    }
    return uniqueTeammates.size;
}

function isWeekdayTimestamp(timestamp) {
    if (!timestamp) return false;
    const day = new Date(timestamp).getDay();
    return day >= 1 && day <= 5;
}

function alignToMostRecentWeekday(baseDate = new Date()) {
    const cursor = new Date(baseDate);
    cursor.setHours(0, 0, 0, 0);
    let attempts = 0;
    while (!isWeekdayTimestamp(cursor.getTime())) {
        cursor.setDate(cursor.getDate() - 1);
        attempts++;
        if (attempts > 7) return null;
    }
    return cursor;
}

function getPreviousWeekday(date) {
    const cursor = new Date(date);
    cursor.setHours(0, 0, 0, 0);
    let attempts = 0;
    do {
        cursor.setDate(cursor.getDate() - 1);
        cursor.setHours(0, 0, 0, 0);
        attempts++;
        if (attempts > 7) return null;
    } while (!isWeekdayTimestamp(cursor.getTime()));
    return cursor;
}

function computeWeekdayActivityStreak(daySet) {
    if (!daySet || daySet.size === 0) return 0;
    let cursor = alignToMostRecentWeekday();
    if (!cursor) return 0;
    // A weekday without a match yet does not break the streak until it is over
    if (!daySet.has(cursor.getTime()) && cursor.getTime() === getDayKey(Date.now())) {
        cursor = getPreviousWeekday(cursor);
        if (!cursor) return 0;
    }
    let streak = 0;
    let guard = daySet.size + 10;
    while (cursor && guard > 0) {
        const key = cursor.getTime();
        if (daySet.has(key)) {
            streak++;
            cursor = getPreviousWeekday(cursor);
            if (!cursor) break;
        } else {
            break;
        }
        guard--;
    }
    return streak;
}
