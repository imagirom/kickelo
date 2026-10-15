# Status Emojis

Status emojis are badges shown next to each player in the leaderboard. They are attached to
**players**, derived from match data (no extra Firestore fields), and computed in the single stats
pass `computeAllPlayerStats` (`src/player-stats-batch.js`). Badges never touch Elo: Elo is only
gained or lost through ranked match results.

## Registry

`BADGE_INFO` in `src/constants.js` is the single list of badges: emoji → `{ name, rule, kind,
introducedAt, minLength? }`. The rule sentence is the user-facing explanation (leaderboard tooltips,
player page collection, emoji stats table). Streak thresholds (`minLength`) are read from it by both
the leaderboard and the tally.

| Emoji | Name | Kind | Rule (shown in the app) | Leaderboard number | introducedAt |
| --- | --- | --- | --- | --- | --- |
| 🔥 | Win streak | streak | Win 3+ matches in a row | streak length | 2025-08-05 |
| 🐍 | Snake | streak | Alternate wins and losses for 7+ matches | run length | 2025-11-19 |
| 🧱 | Wall | streak | Concede ≤1 goal as defender (confirmed positions, 2v2) in 3+ games in a row | streak length | 2026-03-17 |
| φ | Golden streak | streak | `goldenPhi.minWins` (5) 5:4 wins without a 4:5 loss in between | streak length | 2025-11-23 |
| 🧗 | Climber | streak | Positive net Elo on 3+ consecutive played days | days | 2025-11-19 |
| ⛰ | Summit | state | Currently at a personal Elo peak above 1500 | – | 2025-11-19 |
| 👑 | Record holder | state | Holds the highest Elo reached in the season (above 1600) and is at it | – | 2025-11-19 |
| 🐦‍🔥 | Phoenix | state | Today's Elo gain > |loss on the previous played day| | – | 2025-11-19 |
| 🩹 | Medic | state | Won with ≥3 different teammates who were on a 3+ loss streak, within 7 days | teammates | 2025-11-23 |
| 🌊 | Streak breaker | points | Beat an opponent on a 5+ win streak; 1 point per streaking opponent | points today | 2025-11-19 |
| 🐕 | Underdog | points | Win against a team ≥100 Elo higher (team averages); `floor(diff/100)` points | points today | 2025-11-19 |
| 🪃 | Boomerang | points | Win after trailing by ≥2 goals; points = biggest deficit erased | points today | 2025-11-19 |
| 📄 | Clean sheet | event | Win 5:0 | count today | 2025-11-19 |
| 🎩 | Hat trick | event | Win with 3 goals in a row within 40 s | count today | 2026-03-20 |
| ☕ | Coffee break | event | Win a match lasting ≤ 2:30 | count today | 2025-11-23 |
| 🎢 | Rollercoaster | event | Win a match with ≥3 lead changes | count today | 2025-11-23 |
| 🐧 | Chill comeback | event | Win 5:4 after trailing the whole match | count today | 2025-11-23 |
| 🎂 | Cake | event | `CAKE_TEAM` wins together: everyone playing or waiting gets cake | count today | 2026-03-20 |
| 🥇🥈🥉⚽ | Tournament medals | medal | Placement in a completed tournament (⚽ = played, no podium) | medals in the last 7 days | 2026-04-10 |

Event and points badges are shown on the leaderboard for the rest of the day they were earned
(`stats.statusEvents`, today only). State and streak badges are shown while the condition holds.
Medals are shown for `TOURNAMENT_BADGE_DURATION_DAYS` after the tournament completed.

Not in the registry yet: 🪴 Gardener (matches on 5+ consecutive weekdays, `gardenerWeekdayStreak`) is
computed but commented out in `getStatusBadges`. When it is enabled, add it to `BADGE_INFO` as a
streak badge (introducedAt = the day it goes live) and award its levels in the tally.

### How introducedAt was derived

Author date of the commit that first showed the emoji in `src/leaderboard-display.js`
(`git log --reverse -S"'<emoji>'" --format='%h %ad' --date=short -- src/leaderboard-display.js`):

- 🔥 2025-08-05 (`21e6f67`, "streaks and daily elo diff": the 🔥 ≥3 streak predates the badge system).
- ⛰ 🐍 🧗 🐦‍🔥 🌊 🐕 🪃 2025-11-19 (`4437da5`); 👑 2025-11-19 (`e85636c`).
- 📄 2025-11-19: the shutout badge was introduced as 🦏 in `4437da5` and renamed to 📄 in `7e1be17`
  (2026-03-20); the rule is unchanged, so the earlier date counts.
- ☕ 2025-11-23 (`3aca12e`); 🎢 🐧 🩹 φ 2025-11-23 (`e4e0e75`).
- 🧱 2026-03-17 (`69e98c4`); 🎩 2026-03-20 (`7e1be17`; 40 s window since `848a8b6`, same day);
  🎂 2026-03-20 (`f71dce0`).
- Medals 2026-04-10: the badges came on 2026-04-14 (`2cbadd9`), but they are derived from tournament
  results, and tournaments exist since 2026-04-10 (`57991d6`), so every tournament ever played counts.

Thresholds changed over time (e.g. 🌊 started at 3+ win streaks, now 5+). The tally applies
today's rules to all matches since introducedAt; it does not replay old thresholds.

## Emoji tally (statistics and collection)

`stats.emojiTally[emoji] = { count, firstAt, lastAt, maxLength? }` per player, separate from
`statusEvents` so the leaderboard's daily badges are unaffected. It covers the matches passed to
`computeAllPlayerStats`, i.e. the selected season (or all time), and the tournaments completed in it.
Awards dated before the badge's introducedAt (local midnight) are not counted.

Counting rules:

- **event**: +1 per match it was earned in.
- **points** (🌊 🐕 🪃): + the points that match added (the number the leaderboard shows).
- **streak** (🔥 🐍 🧱 φ 🧗): +1 for every level reached from minLength on — a 5-win streak counts
  3 (for being awarded the 3, 4 and 5 win streaks). `maxLength` is the longest streak reached.
  🧗 is dated by day.
- **state**, counted once per day on which it was newly earned (`firstAt`/`lastAt` are local midnights):
  - ⛰: days on which the player set a new personal Elo peak above 1500.
  - 👑: days on which the player set a new season Elo record above 1600.
  - 🐦‍🔥: played days whose net gain exceeded the previous played day's net loss.
  - 🩹: days with a medic save after which ≥3 different teammates had been helped in the last 7 days.
- **medal**: +1 per completed tournament, dated by its completion.

Totals across emojis ("Σ" in the emoji stats table) add up these numbers, so points badges contribute
their points.

Where it is shown: the player page's **Emoji collection** (grid of all registered emojis, ×count, max
length for streaks, first earned date; unearned ones greyed out; tap for name + rule) and the main
page's **Emoji stats** (`src/emoji-stats-display.js`: rarest-first list and a player × emoji table
following the leaderboard's season and show-inactive filters). Summaries live in `src/emoji-stats.js`.
