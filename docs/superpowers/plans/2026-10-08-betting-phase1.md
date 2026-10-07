# Betting Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shared live view of the current match on every phone, house winner bets in golden footballs with model-based odds closing at the first goal, derived balances, and a "Golden footballs" leaderboard option.

**Architecture:** A new `src/betting/` package. Pure modules (identity, model, ledger) carry all logic and are unit-tested in Node. Two Firestore services (`meta/currentMatch`, `bets`) follow the existing `onSnapshot → in-memory → CustomEvent` pattern. The core match form only gains window-event dispatches (`live-started`, `live-goal`, `live-ended`); no core logic changes. Offline script `admin/model/fit.mjs` fits the beta-binomial race model from a local Firestore backup and writes `src/betting/model-params.json`.

**Tech Stack:** Vanilla JS ES modules, Vite, Firebase JS SDK v12 (Firestore), Node test scripts (`test/*.test.js`, no framework), Playwright e2e against the Firebase emulator.

**Spec:** `docs/superpowers/specs/2026-10-08-betting-design.md` (phase 1 of 4; phases 2–3 get their own plans).

## Global Constraints

- Core logic (live mode, suggest, ELO, match logging) must not change; match-form-handler edits are limited to event dispatches.
- Every betting feature is gated by `BETTING.enabled` (and sub-switches) in `src/betting/betting-config.js`; with `enabled: false` nothing renders, subscribes or writes.
- Currency name: "golden footballs"; never real money, never ELO.
- A team is its sorted pair; `matchupKey` = the two team keys sorted, joined with `|`. Side and positions are never part of any key.
- `placedAt`, `firstGoalAt`, `liveStartedAt`, `updatedAt` are `serverTimestamp()`; never client clocks.
- Odds = `clamp((1/P) × (1 − margin), oddsClamp)`, `margin = 0.05`, `oddsClamp = [1.05, 10]`, rounded to 2 decimals.
- `dailyAllowance = 100`, `undoWindowMs = 5000`.
- A device publishes to `meta/currentMatch` only after a user interaction on that device (`navigator.userActivation.hasBeenActive`), never on page load.
- Tests follow the existing style: plain Node script with `assertEq`, registered in `package.json` and in the `test` chain.
- Admin key and backups stay local: `~/.config/kickelo/firebase-admin-key.json`, `admin/backups/` (gitignored). Admin scripts only read Firestore.
- Commits: short conventional messages (`feat(betting): …`); no `Co-Authored-By` line (user's CLAUDE.md).

**Spec adjustment (decided while planning, reflected in the spec in Task 0):** cancelling live mode does **not** refund bets and needs no extra confirmation: bets carry over to the next match with the same lineup (typically the restart) and are refunded at day end otherwise. The overwrite confirmation applies only to lineup changes.

## Review Focus

1. **Lineup re-selected after a submit with the same pairs** — the form is cleared on submit, so re-selecting the same four players must publish a fresh offer (house must reopen) even though the matchupKey is unchanged. Test in Task 5 (`shouldPublishLineup` with `offer: null`).
2. **Goal removed from the timeline back to 0 goals** — `firstGoalAt` must stay set (betting does not reopen). Test in Task 5 (`goalUpdate` on empty log keeps no `firstGoalAt` reset).
3. **Matches logged without live mode** — house bets on them must be refunded, not lost or paid. Test in Task 4.
4. **Match edited after the fact (teams changed or winner swapped) or soft-deleted** — payouts must follow the edit. Test in Task 4.
5. **Season ELO vs fitted all-time ELO** — the client prices with season-cache ELO; at season start gaps are small and odds near even. Expected behaviour, documented in the report; pinned by a Task 2 test that `gap = 0` gives `P = σ(c)` ≈ 0.5.

---

### Task 0: Spec adjustment and package scaffolding

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-betting-design.md` (Overwrite protection paragraph)
- Create: `src/betting/betting-config.js`
- Modify: `src/firebase-service.js` (export `runTransaction`, `serverTimestamp`)
- Modify: `package.json` (add `test:betting`)
- Create: `test/betting.test.js`

**Interfaces:**
- Produces: `BETTING` config object (shape below); `runTransaction`, `serverTimestamp` re-exported from `src/firebase-service.js`.

- [ ] **Step 1: Update the spec paragraph**

In the spec's "Overwrite protection" paragraph replace "changes the pairs (player selection, Suggest) or cancels live mode" with "changes the pairs (player selection, Suggest, tournament prefill)" and append:
"Cancelling live mode never refunds bets: they carry over to the next match with the same lineup (usually the restart) and are refunded at day end otherwise, so cancel needs no extra confirmation."

- [ ] **Step 2: Create the config**

```js
// src/betting/betting-config.js
// Golden-football betting switches and tuning. Code-level, like sound-config.js.
export const BETTING = {
  enabled: true,            // master switch: nothing betting-related renders, syncs or writes when false
  liveSync: true,           // publish/subscribe meta/currentMatch (shared live view); house bets need it
  houseWinner: true,
  houseProps: { enabled: true, count: 2, maxRatio: 3, minSamples: 30 },   // phase 2
  challenges: true,                                                       // phase 3
  margin: 0.05,
  oddsClamp: [1.05, 10],
  dailyAllowance: 100,
  undoWindowMs: 5000,
  stakeChips: [5, 10, 25],
};

/** House bets need the shared live state for the first-goal cutoff. */
export function houseBetsActive(cfg = BETTING) {
  return cfg.enabled && cfg.liveSync && cfg.houseWinner;
}
```

- [ ] **Step 3: Re-export transaction helpers**

In `src/firebase-service.js` add `runTransaction` and `serverTimestamp` to the `firebase/firestore` import list and to the `export { … }` block.

- [ ] **Step 4: Create the test file skeleton and script**

```js
// test/betting.test.js
// Betting: pure-logic tests (no browser, no Firestore).
import { BETTING, houseBetsActive } from '../src/betting/betting-config.js';

let passed = 0;
let failed = 0;

function assertEq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`  ✗ ${message}: expected ${e}, got ${a}`);
    failed++;
  } else {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

function assertClose(actual, expected, tol, message) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) { console.error(`  ✗ ${message}: expected ${expected}±${tol}, got ${actual}`); failed++; }
  else { console.log(`  ✓ ${message}`); passed++; }
}

console.log('\n=== config ===');
assertEq(houseBetsActive(BETTING), true, 'house bets active by default');
assertEq(houseBetsActive({ ...BETTING, liveSync: false }), false, 'house bets need liveSync');
assertEq(houseBetsActive({ ...BETTING, enabled: false }), false, 'master switch disables house bets');

// --- further sections are appended by later tasks above this line ---

console.log('\n' + '='.repeat(60));
console.log(`Betting Tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
```

In `package.json` add `"test:betting": "node test/betting.test.js"` and append `&& npm run test:betting` to the `test` script.

Later tasks insert their sections **above** the `// --- further sections` marker and add their imports at the top.

- [ ] **Step 5: Run and commit**

Run: `npm run test:betting` → `Betting Tests: 3 passed, 0 failed`. Run `npm run build` → succeeds.

```bash
git add docs/superpowers/specs/2026-10-08-betting-design.md src/betting/betting-config.js src/firebase-service.js package.json test/betting.test.js
git commit -m "feat(betting): config switches, test scaffold, firestore tx exports"
```

---

### Task 1: Matchup identity

**Files:**
- Create: `src/betting/matchup.js`
- Test: `test/betting.test.js`

**Interfaces:**
- Consumes: `teamKey(players)` from `src/teams/team-identity.js`.
- Produces:
  - `matchupKey(red: string[], blue: string[]) → string` (`''` unless both teams have 2 players)
  - `isFullLineup(red, blue) → boolean` (2 distinct players per team, 4 distinct overall)
  - `sameTeam(a: string[], b: string[]) → boolean`

- [ ] **Step 1: Write the failing tests** (insert above the marker; add import at top)

```js
import { matchupKey, isFullLineup, sameTeam } from '../src/betting/matchup.js';

console.log('\n=== matchup identity ===');
{
  const k = matchupKey(['Marc', 'Manuel'], ['Tobi', 'Roman']);
  assertEq(k, 'Manuel::Marc|Roman::Tobi', 'sorted pairs, sorted teams');
  assertEq(matchupKey(['Manuel', 'Marc'], ['Roman', 'Tobi']), k, 'position swap within team -> same key');
  assertEq(matchupKey(['Tobi', 'Roman'], ['Marc', 'Manuel']), k, 'red/blue side swap -> same key');
  assertEq(matchupKey(['Marc'], ['Tobi', 'Roman']), '', 'incomplete lineup -> empty key');
  assertEq(isFullLineup(['A', 'B'], ['C', 'D']), true, 'full 2v2');
  assertEq(isFullLineup(['A', 'B'], ['B', 'D']), false, 'player on both sides -> not full');
  assertEq(isFullLineup(['A', ''], ['C', 'D']), false, 'empty slot -> not full');
  assertEq(sameTeam(['A', 'B'], ['B', 'A']), true, 'sameTeam ignores order');
  assertEq(sameTeam(['A', 'B'], ['A', 'C']), false, 'sameTeam detects difference');
}
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:betting` → FAIL (`Cannot find module '../src/betting/matchup.js'`).

- [ ] **Step 3: Implement**

```js
// src/betting/matchup.js
// Pure matchup identity. A team is its sorted pair (teamKey); a matchup is the
// two team keys sorted and '|'-joined. Side (red/blue) and positions never matter,
// so swaps never touch bets.
import { teamKey } from '../teams/team-identity.js';

function clean(players = []) {
  return players.map((p) => (p || '').trim()).filter(Boolean);
}

export function isFullLineup(red = [], blue = []) {
  const r = clean(red);
  const b = clean(blue);
  return r.length === 2 && b.length === 2 && new Set([...r, ...b]).size === 4;
}

export function matchupKey(red = [], blue = []) {
  if (!isFullLineup(red, blue)) return '';
  return [teamKey(red), teamKey(blue)].sort().join('|');
}

export function sameTeam(a = [], b = []) {
  return teamKey(a) === teamKey(b);
}
```

- [ ] **Step 4: Run** `npm run test:betting` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/betting/matchup.js test/betting.test.js
git commit -m "feat(betting): side- and position-independent matchup keys"
```

---

### Task 2: Race-to-5 model and odds

**Files:**
- Create: `src/betting/model.js`
- Create: `src/betting/model-params.json` (placeholder values replaced by Task 3's fit)
- Test: `test/betting.test.js`

**Interfaces:**
- Produces:
  - `goalProbability(gap: number, params) → number` — mean per-goal probability μ for the team with ELO advantage `gap` (that team's average minus opponent's).
  - `scorelineDistribution(gap, params) → { win: number[5], lose: number[5] }` — `win[k]` = P(team wins 5:k), `lose[k]` = P(team loses k:5); sums to 1.
  - `winProbability(gap, params) → number`
  - `toOdds(p: number, cfg = BETTING) → number`
  - `logLikelihood(matches: {gap, goalsFor, goalsAgainst}[], params) → number` (used by Task 3)
  - `params` shape: `{ s: number, c: number, kappa: number }` (`kappa = Infinity` → plain binomial).

Math: per match `p ~ Beta(μκ, (1−μ)κ)`, `μ = 1 / (1 + 10^(−(gap/s + c)))`.
`P(win 5:k) = C(4+k, k) · B(α+5, β+k) / B(α, β)`, `P(lose k:5) = C(4+k, k) · B(α+k, β+5) / B(α, β)`.

- [ ] **Step 1: Write the failing tests**

```js
import { goalProbability, scorelineDistribution, winProbability, toOdds, logLikelihood } from '../src/betting/model.js';

console.log('\n=== race-to-5 model ===');
{
  const P = { s: 1200, c: 0, kappa: Infinity };
  const d = scorelineDistribution(0, P);
  const total = [...d.win, ...d.lose].reduce((a, b) => a + b, 0);
  assertClose(total, 1, 1e-9, 'binomial scoreline distribution sums to 1');
  assertClose(winProbability(0, P), 0.5, 1e-9, 'gap 0, no bias -> 0.5');
  assertClose(d.win[0], Math.pow(0.5, 5), 1e-12, 'P(5:0) at p=0.5 is 1/32');
  assertClose(winProbability(200, P) + winProbability(-200, P), 1, 1e-9, 'symmetry: P(gap)+P(-gap)=1');
  assertEq(winProbability(200, P) > winProbability(100, P), true, 'monotone in gap');

  const B = { s: 1200, c: 0, kappa: 20 };
  const db = scorelineDistribution(150, B);
  assertClose([...db.win, ...db.lose].reduce((a, b) => a + b, 0), 1, 1e-9, 'beta-binomial sums to 1');
  const lopsidedBin = scorelineDistribution(150, { ...B, kappa: Infinity });
  assertEq(db.win[0] + db.lose[0] > lopsidedBin.win[0] + lopsidedBin.lose[0], true, 'finite kappa fattens 5:0 tails');
  assertClose(scorelineDistribution(150, { ...B, kappa: 1e7 }).win[2], lopsidedBin.win[2], 1e-5, 'kappa -> inf approaches binomial');

  assertClose(goalProbability(0, { s: 1200, c: 0.02, kappa: Infinity }), 1 / (1 + Math.pow(10, -0.02)), 1e-12, 'gap 0 -> sigma(c)');

  assertEq(toOdds(0.5), 1.9, 'odds at 0.5 with 5% margin');
  assertEq(toOdds(0.99), 1.05, 'odds clamped low');
  assertEq(toOdds(0.01), 10, 'odds clamped high');

  const ll = logLikelihood([{ gap: 0, goalsFor: 5, goalsAgainst: 0 }], P);
  assertClose(ll, Math.log(1 / 32), 1e-9, 'log-likelihood of a single 5:0 at p=0.5');
}
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// src/betting/model.js
// Beta-binomial race-to-5 model. Each goal goes to "our" team with probability p,
// p ~ Beta(mu*kappa, (1-mu)*kappa) per match, mu = 1/(1+10^-(gap/s + c)).
// kappa = Infinity is the plain binomial (goals independent).
import { MAX_GOALS } from '../constants.js';
import { BETTING } from './betting-config.js';

const N = MAX_GOALS; // race to 5

// Lanczos approximation of log-gamma (g=7, n=9), accurate to ~1e-15.
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function logGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const logBeta = (a, b) => logGamma(a) + logGamma(b) - logGamma(a + b);

function logChoose(n, k) {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

export function goalProbability(gap, { s, c }) {
  return 1 / (1 + Math.pow(10, -(gap / s + c)));
}

/** P of every final scoreline, from the perspective of the team with advantage `gap`. */
export function scorelineDistribution(gap, params) {
  const mu = goalProbability(gap, params);
  const win = [];
  const lose = [];
  for (let k = 0; k < N; k++) {
    const lc = logChoose(N - 1 + k, k);
    if (!Number.isFinite(params.kappa)) {
      win.push(Math.exp(lc + N * Math.log(mu) + k * Math.log(1 - mu)));
      lose.push(Math.exp(lc + k * Math.log(mu) + N * Math.log(1 - mu)));
    } else {
      const a = mu * params.kappa;
      const b = (1 - mu) * params.kappa;
      const lb = logBeta(a, b);
      win.push(Math.exp(lc + logBeta(a + N, b + k) - lb));
      lose.push(Math.exp(lc + logBeta(a + k, b + N) - lb));
    }
  }
  return { win, lose };
}

export function winProbability(gap, params) {
  return scorelineDistribution(gap, params).win.reduce((x, y) => x + y, 0);
}

export function toOdds(p, cfg = BETTING) {
  const [lo, hi] = cfg.oddsClamp;
  const raw = (1 / p) * (1 - cfg.margin);
  return Math.round(Math.min(hi, Math.max(lo, raw)) * 100) / 100;
}

/** Sum of log P(observed final score) over matches; goalsFor/Against from the gap-holder's view. */
export function logLikelihood(matches, params) {
  let ll = 0;
  for (const m of matches) {
    const d = scorelineDistribution(m.gap, params);
    const p = m.goalsFor === N ? d.win[m.goalsAgainst] : d.lose[m.goalsFor];
    ll += Math.log(Math.max(p, 1e-300));
  }
  return ll;
}
```

```json
{ "s": 1200, "c": 0.02, "kappa": 1000000, "fittedAt": null, "n": 0, "note": "placeholder until admin/model/fit.mjs runs" }
```

- [ ] **Step 4: Run** `npm run test:betting` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/betting/model.js src/betting/model-params.json test/betting.test.js
git commit -m "feat(betting): beta-binomial race-to-5 model and odds"
```

---

### Task 3: Offline fit and backtest of the winner model

**Files:**
- Create: `admin/model/fit.mjs`
- Create (generated, committed): `src/betting/model-params.json`, `admin/model/report.md`

**Interfaces:**
- Consumes: `computeAllPlayerStats(matches)` from `src/player-stats-batch.js` (matches sorted newest first, `timestamp` in ms); `logLikelihood`, `winProbability`, `scorelineDistribution` from Task 2.
- Produces: `src/betting/model-params.json` with `{ s, c, kappa, fittedAt, n, trainN, testN }`.

Run with: `node admin/model/fit.mjs [path/to/backup.json]` (defaults to newest `admin/backups/*.json`). Reads only a local file; never touches Firestore.

- [ ] **Step 1: Write the script**

```js
// admin/model/fit.mjs
// Fit the beta-binomial race-to-5 model (s, c, kappa) on a local Firestore backup,
// backtest on the last 3 months, write src/betting/model-params.json + admin/model/report.md.
// Read-only: works on a backup JSON from admin/backup-database.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAllPlayerStats } from '../../src/player-stats-batch.js';
import { logLikelihood, winProbability, scorelineDistribution } from '../../src/betting/model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const backupPath = process.argv[2] || (() => {
  const dir = path.join(ROOT, 'admin/backups');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return path.join(dir, files[files.length - 1]);
})();

const toMs = (t) => (t && typeof t === 'object' ? t._seconds * 1000 + Math.floor((t._nanoseconds || 0) / 1e6)
  : typeof t === 'number' ? (t < 1e11 ? t * 1000 : t) : null);

const raw = JSON.parse(fs.readFileSync(backupPath, 'utf8')).matches;
const matches = Object.entries(raw)
  .map(([id, m]) => ({ id, ...m, timestamp: toMs(m.timestamp) }))
  .filter((m) => !m.deleted && m.ranked !== false && m.timestamp
    && Array.isArray(m.teamA) && Array.isArray(m.teamB) && m.teamA.length === 2 && m.teamB.length === 2
    && Number.isInteger(m.goalsA) && Number.isInteger(m.goalsB)
    && Math.max(m.goalsA, m.goalsB) === 5 && Math.min(m.goalsA, m.goalsB) < 5)
  .sort((a, b) => b.timestamp - a.timestamp); // newest first, as computeAllPlayerStats expects

// Pre-match ELO = last trajectory point strictly before the match, else 1500.
const stats = computeAllPlayerStats(matches);
function preElo(player, ts) {
  const traj = stats[player]?.eloTrajectory || [];
  let elo = 1500;
  for (const p of traj) { if (p.timestamp < ts) elo = p.elo; else break; }
  return elo;
}
const rows = matches.slice().reverse().map((m) => {
  const a = (preElo(m.teamA[0], m.timestamp) + preElo(m.teamA[1], m.timestamp)) / 2;
  const b = (preElo(m.teamB[0], m.timestamp) + preElo(m.teamB[1], m.timestamp)) / 2;
  return { gap: a - b, goalsFor: m.goalsA, goalsAgainst: m.goalsB, timestamp: m.timestamp };
});
const burnIn = Math.floor(rows.length * 0.1);
const usable = rows.slice(burnIn);
const cutoff = usable[usable.length - 1].timestamp - 90 * 24 * 3600 * 1000;
const train = usable.filter((r) => r.timestamp < cutoff);
const test = usable.filter((r) => r.timestamp >= cutoff);

// Nelder-Mead on theta = [log s, c, log kappa].
const unpack = ([ls, c, lk]) => ({ s: Math.exp(ls), c, kappa: Math.exp(lk) });
const objective = (data) => (theta) => -logLikelihood(data, unpack(theta));
function nelderMead(f, x0, step = [0.3, 0.05, 1], iters = 400) {
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i] : v)))]
    .map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iters; it++) {
    simplex.sort((a, b) => a.f - b.f);
    const n = x0.length;
    const centroid = x0.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const worst = simplex[n];
    const at = (t) => centroid.map((c, j) => c + t * (worst.x[j] - c));
    const r = { x: at(-1) }; r.f = f(r.x);
    if (r.f < simplex[0].f) {
      const e = { x: at(-2) }; e.f = f(e.x);
      simplex[n] = e.f < r.f ? e : r;
    } else if (r.f < simplex[n - 1].f) {
      simplex[n] = r;
    } else {
      const k = { x: at(0.5) }; k.f = f(k.x);
      if (k.f < worst.f) simplex[n] = k;
      else simplex = simplex.map((p, i) => (i === 0 ? p : (() => {
        const x = p.x.map((v, j) => simplex[0].x[j] + 0.5 * (v - simplex[0].x[j]));
        return { x, f: f(x) };
      })()));
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return simplex[0];
}

const x0 = [Math.log(1200), 0, Math.log(30)];
const fitTrain = unpack(nelderMead(objective(train), x0).x);
const fitAll = unpack(nelderMead(objective(usable), x0).x);

// Backtest on held-out months: Brier + log-loss for P(red wins), calibration table.
function evaluate(params, data) {
  let brier = 0; let logloss = 0;
  const bins = Array.from({ length: 5 }, () => ({ n: 0, p: 0, o: 0 }));
  for (const r of data) {
    const p = winProbability(r.gap, params);
    const y = r.goalsFor === 5 ? 1 : 0;
    brier += (p - y) ** 2;
    logloss -= Math.log(y ? p : 1 - p);
    const pf = Math.max(p, 1 - p);
    const b = bins[Math.min(4, Math.floor((pf - 0.5) * 10))];
    b.n++; b.p += pf; b.o += (p >= 0.5 ? y : 1 - y);
  }
  return { brier: brier / data.length, logloss: logloss / data.length, bins };
}
const ev = evaluate(fitTrain, test);
const evBinomial = evaluate({ ...fitTrain, kappa: Infinity }, test);

function marginTable(params, data) {
  const pred = [0, 0, 0, 0, 0]; const obs = [0, 0, 0, 0, 0];
  for (const r of data) {
    const d = scorelineDistribution(r.gap, params);
    for (let k = 0; k < 5; k++) pred[5 - k - 1] += d.win[k] + d.lose[k];
    obs[5 - Math.min(r.goalsFor, r.goalsAgainst) - 1]++;
  }
  return pred.map((p, i) => `| ${i + 1} | ${(p / data.length).toFixed(3)} | ${(obs[i] / data.length).toFixed(3)} |`).join('\n');
}

const out = { ...fitAll, fittedAt: new Date().toISOString(), n: usable.length, trainN: train.length, testN: test.length };
fs.writeFileSync(path.join(ROOT, 'src/betting/model-params.json'), JSON.stringify(out, null, 2) + '\n');

const report = `# Winner model report

Generated ${out.fittedAt} from \`${path.basename(backupPath)}\`.
Matches used: ${usable.length} (burn-in ${burnIn} dropped), train ${train.length}, test (last 90 days) ${test.length}.

## Parameters (fit on all usable matches; shipped)
s = ${fitAll.s.toFixed(1)}, c = ${fitAll.c.toFixed(4)}, kappa = ${fitAll.kappa.toFixed(2)}

## Backtest (fit on train, evaluated on test), P(red wins)
| model | Brier | log-loss |
|---|---|---|
| beta-binomial | ${ev.brier.toFixed(4)} | ${ev.logloss.toFixed(4)} |
| binomial (kappa=inf) | ${evBinomial.brier.toFixed(4)} | ${evBinomial.logloss.toFixed(4)} |

### Calibration (favourite's win probability)
| bin | n | mean predicted | observed |
|---|---|---|---|
${ev.bins.map((b, i) => `| ${(0.5 + i / 10).toFixed(1)}–${(0.6 + i / 10).toFixed(1)} | ${b.n} | ${b.n ? (b.p / b.n).toFixed(3) : '-'} | ${b.n ? (b.o / b.n).toFixed(3) : '-'} |`).join('\n')}

### Margin distribution on test (predicted vs observed)
| margin | predicted | observed |
|---|---|---|
${marginTable(fitTrain, test)}

Note: the client prices with season-cache ELO; at a season start gaps are small and odds near even.
`;
fs.mkdirSync(path.join(ROOT, 'admin/model'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'admin/model/report.md'), report);
console.log(report);
```

- [ ] **Step 2: Run the fit**

Run: `node admin/model/fit.mjs`
Expected: report printed; `s` in the range 800–2000, `kappa` finite (roughly 5–200); beta-binomial log-loss ≤ binomial log-loss; calibration bins within ~0.05 of observed. If `computeAllPlayerStats` fails on import in Node (browser-only import), stop and report the error instead of working around it.

- [ ] **Step 3: Sanity-test the shipped params**

Append to `test/betting.test.js`:

```js
import params from '../src/betting/model-params.json' with { type: 'json' };
console.log('\n=== shipped model params ===');
assertEq(Number.isFinite(params.s) && params.s > 0, true, 'fitted s is positive');
assertEq(params.kappa > 0, true, 'fitted kappa is positive');
assertEq(Math.abs(winProbability(0, params) - 0.5) < 0.05, true, 'gap 0 is near even (season start behaviour)');
assertEq(winProbability(300, params) > 0.7, true, 'a 300-point favourite is a clear favourite');
```

Run: `npm run test:betting` → all pass.

- [ ] **Step 4: Commit**

```bash
git add admin/model/fit.mjs admin/model/report.md src/betting/model-params.json test/betting.test.js
git commit -m "feat(betting): offline fit + backtest of the winner model"
```

---

### Task 4: Ledger — resolution, cutoffs, balances

**Files:**
- Create: `src/betting/ledger.js`
- Test: `test/betting.test.js`

**Interfaces:**
- Consumes: `matchupKey` (Task 1).
- Produces:
  - `dayKey(ms) → number` (local midnight, same as `getDayKey` in player-stats-batch)
  - `firstGoalAt(match) → number | null` (`timestamp − matchDuration + goalLog[0].timestamp`; null without goalLog/duration)
  - `resolveHouseBet(bet, matches, now) → { status: 'open'|'won'|'lost'|'refunded', matchId: string|null, payout: number }`
    - `bet`: `{ kind: 'house', matchupKey, placedAt: ms, outcome: { test: 'winner', team: string[] }, bettor, stake, odds, void }`
    - `matches`: app shape (`timestamp` ms, `teamA`, `teamB`, `winner`, `goalLog?`, `matchDuration?`, `deleted?`)
    - `payout` is what the bettor gets back (0 lost, `stake` refunded, `round(stake × odds)` won, 0 open).
  - `computeBalances(bets, matches, now, cfg = BETTING) → Map<player, { balance, todayDelta, open }>`
  - `checkBet(bet, context) → { ok: true } | { ok: false, reason }` (always ok in phase 1)

Rules recap: a house bet belongs to the first non-deleted match with the same matchupKey, `timestamp > placedAt`, same local day. It counts only if `placedAt < firstGoalAt(match)`; matches without goal log → refund. No match by the end of `placedAt`'s day → refund; before that → open. Void bets are ignored entirely (no stake, no allowance).

- [ ] **Step 1: Write the failing tests**

```js
import { dayKey, firstGoalAt, resolveHouseBet, computeBalances, checkBet } from '../src/betting/ledger.js';

console.log('\n=== ledger ===');
{
  const day = new Date(2026, 9, 8, 12, 0, 0).getTime();
  const red = ['Manuel', 'Marc']; const blue = ['Roman', 'Tobi'];
  const key = 'Manuel::Marc|Roman::Tobi';
  const live = (id, ts, winner, extra = {}) => ({
    id, timestamp: ts, teamA: red, teamB: blue, winner, goalsA: winner === 'A' ? 5 : 2, goalsB: winner === 'A' ? 2 : 5,
    matchDuration: 240000, goalLog: [{ team: 'red', timestamp: 30000 }], ...extra,
  });
  const bet = (placedAt, extra = {}) => ({
    kind: 'house', matchupKey: key, placedAt, bettor: 'Simon', stake: 20, odds: 1.9,
    outcome: { test: 'winner', team: red }, void: false, ...extra,
  });

  const m1 = live('m1', day + 300000, 'A'); // started day+60s, first goal at day+90s
  assertEq(firstGoalAt(m1), day + 300000 - 240000 + 30000, 'firstGoalAt from server timestamp, duration, offset');
  assertEq(firstGoalAt({ ...m1, goalLog: undefined }), null, 'no goal log -> null');

  assertEq(resolveHouseBet(bet(day), [m1], day + 400000), { status: 'won', matchId: 'm1', payout: 38 }, 'bet before first goal wins');
  assertEq(resolveHouseBet(bet(day, { outcome: { test: 'winner', team: blue } }), [m1], day + 400000).status, 'lost', 'losing side loses');
  assertEq(resolveHouseBet(bet(day + 100000), [m1], day + 400000), { status: 'refunded', matchId: 'm1', payout: 20 }, 'bet after first goal refunded');
  assertEq(resolveHouseBet(bet(day), [{ ...m1, goalLog: undefined, matchDuration: undefined }], day + 400000).status, 'refunded', 'non-live match -> refund');
  assertEq(resolveHouseBet(bet(day), [], day + 1000).status, 'open', 'no match yet, same day -> open');
  assertEq(resolveHouseBet(bet(day), [], day + 24 * 3600 * 1000).status, 'refunded', 'no match by day end -> refund');
  assertEq(resolveHouseBet(bet(day), [{ ...m1, deleted: true }], day + 400000).status, 'open', 'deleted match ignored');
  assertEq(resolveHouseBet(bet(day), [{ ...m1, winner: 'B' }], day + 400000).status, 'lost', 'edited winner flips result');
  const swapped = { ...m1, teamA: blue, teamB: red, winner: 'B' };
  assertEq(resolveHouseBet(bet(day), [swapped], day + 400000).status, 'won', 'sides swapped in logged match: bet follows the pair');

  // Repeated lineup: bet placed between two matches goes to the second.
  const m2 = live('m2', day + 900000, 'B');
  assertEq(resolveHouseBet(bet(day + 500000), [m2, m1], day + 1000000).matchId, 'm2', 'bet between repeats -> next match');
  // Cancelled live game then restart: bet placed before the cancelled game's goal counts for the restart.
  assertEq(resolveHouseBet(bet(day), [m2], day + 1000000).status, 'lost', 'carry-over to restart counts');

  // Balances: allowance per day with a non-void bet, stakes, payouts, refunds.
  const bets = [
    bet(day),                                   // won -> +38
    bet(day + 100000),                          // refunded -> net 0
    bet(day, { bettor: 'Marc', stake: 10, outcome: { test: 'winner', team: blue } }), // lost
    bet(day, { bettor: 'Peter', void: true }),  // ignored entirely
  ];
  const bal = computeBalances(bets, [m1], day + 400000);
  assertEq(bal.get('Simon').balance, 100 - 20 + 38 - 20 + 20, 'Simon: allowance, win, refund');
  assertEq(bal.get('Marc').balance, 90, 'Marc: allowance minus lost stake');
  assertEq(bal.has('Peter'), false, 'void-only bettor has no wallet');
  assertEq(bal.get('Simon').todayDelta, 18, 'todayDelta excludes allowance: +18 net from bets');
  const open = computeBalances([bet(day)], [], day + 1000);
  assertEq(open.get('Simon'), { balance: 80, todayDelta: -20, open: 1 }, 'open bet: stake held');
  const twoDays = computeBalances([bet(day), bet(day + 24 * 3600 * 1000)], [], day + 3 * 24 * 3600 * 1000);
  assertEq(twoDays.get('Simon').balance, 200, 'two days of allowance, both refunded');
  assertEq(dayKey(day + 3600 * 1000), dayKey(day), 'dayKey groups by local day');

  assertEq(checkBet(bet(day), {}), { ok: true }, 'checkBet allows everything for now');
}
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// src/betting/ledger.js
// Derived betting ledger: nothing is ever "settled" in Firestore. Results and
// balances are recomputed from bets + matches, so match edits/deletes flow through.
import { BETTING } from './betting-config.js';
import { matchupKey } from './matchup.js';
import { teamKey } from '../teams/team-identity.js';

export function dayKey(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function firstGoalAt(match) {
  if (!Array.isArray(match.goalLog) || match.goalLog.length === 0) return null;
  if (typeof match.matchDuration !== 'number' || typeof match.timestamp !== 'number') return null;
  return match.timestamp - match.matchDuration + match.goalLog[0].timestamp;
}

function findMatch(bet, matches) {
  const day = dayKey(bet.placedAt);
  let best = null;
  for (const m of matches) {
    if (m.deleted || typeof m.timestamp !== 'number') continue;
    if (m.timestamp <= bet.placedAt || dayKey(m.timestamp) !== day) continue;
    if (matchupKey(m.teamA, m.teamB) !== bet.matchupKey) continue;
    if (!best || m.timestamp < best.timestamp) best = m;
  }
  return best;
}

function winnerPair(match) {
  return match.winner === 'A' ? match.teamA : match.teamB;
}

export function resolveHouseBet(bet, matches, now) {
  const match = findMatch(bet, matches);
  if (!match) {
    const dayOver = now >= dayKey(bet.placedAt) + 24 * 3600 * 1000;
    return dayOver
      ? { status: 'refunded', matchId: null, payout: bet.stake }
      : { status: 'open', matchId: null, payout: 0 };
  }
  const fg = firstGoalAt(match);
  if (fg === null || bet.placedAt >= fg) return { status: 'refunded', matchId: match.id, payout: bet.stake };
  const won = teamKey(winnerPair(match)) === teamKey(bet.outcome.team);
  return won
    ? { status: 'won', matchId: match.id, payout: Math.round(bet.stake * bet.odds) }
    : { status: 'lost', matchId: match.id, payout: 0 };
}

export function computeBalances(bets, matches, now, cfg = BETTING) {
  const wallets = new Map();
  const days = new Map();
  const today = dayKey(now);
  for (const bet of bets) {
    if (bet.void || bet.kind !== 'house') continue;
    const w = wallets.get(bet.bettor) || { balance: 0, todayDelta: 0, open: 0 };
    if (!days.has(bet.bettor)) days.set(bet.bettor, new Set());
    days.get(bet.bettor).add(dayKey(bet.placedAt));
    const r = resolveHouseBet(bet, matches, now);
    const net = r.payout - bet.stake;
    w.balance += net;
    if (r.status === 'open') w.open++;
    if (dayKey(bet.placedAt) === today) w.todayDelta += net;
    wallets.set(bet.bettor, w);
  }
  for (const [player, w] of wallets) w.balance += cfg.dailyAllowance * days.get(player).size;
  return wallets;
}

/** House rules hook. "Anything goes" for now. */
export function checkBet(_bet, _context) {
  return { ok: true };
}
```

Note: for an open bet, `payout` is 0 so the stake is held (`net = −stake`).

- [ ] **Step 4: Run** `npm run test:betting` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/betting/ledger.js test/betting.test.js
git commit -m "feat(betting): derived ledger with first-goal cutoff and daily allowance"
```

---

### Task 5: Shared live state — `meta/currentMatch`

**Files:**
- Create: `src/betting/current-match.js` (pure helpers)
- Create: `src/betting/current-match-service.js` (Firestore)
- Modify: `src/match-form-handler.js` (dispatch `live-started`, `live-goal`, `live-ended`)
- Test: `test/betting.test.js`

**Interfaces:**
- Consumes: `matchupKey`, `isFullLineup` (Task 1); `winProbability`, `toOdds` (Task 2); `model-params.json`; `getCachedStats(name)` from `src/stats-cache-service.js` (`eloTrajectory` last point = current season ELO); `teamKey`.
- Produces (pure, `current-match.js`):
  - `buildOffer(red, blue, eloOf: (name) => number, params, cfg) → { winner: { [teamKey]: odds }, gap: number }` — `gap` is red average minus blue average.
  - `shouldPublishLineup(current, red, blue, positions) → 'skip' | 'positions' | 'replace'` — `'skip'` if not a full lineup or identical pairs+positions with a non-null offer; `'positions'` if same matchupKey and offer non-null (side/position swap); `'replace'` otherwise (new pairs or offer null).
  - `needsOverwriteConfirm(current, newKey, openBets: number) → boolean` — true iff `current?.matchupKey` is non-empty, differs from `newKey`, and (`current.liveStartedAt` set or `openBets > 0`).
  - `goalUpdate(current, goalLog) → object` — fields to write for a goal-log change: always `{ goalLog }`; adds `firstGoalAt: 'SERVER'` only if `goalLog.length > 0 && !current?.firstGoalAt`. Never clears `firstGoalAt`.
- Produces (service, `current-match-service.js`):
  - `initializeCurrentMatch() → unsubscribe`; dispatches `current-match-updated` (`detail`: doc data or null).
  - `getCurrentMatch() → object | null` (with `updatedAt` as Firestore Timestamp)
  - `publishLineup({ red, blue, positions }, { expectedUpdatedAtMs }) → Promise<void>`; throws `Error('stale')` if the doc's `updatedAt` changed since `expectedUpdatedAtMs`.
  - `publishPositions({ red, blue, positions }) → Promise<void>`
  - `publishLiveStart()`, `publishGoal(goalLog)`, `publishLiveEnd()` → Promise<void>

- [ ] **Step 1: Write the failing tests (pure helpers)**

```js
import { buildOffer, shouldPublishLineup, needsOverwriteConfirm, goalUpdate } from '../src/betting/current-match.js';

console.log('\n=== current match helpers ===');
{
  const P = { s: 1200, c: 0, kappa: Infinity };
  const elo = { A: 1600, B: 1600, C: 1400, D: 1400 };
  const offer = buildOffer(['A', 'B'], ['C', 'D'], (n) => elo[n], P, { margin: 0.05, oddsClamp: [1.05, 10] });
  assertEq(offer.gap, 200, 'gap = red avg - blue avg');
  assertEq(offer.winner['A::B'] < offer.winner['C::D'], true, 'favourite gets lower odds');
  const flipped = buildOffer(['C', 'D'], ['A', 'B'], (n) => elo[n], P, { margin: 0.05, oddsClamp: [1.05, 10] });
  assertEq([flipped.winner['A::B'], flipped.winner['C::D']], [offer.winner['A::B'], offer.winner['C::D']], 'side swap -> identical odds per team');

  const cur = { matchupKey: 'A::B|C::D', red: ['A', 'B'], blue: ['C', 'D'], positions: { redDefense: 'A', redOffense: 'B', blueDefense: 'C', blueOffense: 'D' }, offer };
  assertEq(shouldPublishLineup(cur, ['A', 'B'], ['C', ''], {}), 'skip', 'incomplete lineup -> skip');
  assertEq(shouldPublishLineup(cur, ['B', 'A'], ['C', 'D'], { redDefense: 'B', redOffense: 'A', blueDefense: 'C', blueOffense: 'D' }), 'positions', 'position swap -> positions only');
  assertEq(shouldPublishLineup(cur, ['C', 'D'], ['A', 'B'], { redDefense: 'C', redOffense: 'D', blueDefense: 'A', blueOffense: 'B' }), 'positions', 'side swap -> positions only');
  assertEq(shouldPublishLineup(cur, ['A', 'B'], ['C', 'D'], cur.positions), 'skip', 'identical -> skip');
  assertEq(shouldPublishLineup({ ...cur, offer: null }, ['A', 'B'], ['C', 'D'], cur.positions), 'replace', 'same pairs after submit (offer null) -> replace, house reopens');
  assertEq(shouldPublishLineup(cur, ['A', 'C'], ['B', 'D'], {}), 'replace', 'new pairs -> replace');
  assertEq(shouldPublishLineup(null, ['A', 'B'], ['C', 'D'], {}), 'replace', 'no current doc -> replace');

  assertEq(needsOverwriteConfirm(cur, 'A::C|B::D', 0), false, 'idle match without bets -> no confirm');
  assertEq(needsOverwriteConfirm(cur, 'A::C|B::D', 2), true, 'open bets -> confirm');
  assertEq(needsOverwriteConfirm({ ...cur, liveStartedAt: 1 }, 'A::C|B::D', 0), true, 'live -> confirm');
  assertEq(needsOverwriteConfirm(cur, cur.matchupKey, 5), false, 'same matchup -> never confirm');
  assertEq(needsOverwriteConfirm(null, 'A::C|B::D', 5), false, 'no current -> no confirm');

  assertEq(goalUpdate({ firstGoalAt: null }, [{ team: 'red', timestamp: 1 }]), { goalLog: [{ team: 'red', timestamp: 1 }], firstGoalAt: 'SERVER' }, 'first goal stamps firstGoalAt');
  assertEq(goalUpdate({ firstGoalAt: 123 }, [{ team: 'red', timestamp: 1 }, { team: 'blue', timestamp: 2 }]), { goalLog: [{ team: 'red', timestamp: 1 }, { team: 'blue', timestamp: 2 }] }, 'later goals do not restamp');
  assertEq(goalUpdate({ firstGoalAt: 123 }, []), { goalLog: [] }, 'removing all goals never reopens betting');
}
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement the pure helpers**

```js
// src/betting/current-match.js
// Pure helpers for the shared meta/currentMatch doc.
import { matchupKey, isFullLineup } from './matchup.js';
import { winProbability, toOdds } from './model.js';
import { teamKey } from '../teams/team-identity.js';

const avg = (pair, eloOf) => (eloOf(pair[0]) + eloOf(pair[1])) / 2;

export function buildOffer(red, blue, eloOf, params, cfg) {
  const gap = avg(red, eloOf) - avg(blue, eloOf);
  const pRed = winProbability(gap, params);
  return {
    winner: { [teamKey(red)]: toOdds(pRed, cfg), [teamKey(blue)]: toOdds(1 - pRed, cfg) },
    gap: Math.round(gap),
  };
}

export function shouldPublishLineup(current, red, blue, positions) {
  if (!isFullLineup(red, blue)) return 'skip';
  const key = matchupKey(red, blue);
  if (!current || current.matchupKey !== key || !current.offer) return 'replace';
  const samePositions = JSON.stringify(current.positions || {}) === JSON.stringify(positions || {});
  const sameSides = teamKey(current.red || []) === teamKey(red);
  return samePositions && sameSides ? 'skip' : 'positions';
}

export function needsOverwriteConfirm(current, newKey, openBets) {
  if (!current?.matchupKey || current.matchupKey === newKey) return false;
  return Boolean(current.liveStartedAt) || openBets > 0;
}

/** Fields for a goal-log change. 'SERVER' is replaced by serverTimestamp() in the service. */
export function goalUpdate(current, goalLog) {
  const update = { goalLog };
  if (goalLog.length > 0 && !current?.firstGoalAt) update.firstGoalAt = 'SERVER';
  return update;
}
```

- [ ] **Step 4: Run** `npm run test:betting` → all pass.

- [ ] **Step 5: Implement the service**

```js
// src/betting/current-match-service.js
// Real-time shared live state in meta/currentMatch. Same pattern as team-service.js.
import { db, doc, onSnapshot, setDoc, updateDoc, runTransaction, serverTimestamp } from '../firebase-service.js';
import { getCachedStats } from '../stats-cache-service.js';
import { STARTING_ELO } from '../constants.js';
import { BETTING } from './betting-config.js';
import { matchupKey } from './matchup.js';
import { buildOffer, goalUpdate } from './current-match.js';
import params from './model-params.json';

const ref = () => doc(db, 'meta', 'currentMatch');
let current = null;
let initialized = false;

export function getCurrentMatch() {
  return current;
}

function eloOf(name) {
  const traj = getCachedStats(name)?.eloTrajectory;
  return traj?.length ? traj[traj.length - 1].elo : STARTING_ELO;
}

export function initializeCurrentMatch() {
  if (initialized || !BETTING.enabled || !BETTING.liveSync) return () => {};
  initialized = true;
  return onSnapshot(ref(), (snap) => {
    current = snap.exists() ? snap.data() : null;
    window.dispatchEvent(new CustomEvent('current-match-updated', { detail: current }));
  }, (error) => console.error('Error listening to meta/currentMatch:', error));
}

export function resetCurrentMatchListener() {
  initialized = false;
}

export async function publishLineup({ red, blue, positions }, { expectedUpdatedAtMs = null } = {}) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref());
    const seenMs = snap.exists() ? snap.data().updatedAt?.toMillis?.() ?? null : null;
    if (expectedUpdatedAtMs !== null && seenMs !== expectedUpdatedAtMs) throw new Error('stale');
    tx.set(ref(), {
      red: [...red].sort(), blue: [...blue].sort(), positions,
      matchupKey: matchupKey(red, blue),
      liveStartedAt: null, goalLog: [], firstGoalAt: null,
      offer: buildOffer(red, blue, eloOf, params, BETTING),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function publishPositions({ red, blue, positions }) {
  await updateDoc(ref(), { red: [...red].sort(), blue: [...blue].sort(), positions, updatedAt: serverTimestamp() });
}

export async function publishLiveStart() {
  await setDoc(ref(), { liveStartedAt: serverTimestamp(), goalLog: [], firstGoalAt: null, updatedAt: serverTimestamp() }, { merge: true });
}

export async function publishGoal(goalLog) {
  const update = goalUpdate(current, goalLog);
  if (update.firstGoalAt === 'SERVER') update.firstGoalAt = serverTimestamp();
  await setDoc(ref(), { ...update, updatedAt: serverTimestamp() }, { merge: true });
}

/** After submit or cancel: live fields cleared; offer cleared so the next lineup publish reprices. */
export async function publishLiveEnd() {
  await setDoc(ref(), { liveStartedAt: null, goalLog: [], firstGoalAt: null, offer: null, updatedAt: serverTimestamp() }, { merge: true });
}
```

Note: `publishLiveEnd` also clears `firstGoalAt`; that is safe because cancelled games' bets are re-checked against the next logged match's own first goal (Task 4), and the rule (Task 6) only needs `firstGoalAt == null` for the *new* game.

- [ ] **Step 6: Dispatch live events from the match form (no logic change)**

In `src/match-form-handler.js`:
- In `setLiveMode`, after `liveMode = enabled;` add:
  ```js
  window.dispatchEvent(new CustomEvent(enabled ? 'live-started' : 'live-ended'));
  ```
- After each `goalLog.push(...)` (lines ~776, ~790) and after `goalLog.splice(idx, 1)` (line ~744) add:
  ```js
  window.dispatchEvent(new CustomEvent('live-goal', { detail: goalLog.slice() }));
  ```

Run: `npm test` → all suites pass (no behaviour change). Run `npm run build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/betting/current-match.js src/betting/current-match-service.js src/match-form-handler.js test/betting.test.js
git commit -m "feat(betting): shared meta/currentMatch with published house offer"
```

---

### Task 6: Bets service and Firestore rules

**Files:**
- Create: `src/betting/bets-service.js`
- Modify: `firestore.rules` (add `bets`)

**Interfaces:**
- Consumes: `getCurrentMatch()` (Task 5), `computeBalances`, `checkBet` (Task 4), `BETTING`.
- Produces:
  - `initializeBets() → unsubscribe`; keeps `allBets` (array, `placedAt` converted to ms; pending server timestamps get `Date.now()` as estimate) and dispatches `bets-updated`.
  - `getBets() → object[]`
  - `getOpenBetsFor(matchupKey) → object[]` — non-void house bets on that matchup whose `resolveHouseBet(...).status === 'open'`.
  - `getBalances() → Map` (from `computeBalances(getBets(), allMatches, Date.now())`)
  - `placeHouseBet({ bettor, stake, team }) → Promise<string>` (bet id); rejects with `Error('closed')` when the rule denies (`permission-denied`), `Error('insufficient')` when stake > balance (client check, today's allowance included if the bettor has no bet today), `Error(reason)` when `checkBet` fails.
  - `undoBet(id) → Promise<void>` (sets `void: true`)

- [ ] **Step 1: Add the rules**

Append inside `match /databases/{database}/documents { … }` of `firestore.rules`:

```
    // --- Rules for the 'bets' collection (golden-football betting) ---
    match /bets/{betId} {
      function currentMatch() {
        return get(/databases/$(database)/documents/meta/currentMatch).data;
      }

      allow get, list: if canAccess();

      // House bets only while the current match has not had its first goal.
      allow create: if canAccess()
            && request.resource.data.kind == 'house'
            && request.resource.data.bettor is string
            && request.resource.data.stake is number
            && request.resource.data.stake > 0
            && request.resource.data.odds is number
            && request.resource.data.odds >= 1
            && request.resource.data.matchupKey is string
            && request.resource.data.placedAt == request.time
            && request.resource.data.void == false
            && request.resource.data.matchupKey == currentMatch().matchupKey
            && currentMatch().firstGoalAt == null;

      // Phase 1: only voiding (undo).
      allow update: if canAccess()
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['void'])
            && request.resource.data.void == true;

      allow delete: if false;
    }
```

- [ ] **Step 2: Implement the service**

```js
// src/betting/bets-service.js
// Real-time 'bets' collection + placing/undoing house bets.
import { db, collection, doc, addDoc, updateDoc, onSnapshot, serverTimestamp } from '../firebase-service.js';
import { allMatches } from '../match-data-service.js';
import { BETTING } from './betting-config.js';
import { computeBalances, checkBet, resolveHouseBet, dayKey } from './ledger.js';
import { getCurrentMatch } from './current-match-service.js';
import { teamKey } from '../teams/team-identity.js';

let allBets = [];
let initialized = false;

export function getBets() {
  return allBets;
}

export function initializeBets() {
  if (initialized || !BETTING.enabled) return () => {};
  initialized = true;
  return onSnapshot(collection(db, 'bets'), { includeMetadataChanges: false }, (snap) => {
    allBets = [];
    snap.forEach((d) => {
      const data = d.data({ serverTimestamps: 'estimate' });
      allBets.push({ id: d.id, ...data, placedAt: data.placedAt?.toMillis?.() ?? Date.now() });
    });
    window.dispatchEvent(new CustomEvent('bets-updated'));
  }, (error) => console.error('Error listening to bets:', error));
}

export function resetBetsListener() {
  initialized = false;
}

export function getBalances() {
  return computeBalances(allBets, allMatches || [], Date.now());
}

export function getOpenBetsFor(key) {
  const now = Date.now();
  return allBets.filter((b) => !b.void && b.kind === 'house' && b.matchupKey === key
    && resolveHouseBet(b, allMatches || [], now).status === 'open');
}

function available(bettor) {
  const w = getBalances().get(bettor);
  const hasBetToday = allBets.some((b) => !b.void && b.bettor === bettor && dayKey(b.placedAt) === dayKey(Date.now()));
  return (w?.balance ?? 0) + (hasBetToday ? 0 : BETTING.dailyAllowance);
}

export async function placeHouseBet({ bettor, stake, team }) {
  const cm = getCurrentMatch();
  if (!cm?.offer || cm.firstGoalAt) throw new Error('closed');
  const odds = cm.offer.winner[teamKey(team)];
  const bet = {
    kind: 'house', matchupKey: cm.matchupKey, bettor, stake, odds,
    outcome: { test: 'winner', team: [...team].sort() }, void: false,
  };
  const verdict = checkBet(bet, { currentMatch: cm });
  if (!verdict.ok) throw new Error(verdict.reason);
  if (stake > available(bettor)) throw new Error('insufficient');
  try {
    const ref = await addDoc(collection(db, 'bets'), { ...bet, placedAt: serverTimestamp() });
    return ref.id;
  } catch (err) {
    if (err?.code === 'permission-denied') throw new Error('closed');
    throw err;
  }
}

export async function undoBet(id) {
  await updateDoc(doc(db, 'bets', id), { void: true });
}
```

- [ ] **Step 3: Verify rules compile and the build passes**

Run: `npx firebase emulators:exec --only firestore "echo rules-ok"` → prints `rules-ok` (rules parse). Run `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/betting/bets-service.js firestore.rules
git commit -m "feat(betting): bets service and rule-enforced first-goal cutoff"
```

---

### Task 7: Golden football currency icon

**Files:**
- Create: `public/assets/golden-football.svg`
- Create: `src/betting/currency.js`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `footballs(amount: number) → HTMLSpanElement` — `<span class="gf-amount">20<img class="gf-icon" …></span>`, `aria-label="20 golden footballs"`; `GF_ICON_SRC`.

- [ ] **Step 1: Create the icon**

Copy `public/assets/wm26ball.svg` to `public/assets/golden-football.svg`, then in the copy:
- Add to `<defs>`:
  ```xml
  <linearGradient id="gfGold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff3b0"/>
    <stop offset="0.45" stop-color="#f2c230"/>
    <stop offset="1" stop-color="#a87412"/>
  </linearGradient>
  ```
- Replace the white/light fill colours of the ball's panels with `url(#gfGold)` and the dark panel colours with `#7a5208`. Keep paths unchanged.
- Open it in the browser (Playwright screenshot of `http://localhost:5173/assets/golden-football.svg`) and check that it reads as a gold ball at 16px and 64px.

- [ ] **Step 2: Helper and CSS**

```js
// src/betting/currency.js
// Golden-football amounts: number + shiny gold ball icon.
export const GF_ICON_SRC = 'assets/golden-football.svg';

export function footballs(amount) {
  const span = document.createElement('span');
  span.className = 'gf-amount';
  const n = Math.round(amount);
  span.setAttribute('aria-label', `${n} golden footballs`);
  span.textContent = String(n);
  const img = document.createElement('img');
  img.className = 'gf-icon';
  img.src = GF_ICON_SRC;
  img.alt = '';
  span.appendChild(img);
  return span;
}
```

```css
/* Golden footballs */
.gf-amount { display: inline-flex; align-items: center; gap: 0.15em; font-variant-numeric: tabular-nums; }
.gf-icon { height: 1em; width: 1em; vertical-align: -0.125em; }
.gf-icon.gf-shine {
  -webkit-mask: linear-gradient(110deg, #000 40%, rgba(0,0,0,.55) 50%, #000 60%) right/300% 100%;
  mask: linear-gradient(110deg, #000 40%, rgba(0,0,0,.55) 50%, #000 60%) right/300% 100%;
  animation: gf-shine 3.5s ease-in-out infinite;
}
@keyframes gf-shine { to { -webkit-mask-position: left; mask-position: left; } }
@media (prefers-reduced-motion: reduce) { .gf-icon.gf-shine { animation: none; } }
```

(The shine class is applied only to larger icons, e.g. in the bets box header; inline amounts stay static.)

- [ ] **Step 3: Build and commit**

Run `npm run build` → succeeds.

```bash
git add public/assets/golden-football.svg src/betting/currency.js src/styles.css
git commit -m "feat(betting): golden football currency icon"
```

---

### Task 8: Bets box UI, lineup publishing and overwrite confirmation

**Files:**
- Modify: `index.html` (add `<div class="boxed" id="betsBox" style="display:none">` directly after the closing tag of `#matchForm`)
- Create: `src/betting/bets-ui.js`
- Create: `src/betting/sync-controller.js`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: everything from Tasks 1–7; `teamA1Select…teamB2Select` from `src/dom-elements.js`; `pairFromSelects` (teams); `getTeamRecord`; `showConfirm`, `showToast`; `createTimelineSVG(goalLog)`, `formatMsToMMSS(ms)` from `src/match-timeline.js`; `allPlayers` from `src/player-data-service.js`.
- Produces: `initBettingUI()` (bets box), `initSyncController()` (publishing). Both no-ops when `BETTING.enabled` is false.

**Sync controller behaviour** (`sync-controller.js`):
- `isLiveHere` flag set on `live-started`, cleared on `live-ended`; exported as `isLiveOnThisDevice()`.
- On `lineup-changed`: return unless `navigator.userActivation?.hasBeenActive ?? true`. Read pairs via `pairFromSelects` and positions from the four selects (`redDefense = teamA1`, `redOffense = teamA2`, `blueDefense = teamB1`, `blueOffense = teamB2`). `decision = shouldPublishLineup(getCurrentMatch(), red, blue, positions)`.
  - `'positions'` → `publishPositions(...)`.
  - `'replace'` → `newKey = matchupKey(red, blue)`; `open = getOpenBetsFor(current?.matchupKey).length`; if `needsOverwriteConfirm(current, newKey, open)`: `showConfirm("Replace the current match <labels>?" + (open ? `\n${open} bet(s) (${sum} golden footballs) will be refunded.` : '') + (current.liveStartedAt ? '\nIt is currently live.' : ''), { confirmLabel: 'Replace', cancelLabel: 'Keep shared match', type: 'warning' })`. Declined → set `#betsNotShared` hint visible, return. Then `publishLineup(..., { expectedUpdatedAtMs })` where `expectedUpdatedAtMs` is `current?.updatedAt?.toMillis?.() ?? null` captured *before* the dialog; on `Error('stale')` re-run this handler once (fresh dialog), then give up with a toast.
  - Hide the not-shared hint after any successful publish.
- On `live-started` → `publishLiveStart()` (if the shared matchup differs from this device's lineup, first run the lineup flow above).
- On `live-goal` (detail = goalLog) → `publishGoal(detail)` only when `isLiveHere`.
- On `live-ended` → `publishLiveEnd()` only when `isLiveHere` was true before the event.
- All publish errors → `console.warn` + one `showToast('Live sync failed — others may not see this match.', 'warning')` per minute at most.

**Bets box** (`bets-ui.js`), re-rendered on `current-match-updated`, `bets-updated`, `matches-updated`, `teams-updated`, and every second while live (for the timer):
- Hidden unless `BETTING.enabled` and current match has a matchupKey.
- Header row: red and blue team labels (same classes as `#liveTeamLabels`: `live-team-label red|blue`, team name from `getTeamRecord(teamKey(pair))?.name` else players joined with " + "), large shiny golden-football icon.
- Live row, only if `current.liveStartedAt` and not `isLiveHere`: "● LIVE", timer `formatMsToMMSS(Date.now() - liveStartedAt.toMillis())`, score counted from `goalLog`, `createTimelineSVG(goalLog)`.
- House row (if `houseBetsActive()`):
  - If `offer` null → "House opens when the next lineup is set."
  - Else two buttons `Red wins 1.9×` / `Blue wins 1.8×` (`class="red_select"` / `"blue_select"` for colour; odds from `offer.winner[teamKey(pair)]`). Caption "closes at first goal".
  - If `firstGoalAt` set → buttons disabled, caption "Closed at first goal".
- Feed: non-void house bets for this matchup, newest first: "Simon  20⚽ on Marc + Manuel @1.9" (amount via `footballs()`); after resolution show "won 38" / "lost" / "refunded".
- Not-shared hint `#betsNotShared`: "Your lineup isn't shared — the bets box shows the shared match."

**Place-bet sheet:** clicking an odds button opens `showConfirm('', { contentElement, confirmLabel: 'Place bet', cancelLabel: 'Cancel' })` with `contentElement` containing:
- Bettor `<select>` of `allPlayers` names, preselected from `localStorage['betting.bettor']` (wrapped in try/catch).
- Stake chips from `BETTING.stakeChips` plus `<input type="number" min="1" step="1">`.
- Live text: "Payout: 38 · Balance: 120" updated on input (balance = `available` logic: wallet balance + allowance if no bet today).
On confirm → `placeHouseBet({ bettor, stake, team })`; save bettor to localStorage; success toast `showToast('Bet placed — tap to undo', 'success', BETTING.undoWindowMs, () => undoBet(id))`. Errors: `closed` → "Bet not accepted — betting had closed"; `insufficient` → "Not enough golden footballs"; other → "Bet failed".

- [ ] **Step 1: Implement the sync controller**

```js
// src/betting/sync-controller.js
// Publishes this device's lineup / live state to meta/currentMatch, asking before
// it would replace a shared match that is live or has open bets.
import { teamA1Select, teamA2Select, teamB1Select, teamB2Select } from '../dom-elements.js';
import { pairFromSelects, teamKey } from '../teams/team-identity.js';
import { getTeamRecord } from '../teams/team-service.js';
import { showConfirm, showToast } from '../toast.js';
import { BETTING } from './betting-config.js';
import { matchupKey } from './matchup.js';
import { shouldPublishLineup, needsOverwriteConfirm } from './current-match.js';
import { getCurrentMatch, publishLineup, publishPositions, publishLiveStart, publishGoal, publishLiveEnd } from './current-match-service.js';
import { getOpenBetsFor } from './bets-service.js';

let initialized = false;
let isLiveHere = false;
let lastWarnAt = 0;

export function isLiveOnThisDevice() {
  return isLiveHere;
}

function warn(err) {
  console.warn('[betting] live sync failed', err);
  if (Date.now() - lastWarnAt > 60000) {
    lastWarnAt = Date.now();
    showToast('Live sync failed — others may not see this match.', 'warning');
  }
}

function setNotShared(visible) {
  const hint = document.getElementById('betsNotShared');
  if (hint) hint.style.display = visible ? '' : 'none';
}

function readLineup() {
  const { red, blue } = pairFromSelects(teamA1Select?.value, teamA2Select?.value, teamB1Select?.value, teamB2Select?.value);
  const positions = {
    redDefense: teamA1Select?.value || '', redOffense: teamA2Select?.value || '',
    blueDefense: teamB1Select?.value || '', blueOffense: teamB2Select?.value || '',
  };
  return { red, blue, positions };
}

const label = (pair) => getTeamRecord(teamKey(pair))?.name || pair.join(' + ');

/** Returns true if the shared doc now carries this device's lineup. */
async function syncLineup(retry = true) {
  const { red, blue, positions } = readLineup();
  const current = getCurrentMatch();
  const decision = shouldPublishLineup(current, red, blue, positions);
  if (decision === 'skip') return current?.matchupKey === matchupKey(red, blue);
  if (decision === 'positions') {
    await publishPositions({ red, blue, positions });
    setNotShared(false);
    return true;
  }
  const expectedUpdatedAtMs = current?.updatedAt?.toMillis?.() ?? null;
  const open = current?.matchupKey ? getOpenBetsFor(current.matchupKey) : [];
  if (needsOverwriteConfirm(current, matchupKey(red, blue), open.length)) {
    const stake = open.reduce((sum, b) => sum + b.stake, 0);
    const lines = [`Replace the current match ${label(current.red)} vs ${label(current.blue)}?`];
    if (open.length) lines.push(`${open.length} bet${open.length === 1 ? '' : 's'} (${stake} golden footballs) will be refunded.`);
    if (current.liveStartedAt) lines.push('It is currently live.');
    const ok = await showConfirm(lines.join('\n'), { confirmLabel: 'Replace', cancelLabel: 'Keep shared match', type: 'warning' });
    if (!ok) { setNotShared(true); return false; }
  }
  try {
    await publishLineup({ red, blue, positions }, { expectedUpdatedAtMs });
    setNotShared(false);
    return true;
  } catch (err) {
    if (err.message === 'stale' && retry) return syncLineup(false);
    throw err;
  }
}

export function initSyncController() {
  if (initialized || !BETTING.enabled || !BETTING.liveSync) return;
  initialized = true;

  window.addEventListener('lineup-changed', () => {
    if (!(navigator.userActivation?.hasBeenActive ?? true)) return; // never on page load
    syncLineup().catch(warn);
  });

  window.addEventListener('live-started', async () => {
    isLiveHere = true;
    try {
      if (await syncLineup()) await publishLiveStart();
    } catch (err) { warn(err); }
  });

  window.addEventListener('live-goal', (e) => {
    if (isLiveHere) publishGoal(e.detail).catch(warn);
  });

  window.addEventListener('live-ended', () => {
    if (!isLiveHere) return;
    isLiveHere = false;
    publishLiveEnd().catch(warn);
  });
}
```

Note: if the user declines replacing a live shared match and then starts live mode, `syncLineup()` returns false and this device's live state is not published (the other match keeps the shared view).

- [ ] **Step 2: Implement the bets box** (`bets-ui.js`, markup, CSS) following the behaviour above, using `isLiveOnThisDevice()` from the sync controller for "not running live mode here". Keep DOM construction in small functions (`renderHeader`, `renderLive`, `renderHouse`, `renderFeed`, `openBetSheet`), each building elements with `document.createElement` like `leaderboard-display.js` (no `innerHTML` with player names).

- [ ] **Step 3: Wiring** is done in Task 10 together with the e2e test.

- [ ] **Step 4: Build** `npm run build` → succeeds; `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add index.html src/betting/bets-ui.js src/betting/sync-controller.js src/styles.css
git commit -m "feat(betting): bets box, shared live view and overwrite confirmation"
```

---

### Task 9: Golden footballs leaderboard option

**Files:**
- Modify: `index.html` (add `<option value="goldenFootballs">Golden footballs</option>` as the last option of `#sortBySelect`, only rendered when betting is enabled — see Step 1)
- Modify: `src/leaderboard-display.js` (special-case branch like `teamElo`)

**Interfaces:**
- Consumes: `getBalances()` (Task 6), `footballs()` (Task 7), `BETTING`.
- Produces: `renderGoldenFootballLeaderboard()` (module-internal).

- [ ] **Step 1: Option and branch**

Do not hard-code the option in `index.html`; in `initializeLeaderboardDisplay()` append it when `BETTING.enabled`:

```js
if (BETTING.enabled && sortBySelect && !sortBySelect.querySelector('option[value="goldenFootballs"]')) {
    const opt = document.createElement('option');
    opt.value = 'goldenFootballs';
    opt.textContent = 'Golden footballs';
    sortBySelect.appendChild(opt);
}
```

In `updateLeaderboardDisplay()` next to the `teamElo` branch:

```js
if (sortBy === 'goldenFootballs') {
    renderGoldenFootballLeaderboard();
    return;
}
```

```js
function renderGoldenFootballLeaderboard() {
    const rows = [...getBalances().entries()]
        .map(([name, w]) => ({ name, ...w }))
        .sort((a, b) => b.balance - a.balance);
    if (rows.length === 0) {
        leaderboardList.innerHTML = '<li>No bets yet.</li>';
        return;
    }
    rows.forEach((row, idx) => {
        const li = document.createElement('li');
        li.classList.add('leaderboard-item');
        li.style.cursor = 'default';
        const info = document.createElement('span');
        info.classList.add('leaderboard-player-info');
        const rank = document.createElement('span');
        rank.classList.add('leaderboard-rank');
        rank.textContent = `${idx + 1}`;
        const name = document.createElement('span');
        name.classList.add('leaderboard-name');
        name.textContent = row.name;
        const value = document.createElement('span');
        value.classList.add('leaderboard-value');
        value.appendChild(footballs(row.balance));
        info.append(rank, name, value);
        const meta = document.createElement('span');
        meta.style.fontSize = '0.9em';
        meta.style.color = 'var(--text-color-secondary, #666)';
        meta.textContent = row.todayDelta ? `${row.todayDelta > 0 ? '+' : ''}${Math.round(row.todayDelta)} today` : '';
        li.append(info, meta);
        leaderboardList.appendChild(li);
    });
}
```

Also re-render the leaderboard on `bets-updated` when `sortBy === 'goldenFootballs'`.

- [ ] **Step 2: Build, test, commit**

`npm run build` and `npm test` → pass.

```bash
git add src/leaderboard-display.js
git commit -m "feat(betting): golden footballs leaderboard option"
```

---

### Task 10: App wiring and end-to-end test

**Files:**
- Modify: `src/app.js` (initialize listeners and UI; reset on offline)
- Create: `e2e/betting.spec.js`

**Interfaces:**
- Consumes: `initializeCurrentMatch`, `resetCurrentMatchListener`, `initializeBets`, `resetBetsListener`, `initBettingUI`, `initSyncController`.

- [ ] **Step 1: Wire up**

In `src/app.js`, next to `activeListeners.push(initializeTeams());`:

```js
activeListeners.push(initializeCurrentMatch());
activeListeners.push(initializeBets());
```

after `initializeTournamentUI();`:

```js
initBettingUI();
initSyncController();
```

and next to `resetTeamsListener()` in the offline path: `resetCurrentMatchListener(); resetBetsListener();`. `initBettingUI` and `initSyncController` must guard against double initialization (module-level `initialized` flag).

- [ ] **Step 2: Write the e2e test** (two browser contexts against the emulator)

```js
// e2e/betting.spec.js
// Two phones: A sets the lineup and runs live mode, B watches and bets.
import { test, expect } from '@playwright/test';
import { ensureTestUser, signInViaUI } from './helpers.js';

test.beforeAll(async () => { await ensureTestUser(); });

async function pickLineup(page, [a1, a2, b1, b2]) {
  await page.selectOption('#teamA1', a1);
  await page.selectOption('#teamA2', a2);
  await page.selectOption('#teamB1', b1);
  await page.selectOption('#teamB2', b2);
}

test('lineup, live score and house bets sync across phones', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await signInViaUI(a);
  await signInViaUI(b);
  await a.waitForFunction(() => document.querySelectorAll('#teamA1 option').length > 4);
  const names = await a.$$eval('#teamA1 option', (os) => os.map((o) => o.value).filter((v) => v && v !== '__add_new__').slice(0, 4));
  await a.click('body'); // user activation
  await pickLineup(a, names);

  const box = b.locator('#betsBox');
  await expect(box).toBeVisible({ timeout: 10000 });
  await expect(box.locator('button', { hasText: 'wins' })).toHaveCount(2);

  // B bets 10 on red.
  await box.locator('button', { hasText: 'Red wins' }).click();
  await b.locator('.confirm-dialog input[type=number]').fill('10');
  await b.locator('.confirm-btn-ok').click();
  await expect(box).toContainText('10');
  await expect(a.locator('#betsBox')).toContainText('10'); // A sees B's bet

  // A starts live mode and scores; B sees live row and betting closes.
  await a.click('#toggleLiveMode');
  await a.click('#btnRedScored');
  await expect(box).toContainText('LIVE');
  await expect(box).toContainText('Closed at first goal');

  // Position swap on A (red defense/offense) does not ask and keeps the bet.
  await a.click('#swap_red_team_hitbox');
  await expect(a.locator('.confirm-dialog')).toHaveCount(0);

  // Changing a player on A asks for confirmation mentioning the open bet.
  await a.selectOption('#teamA1', names[2]);
  await a.selectOption('#teamB1', names[0]);
  await expect(a.locator('.confirm-dialog')).toContainText('1 bet');
  await a.locator('.confirm-btn-cancel').click();

  // Leaderboard option exists.
  await b.selectOption('#sortBySelect', 'goldenFootballs');
  await expect(b.locator('#leaderboard')).toContainText(/\d/);

  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 3: Run**

Run: `npx playwright test e2e/betting.spec.js --project=desktop`
Expected: PASS. If the emulator import data has fewer than 4 players, add players via the UI first (see `e2e/submit-match.spec.js` for the add-player flow) and adjust the test.

Run: `npm test` → all suites pass. `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app.js e2e/betting.spec.js
git commit -m "feat(betting): wire betting into the app + two-phone e2e test"
```

---

### Task 11: Final verification (no deploy)

- [ ] Run `npm test`, `npm run build`, `npx playwright test e2e/betting.spec.js --project=desktop --project=mobile`.
- [ ] Set `BETTING.enabled = false` locally, run the app (`npx vite`), confirm: no bets box, no leaderboard option, no `meta/currentMatch` writes (check emulator UI). Revert.
- [ ] Do **not** deploy hosting or rules; deployment (hosting + `firebase deploy --only firestore:rules`) is a separate, user-approved step.
