// Import from the new player data service instead of firebase
import { allPlayers} from './player-data-service.js';
import { leaderboardList } from './dom-elements.js';
import { getCachedStats, getAllCachedStats, getAllTeamEloStats } from './stats-cache-service.js';
import { getSeasons, getSelectedSeason, setSelectedSeason } from './season-service.js';
import { STARTING_ELO, BADGE_THRESHOLDS } from './constants.js';

let onPlayerClickCallback = null;
let showInactivePlayers = false;  // Default: hide inactive players
let sortBy = 'elo';  // Default sort by ELO rating

const DEFAULT_BADGE_VALUE_COLOR = 'var(--text-color-primary, #2d2d2d)';
const BADGE_VALUE_COLORS = {
    '🔥': '#F99D37', // streaks
    '🐦‍🔥': '#f97316', // phoenix
    '🌊': '#779ae7ff', // streak extinguisher
    '🐍': '#8be47aff', // snake
    '🐕': '#ddb494ff', // underdog
    '📄': '#f0f0f0', // clean sheet/shutout
    '🎩': '#a78bfa', // hat trick
    '🎂': '#f9a8d4', // cake
    '👑': '#facc15', // all-time highest ELO
    '☕': '#c08457', // fast win
    '🎢': '#fb5624ff', // rollercoaster
    '🐧': '#60a5fa', // chill comeback
    '🩹': '#f5f5f5ff', // medic
    '🪴': '#4ade51ff', // gardener
    'φ': '#fcd34d', // golden streak
    '🧱': '#a8a29e', // wall
};
const BADGE_EMOJI_COLORS = {
    'φ': '#fcd34d',
};

export function setOnPlayerClick(callback) {
    onPlayerClickCallback = callback;
}

export function setShowInactivePlayers(show) {
    showInactivePlayers = show;
    updateLeaderboardDisplay();
}

export function getShowInactivePlayers() {
    return showInactivePlayers;
}

export function setSortBy(stat) {
    sortBy = stat;
    updateLeaderboardDisplay();
}

export function getSortBy() {
    return sortBy;
}

/**
 * Helper function to compute total wins and losses from player stats
 */
function computeWinsAndLosses(stats) {
    if (!stats || !stats.eloTrajectory) {
        return { wins: 0, losses: 0, totalGames: 0 };
    }
    
    // Total games is the length of eloTrajectory (each match = 1 entry)
    const totalGames = stats.eloTrajectory.length;
    
    // We can derive wins from winLossRatios, but we need to be careful:
    // In a 2v2 match, winLossRatios counts once per opponent (so 2x per match)
    // We need to count unique matches instead
    let wins = 0;
    let losses = 0;
    
    if (stats.winLossRatios) {
        // Count wins/losses per opponent, then divide by number of opponents per match
        // Assuming 2v2 matches (2 opponents per match)
        const opponentsPerMatch = 2;
        let totalWinEntries = 0;
        let totalLossEntries = 0;
        
        for (const opponent in stats.winLossRatios) {
            totalWinEntries += stats.winLossRatios[opponent].wins;
            totalLossEntries += stats.winLossRatios[opponent].losses;
        }
        
        // Each match creates entries for each opponent, so divide by opponents per match
        wins = totalWinEntries / opponentsPerMatch;
        losses = totalLossEntries / opponentsPerMatch;
    }
    
    return { wins, losses, totalGames };
}

function computeRoleEloDelta(stats) {
    if (!stats || !stats.roleElo) return 0;
    const offense = stats.roleElo.offense ?? STARTING_ELO;
    const defense = stats.roleElo.defense ?? STARTING_ELO;
    return offense - defense;
}

function getCurrentEloFromStats(stats) {
    if (!stats || !Array.isArray(stats.eloTrajectory) || stats.eloTrajectory.length === 0) {
        return null;
    }
    return stats.eloTrajectory[stats.eloTrajectory.length - 1].elo;
}

/**
 * Get the value to sort by for a player
 */
function getSortValue(player, stats, sortBy) {
    switch (sortBy) {
        case 'elo':
            return getCurrentEloFromStats(stats) ?? STARTING_ELO;
        case 'offenseElo': {
            if (!stats || !stats.roleElo) return STARTING_ELO;
            return stats.roleElo.offense ?? STARTING_ELO;
        }
        case 'defenseElo': {
            if (!stats || !stats.roleElo) return STARTING_ELO;
            return stats.roleElo.defense ?? STARTING_ELO;
        }
        case 'offenseVsDefense':
            return computeRoleEloDelta(stats);
        case 'openskill': {
            if (!stats || !stats.openskillRating) return 0;
            return stats.openskillRating.ordinal ?? stats.openskillRating.mu ?? 0;
        }
        case 'openskillMuSigma': {
            if (!stats || !stats.openskillRating) return 0;
            return stats.openskillRating.mu ?? 0;
        }
        case 'winRate': {
            if (!stats) return 0;
            const { wins, totalGames } = computeWinsAndLosses(stats);
            return totalGames > 0 ? wins / totalGames : 0;
        }
        case 'dailyChange': {
            if (!stats) return 0;
            return stats.dailyEloChange || 0;
        }
        case 'highestElo': {
            if (!stats) return 0;
            return stats.highestElo || 0;
        }
        case 'goldenRatio': {
            if (!stats) return 0;
            return stats.goldenRatio || 0;
        }
        case 'comebackRate': {
            if (!stats) return 0;
            return stats.comebackPercentage || 0;
        }
        case 'avgTimeTeam': {
            if (!stats || !stats.avgTimeBetweenGoals) return 0;
            // Lower is better, so we negate it for sorting
            return -(stats.avgTimeBetweenGoals.avgTimePerTeamGoal || 0);
        }
        case 'avgTimeOpponent': {
            if (!stats || !stats.avgTimeBetweenGoals) return 0;
            // Higher is better, so we don't negate it
            return stats.avgTimeBetweenGoals.avgTimePerOpponentGoal || 0;
        }
        case 'streakiness': {
            if (!stats || !stats.streakyness) return 0;
            return stats.streakyness.score || 0;
        }
        case 'longestWinStreak': {
            if (!stats || !stats.longestStreaks) return 0;
            return stats.longestStreaks.longestWinStreak || 0;
        }
        case 'longestGoldenStreak': {
            if (!stats) return 0;
            return stats.longestGoldenPhiStreak || 0;
        }
        case 'longestPositiveDayRun': {
            if (!stats) return 0;
            return stats.longestPositiveDayRun || 0;
        }
        default:
            return STARTING_ELO;
    }
}

/**
 * Get the display value for the selected stat
 */
function getDisplayValue(player, stats, sortBy) {
    switch (sortBy) {
        case 'elo':
            return getCurrentEloFromStats(stats) ?? STARTING_ELO;
        case 'offenseElo': {
            if (!stats || !stats.roleElo) return STARTING_ELO;
            return Math.round(stats.roleElo.offense ?? STARTING_ELO);
        }
        case 'defenseElo': {
            if (!stats || !stats.roleElo) return STARTING_ELO;
            return Math.round(stats.roleElo.defense ?? STARTING_ELO);
        }
        case 'offenseVsDefense': {
            if (!stats || !stats.roleElo) return '0';
            const delta = Math.round(computeRoleEloDelta(stats));
            return delta > 0 ? `+${delta}` : `${delta}`;
        }
        case 'openskill': {
            if (!stats || !stats.openskillRating) return STARTING_ELO;
            const ordinalValue = stats.openskillRating.ordinal ?? stats.openskillRating.mu ?? STARTING_ELO;
            return Number.isFinite(ordinalValue) ? ordinalValue.toFixed(2) : STARTING_ELO;
        }
        case 'openskillMuSigma': {
            if (!stats || !stats.openskillRating) return 'μ 0.00 / σ 0.00';
            const { mu, sigma } = stats.openskillRating;
            const safeMu = Number.isFinite(mu) ? mu.toFixed(2) : '0.00';
            const safeSigma = Number.isFinite(sigma) ? sigma.toFixed(2) : '0.00';
            return `μ ${safeMu} / σ ${safeSigma}`;
        }
        case 'winRate': {
            if (!stats) return '0%';
            const { wins, totalGames } = computeWinsAndLosses(stats);
            if (totalGames === 0) return '0%';
            const winRate = (wins / totalGames * 100).toFixed(1);
            return `${winRate}%`;
        }
        case 'dailyChange': {
            if (!stats) return '0';
            const change = stats.dailyEloChange || 0;
            return change > 0 ? `+${Math.round(change)}` : Math.round(change);
        }
        case 'highestElo': {
            if (!stats) return '0';
            return Math.round(stats.highestElo || 0);
        }
        case 'goldenRatio': {
            if (!stats) return '0.00';
            return (stats.goldenRatio || 0).toFixed(2);
        }
        case 'comebackRate': {
            if (!stats) return '0%';
            return `${((stats.comebackPercentage || 0) * 100).toFixed(0)}%`;
        }
        case 'avgTimeTeam': {
            if (!stats || !stats.avgTimeBetweenGoals || !stats.avgTimeBetweenGoals.avgTimePerTeamGoal) return 'N/A';
            return `${(stats.avgTimeBetweenGoals.avgTimePerTeamGoal / 1000).toFixed(1)}s`;
        }
        case 'avgTimeOpponent': {
            if (!stats || !stats.avgTimeBetweenGoals || !stats.avgTimeBetweenGoals.avgTimePerOpponentGoal) return 'N/A';
            return `${(stats.avgTimeBetweenGoals.avgTimePerOpponentGoal / 1000).toFixed(1)}s`;
        }
        case 'streakiness': {
            if (!stats || !stats.streakyness) return '0.00';
            return (stats.streakyness.score || 0).toFixed(2);
        }
        case 'longestWinStreak': {
            if (!stats || !stats.longestStreaks) return '0';
            return stats.longestStreaks.longestWinStreak || 0;
        }
        case 'longestGoldenStreak': {
            if (!stats) return '0';
            return stats.longestGoldenPhiStreak || 0;
        }
        case 'longestPositiveDayRun': {
            if (!stats) return '0';
            return stats.longestPositiveDayRun || 0;
        }
        default:
            return STARTING_ELO;
    }
}

function getCurrentElo(stats) {
    if (!stats || !Array.isArray(stats.eloTrajectory) || stats.eloTrajectory.length === 0) {
        return STARTING_ELO;
    }
    return stats.eloTrajectory[stats.eloTrajectory.length - 1].elo;
}

export function getStatusBadges(stats) {
    if (!stats) return [];
    const badges = [];
    const currentElo = getCurrentElo(stats);
    const medicConfig = BADGE_THRESHOLDS?.medic ?? {};
    const gardenerConfig = BADGE_THRESHOLDS?.gardener ?? {};
    const goldenConfig = BADGE_THRESHOLDS?.goldenPhi ?? {};
    const formatBadge = (emoji, value, threshold) => {
        const badge = { emoji };
        const includeValue = typeof value === 'number' && (
            (typeof threshold === 'number' && value > threshold) ||
            threshold === undefined
        );

        if (includeValue) {
            badge.value = value;
            badge.valueColor = BADGE_VALUE_COLORS[emoji];
        }

        badge.emojiColor = BADGE_EMOJI_COLORS[emoji];

        return badge;
    };

    const events = stats.statusEvents || {};
    if (events.extinguisherCount >= 1) {
        badges.push(formatBadge('🌊', events.extinguisherCount, 1));
    }
    if (events.comebackGoalSum >= 2) {
        badges.push(formatBadge('🪃', events.comebackGoalSum, 2));
    }
    if (events.shutoutCount > 0) {
        badges.push(formatBadge('📄', events.shutoutCount, 1));
    }
    if (events.hattrickCount > 0) {
        badges.push(formatBadge('🎩', events.hattrickCount, 1));
    }
    if (events.underdogPointSum > 0) {
        badges.push(formatBadge('🐕', events.underdogPointSum, 1));
    }
    if (events.rollercoasterCount >= 1) {
        badges.push(formatBadge('🎢', events.rollercoasterCount, 1));
    }
    if (events.chillComebackCount >= 1) {
        badges.push(formatBadge('🐧', events.chillComebackCount, 1));
    }
    if (events.fastWinCount >= 1) {
        badges.push(formatBadge('☕', events.fastWinCount, 1));
    }
    if (events.cakeCount > 0) {
        badges.push(formatBadge('🎂', events.cakeCount, 1));
    }

    if (stats.currentAlternatingRun && stats.currentAlternatingRun >= 7) {
        badges.push(formatBadge('🐍', stats.currentAlternatingRun, 7));
    }
    if (stats.phoenix?.isActive) {
        badges.push({emoji: '🐦‍🔥'});
    }
    if (stats.currentPositiveDayRun && stats.currentPositiveDayRun >= 3) {
        badges.push(formatBadge('🧗', stats.currentPositiveDayRun, 0));
    }
    if (stats.highestElo && currentElo === stats.highestElo && stats.highestElo > STARTING_ELO) {
        badges.push({ emoji: '⛰'});
    }
    if (stats.isAllTimeEloRecordHolder && stats.highestElo && currentElo === stats.highestElo && stats.highestElo > STARTING_ELO + 100) {
        badges.push(formatBadge('👑'));
    }
    if (stats.currentStreak && stats.currentStreak.type === 'win' && stats.currentStreak.length >= 3) {
        badges.push(formatBadge('🔥', stats.currentStreak.length, 0));
    }

    const medicHelped = stats.medicTeammatesHelped || 0;
    if (medicHelped >= (medicConfig.minUniqueTeammates ?? 3)) {
        badges.push(formatBadge('🩹', medicHelped, 0));
    }

    // const gardenerStreak = stats.gardenerWeekdayStreak || 0;
    // if (gardenerStreak >= (gardenerConfig.requiredWeekdays ?? 5)) {
    //     badges.push(formatBadge('🪴', gardenerStreak, gardenerConfig.requiredWeekdays ?? 5));
    // }

    const goldenPhi = stats.goldenPhiStreak || 0;
    if (goldenPhi >= goldenConfig.minWins) {
        badges.push(formatBadge('φ', goldenPhi, 0));
    }

    const wallStreak = stats.wallStreak || 0;
    if (wallStreak >= 3) {
        badges.push(formatBadge('🧱', wallStreak, 0));
    }

    return badges;
}

function renderTeamLeaderboard() {
    const teamStatsMap = getAllTeamEloStats();
    const teams = Object.values(teamStatsMap || {});
    const eligibleTeams = teams
        .filter(team => (team.games || 0) >= 5)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0));

    if (eligibleTeams.length === 0) {
        leaderboardList.innerHTML = '<li>No teams have played 5+ games yet.</li>';
        return;
    }

    eligibleTeams.forEach((team, idx) => {
        const li = document.createElement('li');
        li.classList.add('leaderboard-item');
        li.style.cursor = 'default';

        const playerInfoSpan = document.createElement('span');
        playerInfoSpan.classList.add('leaderboard-player-info');

        const rankSpan = document.createElement('span');
        rankSpan.classList.add('leaderboard-rank');
        rankSpan.textContent = `${idx + 1}`;

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('leaderboard-name');
        nameSpan.textContent = team.players.join(' + ');

        const valueSpan = document.createElement('span');
        valueSpan.classList.add('leaderboard-value');
        valueSpan.textContent = Math.round(team.rating ?? STARTING_ELO);

        playerInfoSpan.appendChild(rankSpan);
        playerInfoSpan.appendChild(nameSpan);
        playerInfoSpan.appendChild(valueSpan);

        const meta = document.createElement('span');
        meta.textContent = `${team.games} games`;
        meta.style.fontSize = '0.9em';
        meta.style.color = 'var(--text-color-secondary, #666)';

        li.appendChild(playerInfoSpan);
        li.appendChild(meta);

        if (idx === 0) li.classList.add('gold');
        else if (idx === 1) li.classList.add('silver');
        else if (idx === 2) li.classList.add('bronze');

        leaderboardList.appendChild(li);
    });
}

// The main function to render the leaderboard from the local 'allPlayers' array
async function updateLeaderboardDisplay() {
    leaderboardList.innerHTML = "";
    let index = 0;

    if (sortBy === 'teamElo') {
        renderTeamLeaderboard();
        return;
    }

    if (allPlayers.length === 0) {
        leaderboardList.innerHTML = "<li>No players found.</li>";
        return;
    }

    // Get all cached stats at once - much more efficient
    const allStats = getAllCachedStats();

    // Sort players by the selected statistic
    const sortedPlayers = [...allPlayers].sort((a, b) => {
        const aStats = allStats[a.name];
        const bStats = allStats[b.name];
        const aValue = getSortValue(a, aStats, sortBy);
        const bValue = getSortValue(b, bStats, sortBy);
        return bValue - aValue;  // Descending order
    });

    // Filter out players without matches in the selected season
    let filteredPlayers = sortedPlayers.filter(player => {
        const stats = allStats[player.name];
        return stats && Array.isArray(stats.eloTrajectory) && stats.eloTrajectory.length > 0;
    });

    const selectedSeason = getSelectedSeason();
    const isCurrentSeason = selectedSeason
        ? selectedSeason.includes(Date.now())
        : true;

    // Filter out inactive players if needed
    filteredPlayers = showInactivePlayers
        ? filteredPlayers
        : filteredPlayers.filter(player => {
            const stats = allStats[player.name];
            if (!stats) return false;
            if (isCurrentSeason) {
                return stats.isActive;
            }
            const matchCount = Array.isArray(stats.eloTrajectory)
                ? stats.eloTrajectory.length
                : 0;
            return matchCount >= 10;
        });

    // When sorting by daily change, also filter out players with 0 change
    if (sortBy === 'dailyChange') {
        filteredPlayers = filteredPlayers.filter(player => {
            const stats = allStats[player.name];
            return stats && stats.dailyEloChange && stats.dailyEloChange !== 0;
        });
    }

    if (filteredPlayers.length === 0) {
        leaderboardList.innerHTML = showInactivePlayers
            ? "<li>No players found for this season.</li>"
            : "<li>No active players found for this season.</li>";
        return;
    }

    filteredPlayers.forEach((player) => {
        const li = document.createElement("li");
        li.classList.add('leaderboard-item');

        const playerInfoSpan = document.createElement('span');
        playerInfoSpan.classList.add('leaderboard-player-info');

        const rankSpan = document.createElement('span');
        rankSpan.classList.add('leaderboard-rank');
        rankSpan.textContent = `${index + 1}`;

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('leaderboard-name');
        const playerStats = allStats[player.name];
        const playerName = player.name === "Julia" ? `${player.name} ❤️` : player.name;
        nameSpan.textContent = playerName;

        const valueSpan = document.createElement('span');
        valueSpan.classList.add('leaderboard-value');
        valueSpan.textContent = getDisplayValue(player, playerStats, sortBy);

        playerInfoSpan.appendChild(rankSpan);
        playerInfoSpan.appendChild(nameSpan);
        playerInfoSpan.appendChild(valueSpan);

        const indicatorsContainer = document.createElement('span');
        indicatorsContainer.classList.add('leaderboard-indicators');
        
        if (playerStats) {
            const statusBadges = getStatusBadges(playerStats);
            if (statusBadges.length > 0) {
                const badgesContainer = document.createElement('span');
                badgesContainer.classList.add('leaderboard-badges');
                statusBadges.forEach((badge) => {
                    const badgeSpan = document.createElement('span');
                    badgeSpan.classList.add('leaderboard-badge');
                    const emojiSpan = document.createElement('span');
                    emojiSpan.textContent = badge.emoji;
                    if (badge.emojiColor) {
                        emojiSpan.style.color = badge.emojiColor;
                    }
                    badgeSpan.appendChild(emojiSpan);

                    if (badge.value !== undefined) {
                        const bvSpan = document.createElement('span');
                        bvSpan.textContent = badge.value;
                        bvSpan.classList.add('leaderboard-badge-value');
                        bvSpan.style.color = badge.valueColor || DEFAULT_BADGE_VALUE_COLOR;
                        badgeSpan.appendChild(bvSpan);
                    }
                    badgesContainer.appendChild(badgeSpan);
                });
                indicatorsContainer.appendChild(badgesContainer);
            }

            // Daily ELO Change Indicator
            const dailyChange = playerStats.dailyEloChange;
            if (dailyChange) {
                const changeSpan = document.createElement('span');
                changeSpan.classList.add('leaderboard-daily-change');
                if (dailyChange > 0) {
                    changeSpan.textContent = `▲ ${Math.round(dailyChange)}`;
                    changeSpan.classList.add('positive');
                } else if (dailyChange < 0) {
                    changeSpan.textContent = `▼ ${Math.round(Math.abs(dailyChange))}`;
                    changeSpan.classList.add('negative');
                }
                if (changeSpan.textContent) {
                    indicatorsContainer.appendChild(changeSpan);
                }
            }
        }

        li.appendChild(playerInfoSpan);
        li.appendChild(indicatorsContainer);

        li.addEventListener("click", () => {
            if (onPlayerClickCallback) {
                onPlayerClickCallback(player.name);
            }
        });

        if (index === 0) li.classList.add("gold");
        else if (index === 1) li.classList.add("silver");
        else if (index === 2) li.classList.add("bronze");
        index += 1;

        leaderboardList.appendChild(li);
    });
    console.log("Leaderboard display updated from local data.");
}

/**
 * Initializes the leaderboard. Call this once when the app starts.
 */
export function initializeLeaderboardDisplay() {
    // Set up the sort by dropdown
    const sortBySelect = document.getElementById('sortBySelect');
    if (sortBySelect) {
        sortBySelect.value = sortBy;
        sortBySelect.addEventListener('change', (e) => {
            setSortBy(e.target.value);
        });
    }

    // Set up the inactive players toggle (now a button)
    const toggleButton = document.getElementById('showInactiveToggle');
    if (toggleButton) {
        // Update button appearance based on state
        const updateButtonAppearance = () => {
            if (showInactivePlayers) {
                toggleButton.textContent = 'Hide inactive players';
                toggleButton.style.backgroundColor = 'var(--hover-color)';
                toggleButton.style.color = 'var(--text-color-primary)';
                toggleButton.style.borderColor = 'var(--gray-light)';
            } else {
                toggleButton.textContent = 'Show inactive players';
                toggleButton.style.backgroundColor = 'var(--card-background-color)';
                toggleButton.style.color = 'var(--text-color-secondary)';
                toggleButton.style.borderColor = 'var(--border-color)';
            }
        };
        
        updateButtonAppearance();
        
        toggleButton.addEventListener('click', () => {
            setShowInactivePlayers(!showInactivePlayers);
            updateButtonAppearance();
        });
    }

    // Set up the season dropdown
    const seasonSelect = document.getElementById('seasonSelect');
    if (seasonSelect) {
        const seasons = getSeasons();
        seasonSelect.innerHTML = '';
        seasons.forEach((season) => {
            const option = document.createElement('option');
            option.value = season.id;
            option.textContent = season.name;
            seasonSelect.appendChild(option);
        });
        const selectedSeason = getSelectedSeason();
        if (selectedSeason) {
            seasonSelect.value = selectedSeason.id;
        }
        seasonSelect.addEventListener('change', (e) => {
            setSelectedSeason(e.target.value);
        });
        window.addEventListener('season-changed', (event) => {
            const season = event.detail?.season;
            if (season && seasonSelect.value !== season.id) {
                seasonSelect.value = season.id;
            }
        });
    }

    // Then, listen for the custom events to re-render
    window.addEventListener('matches-updated', updateLeaderboardDisplay);
    window.addEventListener('players-updated', updateLeaderboardDisplay);
    window.addEventListener('stats-cache-updated', updateLeaderboardDisplay);

    // Perform an initial render in case data is already available from cache
    updateLeaderboardDisplay();
}
