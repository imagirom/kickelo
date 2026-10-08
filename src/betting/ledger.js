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

/** Matches grouped by matchupKey, so resolving many bets does not rescan every match per bet. */
function indexByMatchup(matches) {
  const idx = new Map();
  for (const m of matches) {
    if (m.deleted || typeof m.timestamp !== 'number') continue;
    const k = matchupKey(m.teamA, m.teamB);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(m);
  }
  return idx;
}

/** `matches`: an array, or an index from indexByMatchup. */
function findMatch(matchupKeyOfBet, placedAt, matches) {
  const indexed = matches instanceof Map;
  const pool = indexed ? matches.get(matchupKeyOfBet) || [] : matches;
  const day = dayKey(placedAt);
  let best = null;
  for (const m of pool) {
    if (m.deleted || typeof m.timestamp !== 'number') continue;
    if (m.timestamp <= placedAt || dayKey(m.timestamp) !== day) continue;
    if (!indexed && matchupKey(m.teamA, m.teamB) !== matchupKeyOfBet) continue;
    if (!best || m.timestamp < best.timestamp) best = m;
  }
  return best;
}

export function resolveHouseBet(bet, matches, now) {
  const match = findMatch(bet.matchupKey, bet.placedAt, matches);
  if (!match) {
    const dayOver = dayKey(now) > dayKey(bet.placedAt); // not +24h: DST days are 23/25 h
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

export function resolveChallenge(bet, matches, now) {
  const match = findMatch(bet.matchupKey, bet.placedAt, matches);
  const accepted = Boolean(bet.acceptedBy) && typeof bet.acceptedAt === 'number';
  const refundAll = (status, matchId) => ({ status, matchId,
    challengerPayout: bet.challengerStake, acceptorPayout: accepted ? bet.opponentStake : 0 });
  if (!match) {
    const dayOver = dayKey(now) > dayKey(bet.placedAt); // not +24h: DST days are 23/25 h
    if (!dayOver) return { status: accepted ? 'pending' : 'open', matchId: null, challengerPayout: 0, acceptorPayout: 0 };
    return refundAll(accepted ? 'refunded' : 'cancelled', null);
  }
  if (!accepted || bet.acceptedAt >= match.timestamp) return refundAll('cancelled', match.id);
  // Posted before kick-off -> acceptable only until the first goal (the challenger never agreed to
  // being taken on at 4:0). Challenges posted mid-match stay acceptable until the match is logged.
  const fg = firstGoalAt(match);
  if (fg !== null && bet.placedAt < fg && bet.acceptedAt >= fg) return refundAll('cancelled', match.id);
  const result = evaluateOutcome(match, bet.outcome);
  if (result === null) return refundAll('refunded', match.id);
  const pot = bet.challengerStake + bet.opponentStake;
  return result
    ? { status: 'won', matchId: match.id, challengerPayout: pot, acceptorPayout: 0 }
    : { status: 'lost', matchId: match.id, challengerPayout: 0, acceptorPayout: pot };
}

function book(wallets, days, player, ms, stake, payout, isOpen, today) {
  const w = wallets.get(player) || { balance: 0, todayDelta: 0, open: 0 };
  if (!days.has(player)) days.set(player, new Set());
  days.get(player).add(dayKey(ms));
  const net = payout - stake;
  w.balance += net;
  if (isOpen) w.open++;
  if (dayKey(ms) === today) w.todayDelta += net;
  wallets.set(player, w);
}

export function computeBalances(bets, matches, now, cfg = BETTING) {
  const wallets = new Map();
  const days = new Map();
  const today = dayKey(now);
  const index = indexByMatchup(matches);
  for (const bet of bets) {
    if (bet.void) continue;
    if (bet.kind === 'house') {
      const r = resolveHouseBet(bet, index, now);
      book(wallets, days, bet.bettor, bet.placedAt, bet.stake, r.payout, r.status === 'open', today);
    } else if (bet.kind === 'challenge') {
      const r = resolveChallenge(bet, index, now);
      const isOpen = r.status === 'open' || r.status === 'pending';
      book(wallets, days, bet.challenger, bet.placedAt, bet.challengerStake, r.challengerPayout, isOpen, today);
      if (bet.acceptedBy && typeof bet.acceptedAt === 'number') {
        book(wallets, days, bet.acceptedBy, bet.acceptedAt, bet.opponentStake, r.acceptorPayout, isOpen, today);
      }
    }
  }
  for (const [player, w] of wallets) w.balance += cfg.dailyAllowance * days.get(player).size;
  return wallets;
}

/** Open stake on a matchup (for the overwrite dialog): open house bets and open/pending challenges. */
export function openStakeFor(bets, matches, key, now) {
  let count = 0;
  let stake = 0;
  const index = indexByMatchup(matches);
  for (const b of bets) {
    if (b.void || b.matchupKey !== key) continue;
    if (b.kind === 'house' && resolveHouseBet(b, index, now).status === 'open') {
      count++;
      stake += b.stake;
    } else if (b.kind === 'challenge' && ['open', 'pending'].includes(resolveChallenge(b, index, now).status)) {
      count++;
      stake += b.challengerStake + (b.acceptedBy ? b.opponentStake : 0);
    }
  }
  return { count, stake };
}

/** Whether `acceptor` may accept challenge doc `c` (checked inside the accept transaction). */
export function acceptDecision(c, acceptor) {
  if (c.acceptedBy) return 'taken';
  if (c.void) return 'withdrawn';
  if (c.opponent && c.opponent !== acceptor) return 'not-you';
  if (acceptor === c.challenger) return 'own';
  return 'ok';
}

/**
 * Error message for a challenge write the rules denied, from a fresh read of the doc
 * (null = gone). acceptor null = a withdraw. A lost accept race is denied by the rules,
 * not retried as contention, so this is how the loser learns who took it.
 */
export function deniedChallengeReason(c, acceptor = null) {
  if (!c) return 'withdrawn';
  if (c.acceptedBy) return `taken:${c.acceptedBy}`;
  if (!acceptor) return 'closed';
  const d = acceptDecision(c, acceptor);
  return d === 'ok' ? 'closed' : d;
}

/** House rules hook. "Anything goes" for now. */
export function checkBet(_bet, _context) {
  return { ok: true };
}
