// Badges introduced 2026-10-15 (🧟 🏓 🧊 🐢 ⏳ 🏖️ 🪴) and the 30 s 🎩 window, with synthetic matches.
import {
    computeAllPlayerStats, getNarrowWinScoreline, isZombieWin, isPingPongWin, isIceColdWin,
    computePatienceWins, computeWelcomeBackWins,
} from '../src/player-stats-batch.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
// After every badge's introducedAt, so the tally counts them
const at = (month, day, hour = 12) => new Date(2026, month - 1, day, hour).getTime();

let passed = 0;
function check(label, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    passed++;
    console.log(`  ✓ ${label}`);
}

// 1v1 match won by `winner` (red). goals: 'r'/'b' per goal; times: goal timestamps (default one per minute).
let nextId = 0;
function match(timestamp, winner, loser, goals = 'rrrrr', times = null, extra = {}) {
    const goalLog = [...goals].map((c, i) => ({ team: c === 'r' ? 'red' : 'blue', timestamp: times ? times[i] : (i + 1) * MINUTE }));
    return {
        id: `m${nextId++}`, timestamp, teamA: [winner], teamB: [loser], winner: 'A',
        goalsA: goalLog.filter(g => g.team === 'red').length,
        goalsB: goalLog.filter(g => g.team === 'blue').length,
        goalLog, ...extra,
    };
}
const newestFirst = (matches) => [...matches].sort((a, b) => b.timestamp - a.timestamp);
const tallyOf = (matches, options) => {
    const { players } = computeAllPlayerStats(newestFirst(matches), options);
    return (player, emoji) => players[player]?.emojiTally[emoji]?.count ?? 0;
};

console.log('\n=== goal-log detectors ===');
const scoreline = (goals, times) => getNarrowWinScoreline(match(at(11, 2), 'W', 'L', goals, times));
check('5:3 win has no narrow scoreline', scoreline('rrbrbrr'), null);
check('5:4 without goal log has no narrow scoreline', getNarrowWinScoreline({ winner: 'A', goalsA: 5, goalsB: 4, goalLog: [] }), null);
check('goal log not adding up to the 5:4 result is ignored', getNarrowWinScoreline({ ...match(at(11, 2), 'W', 'L', 'rrbbbbrrr'), goalsB: 3, goalsA: 5, goalLog: match(0, 'W', 'L', 'rrrrbbr').goalLog }), null);
check('🧟 opponents at 4 while we had 2', isZombieWin(scoreline('rrbbbbrrr')), true);
check('🧟 not when we had 3', isZombieWin(scoreline('rrrbbbbrr')), false);
check('🏓 never more than one apart', isPingPongWin(scoreline('rbrbrbrbr')), true);
check('🏓 not after a 2-goal lead', isPingPongWin(scoreline('rrbbrbrbr')), false);
const tieAt = 8 * MINUTE;
const narrowTimes = (gap) => [1, 2, 3, 4, 5, 6, 7, 8].map(i => i * MINUTE).concat(tieAt + gap);
check('🧊 4:4 lasting exactly 120 s', isIceColdWin(scoreline('rbrbrbrbr', narrowTimes(120 * SECOND))), true);
check('🧊 not at 119 s', isIceColdWin(scoreline('rbrbrbrbr', narrowTimes(119 * SECOND))), false);

console.log('\n=== event badges in the stats pass ===');
const D = 2; // November 2nd
const eventTally = tallyOf([
    // 🧟 + 🪃 (deficit 2) in the same match
    match(at(11, D, 9), 'Zombie', 'Opp', 'rrbbbbrrr'),
    // 🏓 alone
    match(at(11, D, 10), 'Ping', 'Opp', 'rbrbrbrbr'),
    // 🏓 + 🎢 (4 lead changes) -> only 🎢
    match(at(11, D, 11), 'Roller', 'Opp', 'rbbrrbbrr'),
    // 🧊 at exactly 120 s, not at 119 s
    match(at(11, D, 12), 'Ice', 'Opp', 'rbrbrbrbr', narrowTimes(120 * SECOND)),
    match(at(11, D, 13), 'Ice', 'Opp', 'rbrbrbrbr', narrowTimes(119 * SECOND)),
    // 🐢: exactly 8 min counts, just below does not, exactly 20 min counts, above 20 min is a forgotten timer
    match(at(11, D, 14), 'Turtle', 'Opp', 'rrrrr', [1, 2, 3, 4, 8].map(m => m * MINUTE)),
    match(at(11, D, 15), 'Turtle', 'Opp', 'rrrrr', [1, 2, 3, 4, 8 * 60 - 1].map(s => s * SECOND)),
    match(at(11, D, 16), 'Turtle', 'Opp', 'rrrrr', [1, 2, 3, 4, 20].map(m => m * MINUTE)),
    match(at(11, D, 17), 'Turtle', 'Opp', 'rrrrr', [1, 2, 3, 4, 20 * 60 + 1].map(s => s * SECOND)),
    // 🐢 from matchDuration when there is no goal log
    { ...match(at(11, D, 18), 'Clock', 'Opp', ''), goalsA: 5, goalsB: 1, goalLog: undefined, matchDuration: 9 * MINUTE },
    // 🎩: 3 goals within exactly 30 s count, 31 s do not
    match(at(11, D, 19), 'Hat', 'Opp', 'rrrbbrr', [0, 15, 30, 40, 50, 60, 70].map(s => s * SECOND)),
    match(at(11, D, 20), 'Hat', 'Opp', 'rrrbbrr', [0, 15, 31, 40, 50, 60, 70].map(s => s * SECOND)),
]);
check('🧟 earned', eventTally('Zombie', '🧟'), 1);
check('🪃 in the same match (2 points)', eventTally('Zombie', '🪃'), 2);
check('🏓 earned', eventTally('Ping', '🏓'), 1);
check('🏓 + 🎢 game earns 🎢 only', [eventTally('Roller', '🎢'), eventTally('Roller', '🏓')], [1, 0]);
check('🧊 at 120 s only', eventTally('Ice', '🧊'), 1);
check('🐢 at 8 and 20 min, not at 7:59 or 20:01', eventTally('Turtle', '🐢'), 2);
check('🐢 from matchDuration', eventTally('Clock', '🐢'), 1);
check('🎩 within 30 s only', eventTally('Hat', '🎩'), 1);
check('losers earn none of them', eventTally('Opp', '🧟') + eventTally('Opp', '🐢'), 0);

// Today's matches feed statusEvents (the leaderboard)
const today = new Date();
today.setHours(0, 0, 0, 0);
const { players: todayPlayers } = computeAllPlayerStats(newestFirst([
    match(today.getTime() + 1000, 'Zombie', 'Opp', 'rrbbbbrrr'),
    match(today.getTime() + 2000, 'Zombie', 'Opp', 'rrbbbbrrr'),
]));
check('statusEvents.zombieCount counts today\'s matches', todayPlayers.Zombie.statusEvents.zombieCount, 2);

console.log('\n=== ⏳ patience ===');
// 2v2 on one day: Pat sits out two matches, loses, then wins -> first win after sitting out.
const waiting = (players) => ({ pairingMetadata: { source: 'suggested', waitingPlayers: players } });
const game = (hour, teamA, teamB, winner, waitingPlayers = [], day = 3) => ({
    id: `p${nextId++}`, timestamp: at(11, day, hour), teamA, teamB, winner, goalsA: winner === 'A' ? 5 : 3, goalsB: winner === 'A' ? 3 : 5,
    ...waiting(waitingPlayers),
});
const patience = [
    game(9, ['A', 'B'], ['C', 'D'], 'A', ['Pat', 'Once']),
    game(10, ['A', 'C'], ['B', 'D'], 'A', ['Pat']),
    game(11, ['Pat', 'Once'], ['A', 'B'], 'B'), // Pat back after 2, loses; Once after 1
    game(12, ['Pat', 'Once'], ['C', 'D'], 'A'), // Pat's first win -> ⏳; Once only sat out once
    game(13, ['Pat', 'A'], ['C', 'D'], 'A'), // second win: no
    // next day: sat out twice yesterday evening does not carry over
    game(20, ['A', 'B'], ['C', 'D'], 'A', ['Late'], 3),
    game(21, ['A', 'B'], ['C', 'D'], 'A', ['Late'], 3),
    game(9, ['Late', 'A'], ['C', 'D'], 'A', [], 4),
];
const patienceWins = computePatienceWins(newestFirst(patience));
const winners = (wins) => [...wins.entries()].map(([m, players]) => [m.timestamp, [...players]]);
check('⏳ only Pat, at the first win after sitting out 2', winners(patienceWins), [[at(11, 3, 12), ['Pat']]]);
check('⏳ sitting out 3 still counts', computePatienceWins(newestFirst([
    game(9, ['A', 'B'], ['C', 'D'], 'A', ['X']), game(10, ['A', 'B'], ['C', 'D'], 'A', ['X']),
    game(11, ['A', 'B'], ['C', 'D'], 'A', ['X']), game(12, ['X', 'A'], ['C', 'D'], 'A'),
])).size, 1);
check('⏳ in the tally', tallyOf(patience)('Pat', '⏳'), 1);

console.log('\n=== 🏖️ welcome back ===');
const back = [
    match(at(11, 1), 'Away', 'Opp'),
    match(at(11, 15, 9), 'Opp', 'Away'), // 14 days later: loses first
    match(at(11, 15, 10), 'Away', 'Opp'), // first win back -> 🏖️
    match(at(11, 15, 11), 'Away', 'Opp'), // second win: no
    match(at(11, 2), 'Short', 'Opp'),
    match(at(11, 15, 12), 'Short', 'Opp'), // 13 days: no
    match(at(11, 15, 13), 'Newbie', 'Opp'), // no earlier match: no
];
check('🏖️ first win after exactly 14 days, not after 13, not for newcomers', winners(computeWelcomeBackWins(newestFirst(back))), [[at(11, 15, 10), ['Away']]]);
// Season starting after the break: the all-time last played date comes from options.allMatches
const seasonMatches = back.filter(m => m.timestamp >= at(11, 10));
check('🏖️ without allMatches the season hides the break', tallyOf(seasonMatches)('Away', '🏖️'), 0);
check('🏖️ with allMatches', tallyOf(seasonMatches, { allMatches: newestFirst(back) })('Away', '🏖️'), 1);
check('🏖️ an unranked match in between counts as playing', computeWelcomeBackWins(newestFirst([
    match(at(11, 1), 'U', 'Opp'), { ...match(at(11, 10), 'Opp', 'U'), ranked: false }, match(at(11, 16), 'U', 'Opp'),
])).size, 0);

// An unranked first win must not use up the badge: the next ranked win earns it
const unrankedFirst = [
    match(at(11, 1), 'U', 'Opp'), { ...match(at(11, 21, 9), 'U', 'Opp'), ranked: false }, match(at(11, 21, 10), 'U', 'Opp'),
];
check('🏖️ unranked first win back: awarded at the next ranked win', winners(computeWelcomeBackWins(newestFirst(unrankedFirst))), [[at(11, 21, 10), ['U']]]);
check('🏖️ unranked first win back: in the tally', tallyOf(unrankedFirst.filter(m => m.ranked !== false), { allMatches: newestFirst(unrankedFirst) })('U', '🏖️'), 1);
const unrankedPatience = [
    game(9, ['A', 'B'], ['C', 'D'], 'A', ['X']), game(10, ['A', 'B'], ['C', 'D'], 'A', ['X']),
    { ...game(11, ['X', 'A'], ['C', 'D'], 'A'), ranked: false }, game(12, ['X', 'A'], ['C', 'D'], 'A'),
];
check('⏳ unranked first win after sitting out: awarded at the next ranked win', winners(computePatienceWins(newestFirst(unrankedPatience))), [[at(11, 3, 12), ['X']]]);

console.log('\n=== 🪴 gardener ===');
// Mon 2 Nov .. Mon 9 Nov 2026 (weekend skipped) = 6 weekdays in a row, then a gap
const gardenDays = [2, 3, 4, 5, 6, 9, 11, 12];
const garden = gardenDays.map(day => match(at(11, day), 'Gardener', 'Opp'));
const { players: gardenPlayers } = computeAllPlayerStats(newestFirst(garden));
check('🪴 levels 5 and 6 counted, maxLength 6', [gardenPlayers.Gardener.emojiTally['🪴']?.count, gardenPlayers.Gardener.emojiTally['🪴']?.maxLength], [2, 6]);
// Current streak: 5 weekdays ending on the last weekday before today; today without a match keeps it alive
const previousWeekdays = [];
const cursor = new Date();
cursor.setHours(12, 0, 0, 0);
while (previousWeekdays.length < 5) {
    cursor.setDate(cursor.getDate() - 1);
    if (cursor.getDay() >= 1 && cursor.getDay() <= 5) previousWeekdays.push(cursor.getTime());
}
const { players: streakPlayers } = computeAllPlayerStats(newestFirst(previousWeekdays.map(ts => match(ts, 'Gardener', 'Opp'))));
check('🪴 streak survives a weekday without a match yet', streakPlayers.Gardener.gardenerWeekdayStreak, 5);

console.log(`\nNew badge tests: ${passed} passed`);
