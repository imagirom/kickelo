// src/betting/ledger.js
// Derived betting ledger: nothing is ever "settled" in Firestore. Results and
// balances are recomputed from bets + matches, so match edits/deletes flow through.
import { BETTING } from './betting-config.js';
import { matchupKey } from './matchup.js';
import { evaluateOutcome } from './outcomes.js';

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
  const result = evaluateOutcome(match, bet.outcome);
  if (result === null) return { status: 'refunded', matchId: match.id, payout: bet.stake };
  return result
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
