// test/betting.test.js
// Betting: pure-logic tests (no browser, no Firestore).
import { BETTING, houseBetsActive } from '../src/betting/betting-config.js';
import { matchupKey, isFullLineup, sameTeam } from '../src/betting/matchup.js';
import { goalProbability, scorelineDistribution, winProbability, toOdds, logLikelihood, pathDistribution, outcomeProbability, normalCdf } from '../src/betting/model.js';
import { dayKey, firstGoalAt, resolveHouseBet, resolveChallenge, isLockedIn, computeBalances, checkBet, openStakeFor, acceptDecision, deniedChallengeReason } from '../src/betting/ledger.js';
import { liveStartQuestion, shouldClearAfterSubmit, buildOffer, shouldPublishLineup, needsOverwriteConfirm, goalUpdate, isLiveTakeover, ownsLive, showNotSharedHint, liveClaimUpdate } from '../src/betting/current-match.js';
import params from '../src/betting/model-params.json' with { type: 'json' };
import { OUTCOME_TESTS, evaluateOutcome, describeOutcome } from '../src/betting/outcomes.js';
import { candidateProps, eligible, drawProps, seededRandom } from '../src/betting/props.js';

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

console.log('\n=== shipped model params ===');
assertEq(Number.isFinite(params.s) && params.s > 0, true, 'fitted s is positive');
assertEq(params.kappa > 0, true, 'fitted kappa is positive');
assertEq(Math.abs(winProbability(0, params) - 0.5) < 0.05, true, 'gap 0 is near even (season start behaviour)');
assertEq(winProbability(300, params) > 0.7, true, 'a 300-point favourite is a clear favourite');
assertEq(params.n > 0 && params.trainN + params.testN === params.n, true, 'params come from a real fit');

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
  assertEq(bal.get('Simon').balance, BETTING.dailyAllowance - 20 + 38 - 20 + 20, 'Simon: allowance, win, refund');
  assertEq(bal.get('Marc').balance, BETTING.dailyAllowance - 10, 'Marc: allowance minus lost stake');
  assertEq(bal.has('Peter'), false, 'void-only bettor has no wallet');
  assertEq(bal.get('Simon').todayDelta, 18, 'todayDelta excludes allowance: +18 net from bets');
  const open = computeBalances([bet(day)], [], day + 1000);
  assertEq(open.get('Simon'), { balance: BETTING.dailyAllowance - 20, todayDelta: -20, open: 1 }, 'open bet: stake held');
  const twoDays = computeBalances([bet(day), bet(day + 24 * 3600 * 1000)], [], day + 3 * 24 * 3600 * 1000);
  assertEq(twoDays.get('Simon').balance, 2 * BETTING.dailyAllowance, 'two days of allowance, both refunded');
  assertEq(dayKey(day + 3600 * 1000), dayKey(day), 'dayKey groups by local day');

  assertEq(checkBet(bet(day), {}), { ok: true }, 'spectators can bet');
  assertEq(checkBet(bet(day, { bettor: red[0] }), {}), { ok: false, reason: `playing:${red[0]}` }, 'a player in the match cannot bet on it');
  assertEq(checkBet({ kind: 'challenge', matchupKey: key, challenger: 'Simon', opponent: blue[1] }, {}).reason, `playing:${blue[1]}`, 'nor be challenged on it');
  assertEq(checkBet({ kind: 'challenge', matchupKey: key, challenger: 'Simon', opponent: null, acceptedBy: red[1] }, {}).ok, false, 'nor accept a challenge on it');
}

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
  assertEq(needsOverwriteConfirm({ ...cur, liveId: 'x', liveStartedAt: null }, 'A::C|B::D', 0), true, 'live start still pending (server timestamp unresolved) -> confirm');
  assertEq(needsOverwriteConfirm(cur, cur.matchupKey, 5), false, 'same matchup -> never confirm');
  assertEq(needsOverwriteConfirm(null, 'A::C|B::D', 5), false, 'no current -> no confirm');

  assertEq(isLiveTakeover({ ...cur, liveStartedAt: 1 }, cur.matchupKey), true, 'same matchup already live -> takeover confirm');
  assertEq(isLiveTakeover({ ...cur, liveId: 'x' }, cur.matchupKey), true, 'live id without committed timestamp -> takeover');
  assertEq(isLiveTakeover(cur, cur.matchupKey), false, 'same matchup idle -> no takeover');
  assertEq(isLiveTakeover({ ...cur, liveStartedAt: 1 }, 'A::C|B::D'), false, 'other matchup -> handled by overwrite confirm');
  assertEq(isLiveTakeover(null, cur.matchupKey), false, 'no current -> no takeover');
  assertEq(ownsLive({ liveId: 'x' }, 'x'), true, 'own live id -> may write goals');
  assertEq(ownsLive({ liveId: 'y' }, 'x'), false, 'taken over -> stop writing goals');
  assertEq(ownsLive({ liveId: null }, null), false, 'never started here -> no writes');
  assertEq(ownsLive(null, 'x'), false, 'doc gone -> no writes');

  assertEq(goalUpdate({ firstGoalAt: null }, [{ team: 'red', timestamp: 1 }]), { goalLog: [{ team: 'red', timestamp: 1 }], firstGoalAt: 'SERVER' }, 'first goal stamps firstGoalAt');
  assertEq(goalUpdate({ firstGoalAt: 123 }, [{ team: 'red', timestamp: 1 }, { team: 'blue', timestamp: 2 }]), { goalLog: [{ team: 'red', timestamp: 1 }, { team: 'blue', timestamp: 2 }] }, 'later goals do not restamp');
  assertEq(goalUpdate({ firstGoalAt: 123 }, []), { goalLog: [] }, 'removing all goals never reopens betting');
}

console.log('\n=== submit clears offer ===');
{
  const cur = { matchupKey: 'A::B|C::D', offer: { winner: {} } };
  assertEq(shouldClearAfterSubmit(cur, ['A', 'B'], ['C', 'D']), true, 'logged match on the shared matchup clears its offer');
  assertEq(shouldClearAfterSubmit(cur, ['D', 'C'], ['B', 'A']), true, 'side/position order does not matter');
  assertEq(shouldClearAfterSubmit(cur, ['A', 'C'], ['B', 'D']), false, 'other matchup logged -> shared match untouched');
  assertEq(shouldClearAfterSubmit({ ...cur, offer: null }, ['A', 'B'], ['C', 'D']), false, 'already cleared -> no write');
  assertEq(shouldClearAfterSubmit(null, ['A', 'B'], ['C', 'D']), false, 'no shared match -> no write');
}

console.log('\n=== not-shared hint ===');
{
  const cur = { matchupKey: 'A::B|C::D', liveId: 'mine' };
  assertEq(showNotSharedHint(cur, null, {}), false, 'incomplete local lineup -> no hint');
  assertEq(showNotSharedHint(cur, 'A::B|C::D', {}), false, 'owner of the shared lineup -> no hint');
  assertEq(showNotSharedHint(cur, 'A::B|C::D', { live: true, liveId: 'mine' }), false, 'live owner -> no hint');
  assertEq(showNotSharedHint(cur, 'A::C|B::D', {}), true, 'different local lineup -> hint');
  assertEq(showNotSharedHint(null, 'A::C|B::D', {}), true, 'nothing shared yet -> hint');
  assertEq(showNotSharedHint(cur, 'A::B|C::D', { live: true, liveId: null }), true, 'declined takeover: live here, owned elsewhere -> hint');
  assertEq(showNotSharedHint(cur, 'A::B|C::D', { live: false, liveId: null }), false, 'spectator of own lineup -> no hint');
}

console.log('\n=== live claim ===');
{
  const goals = [{ team: 'red', timestamp: 1 }];
  const cur = { matchupKey: 'A::B|C::D', firstGoalAt: null };
  assertEq(liveClaimUpdate(cur, 'A::B|C::D', []), { goalLog: [] }, 'no goals yet -> firstGoalAt untouched');
  assertEq(liveClaimUpdate(cur, 'A::B|C::D', goals), { goalLog: goals, firstGoalAt: 'SERVER' }, 'goals scored before the claim close betting');
  assertEq(liveClaimUpdate({ ...cur, firstGoalAt: 5 }, 'A::B|C::D', goals), { goalLog: goals }, 'closed betting is never moved later');
  assertEq(liveClaimUpdate({ ...cur, firstGoalAt: 5 }, 'A::B|C::D', []), { goalLog: [] }, 'takeover never reopens betting');
  assertEq(liveClaimUpdate({ matchupKey: 'X::Y|Z::W', firstGoalAt: 5 }, 'A::B|C::D', goals), { goalLog: goals, firstGoalAt: 'SERVER' }, 'stale doc of another matchup -> stamp');
}

console.log('\n=== outcome tests ===');
{
  const R = ['Manuel', 'Marc']; const B = ['Roman', 'Tobi'];
  const g = (seq) => seq.split('').map((c, i) => ({ team: c === 'r' ? 'red' : 'blue', timestamp: (i + 1) * 34000 }));
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
  assertEq(evaluateOutcome(m, o('durationOver', { threshold: 270 })), true, 'last goal at 4:32 is over 4:30');
  assertEq(evaluateOutcome(m, o('durationOver', { threshold: 300 })), false, 'last goal at 4:32 is not over 5:00');
  assertEq(evaluateOutcome({ ...m, matchDuration: 400000 }, o('durationOver', { threshold: 300 })), false, 'a late Submit (timer still running) does not change duration');
  assertEq(evaluateOutcome({ ...m, goalLog: [] }, o('durationOver', { threshold: 270 })), null, 'duration needs a goal log');
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
  assertEq(describeOutcome(o('durationOver', { threshold: 270 }), lab), 'Duration over 4:30', 'describe duration');
  assertEq(describeOutcome(o('goesToFourFour', { negate: true }), lab), "Doesn't go to 4:4", 'describe negation positively');
  assertEq(describeOutcome(o('winner', { team: R, negate: true }), lab), 'MaMa lose', 'negated winner reads as a loss');
  assertEq(describeOutcome(o('comebackAtLeast', { team: B, threshold: 1, negate: true }), lab), 'No Roman + Tobi comeback from 1 down', 'negated comeback');
}

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
  const PD = { ...P, duration: { lambda: 300, k: 2.5, b: 0 } };
  assertClose(outcomeProbability({ test: 'durationOver', team: null, threshold: 300 * Math.pow(Math.LN2, 1 / 2.5) }, 0, PD), 0.5, 1e-9, 'Weibull median -> 0.5');
  assertClose(outcomeProbability({ test: 'durationOver', team: null, threshold: 300 }, 0, PD), Math.exp(-1), 1e-9, 'P(over lambda) = 1/e');
  const PDb = { ...P, duration: { lambda: 300, k: 2.5, b: -0.0003 } };
  assertEq(outcomeProbability({ test: 'durationOver', team: null, threshold: 300 }, 200, PDb) < outcomeProbability({ test: 'durationOver', team: null, threshold: 300 }, 0, PDb), true, 'b<0: lopsided matches are shorter');
  assertEq(outcomeProbability({ test: 'durationOver', team: null, threshold: 260 }, 0, P), null, 'no duration model -> null');
}

console.log('\n=== props ===');
{
  const P = { s: 1115, c: 0.01, kappa: 43, duration: { lambda: 296, k: 2.5, b: -0.0002 } };
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

console.log('\n=== prop bets in the ledger ===');
{
  const day = new Date(2026, 9, 8, 12).getTime();
  const R = ['Manuel', 'Marc']; const B = ['Roman', 'Tobi'];
  const m = { id: 'p1', timestamp: day + 300000, teamA: R, teamB: B, winner: 'A', goalsA: 5, goalsB: 1,
    matchDuration: 240000, goalLog: [{ team: 'red', timestamp: 30000 }] };
  const bet = (outcome) => ({ kind: 'house', matchupKey: 'Manuel::Marc|Roman::Tobi', placedAt: day, bettor: 'S', stake: 10, odds: 2, outcome, void: false });
  assertEq(resolveHouseBet(bet({ test: 'marginAtLeast', team: R, threshold: 3 }), [m], day + 400000).status, 'won', 'margin prop wins');
  assertEq(resolveHouseBet(bet({ test: 'marginAtLeast', team: R, threshold: 3, negate: true }), [m], day + 400000).status, 'lost', 'negated side loses');
  assertEq(resolveHouseBet(bet({ test: 'durationOver', team: null, threshold: 300 }), [{ ...m, goalLog: undefined }], day + 400000).status, 'refunded', 'missing data -> refund');
  assertEq(resolveHouseBet(bet({ test: 'winner', team: R }), [m], day + 400000).payout, 20, 'phase-1 winner bets unchanged');
}

console.log('\n=== candidateProps minSamples gate ===');
{
  const P = { ...params, duration: { lambda: 296, k: 2.5, b: 0, n: 100 } };
  const red = ['A', 'B']; const blue = ['C', 'D'];
  const tests = (ps) => new Set(candidateProps(red, blue, 0, ps, { minSamples: 30 }).map((c) => c.outcome.test));
  assertEq(tests({ ...P, samples: { scoreline: 100, goalLog: 100 } }).has('durationOver'), true, 'enough samples -> goal-log props');
  const few = tests({ ...P, samples: { scoreline: 100, goalLog: 10 } });
  assertEq(few.has('durationOver') || few.has('scoresFirst'), false, 'few goal logs -> no goal-log props');
  assertEq(few.has('marginAtLeast'), true, 'scoreline props kept');
  assertEq(tests({ ...P, samples: { scoreline: 10, goalLog: 10 } }).size, 0, 'few matches -> no props');
  assertEq(candidateProps(red, blue, 0, P).some((c) => c.outcome.test === 'durationOver'), true, 'default opts: no gate');
}

console.log('\n=== challenges in the ledger ===');
{
  const day = new Date(2026, 9, 8, 12).getTime();
  const R = ['Manuel', 'Marc']; const B = ['Roman', 'Tobi'];
  const key = 'Manuel::Marc|Roman::Tobi';
  const m = { id: 'c1', timestamp: day + 600000, teamA: R, teamB: B, winner: 'A', goalsA: 5, goalsB: 1, matchDuration: 240000, goalLog: [{ team: 'red', timestamp: 1 }] };
  const ch = (extra = {}) => ({ kind: 'challenge', matchupKey: key, placedAt: day, challenger: 'Simon', challengerStake: 10,
    opponent: null, opponentStake: 30, outcome: { test: 'marginAtLeast', team: R, threshold: 3 }, acceptedBy: null, acceptedAt: null, void: false, ...extra });
  const acc = { acceptedBy: 'Peter', acceptedAt: day + 300000 }; // first goal at day + 360001

  assertEq(resolveChallenge(ch(), [], day + 1000).status, 'open', 'unaccepted, no match -> open');
  assertEq(resolveChallenge(ch(), [m], day + 700000).status, 'cancelled', 'unaccepted when match logged -> cancelled');
  assertEq(resolveChallenge(ch(acc), [], day + 500000).status, 'pending', 'accepted, no match yet -> pending');
  assertEq(resolveChallenge(ch(acc), [m], day + 700000), { status: 'won', matchId: 'c1', challengerPayout: 40, acceptorPayout: 0 }, 'challenger right -> takes both stakes');
  assertEq(resolveChallenge(ch({ ...acc, outcome: { test: 'marginAtLeast', team: B, threshold: 3 } }), [m], day + 700000).acceptorPayout, 40, 'challenger wrong -> acceptor takes both');
  assertEq(resolveChallenge(ch({ acceptedBy: 'Peter', acceptedAt: day + 650000 }), [m], day + 700000).status, 'cancelled', 'accepted after the match was logged -> cancelled');
  assertEq(resolveChallenge(ch({ ...acc, outcome: { test: 'durationOver', team: null, threshold: 300 } }), [{ ...m, goalLog: undefined }], day + 700000),
    { status: 'refunded', matchId: 'c1', challengerPayout: 10, acceptorPayout: 30 }, 'undecidable outcome -> both refunded');
  assertEq(resolveChallenge(ch(acc), [], day + 24 * 3600 * 1000).status, 'refunded', 'accepted, no match by day end -> refunded');
  assertEq(resolveChallenge(ch({ acceptedBy: 'Peter', acceptedAt: day + 400000 }), [m], day + 700000).status, 'cancelled', 'posted before kick-off, accepted after the first goal -> cancelled');
  assertEq(resolveChallenge(ch({ placedAt: day + 370000, acceptedBy: 'Peter', acceptedAt: day + 400000 }), [m], day + 700000).status, 'won', 'posted mid-match, accepted mid-match -> counts');
  assertEq(resolveChallenge(ch({ acceptedBy: 'Peter', acceptedAt: day + 400000 }), [{ ...m, goalLog: undefined }], day + 700000).status, 'won', 'no goal log -> only the logging time cuts off');

  const bal = computeBalances([ch(acc)], [m], day + 700000);
  assertEq(bal.get('Simon').balance, BETTING.dailyAllowance - 10 + 40, 'challenger balance after a win');
  assertEq(bal.get('Peter').balance, BETTING.dailyAllowance - 30, 'acceptor balance after a loss (allowance counted)');
  const open = computeBalances([ch()], [], day + 1000);
  assertEq(open.get('Simon'), { balance: BETTING.dailyAllowance - 10, todayDelta: -10, open: 1 }, 'open challenge holds the challenger stake');
  assertEq(open.has('Peter'), false, 'no acceptor yet -> no wallet');
  assertEq(computeBalances([ch({ void: true })], [], day + 1000).size, 0, 'withdrawn challenge ignored');
}

console.log('\n=== challenge accept decision and overwrite stake ===');
{
  const c = { challenger: 'Simon', opponent: null, acceptedBy: null, void: false };
  assertEq(acceptDecision(c, 'Peter'), 'ok', 'open challenge -> ok');
  assertEq(acceptDecision({ ...c, acceptedBy: 'Tobi' }, 'Peter'), 'taken', 'already accepted -> taken');
  assertEq(acceptDecision({ ...c, void: true }, 'Peter'), 'withdrawn', 'withdrawn -> withdrawn');
  assertEq(acceptDecision({ ...c, opponent: 'Tobi' }, 'Peter'), 'not-you', 'addressed to someone else -> not-you');
  assertEq(acceptDecision({ ...c, opponent: 'Peter' }, 'Peter'), 'ok', 'addressed to me -> ok');
  assertEq(acceptDecision(c, 'Simon'), 'own', 'own challenge -> own');

  const day = new Date(2026, 9, 8, 12).getTime();
  const key = 'Manuel::Marc|Roman::Tobi';
  const R = ['Manuel', 'Marc']; const B = ['Roman', 'Tobi'];
  const house = { kind: 'house', matchupKey: key, placedAt: day, bettor: 'Simon', stake: 20, odds: 2, outcome: { test: 'winner', team: R }, void: false };
  const chal = { kind: 'challenge', matchupKey: key, placedAt: day, challenger: 'Peter', challengerStake: 10, opponent: null, opponentStake: 30,
    outcome: { test: 'winner', team: R }, acceptedBy: 'Tobi', acceptedAt: day + 1000, void: false };
  const other = { ...house, matchupKey: 'A::B|C::D' };
  const m = { id: 'x', timestamp: day + 600000, teamA: R, teamB: B, winner: 'A', goalsA: 5, goalsB: 1, matchDuration: 240000, goalLog: [{ team: 'red', timestamp: 1 }] };
  const resolved = { ...house, placedAt: day - 3600000 };
  assertEq(openStakeFor([house, chal, other, { ...house, void: true }], [], key, day + 2000), { count: 2, stake: 60 }, 'open house + accepted challenge counted');
  assertEq(openStakeFor([resolved], [m], key, day + 700000), { count: 0, stake: 0 }, 'resolved bets ignored');
  assertEq(openStakeFor([{ ...chal, acceptedBy: null, acceptedAt: null }], [], key, day + 2000), { count: 1, stake: 10 }, 'unaccepted challenge: challenger stake only');
}

console.log('\n=== denied challenge write -> reason from a fresh read ===');
{
  const c = { challenger: 'Simon', opponent: null, acceptedBy: null, void: false };
  assertEq(deniedChallengeReason({ ...c, acceptedBy: 'Tobi' }, 'Peter'), 'taken:Tobi', 'lost accept race -> taken:<winner>');
  assertEq(deniedChallengeReason({ ...c, void: true }, 'Peter'), 'withdrawn', 'accept vs withdraw -> withdrawn');
  assertEq(deniedChallengeReason(c, 'Peter'), 'closed', 'still open (matchup changed) -> closed');
  assertEq(deniedChallengeReason(null, 'Peter'), 'withdrawn', 'doc gone -> withdrawn');
  assertEq(deniedChallengeReason({ ...c, acceptedBy: 'Tobi' }), 'taken:Tobi', 'withdraw lost to accept -> taken:<acceptor>');
  assertEq(deniedChallengeReason(c), 'closed', 'withdraw denied otherwise -> closed');
}

console.log('\n=== day end ===');
{
  // 2026-10-25 has 25 hours in Europe (DST ends); +24h from midnight would be 23:00 the same day.
  const placed = new Date(2026, 9, 25, 1).getTime();
  const lateSameDay = new Date(2026, 9, 25, 23, 30).getTime();
  const nextDay = new Date(2026, 9, 26, 0, 5).getTime();
  const hb = { kind: 'house', matchupKey: 'A::B|C::D', placedAt: placed, bettor: 'S', stake: 10, odds: 2, outcome: { test: 'winner', team: ['A', 'B'] }, void: false };
  assertEq(resolveHouseBet(hb, [], lateSameDay).status, 'open', 'still open late on a 25-hour day');
  assertEq(resolveHouseBet(hb, [], nextDay).status, 'refunded', 'refunded after midnight');
  const short = { ...hb, placedAt: new Date(2026, 2, 29, 1).getTime() }; // 23-hour day
  assertEq(resolveHouseBet(short, [], new Date(2026, 2, 30, 0, 5).getTime()).status, 'refunded', 'refunded right after midnight on a 23-hour day');
}

console.log('\n=== balances over many matches (indexed) ===');
{
  const day = new Date(2026, 9, 8, 12).getTime();
  const R = ['Manuel', 'Marc']; const B = ['Roman', 'Tobi'];
  const filler = Array.from({ length: 2000 }, (_, i) => ({ id: `f${i}`, timestamp: day - 86400000 * (1 + (i % 300)), teamA: ['P', 'Q'], teamB: ['X', 'Y'], winner: 'A', goalsA: 5, goalsB: 0 }));
  const m = { id: 'real', timestamp: day + 1000, teamA: R, teamB: B, winner: 'A', goalsA: 5, goalsB: 1, matchDuration: 200000, goalLog: [{ team: 'red', timestamp: 100000 }] };
  const bets = Array.from({ length: 3000 }, (_, i) => ({ kind: 'house', matchupKey: 'Manuel::Marc|Roman::Tobi', placedAt: day - 200000, bettor: `B${i % 10}`, stake: 1, odds: 2, outcome: { test: 'winner', team: R }, void: false }));
  const t0 = Date.now();
  const bal = computeBalances(bets, [...filler, m], day + 2000);
  assertEq(bal.get('B0').balance, BETTING.dailyAllowance + 300, 'every bet resolved against the indexed match');
  assertEq(Date.now() - t0 < 500, true, '3,000 bets x 2,000 matches well under a second');
}

console.log('\n=== live start question ===');
{
  const cur = { matchupKey: 'A::B|C::D', liveId: 'x', liveStartedAt: 1, offer: {} };
  assertEq(liveStartQuestion(cur, 'A::B|C::D', 0, null), 'takeover', 'same matchup live on another phone -> takeover');
  assertEq(liveStartQuestion(cur, 'A::B|C::D', 0, 'x'), null, 'own live match -> no question');
  assertEq(liveStartQuestion(cur, 'A::C|B::D', 0, null), 'replace', 'other matchup live -> replace');
  assertEq(liveStartQuestion({ matchupKey: 'A::B|C::D', offer: {} }, 'A::C|B::D', 2, null), 'replace', 'other matchup with open bets -> replace');
  assertEq(liveStartQuestion({ matchupKey: 'A::B|C::D', offer: {} }, 'A::C|B::D', 0, null), null, 'idle other matchup without bets -> no question');
  assertEq(liveStartQuestion(cur, null, 3, null), null, 'incomplete local lineup -> no question (live may start before teams)');
  assertEq(liveStartQuestion(null, 'A::B|C::D', 0, null), null, 'no shared match -> no question');
}

console.log('\n=== locked-in challenges ===');
{
  const day = new Date(2026, 9, 8, 12).getTime();
  const R = ['Manuel', 'Marc']; const B = ['Roman', 'Tobi'];
  const lock = { kind: 'challenge', matchupKey: 'Manuel::Marc|Roman::Tobi', placedAt: day, challenger: 'Simon', challengerStake: 10,
    opponent: 'Peter', opponentStake: 30, outcome: { test: 'winner', team: R }, acceptedBy: 'Peter', acceptedAt: day, void: false };
  assertEq(isLockedIn(lock), true, 'named opponent accepted in the posting write -> locked in');
  assertEq(isLockedIn({ ...lock, acceptedAt: day + 5000 }), false, 'accepted later -> not a lock-in');
  assertEq(isLockedIn({ ...lock, opponent: null, acceptedBy: 'Peter' }), false, '"anyone" challenges are never locked in');
  const m = { id: 'L1', timestamp: day + 600000, teamA: R, teamB: B, winner: 'A', goalsA: 5, goalsB: 2, matchDuration: 240000, goalLog: [{ team: 'red', timestamp: 30000 }] };
  assertEq(resolveChallenge(lock, [], day + 1000).status, 'pending', 'locked in before the match -> pending, both stakes held');
  assertEq(resolveChallenge(lock, [m], day + 700000).challengerPayout, 40, 'locked-in challenge settles like an accepted one');
  const bal = computeBalances([lock], [], day + 1000);
  assertEq([bal.get('Simon').balance, bal.get('Peter').balance], [BETTING.dailyAllowance - 10, BETTING.dailyAllowance - 30], 'both stakes held from posting, allowance for both');
}

// --- further sections are appended by later tasks above this line ---

console.log('\n' + '='.repeat(60));
console.log(`Betting Tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
