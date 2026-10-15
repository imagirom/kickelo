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
| 🪴 | Gardener | streak | A match on 5+ consecutive weekdays (`gardener.requiredWeekdays`; weekends skipped, a weekday without a match yet does not break it until it is over) | weekdays | 2026-10-15 |
| ⛰ | Summit | state | Currently at a personal Elo peak above 1500 | – | 2025-11-19 |
| 👑 | Record holder | state | Holds the highest Elo reached in the season (above 1600) and is at it | – | 2025-11-19 |
| 🐦‍🔥 | Phoenix | state | Today's Elo gain > |loss on the previous played day| | – | 2025-11-19 |
| 🩹 | Medic | state | Won with ≥3 different teammates who were on a 3+ loss streak, within 7 days | teammates | 2025-11-23 |
| 🌊 | Streak breaker | points | Beat an opponent on a 5+ win streak; 1 point per streaking opponent | points today | 2025-11-19 |
| 🐕 | Underdog | points | Win against a team ≥100 Elo higher (team averages); `floor(diff/100)` points | points today | 2025-11-19 |
| 🪃 | Boomerang | points | Win after trailing by ≥2 goals; points = biggest deficit erased | points today | 2025-11-19 |
| 📄 | Clean sheet | event | Win 5:0 | count today | 2025-11-19 |
| 🎩 | Hat trick | event | Win with 3 goals in a row within 30 s (`hattrick.windowMs`; was 40 s until 2026-10-15 — the 30 s window applies to all matches, so earlier tallies are recomputed with it) | count today | 2026-03-20 |
| ☕ | Coffee break | event | Win a match lasting ≤ 2:30 | count today | 2025-11-23 |
| 🎢 | Rollercoaster | event | Win a match with ≥3 lead changes | count today | 2025-11-23 |
| 🐧 | Chill comeback | event | Win 5:4 after trailing the whole match | count today | 2025-11-23 |
| 🧟 | Match-point survivor | event | Win 5:4 after the opponents reached 4 goals while you had ≤2 (goal log); earned alongside 🪃 | count today | 2026-10-15 |
| 🏓 | Ping-pong | event | Win 5:4 with the score never more than 1 apart (goal log); a game that is also a 🎢 earns only 🎢 | count today | 2026-10-15 |
| 🧊 | Ice-cold decider | event | Win 5:4 where the 4:4 lasted ≥ 120 s before the winning goal (`iceCold.minTiedMs`, goal log) | count today | 2026-10-15 |
| 🐢 | Marathon | event | Win a match lasting ≥ 8 min (last goal of the goal log, else `matchDuration`); > 20 min is ignored as a forgotten timer (`marathon`) | count today | 2026-10-15 |
| ⏳ | Patience | event | First win after sitting out ≥ 2 matches in a row on the same day (`patience.minSatOut`) | count today | 2026-10-15 |
| 🏖️ | Welcome back | event | First win after ≥ 14 calendar days without playing any match (`welcomeBack.minDaysAway`) | count today | 2026-10-15 |
| 🎂 | Cake | event | `CAKE_TEAM` wins together: everyone playing or waiting gets cake | count today | 2026-03-20 |
| 🥇🥈🥉⚽ | Tournament medals | medal | Placement in a completed tournament (⚽ = played, no podium) | medals in the last 7 days | 2026-04-10 |

Event and points badges are shown on the leaderboard for the rest of the day they were earned
(`stats.statusEvents`, today only). State and streak badges are shown while the condition holds.
Medals are shown for `TOURNAMENT_BADGE_DURATION_DAYS` after the tournament completed.

Thresholds live in `BADGE_THRESHOLDS` (`src/constants.js`); the rule sentences are built from them.
Rates on the 2026 matches up to 2026-10-07 (990 with goal log, 2019 player wins): 🧟 47 matches,
🏓 50 (15 of them also 🎢), 🧊 15 (1.5%; at 60 s it would be 6–9%), 🐢 ≈ 5% (≈ 1–2% at 9 min),
⏳ 125 wins (6%; at 3 sat out it would be 0.5%), 🏖️ 65 wins.

Data the newer badges rely on:

- 🧟 🏓 🧊 need a goal log that adds up to the 5:4 result (`getNarrowWinScoreline`); manual entries never
  earn them.
- ⏳ "Sat out" means listed in `pairingMetadata.waitingPlayers`: the active players of the last Suggest
  (within 30 min, see `buildPairingMetadata` in `src/match-form-handler.js`) who are not playing. That
  list is on 97% of the 2026 matches; a match without it neither extends nor breaks a run, and a player
  who is there but not among the Suggest session's active players is not known to be waiting.
  Runs restart every day. "First win": a loss after the wait keeps it pending until the next win that day.
- 🏖️ uses the all-time last match (any season, unranked too): `computeAllPlayerStats` takes
  `options.allMatches`; without it, only the matches passed in are known. Players without an earlier
  match never earn it.

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
- **streak** (🔥 🐍 🧱 φ 🧗 🪴): +1 for every level reached from minLength on — a 5-win streak counts
  3 (for being awarded the 3, 4 and 5 win streaks). `maxLength` is the longest streak reached.
  🧗 and 🪴 are dated by day.
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
