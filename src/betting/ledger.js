// src/betting/ledger.js
// Derived betting ledger: nothing is ever "settled" in Firestore. Results and
// balances are recomputed from bets + matches, so match edits/deletes flow through.
import { BETTING } from './betting-config.js';
import { matchupKey, matchupPlayers } from './matchup.js';
import { evaluateOutcome } from './outcomes.js';

// One venue day across browsers and the server (including daylight-saving time).
const venueDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
});
export function dayKey(ms) {
  const parts = Object.fromEntries(venueDate.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

export function firstGoalAt(match) {
  if (!Array.isArray(match.goalLog) || match.goalLog.length === 0) return null;
  if (Number.isFinite(match.matchStartedAtMs)) return match.matchStartedAtMs + match.goalLog[0].timestamp;
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

/** A challenge to a named player is locked in when posted: accepted in the same write. */
export function isLockedIn(bet) {
  return Boolean(bet.opponent) && bet.acceptedBy === bet.opponent && bet.acceptedAt != null && bet.acceptedAt === bet.placedAt;
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

function book(wallets, days, player, ms, stake, payout, isOpen, today, status, policy) {
  const w = wallets.get(player) || { balance: 0, todayDelta: 0, open: 0 };
  if (!days.has(player)) days.set(player, new Map());
  const day = dayKey(ms);
  const activity = days.get(player).get(day) || { stake: 0, legacy: false };
  // Refunds and cancelled challenges must not manufacture another allowance.
  if (status !== 'refunded' && status !== 'cancelled') activity.stake += stake;
  if (policy !== 2) activity.legacy = true;
  days.get(player).set(day, activity);
  const net = payout - stake;
  w.balance += net;
  if (isOpen) w.open++;
  if (dayKey(ms) === today) w.todayDelta += net;
  wallets.set(player, w);
}

function computeLedger(bets, matches, now, cfg) {
  const wallets = new Map();
  const days = new Map();
  const today = dayKey(now);
  const index = indexByMatchup(matches);
  for (const bet of bets) {
    if (bet.void) continue;
    if (bet.kind === 'allowance') {
      book(wallets, days, bet.bettor, bet.placedAt, 0, 0, false, today, 'allowance', 2);
      days.get(bet.bettor).get(dayKey(bet.placedAt)).choice = bet;
    } else if (bet.kind === 'credit') {
      // An advance is money, not a stake or a fresh allowance.
      book(wallets, days, bet.bettor, bet.placedAt, 0, bet.advance, false, today, 'credit', 2);
      const activity = days.get(bet.bettor).get(dayKey(bet.placedAt));
      activity.borrowed = (activity.borrowed || 0) + bet.repayment;
    } else if (bet.kind === 'house') {
      const r = resolveHouseBet(bet, index, now);
      book(wallets, days, bet.bettor, bet.placedAt, bet.stake, r.payout, r.status === 'open', today, r.status, bet.allowancePolicy);
    } else if (bet.kind === 'challenge') {
      const r = resolveChallenge(bet, index, now);
      const isOpen = r.status === 'open' || r.status === 'pending';
      book(wallets, days, bet.challenger, bet.placedAt, bet.challengerStake, r.challengerPayout, isOpen, today, r.status, bet.allowancePolicy);
      if (bet.acceptedBy && typeof bet.acceptedAt === 'number') {
        book(wallets, days, bet.acceptedBy, bet.acceptedAt, bet.opponentStake, r.acceptorPayout, isOpen, today, r.status, bet.allowancePolicy);
      }
    }
  }
  const allowances = new Map();
  for (const [player, activity] of days) {
    let previousStake = null;
    let debt = 0;
    let todayRepayment = 0;
    let creditedToday = false;
    let todayAmount = cfg.dailyAllowance;
    for (const [day, entry] of [...activity].sort(([a], [b]) => a - b)) {
      const wheel = entry.choice?.mode === 'wheel' ? entry.choice : null;
      const amount = wheel ? wheel.allowance : entry.legacy ? cfg.dailyAllowance
        : Math.min(cfg.dailyAllowance, previousStake ?? cfg.dailyAllowance);
      const active = entry.legacy || entry.stake > 0;
      const repayment = Math.min(debt, wheel ? wheel.repayment : Math.floor(amount / 2));
      if (active) {
        wallets.get(player).balance += wheel ? wheel.payout : amount - repayment;
        debt -= repayment;
        if (day === today) wallets.get(player).todayDelta -= repayment;
      }
      // Loans taken today start repayment on a later active day.
      debt += entry.borrowed || 0;
      if (day === today) {
        creditedToday = active;
        todayAmount = amount;
        todayRepayment = repayment;
      }
      // Skip empty/refunded days when finding the previous active day.
      if (day < today && entry.stake > 0) previousStake = entry.stake;
    }
    if (!creditedToday && activity.get(today)?.choice?.mode !== 'wheel') todayAmount = Math.min(cfg.dailyAllowance, previousStake ?? cfg.dailyAllowance);
    if (!creditedToday) todayRepayment = Math.min(debt - (activity.get(today)?.borrowed || 0), Math.floor(todayAmount / 2));
    if (debt) wallets.get(player).debt = debt;
    allowances.set(player, { amount: todayAmount, credited: creditedToday, repayment: todayRepayment, choice: activity.get(today)?.choice });
  }
  return { wallets, allowances };
}

export function computeBalances(bets, matches, now, cfg = BETTING) {
  return computeLedger(bets, matches, now, cfg).wallets;
}

/** The same calculation drives the displayed balance and every stake check. */
export function walletAvailable(player, bets, matches, now, cfg = BETTING) {
  const { wallets, allowances } = computeLedger(bets, matches, now, cfg);
  const allowance = allowances.get(player) || { amount: cfg.dailyAllowance, credited: false, repayment: 0 };
  return {
    balance: (wallets.get(player)?.balance ?? 0) + (allowance.credited ? 0
      : allowance.choice?.mode === 'wheel' ? allowance.choice.payout : allowance.amount - allowance.repayment),
    allowance: allowance.amount,
    allowanceCredited: allowance.credited,
    repayment: allowance.repayment,
    debt: wallets.get(player)?.debt || 0,
    choice: allowance.choice,
  };
}

export function spendable(bettor, bets, matches, now, cfg = BETTING) {
  return walletAvailable(bettor, bets, matches, now, cfg).balance;
}

// A deterministic document ID also makes simultaneous requests on two phones idempotent.
export function creditId(bettor, now) {
  return `credit:${bettor}:${Math.floor(now / 86400000)}`;
}

export function canBorrow(bettor, bets, matches, now) {
  const w = computeBalances(bets, matches, now).get(bettor);
  return Boolean(bettor) && spendable(bettor, bets, matches, now) === 0 && !w?.debt
    && !bets.some(b => b.kind === 'credit' && b.bettor === bettor && Math.floor(b.placedAt / 86400000) === Math.floor(now / 86400000));
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

/** House rules: players in the match can't bet on it (house bet, challenge or accept). */
export function checkBet(bet, _context) {
  const playing = matchupPlayers(bet.matchupKey);
  const who = [bet.bettor, bet.challenger, bet.opponent, bet.acceptedBy].find((n) => n && playing.includes(n));
  return who ? { ok: false, reason: `playing:${who}` } : { ok: true };
}
