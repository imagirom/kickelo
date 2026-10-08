// src/betting/model.js
// Beta-binomial race-to-5 model. Each goal goes to "our" team with probability p,
// p ~ Beta(mu*kappa, (1-mu)*kappa) per match, mu = 1/(1+10^-(gap/s + c)).
// kappa = Infinity is the plain binomial (goals independent).
import { MAX_GOALS } from '../constants.js';
import { BETTING } from './betting-config.js';
import { evaluateOutcome } from './outcomes.js';

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
