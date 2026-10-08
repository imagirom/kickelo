# Betting with golden footballs — design

**Date:** 2026-10-08
**Status:** Draft for review

## Summary

A just-for-fun betting layer on top of Kickelo. Bets use a fictional currency
(**golden footballs**, never real money, never ELO). Anyone can place a bet
for any player from any device, on trust, without accounts.
The betting layer reads the existing core (live mode, suggest, ELO, match
logging) and never changes its logic.

Three ways to bet:
1. **House winner bet** — fixed odds from a fitted model, always offered.
2. **House props** — two extra house bets per matchup (e.g. "margin ≥ 3",
   "over 4:30"), priced from match history, with odds no worse than a
   configurable ratio (default 3:1).
3. **Challenges** — custom player-vs-player bets on any outcome test with
   custom stakes, optionally open to "anyone".

Plus a **shared live view** of the current match on every phone, and a subtle
**Golden footballs** leaderboard option.

## Goals and non-goals

**Goals**
- Fun for 4–10 people per daily session, with people joining late and leaving early.
- No influence on ELO, suggest, live-mode logic or match data.
- Each part can be switched off in one config file.
- Odds are well calibrated: house bets should feel fair.

**Non-goals (this spec)**
- User accounts and authentication per person.
- Enforcing balances or rules server-side (trust-based like the rest of the app).
- Shop / cosmetics (phase 4, separate spec), bounties (later, needs a design
  that gives strong players no advantage), hybrid crowd-adjusted odds (later).
- House rules about who may bet on what ("anything goes" for now, see `checkBet`).

## Context (current code)

- Auth is one shared email/password account (`src/app.js`); players are name
  strings in `players/{name}`. Firestore rules gate collections with `canAccess()`.
- Matches: `matches/{id}` with `teamA`, `teamB` (Red = A, Blue = B), `winner`,
  `goalsA/B`, `timestamp` (server time at logging), and for live-mode matches
  `goalLog` (`[{team, timestamp: ms since start}]`) and `matchDuration` (ms).
  Matches can be edited (`editHistory`) and soft-deleted (`deleted`).
- Pre-match ELO is not stored; it is replayed by `computeAllPlayerStats`
  (`src/player-stats-batch.js`, team-average ELO, seasonal K).
- Win probability: `expectedScore()` in `src/elo-service.js`.
- Real-time pattern: `onSnapshot` → in-memory state → CustomEvent (`team-service.js`).
- UI helpers: `showToast`, `showConfirm` (`src/toast.js`), `createTimelineSVG(goalLog)`
  (`src/match-timeline.js`), leaderboard sort dropdown `#sortBySelect` with a
  special-case branch for `teamElo` in `src/leaderboard-display.js`.
- Lineup changes are signalled from `handleRoleSelectionChange` in
  `src/match-form-handler.js`.
- History (snapshot 2026-10-07): 1,948 matches over 252 play days, 1,707 with
  `goalLog`; 73 lack score fields and are ignored by modelling.

## Configuration

`src/betting/betting-config.js`, a code-level constant (like `sound-config.js`):

```js
export const BETTING = {
  enabled: true,            // master switch: nothing betting-related renders or syncs when false
  liveSync: true,           // publish/subscribe meta/currentMatch (shared live view)
  houseWinner: true,
  houseProps: { enabled: true, count: 2, maxRatio: 3, minSamples: 30 },
  challenges: true,
  margin: 0.05,             // house margin on fixed odds
  oddsClamp: [1.05, 10],
  dailyAllowance: 20,
  undoWindowMs: 5000,
};
```

House bets (winner and props) require `liveSync` because the first-goal cutoff needs
the shared live state; if `liveSync` is false, house bets are hidden and only
challenges remain.

## Data model

### `meta/currentMatch` (single doc, shared live view)

```
{
  red:  ["Marc", "Manuel"],        // sorted pair
  blue: ["Roman", "Tobi"],         // sorted pair
  positions: { redDefense, redOffense, blueDefense, blueOffense },  // display only
  matchupKey: "Manuel::Marc|Roman::Tobi",   // see Identity
  liveStartedAt: Timestamp | null,
  goalLog: [{team, timestamp}],    // mirrors the logging device
  firstGoalAt: Timestamp | null,   // serverTimestamp() written with the first goal
  offer: {                         // house offer, computed by the publishing device
    winner: { red: 1.9, blue: 1.8 },
    props: [{ outcome, oddsYes, oddsNo }],
    gap: number                    // pre-match ELO gap used for pricing
  } | null,
  updatedAt: serverTimestamp
}
```

**Write rule:** a device writes only on a user action on that device: selecting
a player, Suggest, Swap teams, starting/cancelling live mode, scoring a goal,
logging a match (which clears `liveStartedAt`/`goalLog`). Never on page load.
Last writer wins.

### `bets/{auto-id}`

```
{
  kind: "house" | "challenge",
  matchupKey: string,              // pairs, independent of side and positions
  placedAt: serverTimestamp,
  outcome: { test: "winner" | "marginAtLeast" | ..., team: [pair] | null, threshold: number | null, negate: bool },

  // house
  bettor: "Simon", stake: 20, odds: 1.9,          // odds locked at placement

  // challenge
  challenger: "Marc", challengerStake: 10,
  opponent: "Tobi" | null,                         // null = anyone
  opponentStake: 30,
  acceptedBy: string | null, acceptedAt: Timestamp | null,

  void: false                                      // undo / withdraw
}
```

### Identity

- A team is its **sorted pair** of names (same key as `teamKey` in
  `src/teams/team-identity.js`).
- `matchupKey` = the two team keys sorted and joined with `|`. Side (Red/Blue)
  and positions (offense/defense) are **not** part of it. So swapping positions
  or swapping Red/Blue never voids, resets or changes a bet.
- Bets refer to teams by pair, not by colour; the UI shows the current colour.

## Resolution (all derived, nothing is "settled")

Balances and bet results are computed on every client from `bets` + `matches`,
like ELO is computed from matches. Editing or deleting a match therefore
corrects all payouts automatically, and double payouts are impossible.

**Which match a bet belongs to:** the first non-deleted match with the same
`matchupKey` whose `timestamp` is after `placedAt`, on the same day (local
day, same as `getDayKey`). If none exists by the end of that day, the bet is
refunded.

**Cutoffs:**
- House bets count only if `placedAt < firstGoalAt`, where
  `firstGoalAt = timestamp − matchDuration + goalLog[0].timestamp`.
  `placedAt` and `timestamp` are server times; `matchDuration` and goal offsets
  are measured on one device, so device clock offsets cancel.
  Bets on matches without `goalLog` (not played in live mode) are refunded.
- Challenges count only if `acceptedAt < timestamp` of the match. Challenges
  not accepted by then are cancelled (refunded). A challenge posted before the
  first goal must also be accepted before it (`acceptedAt < firstGoalAt`, rules:
  `meta/currentMatch.firstGoalAt == null` at accept time); one posted mid-match
  stays acceptable until the match is logged, since both sides see the score.
- Known limit: if the scoring phone is offline, `meta/currentMatch.firstGoalAt`
  is written late and the logged match's `timestamp` (server time of the queued
  write) is late too, so both cutoffs move late by the offline delay. Not fixable
  without a server-side clock on the goals; accepted for a trust-based game.

**Payouts:**
- House: win → `stake × odds`, loss → 0, refund → `stake`.
- Challenge: winner receives both stakes.

**Balance** of a player =
`dailyAllowance × (number of days on which they placed ≥ 1 non-void bet or challenge)`
− stakes of their open and resolved bets + payouts + refunds.
Accepting a challenge counts as a bet for the allowance and deducts the opponent stake.
When checking a stake, today's allowance is included even before the player's first
bet of the day (the bet itself earns it). The client blocks stakes larger than the
balance, for placing and for accepting (trust-based; not enforced in rules).

**Rules hook:** `checkBet(bet, context) → { ok: true } | { ok: false, reason }`.
Allows everything for now ("anything goes"); house rules are added there later.

## Outcome tests

Pure functions `test(match) → boolean`, from the perspective of a given team
where relevant. Used for house props (phase 2) and challenges (phase 3);
phase 1 uses only `winner`.

| test | parameters | needs goalLog |
|---|---|---|
| `winner` | team | no |
| `marginAtLeast` | team, k | no |
| `shutout` (5:0) | team | no |
| `goesToFourFour` | — | no |
| `durationOver` | T (30 s steps) | yes (time of the last goal, not `matchDuration`, which runs until Submit) |
| `scoresFirst` | team | yes |
| `firstScorerWins` | — | yes |
| `comebackAtLeast` | team, k (winner was behind by ≥ k) | yes |

Every test can be negated ("no" side of a prop).

## Pricing model

Fit offline, ship a few parameters to the client.

**Main model — beta-binomial race to 5.** For a match with ELO gap `g`
(Red average minus Blue average, pre-match), each goal goes to Red with
probability `p`, where per match `p ~ Beta(μκ, (1−μ)κ)` with
`μ = 1 / (1 + 10^(−(g/s + c)))`. Parameters `s, c, κ` are fitted by maximum
likelihood on goal counts. The scoreline distribution of a race to 5 follows in
closed form (sum over the beta-binomial), which gives `winner`, `marginAtLeast`,
`shutout` and `goesToFourFour` consistently. Goal-order props (`scoresFirst`,
`firstScorerWins`, `comebackAtLeast`) come from the same model by exact
enumeration over goal sequences (at most 9 goals).

Exploration on the 2026-10-07 snapshot (simplified ELO replay, κ = ∞, i.e.
plain binomial): `s ≈ 1200`, `c ≈ 0.02`; predicted vs observed —
favourite wins 0.681/0.693, margin ≥ 3 0.516/0.564, 5:4 0.234/0.214,
5:0 0.092/0.108. The remaining gap (lopsided results more frequent than
predicted) is what `κ` captures.

**Duration model.** Time of the last goal ~ Weibull(shape k, scale λ·exp(b·|g|)), fitted by
maximum likelihood on live-mode matches; `P(durationOver T) = exp(−(T/scale)^k)`. Chosen over
log-normal, log-logistic and the empirical distribution on the time-split backtest (log-normal
overstated very short games). Offered lines are 4:00–6:00 in 30 s steps: 3:00 and 3:30 stayed
about 8 points off in the recent period (fewer very quick games lately) even with the best model.

**Benchmark.** Per-prop logistic regression (features: gap, |gap|, average
ELO, recent form) as a baseline. A prop switches to the benchmark only if it
clearly beats the main model in the backtest.

**Backtest.** Fit on matches older than the last 3 months, evaluate on the last
3 months: Brier score, log-loss, calibration table per prop. The report is
written to `admin/model/report.md`; the backtest script is kept in the repo.

**Pipeline.** `admin/model/fit.js` (Node, uses `computeAllPlayerStats` for
pre-match ELO trajectories and a local backup JSON) writes
`src/betting/model-params.json`. Refit manually (e.g. once per season).
Backups and the admin key stay local and are never committed
(`admin/backups/` is gitignored; key lives in `~/.config/kickelo/`).

**Odds.** `odds = clamp((1 / P) × (1 − margin), oddsClamp)`, with `P` the
model probability of the backed outcome. Pre-match ELO for a live bet comes
from the client's current stats (the same trajectories the leaderboard uses).

**Prop selection.** Candidates are all tests × sides × thresholds (margins
k = 2..4, duration 4:00–6:00 in 30 s steps) whose probability lies in
`[1/(1+maxRatio), maxRatio/(1+maxRatio)]` and have ≥ `minSamples` relevant
historical matches. `count` of them are drawn with a PRNG seeded by
`matchupKey + local date`, so every phone shows the same props. At most one
prop per test type.

## UI

Consistent with the existing `boxed` sections, red/blue select styling,
toasts and confirm dialogs.

**Currency.** Golden footballs: a gold variant of the standard ball `public/assets/football.svg`
(gradient + slow diagonal shine; static under `prefers-reduced-motion`),
shown inline at text size next to amounts.

**Bets box** (new `boxed` section below the match form; hidden unless betting is
enabled and `meta/currentMatch` has a full lineup):
- Header: team labels in red/blue (with team names, as in the live-team label).
- Live row (only on phones not running live mode): ● LIVE, timer, score,
  `createTimelineSVG(goalLog)`. Read-only.
- House section: "Red wins ×", "Blue wins ×", and the seeded props with yes/no
  odds. Label "Closes at first goal" (plus "counts only if the match is scored in
  live mode" while no phone is live; shown as "live mode only"); after the first goal the section collapses to
  one line "Closed at first goal · odds were …".
- "Challenge someone…" opens the challenge form: challenger, opponent
  (player or **anyone**), outcome test, threshold, both stakes. A challenge to a
  named player is **locked in** when posted (accepted in the same write, both
  balances checked; button "Lock in"); "anyone" challenges need an accept
  ("Post challenge"). Stakes are capped at `BETTING.maxStake` (10000).
- Feed: all non-void bets on the current matchup, live via `onSnapshot`;
  open challenges show **Accept** (if opponent is anyone or the selected player;
  "closed at first goal" for pre-match challenges after it). Below, the results of
  the last logged match today if the shared lineup has moved on ("Last match").
- Accept sheet: the acceptor's side in positive form ("You back: X lose"), the
  stakes, and the live score with the time the challenge was posted.
- Placing a bet: sheet in `showConfirm` style — bettor (dropdown, remembered per
  device in localStorage), stake (chips 5/10/25 + number field), payout,
  bettor's balance. After placing, a toast offers **Undo** within `undoWindowMs`
  (sets `void: true`). An unaccepted challenge can be withdrawn at any time, from any
  phone (no accounts) after a confirmation; accepted challenges and house bets after
  the undo window cannot be voided (rules allow a house-bet void for 60 s).

**Odds shown** come from `meta/currentMatch.offer`, not from each phone's own
stats, so all phones show identical odds and props. A placed bet copies its odds
from the offer.

**Overwrite protection.** Before a device publishes a change to
`meta/currentMatch` that changes the pairs (player selection, Suggest, tournament prefill), while the current match is live or has ≥ 1 non-void bet,
it asks via `showConfirm`:
"Replace the current match *Marc + Manuel vs Roman + Tobi*? 3 bets (45 ⚽︎) will be refunded."
Declining ("Keep shared match", "Keep other phone") cancels the action itself: a lineup
change is reverted to the lineup before it, and live mode is not started (the question is
asked before it starts). One table, one match. Position swaps and Red/Blue swaps never ask.
Cancelling live mode never refunds bets: they carry over to the next match with the same lineup (usually the restart) and are refunded at day end otherwise, so cancel needs no extra confirmation.

**Leaderboard.** One new `#sortBySelect` option, "Golden footballs", rendered
via a special-case branch (like `teamElo`): rank, name, balance, today's ±.
No other leaderboard changes.

## Firestore rules

- `meta/currentMatch`: covered by the existing `meta` rule.
- `bets/{id}`: `read: canAccess()`; `create: canAccess()` with type checks
  (kind, stakes positive numbers, `placedAt == request.time`, odds number for
  house) and, for `kind == "house"`, `get(/meta/currentMatch)` must have the same
  `matchupKey` and `firstGoalAt == null`; `update: canAccess()` only for `void`,
  `acceptedBy`, `acceptedAt` (`acceptedAt == request.time`), with accept requiring
  `acceptedBy == null && void == false` and challenge withdraw requiring
  `acceptedBy == null`; `delete: false`.

## Concurrency

Firestore rules and transactions decide races at write time; the derived
resolution re-checks everything from match data.

1. **House bet vs first goal.** The logging device writes `firstGoalAt:
   serverTimestamp()` with the first goal. The `bets` create rule reads
   `meta/currentMatch` and allows a house bet only if its `matchupKey` equals the
   current one and `firstGoalAt == null`, enforced against committed state at write
   time. Resolution independently requires `placedAt < firstGoalAt` derived from
   the logged match (see Resolution); a bet must pass both checks to count.
   Rejected writes show "Bet not accepted — betting had closed".
2. **Concurrent accepts / accept vs withdraw.** Accept and withdraw run in a
   transaction; rules allow accept only if `acceptedBy == null && void == false`,
   and challenge withdraw only if `acceptedBy == null`. Exactly one wins; the
   loser sees a toast ("Already taken by Marc").
3. **Stale overwrite dialog / stale phones.** Every write to `meta/currentMatch`
   (lineup, positions, live claim, goals, live end) is a transaction that re-reads
   it. A lineup replace re-checks the overwrite condition on the fresh doc: if that
   doc newly needs asking (another matchup than the one confirmed, now live or with
   bets), the dialog is shown again with fresh counts; goals scored meanwhile on the
   confirmed match do not ask again. Goals and live end are written only while the
   doc still carries this phone's `liveId` (or, after a submit, the logged matchup),
   so a phone with a stale or offline snapshot never writes onto a newer match.
   These writes fail offline instead of queueing. A phone that is live locally
   claims live scoring in the same write as its lineup.
4. **Diverging odds across phones.** Solved by the published `offer` (see UI).
5. **Concurrent stakes for one player.** Not prevented (rules cannot sum derived
   balances). Balances may go slightly negative; further stakes are blocked until
   positive.
6. **Late offline bets.** Rejected by rule 1 when they reach the server.
7. **Two phones starting live mode.** Starting live mode while `currentMatch` is
   live goes through the overwrite confirmation; only the confirmed phone writes goals.
8. **Bet between matches with a repeated lineup** resolves to the next match (intended).

## Phases

1. Live sync (`meta/currentMatch`, shared live view, overwrite protection),
   house winner bet with the fitted winner model, derived balances, Golden
   footballs leaderboard, currency icon, config switches.
2. House props: full model fit, outcome tests, backtest report, seeded prop selection.
3. Challenges (incl. "anyone" and accept flow).
4. Shop (separate spec).

## Testing

- **Unit (node, existing `test/*.test.js` style):** matchup key invariance
  under position and side swaps; bet → match resolution (same-lineup repeats,
  end-of-day refund, deleted/edited matches); first-goal cutoff computation;
  balances including allowance days and refunds; every outcome test on handmade
  goal logs; odds clamp/margin; seeded prop selection is deterministic and
  respects `maxRatio`; `checkBet` default.
- **Model:** backtest report with calibration tables; fit script re-runnable.
- **In-browser (Playwright):** two browser contexts — lineup and goals on
  one appear on the other; house buttons close at first goal; overwrite
  confirm shows bet count; bet placed on one context appears in the other's
  feed; leaderboard option renders.
