import { computeAllPlayerStats } from '../src/player-stats-batch.js';
import { validateStats, printDetailedStats } from '../src/utils/player-stats-validator.js';
import { BADGE_THRESHOLDS, TOURNAMENT_BADGE_DURATION_DAYS } from '../src/constants.js';

// Mock MAX_GOALS for testing
const MAX_GOALS = 5;

/**
 * Create test matches to validate the function
 */
function createTestMatches() {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;
    
    // Matches are sorted newest first (as they come from Firestore)
    return [
        // Today's matches (newest)
        {
            id: 'match5',
            teamA: ['Alice', 'Bob'],
            teamB: ['Charlie', 'David'],
            winner: 'A',
            goalsA: 5,
            goalsB: 3,
            eloDelta: 20,
            timestamp: now - oneHour,
            goalLog: [
                { team: 'red', timestamp: 5000 },
                { team: 'blue', timestamp: 10000 },
                { team: 'red', timestamp: 15000 },
                { team: 'blue', timestamp: 20000 },
                { team: 'red', timestamp: 25000 },
                { team: 'blue', timestamp: 30000 },
                { team: 'red', timestamp: 35000 },
                { team: 'red', timestamp: 40000 },
            ]
        },
        {
            id: 'match4',
            teamA: ['Alice', 'Charlie'],
            teamB: ['Bob', 'David'],
            winner: 'B',
            goalsA: 4,
            goalsB: 5,
            eloDelta: 25,
            timestamp: now - (2 * oneHour),
            goalLog: []
        },
        // Yesterday's matches
        {
            id: 'match3',
            teamA: ['Alice', 'Bob'],
            teamB: ['Charlie', 'David'],
            winner: 'A',
            goalsA: 5,
            goalsB: 2,
            eloDelta: 15,
            timestamp: now - oneDay - oneHour,
            goalLog: []
        },
        {
            id: 'match2',
            teamA: ['Bob', 'Charlie'],
            teamB: ['Alice', 'David'],
            winner: 'A',
            goalsA: 5,
            goalsB: 4,
            eloDelta: 18,
            timestamp: now - oneDay - (2 * oneHour),
            goalLog: []
        },
        // 2 days ago
        {
            id: 'match1',
            teamA: ['Alice', 'Charlie'],
            teamB: ['Bob', 'David'],
            winner: 'B',
            goalsA: 3,
            goalsB: 5,
            eloDelta: 22,
            timestamp: now - (2 * oneDay),
            goalLog: []
        },
    ];
}

/**
 * Test the function and print results
 */
function testComputeAllPlayerStats() {
    console.log('=== Testing computeAllPlayerStats ===\n');
    
    const matches = createTestMatches();
    console.log(`Created ${matches.length} test matches`);
    console.log(`Players in matches: ${[...new Set(matches.flatMap(m => [...m.teamA, ...m.teamB]))].join(', ')}\n`);
    
    const { players: stats, teams: teamStats } = computeAllPlayerStats(matches);

    for (const [playerName, playerStats] of Object.entries(stats)) {
        if (!playerStats.statusEvents) {
            throw new Error(`${playerName} missing statusEvents payload`);
        }
        if (typeof playerStats.statusEvents.fastWinCount === 'undefined') {
            throw new Error(`${playerName} missing fastWinCount status event`);
        }
        if (typeof playerStats.currentAlternatingRun === 'undefined') {
            throw new Error(`${playerName} missing currentAlternatingRun`);
        }
        if (typeof playerStats.currentPositiveDayRun === 'undefined') {
            throw new Error(`${playerName} missing currentPositiveDayRun`);
        }
        if (!playerStats.phoenix || typeof playerStats.phoenix.isActive === 'undefined') {
            throw new Error(`${playerName} missing phoenix status`);
        }
        if (!playerStats.openskillRating || typeof playerStats.openskillRating.mu !== 'number') {
            throw new Error(`${playerName} missing OpenSkill rating snapshot`);
        }
        if (!Array.isArray(playerStats.openskillTrajectory)) {
            throw new Error(`${playerName} missing OpenSkill trajectory data`);
        }
        if (!playerStats.roleElo || typeof playerStats.roleElo.offense !== 'number' || typeof playerStats.roleElo.defense !== 'number') {
            throw new Error(`${playerName} missing role-specific Elo ratings`);
        }
        if (!playerStats.roleEloTrajectory || !Array.isArray(playerStats.roleEloTrajectory.offense) || !Array.isArray(playerStats.roleEloTrajectory.defense)) {
            throw new Error(`${playerName} missing role-specific Elo trajectories`);
        }
    }

    const aliceFastWins = stats['Alice']?.statusEvents?.fastWinCount ?? 0;
    const bobFastWins = stats['Bob']?.statusEvents?.fastWinCount ?? 0;
    if (aliceFastWins < 1 || bobFastWins < 1) {
        throw new Error(`Expected Alice and Bob to earn a fast-win coffee badge (got Alice=${aliceFastWins}, Bob=${bobFastWins})`);
    }

    const aliceBobTeam = Object.values(teamStats).find(team =>
        Array.isArray(team.players) && team.players.includes('Alice') && team.players.includes('Bob')
    );
    if (!aliceBobTeam) {
        throw new Error('Expected Alice & Bob team Elo entry to exist');
    }
    if ((aliceBobTeam.games || 0) === 0) {
        throw new Error('Expected Alice & Bob to have at least one recorded team game');
    }
    
    console.log('\n=== Results for each player ===\n');
    
    for (const [playerName, playerStats] of Object.entries(stats)) {
        console.log(`\n--- ${playerName} ---`);
        console.log(`Elo Trajectory (${playerStats.eloTrajectory.length} points):`);
        playerStats.eloTrajectory.forEach((point, idx) => {
            const date = new Date(point.timestamp).toLocaleString();
            console.log(`  ${idx}: ${point.elo} at ${date}`);
        });
        
        console.log(`\nCurrent Streak: ${playerStats.currentStreak.type} streak of ${playerStats.currentStreak.length}`);
        console.log(`Longest Streaks: Win=${playerStats.longestStreaks.longestWinStreak}, Loss=${playerStats.longestStreaks.longestLossStreak}`);
        
        console.log(`\nDaily ELO Change: ${playerStats.dailyEloChange > 0 ? '+' : ''}${playerStats.dailyEloChange}`);
        console.log(`Highest ELO Ever: ${playerStats.highestElo}`);
        
        console.log(`\nStreakyness: ${playerStats.streakyness.score.toFixed(2)} (Wins: ${playerStats.streakyness.totalWins}, Losses: ${playerStats.streakyness.totalLosses})`);
        
        console.log(`\nGoal Stats: For=${playerStats.goalStats.goalsFor}, Against=${playerStats.goalStats.goalsAgainst}`);
        console.log(`Result Histogram:`, playerStats.goalStats.resultHistogram);
        
        console.log(`\nGolden Ratio: ${playerStats.goldenRatio !== null ? (playerStats.goldenRatio * 100).toFixed(1) + '%' : 'N/A'}`);
        console.log(`Comeback %: ${playerStats.comebackPercentage !== null ? (playerStats.comebackPercentage * 100).toFixed(1) + '%' : 'N/A'}`);
        
        console.log(`\nWin/Loss vs Opponents:`);
        for (const [opp, record] of Object.entries(playerStats.winLossRatios)) {
            console.log(`  vs ${opp}: ${record.wins}W - ${record.losses}L`);
        }
        
        console.log(`\nWin/Loss with Teammates:`);
        for (const [teammate, record] of Object.entries(playerStats.winLossRatiosWithTeammates)) {
            console.log(`  with ${teammate}: ${record.wins}W - ${record.losses}L`);
        }
        
        console.log(`\nElo Gains/Losses:`);
        for (const [opp, elo] of Object.entries(playerStats.eloGainsAndLosses)) {
            console.log(`  vs ${opp}: ${elo > 0 ? '+' : ''}${elo.toFixed(1)}`);
        }
        
        if (playerStats.avgTimeBetweenGoals) {
            console.log(`\nAvg Time Between Goals:`);
            console.log(`  Team: ${playerStats.avgTimeBetweenGoals.avgTimePerTeamGoal !== null ? (playerStats.avgTimeBetweenGoals.avgTimePerTeamGoal / 1000).toFixed(1) + 's' : 'N/A'}`);
            console.log(`  Opponent: ${playerStats.avgTimeBetweenGoals.avgTimePerOpponentGoal !== null ? (playerStats.avgTimeBetweenGoals.avgTimePerOpponentGoal / 1000).toFixed(1) + 's' : 'N/A'}`);
        }
    }
    
    // Run validation
    const validation = validateStats(stats, matches);
    
    if (validation.valid) {
        console.log('\n\n✅ All validation checks passed!\n');
    } else {
        console.log('\n\n❌ Validation failed. Please review errors above.\n');
    }
    
    // Print detailed stats for one player as example
    console.log('\n--- Example Detailed View ---');
    printDetailedStats(stats, 'Alice');
    
    console.log('\n=== Test Complete ===');
}

// Run the test
testComputeAllPlayerStats();

function testBadgeScenarios() {
    console.log('\n=== Testing badge-specific scenarios ===\n');
    const matches = createBadgeScenarioMatches();
    const { players: stats } = computeAllPlayerStats(matches);
    const aliceStats = stats['Alice'];
    if (!aliceStats) {
        throw new Error('Alice missing from badge scenario stats');
    }

    const medicThreshold = BADGE_THRESHOLDS?.medic?.minUniqueTeammates ?? 3;
    if ((aliceStats.medicTeammatesHelped || 0) < medicThreshold) {
        throw new Error(`Expected Alice to have Medic badge with ≥${medicThreshold} teammates helped (got ${aliceStats.medicTeammatesHelped || 0})`);
    }

    const gardenerThreshold = BADGE_THRESHOLDS?.gardener?.requiredWeekdays ?? 5;
    if ((aliceStats.gardenerWeekdayStreak || 0) < gardenerThreshold) {
        throw new Error(`Expected Alice to have Gardener streak ≥${gardenerThreshold} (got ${aliceStats.gardenerWeekdayStreak || 0})`);
    }

    const goldenThreshold = BADGE_THRESHOLDS?.goldenPhi?.minWins ?? 3;
    if ((aliceStats.goldenPhiStreak || 0) < goldenThreshold) {
        throw new Error(`Expected Alice to have Golden Phi streak ≥${goldenThreshold} (got ${aliceStats.goldenPhiStreak || 0})`);
    }

    if ((aliceStats.statusEvents?.rollercoasterCount || 0) < 1) {
        throw new Error('Expected at least one Rollercoaster event for Alice');
    }
    if ((aliceStats.statusEvents?.chillComebackCount || 0) < 1) {
        throw new Error('Expected at least one Chill Comeback event for Alice');
    }

    console.log('✓ Badge scenario assertions passed');
}

testBadgeScenarios();

function createBadgeScenarioMatches() {
    const matches = [];
    const HOUR = 60 * 60 * 1000;
    const medicLossLength = BADGE_THRESHOLDS?.medic?.teammateLossStreakLength ?? 3;
    const weekdayCount = BADGE_THRESHOLDS?.gardener?.requiredWeekdays ?? 5;
    const minWeekdays = Math.max(weekdayCount, 3);
    const weekdayTimestamps = getRecentWeekdayTimestamps(minWeekdays);
    const opponents = ['Henry', 'Ivan'];

    const bobWinTs = weekdayTimestamps[0];
    const charlieWinTs = weekdayTimestamps[1];
    const davidWinTs = weekdayTimestamps[2];

    addLossSeries(matches, 'Bob', 'Eve', opponents, bobWinTs, medicLossLength, HOUR);
    addMatch(matches, {
        id: 'bob-medic-win',
        teamA: ['Alice', 'Bob'],
        teamB: opponents,
        winner: 'A',
        goalsA: 5,
        goalsB: 4,
        timestamp: bobWinTs
    });

    addLossSeries(matches, 'Charlie', 'Fiona', opponents, charlieWinTs, medicLossLength, HOUR);
    addMatch(matches, {
        id: 'charlie-medic-win',
        teamA: ['Alice', 'Charlie'],
        teamB: opponents,
        winner: 'A',
        goalsA: 5,
        goalsB: 4,
        timestamp: charlieWinTs
    });

    addLossSeries(matches, 'David', 'Gina', opponents, davidWinTs, medicLossLength, HOUR);
    addMatch(matches, {
        id: 'david-medic-win',
        teamA: ['Alice', 'David'],
        teamB: opponents,
        winner: 'A',
        goalsA: 5,
        goalsB: 4,
        timestamp: davidWinTs
    });

    for (let i = 3; i < weekdayTimestamps.length; i++) {
        addMatch(matches, {
            id: `gardener-extra-${i}`,
            teamA: ['Alice', 'Eve'],
            teamB: ['Grace', 'Henry'],
            winner: 'A',
            goalsA: 5,
            goalsB: 2,
            timestamp: weekdayTimestamps[i]
        });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const rollerTimestamp = todayStart.getTime() + HOUR;
    const chillTimestamp = rollerTimestamp + HOUR;

    addMatch(matches, {
        id: 'rollercoaster-today',
        teamA: ['Alice', 'Bob'],
        teamB: ['Charlie', 'David'],
        winner: 'A',
        goalsA: 5,
        goalsB: 4,
        timestamp: rollerTimestamp,
        goalSequence: ['red', 'blue', 'blue', 'red', 'red', 'blue', 'blue', 'red', 'red']
    });

    addMatch(matches, {
        id: 'chill-today',
        teamA: ['Alice', 'Bob'],
        teamB: ['Charlie', 'David'],
        winner: 'A',
        goalsA: 5,
        goalsB: 4,
        timestamp: chillTimestamp,
        goalSequence: ['blue', 'blue', 'blue', 'red', 'blue', 'red', 'red', 'red', 'red']
    });

    return matches.sort((a, b) => b.timestamp - a.timestamp);
}

function addLossSeries(matches, player, teammate, opponents, winTimestamp, lossCount, HOUR) {
    const startTs = winTimestamp - (lossCount + 1) * HOUR;
    for (let i = 0; i < lossCount; i++) {
        addMatch(matches, {
            id: `${player}-loss-${i}`,
            teamA: [player, teammate],
            teamB: opponents,
            winner: 'B',
            goalsA: 2,
            goalsB: 5,
            timestamp: startTs + i * HOUR
        });
    }
}

function addMatch(matches, match) {
    const goalLog = match.goalLog || (match.goalSequence ? buildGoalLog(match.goalSequence) : undefined);
    const entry = {
        eloDelta: match.eloDelta ?? 20,
        ...match,
        goalLog
    };
    delete entry.goalSequence;
    matches.push(entry);
}

function buildGoalLog(sequence) {
    if (!sequence) return undefined;
    return sequence.map((team, idx) => ({ team, timestamp: (idx + 1) * 5000 }));
}

function getRecentWeekdayTimestamps(count) {
    const results = [];
    const cursor = new Date();
    cursor.setHours(12, 0, 0, 0);
    while (!isWeekday(cursor)) {
        cursor.setDate(cursor.getDate() - 1);
    }
    while (results.length < count) {
        results.unshift(cursor.getTime());
        cursor.setDate(cursor.getDate() - 1);
        while (!isWeekday(cursor)) {
            cursor.setDate(cursor.getDate() - 1);
        }
        cursor.setHours(12, 0, 0, 0);
    }
    return results;
}

function isWeekday(date) {
    const day = date.getDay();
    return day >= 1 && day <= 5;
}

// --- New stat regression tests ---

function testLongestGoldenPhiStreak() {
    console.log('\n=== Testing longestGoldenPhiStreak ===\n');
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const now = Date.now();

    // Alice: 3 consecutive 5:4 wins, then a 4:5 loss, then 1 more 5:4 win
    // Expected: longestGoldenPhiStreak=3, goldenPhiStreak=1
    const matches = [
        { id: 'g1', teamA: ['Alice'], teamB: ['Bob'], winner: 'A', goalsA: 5, goalsB: 4, eloDelta: 10, timestamp: now - 4 * DAY },
        { id: 'g2', teamA: ['Alice'], teamB: ['Bob'], winner: 'A', goalsA: 5, goalsB: 4, eloDelta: 10, timestamp: now - 3 * DAY },
        { id: 'g3', teamA: ['Alice'], teamB: ['Bob'], winner: 'A', goalsA: 5, goalsB: 4, eloDelta: 10, timestamp: now - 2 * DAY },
        { id: 'g4', teamA: ['Alice'], teamB: ['Bob'], winner: 'B', goalsA: 4, goalsB: 5, eloDelta: 10, timestamp: now - DAY },
        { id: 'g5', teamA: ['Alice'], teamB: ['Bob'], winner: 'A', goalsA: 5, goalsB: 4, eloDelta: 10, timestamp: now - HOUR },
    ].sort((a, b) => b.timestamp - a.timestamp);

    const { players: stats } = computeAllPlayerStats(matches);
    const alice = stats['Alice'];

    if (!alice) throw new Error('Alice missing from stats');
    if (alice.longestGoldenPhiStreak !== 3) {
        throw new Error(`Expected longestGoldenPhiStreak=3, got ${alice.longestGoldenPhiStreak}`);
    }
    if (alice.goldenPhiStreak !== 1) {
        throw new Error(`Expected current goldenPhiStreak=1, got ${alice.goldenPhiStreak}`);
    }
    console.log('✓ longestGoldenPhiStreak correctly tracks peak before reset');
}

function testLongestPositiveDayRun() {
    console.log('\n=== Testing longestPositiveDayRun ===\n');
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const now = Date.now();

    // Alice ELO per day:
    //   5 days ago: win  → positive (run=1)
    //   4 days ago: win  → positive (run=2)
    //   3 days ago: win  → positive (run=3)  ← longest
    //   2 days ago: lose → negative (run resets)
    //   1 day ago:  win  → positive (run=1)
    //   today:      lose → negative (current run=0)
    // Expected: longestPositiveDayRun=3, currentPositiveDayRun=0
    const matches = [
        { id: 'p1', teamA: ['Alice'], teamB: ['Bob'], winner: 'A', goalsA: 5, goalsB: 2, eloDelta: 20, timestamp: now - 5 * DAY },
        { id: 'p2', teamA: ['Alice'], teamB: ['Bob'], winner: 'A', goalsA: 5, goalsB: 2, eloDelta: 20, timestamp: now - 4 * DAY },
        { id: 'p3', teamA: ['Alice'], teamB: ['Bob'], winner: 'A', goalsA: 5, goalsB: 2, eloDelta: 20, timestamp: now - 3 * DAY },
        { id: 'p4', teamA: ['Alice'], teamB: ['Bob'], winner: 'B', goalsA: 2, goalsB: 5, eloDelta: 20, timestamp: now - 2 * DAY },
        { id: 'p5', teamA: ['Alice'], teamB: ['Bob'], winner: 'A', goalsA: 5, goalsB: 2, eloDelta: 20, timestamp: now - DAY },
        { id: 'p6', teamA: ['Alice'], teamB: ['Bob'], winner: 'B', goalsA: 2, goalsB: 5, eloDelta: 20, timestamp: now - HOUR },
    ].sort((a, b) => b.timestamp - a.timestamp);

    const { players: stats } = computeAllPlayerStats(matches);
    const alice = stats['Alice'];

    if (!alice) throw new Error('Alice missing from stats');
    if (alice.longestPositiveDayRun !== 3) {
        throw new Error(`Expected longestPositiveDayRun=3, got ${alice.longestPositiveDayRun}`);
    }
    if (alice.currentPositiveDayRun !== 0) {
        throw new Error(`Expected currentPositiveDayRun=0, got ${alice.currentPositiveDayRun}`);
    }

    console.log('✓ longestPositiveDayRun correctly finds peak across all days');
}

testLongestGoldenPhiStreak();
testLongestPositiveDayRun();

function testHattrickBadge() {
    console.log('\n=== Testing hattrickCount ===\n');
    const HOUR = 60 * 60 * 1000;
    const MIN = 60 * 1000;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const today = todayStart.getTime();

    const matches = [
        // Today: Alice wins with 3 consecutive red goals within 40s → hat trick
        {
            id: 'ht-yes',
            teamA: ['Alice'], teamB: ['Bob'],
            winner: 'A', goalsA: 5, goalsB: 2, eloDelta: 20,
            timestamp: today + HOUR,
            goalLog: [
                { team: 'red',  timestamp: 10000 },
                { team: 'blue', timestamp: 25000 },
                { team: 'red',  timestamp: 40000 },
                { team: 'red',  timestamp: 55000 },
                { team: 'red',  timestamp: 68000 }, // 3rd red: 68s - 40s = 28s apart from 1st → within 40s
                { team: 'blue', timestamp: 80000 },
                { team: 'red',  timestamp: 90000 },
            ],
        },
        // Today: Alice wins with 3 consecutive red goals but spread over >40s → no hat trick
        {
            id: 'ht-slow',
            teamA: ['Alice'], teamB: ['Bob'],
            winner: 'A', goalsA: 5, goalsB: 2, eloDelta: 20,
            timestamp: today + 2 * HOUR,
            goalLog: [
                { team: 'red',  timestamp: 10000 },
                { team: 'red',  timestamp: 50000 },
                { team: 'red',  timestamp: 80000 }, // 80s - 10s = 70s > 40s → no hat trick
                { team: 'blue', timestamp: 100000 },
                { team: 'red',  timestamp: 110000 },
                { team: 'blue', timestamp: 120000 },
                { team: 'red',  timestamp: 130000 },
            ],
        },
        // Today: Alice wins but goals alternate — no hat trick
        {
            id: 'ht-no',
            teamA: ['Alice'], teamB: ['Bob'],
            winner: 'A', goalsA: 5, goalsB: 4, eloDelta: 20,
            timestamp: today + 3 * HOUR,
            goalLog: buildGoalLog(['red', 'blue', 'red', 'blue', 'red', 'blue', 'red', 'blue', 'red']),
        },
        // Today: Bob wins with a hat trick but Alice loses — should not count for Alice
        {
            id: 'ht-loser',
            teamA: ['Bob'], teamB: ['Alice'],
            winner: 'A', goalsA: 5, goalsB: 1, eloDelta: 20,
            timestamp: today + 4 * HOUR,
            goalLog: buildGoalLog(['red', 'red', 'red', 'blue', 'red', 'red']),
        },
        // Yesterday: Alice wins with hat trick — should not count (not today)
        {
            id: 'ht-yesterday',
            teamA: ['Alice'], teamB: ['Bob'],
            winner: 'A', goalsA: 5, goalsB: 0, eloDelta: 20,
            timestamp: today - HOUR,
            goalLog: buildGoalLog(['red', 'red', 'red', 'red', 'red']),
        },
    ].sort((a, b) => b.timestamp - a.timestamp);

    const { players: stats } = computeAllPlayerStats(matches);
    const alice = stats['Alice'];
    const bob = stats['Bob'];

    if (!alice) throw new Error('Alice missing from stats');
    if (!bob) throw new Error('Bob missing from stats');

    // Alice: only ht-yes qualifies (consecutive + within 40s)
    if (alice.statusEvents.hattrickCount !== 1) {
        throw new Error(`Expected Alice hattrickCount=1, got ${alice.statusEvents.hattrickCount}`);
    }
    // Bob wins ht-loser with a hat trick today
    if (bob.statusEvents.hattrickCount !== 1) {
        throw new Error(`Expected Bob hattrickCount=1, got ${bob.statusEvents.hattrickCount}`);
    }

    console.log('✓ hattrickCount increments only for today\'s winners with 3 consecutive goals within 40 seconds');
}

testHattrickBadge();

// ============================================================
// Tournament Badge Tests
// ============================================================

function testTournamentBadges() {
    console.log('\n=== Testing tournament badges ===\n');
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

    // Create matches with a tournament completion stamp
    const matches = [
        // Recent match that completed a tournament (2 hours ago)
        {
            id: 'tourney-final',
            teamA: ['Alice', 'Bob'],
            teamB: ['Charlie', 'David'],
            winner: 'A', goalsA: 5, goalsB: 3, eloDelta: 20,
            timestamp: now - 2 * HOUR,
            tournamentId: 'tournament1',
            tournamentCompletion: {
                tournamentId: 'tournament1',
                tournamentName: 'Friday Cup',
                completedAt: now - 2 * HOUR,
                playerRankings: {
                    'Alice': 1, 'Bob': 1,
                    'Charlie': 2, 'David': 2,
                    'Eve': 3, 'Frank': 3,
                    'Grace': 4, 'Hank': 4,
                },
            },
        },
        // Earlier regular match
        {
            id: 'regular1',
            teamA: ['Alice', 'Eve'],
            teamB: ['Bob', 'Frank'],
            winner: 'A', goalsA: 5, goalsB: 2, eloDelta: 15,
            timestamp: now - 3 * HOUR,
        },
        // Even earlier match involving Grace and Hank
        {
            id: 'regular2',
            teamA: ['Grace', 'Hank'],
            teamB: ['Charlie', 'David'],
            winner: 'B', goalsA: 3, goalsB: 5, eloDelta: 15,
            timestamp: now - 4 * HOUR,
        },
    ];

    const { players: stats } = computeAllPlayerStats(matches);

    // Gold for Alice and Bob (rank 1)
    if (stats['Alice'].tournamentBadges.gold !== 1) {
        throw new Error(`Expected Alice gold=1, got ${stats['Alice'].tournamentBadges.gold}`);
    }
    if (stats['Bob'].tournamentBadges.gold !== 1) {
        throw new Error(`Expected Bob gold=1, got ${stats['Bob'].tournamentBadges.gold}`);
    }

    // Silver for Charlie and David (rank 2)
    if (stats['Charlie'].tournamentBadges.silver !== 1) {
        throw new Error(`Expected Charlie silver=1, got ${stats['Charlie'].tournamentBadges.silver}`);
    }

    // Bronze for Eve and Frank (rank 3)
    if (stats['Eve'].tournamentBadges.bronze !== 1) {
        throw new Error(`Expected Eve bronze=1, got ${stats['Eve'].tournamentBadges.bronze}`);
    }

    // Participant for Grace and Hank (rank 4)
    if (stats['Grace'].tournamentBadges.participant !== 1) {
        throw new Error(`Expected Grace participant=1, got ${stats['Grace'].tournamentBadges.participant}`);
    }

    // No other badges for Alice
    if (stats['Alice'].tournamentBadges.silver !== 0 || stats['Alice'].tournamentBadges.bronze !== 0) {
        throw new Error('Alice should only have gold badge');
    }

    console.log('✓ Tournament badges assigned correctly by rank');
}

testTournamentBadges();

function testTournamentBadgesExpired() {
    console.log('\n=== Testing expired tournament badges ===\n');
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

    // Tournament completed beyond the badge duration window
    const expiredTime = now - (TOURNAMENT_BADGE_DURATION_DAYS + 1) * DAY;

    const matches = [
        {
            id: 'tourney-old',
            teamA: ['Alice', 'Bob'],
            teamB: ['Charlie', 'David'],
            winner: 'A', goalsA: 5, goalsB: 3, eloDelta: 20,
            timestamp: expiredTime,
            tournamentCompletion: {
                tournamentId: 'old-tournament',
                tournamentName: 'Old Cup',
                completedAt: expiredTime,
                playerRankings: {
                    'Alice': 1, 'Bob': 1,
                    'Charlie': 2, 'David': 2,
                },
            },
        },
    ];

    const { players: stats } = computeAllPlayerStats(matches);

    if (stats['Alice'].tournamentBadges.gold !== 0) {
        throw new Error(`Expected Alice gold=0 (expired), got ${stats['Alice'].tournamentBadges.gold}`);
    }
    if (stats['Charlie'].tournamentBadges.silver !== 0) {
        throw new Error(`Expected Charlie silver=0 (expired), got ${stats['Charlie'].tournamentBadges.silver}`);
    }

    console.log('✓ Expired tournament badges correctly ignored');
}

testTournamentBadgesExpired();

function testMultipleTournamentBadges() {
    console.log('\n=== Testing multiple tournament badges ===\n');
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

    const matches = [
        // Tournament 2 final (more recent)
        {
            id: 'tourney2-final',
            teamA: ['Alice', 'Bob'],
            teamB: ['Charlie', 'David'],
            winner: 'A', goalsA: 5, goalsB: 4, eloDelta: 20,
            timestamp: now - 1 * HOUR,
            tournamentCompletion: {
                tournamentId: 'tournament2',
                tournamentName: 'Monday Cup',
                completedAt: now - 1 * HOUR,
                playerRankings: {
                    'Alice': 1, 'Bob': 1,
                    'Charlie': 2, 'David': 2,
                },
            },
        },
        // Tournament 1 final (older but still within window)
        {
            id: 'tourney1-final',
            teamA: ['Alice', 'Charlie'],
            teamB: ['Bob', 'David'],
            winner: 'B', goalsA: 3, goalsB: 5, eloDelta: 20,
            timestamp: now - 2 * DAY,
            tournamentCompletion: {
                tournamentId: 'tournament1',
                tournamentName: 'Friday Cup',
                completedAt: now - 2 * DAY,
                playerRankings: {
                    'Alice': 2, 'Charlie': 2,
                    'Bob': 1, 'David': 1,
                },
            },
        },
    ];

    const { players: stats } = computeAllPlayerStats(matches);

    // Alice: gold from tournament2, silver from tournament1
    if (stats['Alice'].tournamentBadges.gold !== 1) {
        throw new Error(`Expected Alice gold=1, got ${stats['Alice'].tournamentBadges.gold}`);
    }
    if (stats['Alice'].tournamentBadges.silver !== 1) {
        throw new Error(`Expected Alice silver=1, got ${stats['Alice'].tournamentBadges.silver}`);
    }

    // Bob: gold from both tournaments
    if (stats['Bob'].tournamentBadges.gold !== 2) {
        throw new Error(`Expected Bob gold=2, got ${stats['Bob'].tournamentBadges.gold}`);
    }

    console.log('✓ Multiple tournament badges aggregate correctly');
}

testMultipleTournamentBadges();
