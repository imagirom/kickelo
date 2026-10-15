// Emoji tally (stats.emojiTally): every badge earned in the given matches, counted per the
// rules in status-emojis.md and respecting each badge's introducedAt.
import { computeAllPlayerStats } from '../src/player-stats-batch.js';
import { summarizeEmojiTallies, rarestFirst, rankPlayers, emojiValue, emojiTotal, longestStreakValue, rarestLine, STREAK_EMOJIS } from '../src/emoji-stats.js';

const SECOND = 1000;
const at = (month, day, hour = 12) => new Date(2026, month - 1, day, hour).getTime();

let passed = 0;
function check(label, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    passed++;
    console.log(`  ✓ ${label}`);
}

// 1v1 match, winner on team A (red). goals: 'r'/'b' string, one goal per `spacing` ms.
function match(id, timestamp, winner, loser, goals = 'rrrrr', spacing = 60 * SECOND) {
    const goalLog = [...goals].map((c, i) => ({ team: c === 'r' ? 'red' : 'blue', timestamp: (i + 1) * spacing }));
    return {
        id, timestamp, teamA: [winner], teamB: [loser], winner: 'A',
        goalsA: goalLog.filter(g => g.team === 'red').length,
        goalsB: goalLog.filter(g => g.team === 'blue').length,
        goalLog,
    };
}

const matches = [
    // 🎩 before its introducedAt (2026-03-20): not counted
    match('hat-old', at(3, 19), 'Hat', 'Opp1', 'rrrbbrr', 10 * SECOND),
    // 🎩 after: counted
    match('hat-new', at(9, 1), 'Hat', 'Opp1', 'brrrbbrr', 10 * SECOND),
    // 5-win 🔥 streak (one of them 5:0 📄), then a loss
    match('s1', at(9, 2, 9), 'Streak', 'Opp2', 'rrrbbbrr'),
    match('s2', at(9, 2, 10), 'Streak', 'Opp2', 'rrrbbbrr'),
    match('s3', at(9, 2, 11), 'Streak', 'Opp2', 'rrrrr'),
    match('s4', at(9, 2, 12), 'Streak', 'Opp2', 'rrrbbbrr'),
    match('s5', at(9, 2, 13), 'Streak', 'Opp2', 'rrrbbbrr'),
    match('s6', at(9, 2, 14), 'Opp2', 'Streak', 'rrrbbbrr'),
    // 🪃 comeback from 0:3 -> 3 points
    match('back', at(9, 3), 'Back', 'Opp3', 'bbbrrrrr'),
].reverse(); // newest first, as from Firestore

// Completed tournaments: one before the medals' introducedAt (2026-04-10), one after
const tournament = (id, completedAt) => ({
    id, state: 'completed', completedAt, games: [],
    teams: [{ id: 't1', players: ['Streak'] }, { id: 't2', players: ['Back'] }],
    finalRankings: [{ teamId: 't1', rank: 1 }, { teamId: 't2', rank: 2 }],
});
const tournaments = [tournament('old', at(4, 1)), tournament('new', at(9, 4))];

console.log('\n=== emoji tally ===');
const { players } = computeAllPlayerStats(matches, { tournaments });
const tally = (player, emoji) => players[player].emojiTally[emoji];

check('5:0 win -> 📄 ×1', tally('Streak', '📄')?.count, 1);
check('hat trick -> 🎩 ×1, the pre-introducedAt one excluded', tally('Hat', '🎩'), { count: 1, firstAt: at(9, 1), lastAt: at(9, 1) });
check('5-win streak -> 🔥 ×3 (levels 3, 4, 5), maxLength 5', tally('Streak', '🔥'), { count: 3, firstAt: at(9, 2, 11), lastAt: at(9, 2, 13), maxLength: 5 });
check('comeback from 0:3 -> 🪃 3 points', tally('Back', '🪃')?.count, 3);
check('no 🪃 for a 1-goal deficit', tally('Hat', '🪃'), undefined);
check('tournament win -> 🥇 ×1 (pre-introducedAt tournament excluded)', tally('Streak', '🥇'), { count: 1, firstAt: at(9, 4), lastAt: at(9, 4) });
check('tournament second -> 🥈 ×1', tally('Back', '🥈')?.count, 1);
check('losers earn nothing', Object.keys(players.Opp3.emojiTally), []);
check('past days leave statusEvents (today) empty', players.Streak.statusEvents.shutoutCount, 0);

// The tally follows the season the matches and tournaments were filtered to
const season = { start: new Date(2026, 8, 3), end: new Date(2026, 8, 3, 23, 59) };
const seasonMatches = matches.filter(m => m.timestamp >= season.start.getTime() && m.timestamp <= season.end.getTime());
const { players: seasonPlayers } = computeAllPlayerStats(seasonMatches, { tournaments, season });
check('season: only its matches count', seasonPlayers.Back.emojiTally['🪃']?.count, 3);
check('season: tournaments completed outside it do not count', seasonPlayers.Back.emojiTally['🥈'], undefined);

// Summaries for the emoji stats section / collection header
const summary = summarizeEmojiTallies(players);
check('summary: 🔥 total, holders, first earner, top holder', summary['🔥'],
    { total: 3, holders: 1, first: { player: 'Streak', at: at(9, 2, 11) }, top: { player: 'Streak', count: 3 } });
check('summary: unearned emoji', summary['🐧'], { total: 0, holders: 0, first: null, top: null });
const rarest = rarestFirst(summary);
check('rarest first: ascending totals, unearned left out', rarest.map(e => summary[e].total), rarest.map(e => summary[e].total).sort((x, y) => x - y));
check('⛰: one per day with a new personal peak', summary['⛰'].total, 4); // Hat ×2 days, Streak, Back
check('beating the 5-streak earns 🌊 and 🐕 (≥100 Elo below)', [players.Opp2.emojiTally['🌊']?.count, players.Opp2.emojiTally['🐕']?.count], [1, 1]);

// Leaderboard "Emojis" / "Longest streaks" views
console.log('\n=== leaderboard emoji views ===');
check('streak emojis come from the registry', STREAK_EMOJIS, ['🔥', '🐍', '🧱', 'φ', '🧗', '🪴']);
check('total = sum of counts', emojiTotal(players.Streak.emojiTally), Object.values(players.Streak.emojiTally).reduce((sum, e) => sum + e.count, 0));
check('emojiValue: null emoji -> total', emojiValue(players.Back, null), emojiTotal(players.Back.emojiTally));
check('emojiValue: one emoji', emojiValue(players.Back, '🪃'), 3);
check('emojiValue: missing stats/emoji -> falsy', [emojiValue(undefined, '🪃') || 0, emojiValue(players.Opp3, '🪃') || 0, emojiValue(undefined, null)], [0, 0, 0]);
const byBoomerang = rankPlayers(players, (s) => emojiValue(s, '🪃'));
check('rank by one emoji: holders only, the rest counted', [byBoomerang.rows, byBoomerang.without],
    [[{ name: 'Back', value: 3 }], Object.keys(players).length - 1]);
check('rank: ties by name', rankPlayers({ b: 2, a: 2, c: 5 }, (v) => v).rows.map((r) => r.name), ['c', 'a', 'b']);
check('longest 🔥 run in the season', longestStreakValue(players.Streak, '🔥'), 5);
check('longest runs below minLength are kept (🐍 needs 7)', longestStreakValue(players.Streak, '🐍'), 2);
check('longestStreakValue: none -> 0', [longestStreakValue(players.Opp3, 'φ'), longestStreakValue(undefined, '🔥')], [0, 0]);
// 🪴 runs before its introducedAt count for the longest streak, but not for the tally
const weekdays = [5, 6, 7, 8, 9].map((day, i) => match(`g${i}`, new Date(2025, 4, day, 12).getTime(), 'Gardener', 'Opp4')).reverse();
const { players: gardenPlayers } = computeAllPlayerStats(weekdays);
check('🪴 longest run counted before introducedAt, not tallied', [longestStreakValue(gardenPlayers.Gardener, '🪴'), gardenPlayers.Gardener.emojiTally['🪴']], [5, undefined]);
const tiny = summarizeEmojiTallies({
    Anna: { emojiTally: { '🧊': { count: 1, firstAt: 1 } } },
    Ben: { emojiTally: { '🐢': { count: 1, firstAt: 2 }, '🔥': { count: 5, firstAt: 1 } } },
    Cy: { emojiTally: { '🐢': { count: 1, firstAt: 3 } } },
});
check('rarest line: rarest first, single holder named', rarestLine(tiny), 'Rarest: 🧊 ×1 (Anna) · 🐢 ×2 · 🔥 ×5 (Ben)');
check('rarest line: nothing earned -> empty', rarestLine(summarizeEmojiTallies({})), '');

console.log(`\nEmoji tally tests: ${passed} passed`);
