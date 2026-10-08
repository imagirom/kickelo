# Betting Phase 2 (House Props) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Besides the winner bet, the house offers two extra props per matchup (e.g. "MaMa win by 3+", "Over 4:30", "Comeback"), priced from the fitted model, within a configurable max ratio, identical on all phones, resolved automatically.

**Architecture:** A pure outcome-test module (`outcomes.js`) evaluates any outcome on a logged match and is shared by phase 3 (challenges). The model gains exact goal-sequence enumeration (`pathDistribution`) so every scoreline and goal-order prop is priced from one beta-binomial model, plus a log-normal duration model. A pure `props.js` generates candidates, filters by `maxRatio` and draws `count` of them with a PRNG seeded by matchup + date; the publishing device stores them in `meta/currentMatch.offer.props`. The ledger resolves any house bet through `evaluateOutcome`.

**Tech Stack:** as phase 1 (vanilla JS, Firebase v12, Node test scripts, Playwright + emulator).

**Spec:** `docs/superpowers/specs/2026-10-08-betting-design.md` (sections Outcome tests, Pricing model, Prop selection, Phases). Phase 1 plan: `docs/superpowers/plans/2026-10-08-betting-phase1.md`.

## Global Constraints

- Core logic untouched (live mode, suggest, ELO, match logging). No new core dispatches needed.
- All new behaviour is gated by `BETTING.enabled && BETTING.liveSync && BETTING.houseProps.enabled` (house props need the shared offer); with `houseProps.enabled = false` the winner bet keeps working unchanged.
- `houseProps: { enabled: true, count: 2, maxRatio: 3, minSamples: 30 }` — a prop side is offered only if its probability `p` satisfies `1/(1+maxRatio) ≤ p ≤ maxRatio/(1+maxRatio)`; both yes and no odds are shown.
- At most one prop per test type per matchup; the winner bet is always offered and never counted in `count`.
- Odds formula and clamp exactly as phase 1 (`toOdds`).
- Existing phase-1 bets (`outcome: { test: 'winner', team }`) must keep resolving identically.
- A prop whose required data is missing from the logged match (e.g. no `goalLog`/`matchDuration`) is refunded.
- Team-referencing props name the team by its label (team name or "A + B"), never by colour, because colours can swap.
- Tests: extend `test/betting.test.js` (plain `assertEq`/`assertClose`). E2E: extend `e2e/betting.spec.js`, run with `--workers=1` against the already-running emulator + vite.
- No push, no deploy, no production Firestore; fit runs on the local backup in `admin/backups/`. Commits without `Co-Authored-By`.

## Review Focus

1. **A prop bet on the team whose side changes** (Red/Blue swap before the match is logged) — must resolve by pair, not colour. Test in Task 1.
2. **Negated ("no") side of a prop when the data is missing** — must refund, not win. Test in Task 1 (`evaluateOutcome` returns null → refund in Task 4).
3. **Two phones computing different props** — must not happen: props come only from the published offer; the seeded draw is deterministic for the same inputs. Test in Task 3.
4. **Odds of yes and no for the same prop** both respect clamp and margin, and `p_yes + p_no = 1`. Test in Task 3.
5. **Offer with no eligible props** (extreme ELO gap pushes everything outside the ratio) — the UI shows only the winner bet, nothing breaks. Test in Task 3 (empty list) and Task 5 (render with `props: []`).

---

### Task 1: Outcome tests

**Files:**
- Create: `src/betting/outcomes.js`
- Test: `test/betting.test.js`

**Interfaces:**
- Produces:
  - `OUTCOME_TESTS`: ordered array of `{ id, needsGoalLog: boolean, hasTeam: boolean, thresholds: number[] | null }` for `winner`, `marginAtLeast` (k: 2,3,4), `shutout`, `goesToFourFour`, `durationOver` (T seconds: 180..360 step 30), `scoresFirst`, `firstScorerWins`, `comebackAtLeast` (k: 1,2).
  - `evaluateOutcome(match, outcome) → true | false | null` — `outcome = { test, team: string[]|null, threshold: number|null, negate?: boolean }`; `null` when the match lacks required data or the team is not in the match. Negation applies only to non-null results.
  - `describeOutcome(outcome, labelOf: (pair) => string) → string` — e.g. "MaMa win", "MaMa win by 3+", "MaMa win 5:0", "Goes to 4:4", "Over 4:30", "MaMa score first", "First scorer wins", "MaMa comeback from 2 down"; negated: prefix "Not: ".

Semantics (team = the pair in `outcome.team`, side resolved per match by pair):
- `winner`: team won.
- `marginAtLeast k`: team won and `goalsTeam − goalsOpp ≥ k`.
- `shutout`: team won and opponent scored 0.
- `goesToFourFour`: `min(goalsA, goalsB) === 4` (no team).
- `durationOver T`: `matchDuration > T·1000` (needs `matchDuration`).
- `scoresFirst`: `goalLog[0].team` is team's colour in that match (`red` = teamA).
- `firstScorerWins`: the side of `goalLog[0]` won (no team).
- `comebackAtLeast k`: team won and was behind by ≥ k at some point in `goalLog`.

- [ ] **Step 1: Write the failing tests**

```js
import { OUTCOME_TESTS, evaluateOutcome, describeOutcome } from '../src/betting/outcomes.js';

console.log('\n=== outcome tests ===');
{
  const R = ['Manuel', 'Marc']; const B = ['Roman', 'Tobi'];
  const g = (seq) => seq.split('').map((c, i) => ({ team: c === 'r' ? 'red' : 'blue', timestamp: (i + 1) * 10000 }));
  // red falls behind 0:2 then wins 5:3
  const m = { teamA: R, teamB: B, winner: 'A', goalsA: 5, goalsB: 3, matchDuration: 275000, goalLog: g('bbrrrbrr') };
  const o = (test, extra = {}) => ({ test, team: null, threshold: null, ...extra });
  assertEq(evaluateOutcome(m, o('winner', { team: R })), true, 'winner: red pair won');
  assertEq(evaluateOutcome({ ...m, teamA: B, teamB: R, winner: 'B', goalLog: g('rrbbbrbb') }, o('winner', { team: R })), true, 'winner follows the pair across a side swap');
  assertEq(evaluateOutcome(m, o('marginAtLeast', { team: R, threshold: 2 })), true, 'margin 2 reached');
  assertEq(evaluateOutcome(m, o('marginAtLeast', { team: R, threshold: 3 })), false, 'margin 3 not reached');
  assertEq(evaluateOutcome(m, o('marginAtLeast', { team: B, threshold: 2 })), false, 'loser never has a margin');
  assertEq(evaluateOutcome({ ...m, goalsB: 0 }, o('shutout', { team: R })), true, 'shutout');
  assertEq(evaluateOutcome(m, o('goesToFourFour')), false, '5:3 did not reach 4:4');
  assertEq(evaluateOutcome({ ...m, goalsB: 4 }, o('goesToFourFour')), true, '5:4 reached 4:4');
  assertEq(evaluateOutcome(m, o('durationOver', { threshold: 270 })), true, '4:35 is over 4:30');
  assertEq(evaluateOutcome(m, o('durationOver', { threshold: 300 })), false, '4:35 is not over 5:00');
  assertEq(evaluateOutcome(m, o('scoresFirst', { team: B })), true, 'blue scored first');
  assertEq(evaluateOutcome(m, o('firstScorerWins')), false, 'first scorer lost');
  assertEq(evaluateOutcome(m, o('comebackAtLeast', { team: R, threshold: 2 })), true, 'comeback from 2 down');
  assertEq(evaluateOutcome(m, o('comebackAtLeast', { team: R, threshold: 3 })), false, 'not from 3 down');
  assertEq(evaluateOutcome(m, o('marginAtLeast', { team: R, threshold: 3, negate: true })), true, 'negation flips');
  const noLog = { ...m, goalLog: undefined, matchDuration: undefined };
  assertEq(evaluateOutcome(noLog, o('scoresFirst', { team: R })), null, 'goal-order test without goalLog -> null');
  assertEq(evaluateOutcome(noLog, o('durationOver', { threshold: 270, negate: true })), null, 'negated test without data stays null');
  assertEq(evaluateOutcome(noLog, o('marginAtLeast', { team: R, threshold: 2 })), true, 'scoreline tests work without goalLog');
  assertEq(evaluateOutcome(m, o('winner', { team: ['Peter', 'Paul'] })), null, 'team not in match -> null');
  assertEq(OUTCOME_TESTS.map((t) => t.id), ['winner', 'marginAtLeast', 'shutout', 'goesToFourFour', 'durationOver', 'scoresFirst', 'firstScorerWins', 'comebackAtLeast'], 'catalog order');
  const lab = (p) => (p[0] === 'Manuel' ? 'MaMa' : p.join(' + '));
  assertEq(describeOutcome(o('marginAtLeast', { team: R, threshold: 3 }), lab), 'MaMa win by 3+', 'describe margin');
  assertEq(describeOutcome(o('durationOver', { threshold: 270 }), lab), 'Over 4:30', 'describe duration');
  assertEq(describeOutcome(o('goesToFourFour', { negate: true }), lab), 'Not: Goes to 4:4', 'describe negation');
}
```

- [ ] **Step 2: Run** `npm run test:betting` → FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// src/betting/outcomes.js
// Pure outcome tests on a logged match. Teams are pairs, resolved to a side per
// match, so a Red/Blue swap never changes a result. null = cannot be decided
// (missing data or team not in match) -> the bet is refunded.
import { teamKey } from '../teams/team-identity.js';
import { MAX_GOALS } from '../constants.js';

export const OUTCOME_TESTS = [
  { id: 'winner', needsGoalLog: false, hasTeam: true, thresholds: null },
  { id: 'marginAtLeast', needsGoalLog: false, hasTeam: true, thresholds: [2, 3, 4] },
  { id: 'shutout', needsGoalLog: false, hasTeam: true, thresholds: null },
  { id: 'goesToFourFour', needsGoalLog: false, hasTeam: false, thresholds: null },
  { id: 'durationOver', needsGoalLog: true, hasTeam: false, thresholds: [180, 210, 240, 270, 300, 330, 360] },
  { id: 'scoresFirst', needsGoalLog: true, hasTeam: true, thresholds: null },
  { id: 'firstScorerWins', needsGoalLog: true, hasTeam: false, thresholds: null },
  { id: 'comebackAtLeast', needsGoalLog: true, hasTeam: true, thresholds: [1, 2] },
];

function sideOf(match, team) {
  const k = teamKey(team || []);
  if (k && teamKey(match.teamA) === k) return 'A';
  if (k && teamKey(match.teamB) === k) return 'B';
  return null;
}

const colourOf = (side) => (side === 'A' ? 'red' : 'blue');

function raw(match, { test, team, threshold }) {
  const side = sideOf(match, team);
  const def = OUTCOME_TESTS.find((t) => t.id === test);
  if (!def || (def.hasTeam && !side)) return null;
  const log = Array.isArray(match.goalLog) && match.goalLog.length ? match.goalLog : null;
  const goalsFor = side === 'A' ? match.goalsA : match.goalsB;
  const goalsAgainst = side === 'A' ? match.goalsB : match.goalsA;
  const won = match.winner === side;
  switch (test) {
    case 'winner': return won;
    case 'marginAtLeast': return won && goalsFor - goalsAgainst >= threshold;
    case 'shutout': return won && goalsAgainst === 0;
    case 'goesToFourFour': return Math.min(match.goalsA, match.goalsB) === MAX_GOALS - 1;
    case 'durationOver':
      return typeof match.matchDuration === 'number' ? match.matchDuration > threshold * 1000 : null;
    case 'scoresFirst': return log ? log[0].team === colourOf(side) : null;
    case 'firstScorerWins': return log ? match.winner === (log[0].team === 'red' ? 'A' : 'B') : null;
    case 'comebackAtLeast': {
      if (!log) return null;
      if (!won) return false;
      let diff = 0; let worst = 0;
      for (const goal of log) {
        diff += goal.team === colourOf(side) ? 1 : -1;
        worst = Math.min(worst, diff);
      }
      return -worst >= threshold;
    }
    default: return null;
  }
}

export function evaluateOutcome(match, outcome) {
  const r = raw(match, outcome);
  if (r === null) return null;
  return outcome.negate ? !r : r;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function describeOutcome(outcome, labelOf) {
  const t = outcome.team ? labelOf(outcome.team) : '';
  const k = outcome.threshold;
  const text = {
    winner: `${t} win`,
    marginAtLeast: `${t} win by ${k}+`,
    shutout: `${t} win 5:0`,
    goesToFourFour: 'Goes to 4:4',
    durationOver: `Over ${mmss(k)}`,
    scoresFirst: `${t} score first`,
    firstScorerWins: 'First scorer wins',
    comebackAtLeast: `${t} comeback from ${k} down`,
  }[outcome.test] || outcome.test;
  return outcome.negate ? `Not: ${text}` : text;
}
```

- [ ] **Step 4: Run** → pass. **Step 5: Commit** `feat(betting): outcome tests shared by props and challenges`.

---

### Task 2: Model — goal-sequence enumeration and duration

**Files:**
- Modify: `src/betting/model.js`
- Test: `test/betting.test.js`

**Interfaces:**
- Consumes: existing `goalProbability`, `logBeta` (module-internal), params `{ s, c, kappa, duration? }`.
- Produces:
  - `pathDistribution(gap, params) → Array<{ seq: string, p: number }>` — every complete race-to-5 goal sequence from the gap-holder's view (`'f'` = goal for, `'a'` = against), probabilities sum to 1. Exchangeability of the beta-binomial: a specific sequence ending at (a for, b against) has probability `B(α+a, β+b)/B(α, β)` (binomial limit `μ^a (1−μ)^b`).
  - `outcomeProbability(outcome, gap, params) → number | null` — P(outcome) for a team with ELO advantage `gap` over the opponent; for team-less tests `gap` is red minus blue. Uses `pathDistribution` + a synthetic match built from each path and `evaluateOutcome` (so pricing and resolution share one definition). For `durationOver` uses the duration model: `P = 1 − Φ((ln T − (a + b·|gap|)) / sigma)`; returns `null` if `params.duration` is missing.
  - `normalCdf(z) → number` (Abramowitz–Stegun 7.1.26 erf approximation).

- [ ] **Step 1: Write the failing tests**

```js
import { pathDistribution, outcomeProbability, normalCdf } from '../src/betting/model.js';

console.log('\n=== path enumeration ===');
{
  const P = { s: 1115, c: 0, kappa: 43 };
  const paths = pathDistribution(120, P);
  assertEq(paths.length, 252, 'race to 5 has 2*C(9,4)=252 complete sequences');
  assertClose(paths.reduce((s, x) => s + x.p, 0), 1, 1e-9, 'sequence probabilities sum to 1');
  const team = ['A', 'B'];
  assertClose(outcomeProbability({ test: 'winner', team }, 120, P), winProbability(120, P), 1e-9, 'enumeration agrees with closed-form winner');
  const d = scorelineDistribution(120, P);
  assertClose(outcomeProbability({ test: 'shutout', team }, 120, P), d.win[0], 1e-9, 'shutout = P(5:0)');
  assertClose(outcomeProbability({ test: 'goesToFourFour', team: null }, 120, P), d.win[4] + d.lose[4], 1e-9, '4:4 = P(5:4)+P(4:5)');
  const yes = outcomeProbability({ test: 'marginAtLeast', team, threshold: 3 }, 120, P);
  const no = outcomeProbability({ test: 'marginAtLeast', team, threshold: 3, negate: true }, 120, P);
  assertClose(yes + no, 1, 1e-9, 'yes + no = 1');
  const first = outcomeProbability({ test: 'scoresFirst', team }, 0, { ...P, kappa: Infinity });
  assertClose(first, 0.5, 1e-9, 'scores first at gap 0, binomial = 0.5');
  assertEq(outcomeProbability({ test: 'comebackAtLeast', team, threshold: 1 }, 0, P) > 0, true, 'comeback probability positive');
  assertClose(normalCdf(0), 0.5, 1e-7, 'Phi(0)');
  assertClose(normalCdf(1.96), 0.975, 1e-3, 'Phi(1.96)');
  const PD = { ...P, duration: { a: Math.log(260), b: 0, sigma: 0.3 } };
  assertClose(outcomeProbability({ test: 'durationOver', team: null, threshold: 260 }, 0, PD), 0.5, 1e-6, 'duration median -> 0.5');
  assertEq(outcomeProbability({ test: 'durationOver', team: null, threshold: 260 }, 0, P), null, 'no duration model -> null');
}
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (append to `src/betting/model.js`; import `evaluateOutcome` from `./outcomes.js`)

```js
// Exact enumeration of race-to-5 goal sequences. The beta-binomial is exchangeable:
// a sequence's probability depends only on its final counts (a for, b against).
export function pathDistribution(gap, params) {
  const mu = goalProbability(gap, params);
  const finite = Number.isFinite(params.kappa);
  const alpha = mu * params.kappa;
  const beta = (1 - mu) * params.kappa;
  const lb = finite ? logBeta(alpha, beta) : 0;
  const prob = (a, b) => (finite
    ? Math.exp(logBeta(alpha + a, beta + b) - lb)
    : Math.pow(mu, a) * Math.pow(1 - mu, b));
  const out = [];
  (function walk(seq, a, b) {
    if (a === N || b === N) { out.push({ seq, p: prob(a, b) }); return; }
    walk(seq + 'f', a + 1, b);
    walk(seq + 'a', a, b + 1);
  })('', 0, 0);
  return out;
}

export function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

const US = ['f1', 'f2'];
const THEM = ['a1', 'a2'];

/** P(outcome) for "our" team (US) with ELO advantage `gap`; team-less tests: gap = red - blue, US = red. */
export function outcomeProbability(outcome, gap, params) {
  if (outcome.test === 'durationOver') {
    const d = params.duration;
    if (!d) return null;
    const pOver = 1 - normalCdf((Math.log(outcome.threshold) - (d.a + d.b * Math.abs(gap))) / d.sigma);
    return outcome.negate ? 1 - pOver : pOver;
  }
  const o = { ...outcome, team: outcome.team ? US : null };
  let p = 0;
  for (const { seq, p: w } of pathDistribution(gap, params)) {
    const goalsA = [...seq].filter((c) => c === 'f').length;
    const match = {
      teamA: US, teamB: THEM, goalsA, goalsB: seq.length - goalsA,
      winner: goalsA === N ? 'A' : 'B',
      goalLog: [...seq].map((c, i) => ({ team: c === 'f' ? 'red' : 'blue', timestamp: i })),
      matchDuration: 1,
    };
    if (evaluateOutcome(match, o)) p += w;
  }
  return p;
}
```

Note: for `durationOver` the synthetic match is never used. `evaluateOutcome` imports `teamKey` → keep `US`/`THEM` as distinct names.

- [ ] **Step 4: Run** → pass. **Step 5: Commit** `feat(betting): exact goal-sequence pricing and duration model`.

---

### Task 3: Prop candidates, ratio filter and seeded draw; offer extension

**Files:**
- Create: `src/betting/props.js`
- Modify: `src/betting/current-match.js` (`buildOffer` adds `props`)
- Modify: `src/betting/betting-config.js` (add `propsActive(cfg)`)
- Test: `test/betting.test.js`

**Interfaces:**
- Consumes: `OUTCOME_TESTS` (Task 1), `outcomeProbability` (Task 2), `toOdds`, `teamKey`.
- Produces:
  - `propsActive(cfg = BETTING) → boolean` = `houseBetsActive(cfg) && cfg.houseProps.enabled`.
  - `candidateProps(red, blue, gap, params) → Array<{ id, outcome, p }>` — every test except `winner`, every threshold, for team tests both pairs (team perspective gap: red pair `gap`, blue pair `−gap`); team-less tests use `gap`; drops tests whose probability is `null` or whose `params.excluded?.includes(test)`. `id` = `${test}:${teamKey(team)||'-'}:${threshold ?? '-'}`; `p` = P(yes).
  - `eligible(cands, maxRatio) → cands` with `1/(1+r) ≤ p ≤ r/(1+r)`.
  - `seededRandom(seedString) → () => number` (FNV-1a hash → mulberry32).
  - `drawProps(cands, count, seedString) → cands` — group by test id, shuffle groups with the seeded PRNG, take `count` groups, from each group pick one candidate with the same PRNG. Deterministic for equal inputs.
  - `buildOffer(red, blue, eloOf, params, cfg, seedString = '') → { winner, gap, props: Array<{ id, outcome, oddsYes, oddsNo }> }` — `props` is `[]` unless `propsActive(cfg)`; `oddsYes = toOdds(p)`, `oddsNo = toOdds(1 − p)`.
- The publishing device (`current-match-service.publishLineup`) passes `seedString = matchupKey + ':' + localDateISO` (e.g. `2026-10-08`).

- [ ] **Step 1: Write the failing tests**

```js
import { candidateProps, eligible, drawProps, seededRandom } from '../src/betting/props.js';

console.log('\n=== props ===');
{
  const P = { s: 1115, c: 0.01, kappa: 43, duration: { a: Math.log(258), b: 0.0002, sigma: 0.35 } };
  const red = ['A', 'B']; const blue = ['C', 'D'];
  const cands = candidateProps(red, blue, 80, P);
  assertEq(cands.some((c) => c.outcome.test === 'winner'), false, 'winner is not a prop');
  assertEq(cands.every((c) => c.p > 0 && c.p < 1), true, 'all probabilities in (0,1)');
  const el = eligible(cands, 3);
  assertEq(el.every((c) => c.p >= 0.25 && c.p <= 0.75), true, 'maxRatio 3 -> p in [0.25, 0.75]');
  const a = drawProps(el, 2, 'A::B|C::D:2026-10-08');
  const b = drawProps(el, 2, 'A::B|C::D:2026-10-08');
  assertEq(a.map((c) => c.id), b.map((c) => c.id), 'same seed -> same props');
  assertEq(a.length, 2, 'draws count props');
  assertEq(new Set(a.map((c) => c.outcome.test)).size, 2, 'at most one prop per test type');
  const other = drawProps(el, 2, 'A::B|C::D:2026-10-09');
  assertEq(typeof other[0].id, 'string', 'other seed still works');
  assertEq(drawProps([], 2, 'x'), [], 'no eligible props -> empty list');
  assertEq(eligible(candidateProps(red, blue, 3000, { s: 1115, c: 0, kappa: Infinity }), 3).filter((c) => c.outcome.team).length >= 0, true, 'extreme gap does not throw');
  const r = seededRandom('seed'); const r2 = seededRandom('seed');
  assertEq([r(), r(), r()], [r2(), r2(), r2()], 'seeded PRNG deterministic');

  const offer = buildOffer(red, blue, (n) => ({ A: 1600, B: 1580, C: 1500, D: 1480 })[n], P,
    { ...BETTING, houseProps: { enabled: true, count: 2, maxRatio: 3, minSamples: 30 } }, 'A::B|C::D:2026-10-08');
  assertEq(offer.props.length, 2, 'offer carries 2 props');
  for (const pr of offer.props) {
    assertEq(pr.oddsYes >= 1.05 && pr.oddsNo >= 1.05 && pr.oddsYes <= 10 && pr.oddsNo <= 10, true, `odds clamped for ${pr.id}`);
  }
  const off = buildOffer(red, blue, () => 1500, P, { ...BETTING, houseProps: { ...BETTING.houseProps, enabled: false } }, 's');
  assertEq(off.props, [], 'props disabled -> empty list, winner still present');
  assertEq(Object.keys(off.winner).length, 2, 'winner odds unaffected');
}
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `props.js`**

```js
// src/betting/props.js
// House props: all candidate outcomes, filtered to near-even odds, drawn with a
// PRNG seeded by matchup + date so the publishing device's draw is reproducible.
import { OUTCOME_TESTS } from './outcomes.js';
import { outcomeProbability } from './model.js';
import { teamKey } from '../teams/team-identity.js';

export function candidateProps(red, blue, gap, params) {
  const out = [];
  for (const def of OUTCOME_TESTS) {
    if (def.id === 'winner' || params.excluded?.includes(def.id)) continue;
    const teams = def.hasTeam ? [[red, gap], [blue, -gap]] : [[null, gap]];
    for (const [team, g] of teams) {
      for (const threshold of def.thresholds || [null]) {
        const outcome = { test: def.id, team: team ? [...team].sort() : null, threshold };
        const p = outcomeProbability(outcome, g, params);
        if (p === null || !(p > 0 && p < 1)) continue;
        out.push({ id: `${def.id}:${team ? teamKey(team) : '-'}:${threshold ?? '-'}`, outcome, p });
      }
    }
  }
  return out;
}

export function eligible(cands, maxRatio) {
  const lo = 1 / (1 + maxRatio);
  const hi = maxRatio / (1 + maxRatio);
  return cands.filter((c) => c.p >= lo && c.p <= hi);
}

export function seededRandom(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawProps(cands, count, seed) {
  const rnd = seededRandom(seed);
  const groups = new Map();
  for (const c of cands) {
    if (!groups.has(c.outcome.test)) groups.set(c.outcome.test, []);
    groups.get(c.outcome.test).push(c);
  }
  const keys = [...groups.keys()];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys.slice(0, count).map((k) => {
    const g = groups.get(k);
    return g[Math.floor(rnd() * g.length)];
  });
}
```

- [ ] **Step 4: Extend `buildOffer` and config**

In `betting-config.js`:
```js
export function propsActive(cfg = BETTING) {
  return houseBetsActive(cfg) && Boolean(cfg.houseProps?.enabled);
}
```
In `current-match.js` `buildOffer(red, blue, eloOf, params, cfg, seed = '')`, after the winner odds:
```js
const props = propsActive(cfg)
  ? drawProps(eligible(candidateProps(red, blue, gap, params), cfg.houseProps.maxRatio), cfg.houseProps.count, seed)
      .map(({ id, outcome, p }) => ({ id, outcome, oddsYes: toOdds(p, cfg), oddsNo: toOdds(1 - p, cfg) }))
  : [];
return { winner: { … }, gap: Math.round(gap), props };
```
In `current-match-service.publishLineup` pass `seed = \`${matchupKey(red, blue)}:${new Date().toLocaleDateString('sv')}\`` (`sv` locale gives `YYYY-MM-DD`).

- [ ] **Step 5: Run** `npm test`, `npm run build` → pass. **Commit** `feat(betting): seeded house props in the published offer`.

---

### Task 4: Fit the duration model, per-prop backtest, ledger and service generalisation

**Files:**
- Modify: `admin/model/fit.mjs` (duration fit, per-prop backtest, `minSamples` gating, `excluded`)
- Regenerate: `src/betting/model-params.json`, `admin/model/report.md`
- Modify: `src/betting/ledger.js` (resolve via `evaluateOutcome`)
- Modify: `src/betting/bets-service.js` (`placeHouseBet({ bettor, stake, outcome })`)
- Modify: `firestore.rules` (house bet must carry `outcome.test is string`)
- Test: `test/betting.test.js`

**Interfaces:**
- `model-params.json` gains `duration: { a, b, sigma, n }`, `samples: { scoreline, goalLog }`, `excluded: string[]`.
- `resolveHouseBet(bet, matches, now)` unchanged signature; result for any outcome via `evaluateOutcome(match, bet.outcome)`: `true` → won, `false` → lost, `null` → refunded. First-goal cutoff and match finding unchanged.
- `placeHouseBet({ bettor, stake, outcome })` — odds looked up from the published offer: `outcome.test === 'winner'` → `offer.winner[teamKey(outcome.team)]`; otherwise the prop with matching `id` (passed as `outcome.propId`, stripped before writing) → `outcome.negate ? oddsNo : oddsYes`. Throws `Error('closed')` if the prop is no longer in the offer. Stored `outcome` = `{ test, team, threshold, negate }`.

- [ ] **Step 1: Ledger tests (failing)**

```js
console.log('\n=== prop bets in the ledger ===');
{
  const day = new Date(2026, 9, 8, 12).getTime();
  const R = ['Manuel', 'Marc']; const B = ['Roman', 'Tobi'];
  const m = { id: 'p1', timestamp: day + 300000, teamA: R, teamB: B, winner: 'A', goalsA: 5, goalsB: 1,
    matchDuration: 240000, goalLog: [{ team: 'red', timestamp: 30000 }] };
  const bet = (outcome) => ({ kind: 'house', matchupKey: 'Manuel::Marc|Roman::Tobi', placedAt: day, bettor: 'S', stake: 10, odds: 2, outcome, void: false });
  assertEq(resolveHouseBet(bet({ test: 'marginAtLeast', team: R, threshold: 3 }), [m], day + 400000).status, 'won', 'margin prop wins');
  assertEq(resolveHouseBet(bet({ test: 'marginAtLeast', team: R, threshold: 3, negate: true }), [m], day + 400000).status, 'lost', 'negated side loses');
  assertEq(resolveHouseBet(bet({ test: 'durationOver', team: null, threshold: 300 }), [{ ...m, matchDuration: undefined }], day + 400000).status, 'refunded', 'missing data -> refund');
  assertEq(resolveHouseBet(bet({ test: 'winner', team: R }), [m], day + 400000).payout, 20, 'phase-1 winner bets unchanged');
}
```

- [ ] **Step 2: Implement** — in `resolveHouseBet` replace the winner comparison with:
```js
const result = evaluateOutcome(match, bet.outcome);
if (result === null) return { status: 'refunded', matchId: match.id, payout: bet.stake };
return result
  ? { status: 'won', matchId: match.id, payout: Math.round(bet.stake * bet.odds) }
  : { status: 'lost', matchId: match.id, payout: 0 };
```
(keep `firstGoalAt`/refund logic above it; remove the now-unused `winnerPair` and `teamKey` import if unused).

Update `placeHouseBet` as specified; add rule line `&& request.resource.data.outcome.test is string` to the house create rule.

- [ ] **Step 3: Extend the fit**

In `admin/model/fit.mjs`:
1. **Duration:** on usable live matches with `matchDuration > 30 s` and `< 30 min`, fit `ln(seconds) = a + b·|gap| + ε` by ordinary least squares; `sigma` = residual std. Store `duration: { a, b, sigma, n }`.
2. **Per-prop backtest:** fit on train (as for the winner), then for every test match and every candidate from `candidateProps(red, blue, gap, trainParams)` (red/blue = teamA/teamB) record `(id-family = test:threshold, p, y = evaluateOutcome(match, outcome))`, skipping `y === null`. Per family report n, mean p, observed rate, Brier, and the Brier of the constant base rate from train. Also fit a one-feature logistic regression `logit p = w0 + w1·gapTeam/400` per family on train (Newton, 20 iterations) and report its test Brier.
3. **Exclusion:** a test id goes into `excluded` if, for its families pooled, the model's test Brier is worse than the base-rate Brier by more than 0.005, or than the logistic benchmark by more than 0.01. (Spec deviation, documented in the report: instead of switching a prop to the benchmark model, it is excluded from offers — simpler, and safe.)
4. **Samples:** `samples.scoreline` = usable matches, `samples.goalLog` = usable live matches; `candidateProps` callers in the client check `minSamples` via `params.samples` (add the gate in `candidateProps`: drop `needsGoalLog` tests if `params.samples?.goalLog < minSamples`, drop all if `params.samples?.scoreline < minSamples`; pass `minSamples` through a 5th argument `opts = { minSamples: 0 }`).
5. Append a "## Props" section to `report.md`: duration params, the per-family table, `excluded`.

Run `node admin/model/fit.mjs`; check: duration `sigma` roughly 0.25–0.5; most families' Brier ≤ base rate.

- [ ] **Step 4: Run** `npm test`, `npm run build`. **Commit** `feat(betting): duration model, per-prop backtest, prop bets resolve via outcome tests`.

---

### Task 5: UI — prop buttons, sheet and feed

**Files:**
- Modify: `src/betting/bets-ui.js`
- Modify: `src/styles.css`
- Modify: `e2e/betting.spec.js`

**Interfaces:**
- Consumes: `describeOutcome` (Task 1), `offer.props` (Task 3), `placeHouseBet({ bettor, stake, outcome })` (Task 4).

- [ ] **Step 1: Render props** — in `renderHouse`, below the winner buttons, for each `cm.offer.props` entry a row: description (`describeOutcome(outcome, label)`), and two small buttons `Yes 2.1×` / `No 1.7×` (class `bets-prop-btn`, neutral styling consistent with existing buttons, not red/blue). Disabled together with the winner buttons at the first goal. If `props` is empty or missing, render nothing extra.
- [ ] **Step 2: Generalise the sheet** — `openBetSheet({ outcome, odds, title })`; winner buttons pass `{ outcome: { test: 'winner', team: pair, threshold: null }, odds, title: `${label(pair)} to win` }`, prop buttons pass `{ outcome: { ...prop.outcome, negate, propId: prop.id }, odds, title: describeOutcome({...prop.outcome, negate}, label) }`.
- [ ] **Step 3: Feed** — feed line uses `describeOutcome(bet.outcome, label)` instead of "on <team>".
- [ ] **Step 4: E2E** — extend `e2e/betting.spec.js`: after the lineup, phone B sees exactly `BETTING.houseProps.count` prop rows (or 0 if none eligible — assert `count <= 2`), places a "No" bet on the first prop if present, and both phones' feeds show its description with "Not: ". Run `npx playwright test e2e/betting.spec.js --project=desktop --workers=1` → pass.
- [ ] **Step 5:** `npm test`, `npm run build`. **Commit** `feat(betting): house prop buttons, generalised bet sheet and feed`.
