// src/betting/props.js
// House props: all candidate outcomes, filtered to near-even odds, drawn with a
// PRNG seeded by matchup + date so the publishing device's draw is reproducible.
import { OUTCOME_TESTS } from './outcomes.js';
import { outcomeProbability } from './model.js';
import { teamKey } from '../teams/team-identity.js';

export function candidateProps(red, blue, gap, params, opts = { minSamples: 0 }) {
  const out = [];
  const min = opts.minSamples || 0;
  if (params.samples?.scoreline < min) return out;
  for (const def of OUTCOME_TESTS) {
    if (def.id === 'winner' || params.excluded?.includes(def.id)) continue;
    if (def.needsGoalLog && params.samples?.goalLog < min) continue;
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
