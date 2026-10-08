# Betting Phase 3 (Challenges) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Player-vs-player challenges on any outcome test with custom stakes, addressed to a specific player or to anyone, accepted with one tap, open until the match is logged, settled automatically.

**Architecture:** Challenges are `bets` docs with `kind: 'challenge'`. Resolution and balances stay derived (ledger). Accept and withdraw are guarded by Firestore rules and a transaction so exactly one of concurrent accepts/withdraws wins. UI: a "Challenge someone…" form and Accept/Withdraw buttons in the bet feed, reusing the outcome tests and `describeOutcome` from phase 2.

**Tech Stack:** as phases 1–2.

**Spec:** `docs/superpowers/specs/2026-10-08-betting-design.md` (Data model `bets`, Resolution, Concurrency #2/#3, UI). Builds on `docs/superpowers/plans/2026-10-08-betting-phase2-props.md` (outcomes.js, describeOutcome, generalised ledger).

## Global Constraints

- Gated by `BETTING.enabled && BETTING.challenges`; challenges do **not** need `liveSync` for resolution, but creating one requires a shared matchup (`meta/currentMatch.matchupKey`), so with `liveSync: false` the challenge button is hidden.
- The challenger claims `outcome` (any test from `OUTCOME_TESTS`, any listed threshold, optional `negate`); the acceptor takes the opposite side. Winner of the challenge receives `challengerStake + opponentStake`.
- `opponent: null` means anyone may accept; otherwise only that player (client restriction + rule). Nobody can accept their own challenge.
- Open until the match is logged: a challenge counts only if `acceptedAt < match.timestamp`; unaccepted challenges are cancelled (challenger refunded) when the match is logged or at day end; an accepted challenge whose outcome is `null` (missing data) refunds both.
- Accepting counts as a bet for the daily allowance on the acceptance day; stake checks include today's allowance if the player has no bet that day (same rule as house bets).
- An unaccepted challenge can be withdrawn at any time (`void: true`); accepted challenges cannot be voided.
- Concurrency: accept and withdraw run in a transaction; rules allow accept only if `acceptedBy == null && void == false`, withdraw only if `acceptedBy == null`.
- Existing house bets (winner and props) unchanged. No core logic changes. No push, no deploy, no production Firestore. Commits without `Co-Authored-By`.

## Review Focus

1. **Two phones accept the same "anyone" challenge at once** — exactly one succeeds, the other sees "Already taken by …". E2E in Task 3.
2. **Withdraw racing with accept** — exactly one wins; never both a withdrawn and accepted state. Rule + transaction (Task 2), unit test of the decision helper (Task 2).
3. **Challenge accepted after the match was logged** (late snapshot on a slow phone) — must be cancelled/refunded by resolution, never paid. Test in Task 1.
4. **Overwrite confirmation counts** — open challenges on the shared matchup are included in "N bets (X golden footballs) will be refunded". Test in Task 2 (`openStakeFor`).
5. **Balances with challenges** — challenger stake held from placement, acceptor stake held from acceptance, allowance days for both. Test in Task 1.

---

### Task 1: Ledger — challenge resolution and balances

**Files:**
- Modify: `src/betting/ledger.js`
- Test: `test/betting.test.js`

**Interfaces:**
- Produces:
  - `resolveChallenge(bet, matches, now) → { status: 'open'|'pending'|'cancelled'|'won'|'lost'|'refunded', matchId, challengerPayout, acceptorPayout }`
    - `'open'`: not accepted, no match yet, day not over (challenger stake held).
    - `'pending'`: accepted, no match yet, day not over (both stakes held).
    - `'cancelled'`: not accepted and (match logged or day over) **or** accepted with `acceptedAt >= match.timestamp` → refund whoever staked.
    - `'won'` (challenger wins), `'lost'` (acceptor wins), `'refunded'` (outcome `null`, or accepted but day over without match).
  - `computeBalances` handles `kind: 'challenge'` bets: challenger is charged `challengerStake` on `placedAt`'s day, acceptor `opponentStake` on `acceptedAt`'s day; payouts per result; both get allowance days.
  - Match association: the first non-deleted match with the challenge's `matchupKey`, `timestamp > placedAt`, same local day as `placedAt` (same helper as house bets).

- [ ] **Step 1: Write the failing tests**

```js
import { resolveChallenge } from '../src/betting/ledger.js';

console.log('\n=== challenges in the ledger ===');
{
  const day = new Date(2026, 9, 8, 12).getTime();
  const R = ['Manuel', 'Marc']; const B = ['Roman', 'Tobi'];
  const key = 'Manuel::Marc|Roman::Tobi';
  const m = { id: 'c1', timestamp: day + 600000, teamA: R, teamB: B, winner: 'A', goalsA: 5, goalsB: 1, matchDuration: 240000, goalLog: [{ team: 'red', timestamp: 1 }] };
  const ch = (extra = {}) => ({ kind: 'challenge', matchupKey: key, placedAt: day, challenger: 'Simon', challengerStake: 10,
    opponent: null, opponentStake: 30, outcome: { test: 'marginAtLeast', team: R, threshold: 3 }, acceptedBy: null, acceptedAt: null, void: false, ...extra });
  const acc = { acceptedBy: 'Peter', acceptedAt: day + 400000 };

  assertEq(resolveChallenge(ch(), [], day + 1000).status, 'open', 'unaccepted, no match -> open');
  assertEq(resolveChallenge(ch(), [m], day + 700000).status, 'cancelled', 'unaccepted when match logged -> cancelled');
  assertEq(resolveChallenge(ch(acc), [], day + 500000).status, 'pending', 'accepted, no match yet -> pending');
  assertEq(resolveChallenge(ch(acc), [m], day + 700000), { status: 'won', matchId: 'c1', challengerPayout: 40, acceptorPayout: 0 }, 'challenger right -> takes both stakes');
  assertEq(resolveChallenge(ch({ ...acc, outcome: { test: 'marginAtLeast', team: B, threshold: 3 } }), [m], day + 700000).acceptorPayout, 40, 'challenger wrong -> acceptor takes both');
  assertEq(resolveChallenge(ch({ acceptedBy: 'Peter', acceptedAt: day + 650000 }), [m], day + 700000).status, 'cancelled', 'accepted after the match was logged -> cancelled');
  assertEq(resolveChallenge(ch({ ...acc, outcome: { test: 'durationOver', team: null, threshold: 300 } }), [{ ...m, matchDuration: undefined }], day + 700000),
    { status: 'refunded', matchId: 'c1', challengerPayout: 10, acceptorPayout: 30 }, 'undecidable outcome -> both refunded');
  assertEq(resolveChallenge(ch(acc), [], day + 24 * 3600 * 1000).status, 'refunded', 'accepted, no match by day end -> refunded');

  const bal = computeBalances([ch(acc)], [m], day + 700000);
  assertEq(bal.get('Simon').balance, 100 - 10 + 40, 'challenger balance after a win');
  assertEq(bal.get('Peter').balance, 100 - 30, 'acceptor balance after a loss (allowance counted)');
  const open = computeBalances([ch()], [], day + 1000);
  assertEq(open.get('Simon'), { balance: 90, todayDelta: -10, open: 1 }, 'open challenge holds the challenger stake');
  assertEq(open.has('Peter'), false, 'no acceptor yet -> no wallet');
  assertEq(computeBalances([ch({ void: true })], [], day + 1000).size, 0, 'withdrawn challenge ignored');
}
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — refactor `findMatch(bet, matches)` to take `(matchupKey, placedAt, matches)`; add:

```js
export function resolveChallenge(bet, matches, now) {
  const match = findMatch(bet.matchupKey, bet.placedAt, matches);
  const accepted = Boolean(bet.acceptedBy) && typeof bet.acceptedAt === 'number';
  const refundAll = (status, matchId) => ({ status, matchId,
    challengerPayout: bet.challengerStake, acceptorPayout: accepted ? bet.opponentStake : 0 });
  if (!match) {
    const dayOver = now >= dayKey(bet.placedAt) + 24 * 3600 * 1000;
    if (!dayOver) return { status: accepted ? 'pending' : 'open', matchId: null, challengerPayout: 0, acceptorPayout: 0 };
    return refundAll(accepted ? 'refunded' : 'cancelled', null);
  }
  if (!accepted || bet.acceptedAt >= match.timestamp) return refundAll('cancelled', match.id);
  const result = evaluateOutcome(match, bet.outcome);
  if (result === null) return refundAll('refunded', match.id);
  const pot = bet.challengerStake + bet.opponentStake;
  return result
    ? { status: 'won', matchId: match.id, challengerPayout: pot, acceptorPayout: 0 }
    : { status: 'lost', matchId: match.id, challengerPayout: 0, acceptorPayout: pot };
}
```

In `computeBalances`, keep the house branch; add a challenge branch that books `(challenger, placedAt, challengerStake, challengerPayout)` and, if accepted, `(acceptedBy, acceptedAt, opponentStake, acceptorPayout)` with the same per-entry logic (allowance day set, `net = payout − stake`, `open++` while `open`/`pending`, `todayDelta` by the entry's own day). Extract a small `book(wallets, days, player, ms, stake, payout, isOpen, today)` helper used by both branches.

- [ ] **Step 4: Run** → pass (including all phase-1/2 ledger tests). **Commit** `feat(betting): challenge resolution and balances`.

---

### Task 2: Challenge service and rules

**Files:**
- Modify: `src/betting/bets-service.js`
- Modify: `firestore.rules`
- Modify: `src/betting/sync-controller.js` (overwrite count includes challenges)
- Test: `test/betting.test.js`

**Interfaces:**
- Produces (service):
  - `placeChallenge({ challenger, opponent, outcome, challengerStake, opponentStake }) → Promise<id>` — requires a shared matchup (`Error('closed')` otherwise); `checkBet`; balance check for the challenger (`Error('insufficient')`); writes `{ kind: 'challenge', matchupKey, placedAt: serverTimestamp(), challenger, opponent: opponent || null, challengerStake, opponentStake, outcome: { test, team, threshold, negate }, acceptedBy: null, acceptedAt: null, void: false }`.
  - `acceptChallenge(id, acceptor) → Promise<void>` — balance check for `opponentStake`; `runTransaction`: read the doc; throw `Error('taken:<name>')` if `acceptedBy` set, `Error('withdrawn')` if void, `Error('not-you')` if `opponent && opponent !== acceptor`, `Error('own')` if `acceptor === challenger`; else `update({ acceptedBy: acceptor, acceptedAt: serverTimestamp() })`. Map `permission-denied` → `Error('closed')`.
  - `withdrawChallenge(id) → Promise<void>` — transaction: throw `Error('taken:<name>')` if accepted; else `update({ void: true })`.
  - `getOpenBetsFor(matchupKey)` now also returns open challenges (`resolveChallenge(...).status` in `open|pending`).
  - Pure helper in `ledger.js`: `openStakeFor(bets, matches, matchupKey, now) → { count, stake }` — counts open house bets and open/pending challenges on that matchup; stake sums house stakes, challenger stakes and accepted opponent stakes. The sync controller uses it for the overwrite dialog text.
  - `acceptDecision(doc, acceptor) → 'ok' | 'taken' | 'withdrawn' | 'not-you' | 'own'` — pure, used inside the transaction and unit-tested.

- [ ] **Step 1: Tests (failing)** for `acceptDecision` (all five outcomes) and `openStakeFor` (one open house bet of 20 + one accepted challenge 10/30 on the matchup → `{ count: 2, stake: 60 }`; bets on another matchup ignored; resolved bets ignored).

- [ ] **Step 2: Implement** service functions and helpers as specified; `available(player)` already exists and is reused for both balance checks.

- [ ] **Step 3: Rules** — inside `match /bets/{betId}`, replace the single create rule with house-or-challenge and extend update:

```
      function isHouse() { return request.resource.data.kind == 'house'; }
      function isChallenge() { return request.resource.data.kind == 'challenge'; }

      allow create: if canAccess()
            && request.resource.data.matchupKey is string
            && request.resource.data.matchupKey == currentMatch().matchupKey
            && request.resource.data.placedAt == request.time
            && request.resource.data.void == false
            && request.resource.data.outcome.test is string
            && (
              (isHouse()
                && request.resource.data.bettor is string
                && request.resource.data.stake is number && request.resource.data.stake > 0
                && request.resource.data.odds is number && request.resource.data.odds >= 1
                && currentMatch().firstGoalAt == null
                && currentMatch().offer != null)
              ||
              (isChallenge()
                && request.resource.data.challenger is string
                && (request.resource.data.opponent == null || request.resource.data.opponent is string)
                && request.resource.data.challengerStake is number && request.resource.data.challengerStake > 0
                && request.resource.data.opponentStake is number && request.resource.data.opponentStake > 0
                && request.resource.data.acceptedBy == null
                && request.resource.data.acceptedAt == null)
            );

      allow update: if canAccess() && (
            // undo / withdraw: only voiding, and a challenge only while unaccepted
            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['void'])
              && request.resource.data.void == true
              && (resource.data.kind != 'challenge' || resource.data.acceptedBy == null))
            ||
            // accept: once, not withdrawn, by the named opponent (or anyone), not the challenger
            (resource.data.kind == 'challenge'
              && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['acceptedBy', 'acceptedAt'])
              && resource.data.acceptedBy == null
              && resource.data.void == false
              && request.resource.data.acceptedBy is string
              && request.resource.data.acceptedBy != resource.data.challenger
              && (resource.data.opponent == null || request.resource.data.acceptedBy == resource.data.opponent)
              && request.resource.data.acceptedAt == request.time
              && currentMatch().matchupKey == resource.data.matchupKey)
          );
```

Keep the existing `currentMatch()` helper, `allow get, list` and `allow delete: if false`.

- [ ] **Step 4: Overwrite dialog** — in `sync-controller.js` use `openStakeFor(getBets(), allMatches, current.matchupKey, Date.now())` for the count and sum (text unchanged otherwise).

- [ ] **Step 5:** `npm test`, `npm run build`, rules parse (`npx firebase emulators:exec --only firestore "echo ok"` is not possible while the emulator runs — instead rely on the running emulator's hot reload: check its log for "Rules updated" and no errors). **Commit** `feat(betting): challenge service with transactional accept/withdraw and rules`.

---

### Task 3: Challenge UI and e2e

**Files:**
- Modify: `src/betting/bets-ui.js`
- Modify: `src/styles.css`
- Modify: `e2e/betting.spec.js`

**Behaviour:**
- If `BETTING.challenges` and a shared matchup exists: a "Challenge someone…" button under the house section (secondary button styling like existing neutral buttons). Visible before and after the first goal, hidden once `offer` is null after a submit (the match is over; a new lineup reopens it).
- Challenge form (`showConfirm` with `contentElement`, confirm "Challenge"):
  - Challenger `<select>` (all players, preselected from the remembered bettor), opponent `<select>` ("Anyone" + all players except the challenger).
  - Outcome: test `<select>` (all `OUTCOME_TESTS`, labelled in words: "Win", "Win by …", "Win 5:0", "Goes to 4:4", "Duration over …", "Scores first", "First scorer wins", "Comeback from …"); team `<select>` with the two pair labels when the test has a team; threshold `<select>` when the test has thresholds (durations shown as m:ss); a "claim / against" toggle sets `negate`.
  - Live preview line: `describeOutcome(outcome, label)`.
  - Stakes: "My stake" and "Their stake" number inputs (default 10 / 10), challenger balance shown.
  - On confirm: `placeChallenge`; errors mapped like house bets; success toast with tap-to-undo (`withdrawChallenge`) within `undoWindowMs`.
- Feed lines for challenges (today, this matchup): "Simon → anyone: Not: Goes to 4:4 · 10 vs 30" with
  - **Accept** button when unaccepted and not withdrawn: opens a sheet with acceptor `<select>` (only the named opponent if set; otherwise all players except the challenger), shows the acceptor's balance and "You win 40 if it doesn't happen"; confirm → `acceptChallenge`; errors: `taken:<n>` → "Already taken by <n>", `withdrawn` → "Challenge was withdrawn", `not-you`, `own`, `insufficient`, `closed` → readable toasts.
  - **Withdraw** button (small, secondary) while unaccepted.
  - After acceptance: "accepted by Peter"; after resolution: "Simon won 40" / "Peter won 40" / "cancelled" / "refunded".
- E2E (extend `e2e/betting.spec.js`, run `--workers=1`): phone A creates an "anyone" challenge after the first goal; phones B and C (third context) both click Accept and confirm concurrently → exactly one success; the other gets "Already taken by"; feed on all phones shows "accepted by". A second challenge is withdrawn by A and its Accept button disappears on B.

- [ ] **Step 1:** Implement UI. **Step 2:** E2E → pass. **Step 3:** `npm test`, `npm run build`. **Commit** `feat(betting): challenge form, accept/withdraw in the feed`.
