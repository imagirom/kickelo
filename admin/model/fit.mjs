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
