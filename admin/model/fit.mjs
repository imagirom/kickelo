// admin/model/fit.mjs
// Fit the beta-binomial race-to-5 model (s, c, kappa) on a local Firestore backup,
// backtest on the last 3 months, write src/betting/model-params.json + admin/model/report.md.
// Read-only: works on a backup JSON from admin/backup-database.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAllPlayerStats } from '../../src/player-stats-batch.js';
import { logLikelihood, winProbability, scorelineDistribution } from '../../src/betting/model.js';
import { evaluateOutcome, decidedAtMs } from '../../src/betting/outcomes.js';
import { candidateProps } from '../../src/betting/props.js';

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
// computeAllPlayerStats returns { players, teams, matchDeltas } and console.debug-dumps it; mute that.
const debug = console.debug; console.debug = () => {};
const stats = computeAllPlayerStats(matches).players;
console.debug = debug;
function preElo(player, ts) {
  const traj = stats[player]?.eloTrajectory || [];
  let elo = 1500;
  for (const p of traj) { if (p.timestamp < ts) elo = p.elo; else break; }
  return elo;
}
const rows = matches.slice().reverse().map((m) => {
  const a = (preElo(m.teamA[0], m.timestamp) + preElo(m.teamA[1], m.timestamp)) / 2;
  const b = (preElo(m.teamB[0], m.timestamp) + preElo(m.teamB[1], m.timestamp)) / 2;
  return { gap: a - b, goalsFor: m.goalsA, goalsAgainst: m.goalsB, timestamp: m.timestamp, match: m };
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

// --- Props: duration model, per-prop backtest, exclusion ---
const isLive = (r) => Array.isArray(r.match.goalLog) && r.match.goalLog.length > 0 && typeof r.match.matchDuration === 'number';

// Weibull time-to-last-goal with scale lambda*exp(b*|gap|), MLE on live matches with
// 30 s < duration < 30 min. Weibull beat log-normal, log-logistic and the empirical train
// distribution on the time-split backtest (log-normal overstated very short games).
// Duration = time of the last goal (what durationOver resolves on), not matchDuration, which
// keeps running until Submit is pressed.
function fitDuration(data) {
  const pts = data.filter(isLive).map((r) => [Math.abs(r.gap), decidedAtMs(r.match) / 1000])
    .filter(([, sec]) => sec > 30 && sec < 1800);
  const nll = ([ll, lk, b]) => {
    const k = Math.exp(lk);
    let s = 0;
    for (const [x, t] of pts) {
      const lam = Math.exp(ll + b * x);
      s -= Math.log(k / lam) + (k - 1) * Math.log(t / lam) - Math.pow(t / lam, k);
    }
    return s;
  };
  const [ll, lk, b] = nelderMead(nll, [Math.log(300), Math.log(2.5), 0], [0.1, 0.1, 0.0002], 600).x;
  return { lambda: Math.exp(ll), k: Math.exp(lk), b, n: pts.length };
}
const durationTrain = fitDuration(train);
const durationAll = fitDuration(usable);

// Observations per family (test:threshold): p from the train-fitted model, y from the logged match.
function observations(params, data) {
  const fam = new Map();
  for (const r of data) {
    for (const c of candidateProps(r.match.teamA, r.match.teamB, r.gap, params)) {
      const y = evaluateOutcome(r.match, c.outcome);
      if (y === null) continue;
      const key = `${c.outcome.test}:${c.outcome.threshold ?? '-'}`;
      if (!fam.has(key)) fam.set(key, []);
      const gapTeam = c.outcome.team ? (c.outcome.team.join() === [...r.match.teamA].sort().join() ? r.gap : -r.gap) : r.gap;
      fam.get(key).push({ p: c.p, y: y ? 1 : 0, x: gapTeam / 400 });
    }
  }
  return fam;
}
// One-feature logistic regression logit p = w0 + w1*x, Newton's method.
function fitLogistic(obs) {
  let w0 = 0; let w1 = 0;
  for (let it = 0; it < 20; it++) {
    let g0 = 0; let g1 = 0; let h00 = 1e-9; let h01 = 0; let h11 = 1e-9;
    for (const { x, y } of obs) {
      const p = 1 / (1 + Math.exp(-(w0 + w1 * x)));
      const w = p * (1 - p);
      g0 += y - p; g1 += (y - p) * x;
      h00 += w; h01 += w * x; h11 += w * x * x;
    }
    const det = h00 * h11 - h01 * h01;
    w0 += (h11 * g0 - h01 * g1) / det;
    w1 += (h00 * g1 - h01 * g0) / det;
  }
  return (x) => 1 / (1 + Math.exp(-(w0 + w1 * x)));
}
const trainParams = { ...fitTrain, duration: durationTrain };
const famTrain = observations(trainParams, train);
const famTest = observations(trainParams, test);
const families = [...famTest.keys()].sort().map((key) => {
  const tr = famTrain.get(key) || [];
  const te = famTest.get(key);
  const base = tr.length ? tr.reduce((s, o) => s + o.y, 0) / tr.length : 0.5;
  const logistic = fitLogistic(tr);
  const n = te.length;
  const sum = (f) => te.reduce((s, o) => s + f(o), 0);
  return {
    key, test: key.split(':')[0], n,
    meanP: sum((o) => o.p) / n, rate: sum((o) => o.y) / n,
    sse: sum((o) => (o.p - o.y) ** 2), sseBase: sum((o) => (base - o.y) ** 2), sseLogit: sum((o) => (logistic(o.x) - o.y) ** 2),
  };
});
const excluded = [...new Set(families.map((f) => f.test))].filter((t) => {
  const fs_ = families.filter((f) => f.test === t);
  const n = fs_.reduce((s, f) => s + f.n, 0);
  const tot = (k) => fs_.reduce((s, f) => s + f[k], 0) / n;
  return tot('sse') > tot('sseBase') + 0.005 || tot('sse') > tot('sseLogit') + 0.01;
});

const out = { ...fitAll, duration: durationAll, samples: { scoreline: usable.length, goalLog: usable.filter(isLive).length }, excluded, fittedAt: new Date().toISOString(), n: usable.length, trainN: train.length, testN: test.length };
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

## Props

Samples: scoreline ${out.samples.scoreline}, goal log ${out.samples.goalLog}.

### Duration to the last goal (Weibull, scale = lambda·exp(b·|gap|); live matches 30 s – 30 min)
| fit | lambda | k | b | n | median at gap 0 |
|---|---|---|---|---|---|
| shipped (all) | ${durationAll.lambda.toFixed(1)} | ${durationAll.k.toFixed(3)} | ${durationAll.b.toExponential(3)} | ${durationAll.n} | ${Math.round(durationAll.lambda * Math.pow(Math.LN2, 1 / durationAll.k))} s |
| train | ${durationTrain.lambda.toFixed(1)} | ${durationTrain.k.toFixed(3)} | ${durationTrain.b.toExponential(3)} | ${durationTrain.n} | ${Math.round(durationTrain.lambda * Math.pow(Math.LN2, 1 / durationTrain.k))} s |

### Per-prop backtest (fit on train, evaluated on test; both team sides pooled)
| family | n | mean p | observed | Brier model | Brier base rate | Brier logistic |
|---|---|---|---|---|---|---|
${families.map((f) => `| ${f.key} | ${f.n} | ${f.meanP.toFixed(3)} | ${f.rate.toFixed(3)} | ${(f.sse / f.n).toFixed(4)} | ${(f.sseBase / f.n).toFixed(4)} | ${(f.sseLogit / f.n).toFixed(4)} |`).join('\n')}

Excluded from offers: ${excluded.length ? excluded.join(', ') : 'none'}.

Rule: a test is excluded if, over its families pooled, the model's test Brier exceeds the base-rate Brier by
more than 0.005 or the logistic benchmark's by more than 0.01. Spec deviation: instead of switching such a
prop to the benchmark model it is simply not offered (simpler, and safe).
`;
fs.mkdirSync(path.join(ROOT, 'admin/model'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'admin/model/report.md'), report);
console.log(report);
