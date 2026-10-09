// src/betting/bets-ui.js
// Bets box under the match form: shared match header, live view for spectators,
// house winner odds, place-bet sheet and today's bet feed for this matchup.
import { allPlayers } from '../player-data-service.js';
import { allMatches } from '../match-data-service.js';
import { teamKey } from '../teams/team-identity.js';
import { matchupKey, matchupPlayers } from './matchup.js';
import { getTeamRecord } from '../teams/team-service.js';
import { showConfirm, showToast } from '../toast.js';
import { createTimelineSVG, formatMsToMMSS } from '../match-timeline.js';
import { BETTING, houseBetsActive } from './betting-config.js';
import { describeOutcome, OUTCOME_TESTS, mmss } from './outcomes.js';
import { isLockedIn, resolveHouseBet, resolveChallenge, dayKey } from './ledger.js';
import { getCurrentMatch } from './current-match-service.js';
import { getBets, placeHouseBet, undoBet, available, placeChallenge, acceptChallenge, withdrawChallenge } from './bets-service.js';
import { footballs, GF_ICON_SRC } from './currency.js';
import { isLiveOnThisDevice } from './sync-controller.js';

const BETTOR_KEY = 'betting.bettor';
let initialized = false;
let timerId = null;

const label = (pair = []) => getTeamRecord(teamKey(pair))?.name || pair.join(' + ');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHeader(cm) {
  const row = el('div', 'bets-header');
  const icon = el('img', 'gf-icon gf-shine bets-header-icon');
  icon.src = GF_ICON_SRC;
  icon.alt = '';
  row.append(el('span', 'live-team-label red bets-header-red', label(cm.red)), icon,
    el('span', 'live-team-label blue bets-header-blue', label(cm.blue)));
  return row;
}

function renderLive(cm) {
  const startedMs = cm.liveStartedAt?.toMillis?.();
  if (!startedMs || isLiveOnThisDevice()) return null;
  const goals = cm.goalLog || [];
  const red = goals.filter((g) => g.team === 'red').length;
  const row = el('div', 'bets-live');
  const top = el('div', 'bets-live-top');
  const timer = el('span', 'live-timer', formatMsToMMSS(Date.now() - startedMs));
  timer.dataset.startedMs = String(startedMs);
  top.append(el('span', 'bets-live-dot', '● LIVE'), timer, el('span', 'bets-live-score', `${red} : ${goals.length - red}`));
  row.appendChild(top);
  const tl = el('div', 'bets-timeline');
  tl.goals = goals;
  drawTimeline(tl, Date.now() - startedMs);
  row.appendChild(tl);
  return row;
}

/** The line runs to the current game time, so it grows every second. */
function drawTimeline(tl, elapsedMs) {
  // goals after the clock (a peer's clock running ahead) still fit on the line
  const total = Math.max(elapsedMs, ...tl.goals.map((g) => g.timestamp || 0));
  tl.innerHTML = createTimelineSVG(tl.goals, 400, total) ?? ''; // generated markup: numbers and fixed strings only
}

const fmtOdds = (odds) => `${odds}×`;

/** Pre-match challenges close at the first goal (rules + ledger); mid-match ones stay acceptable. */
function houseClosed(cm) {
  // goalLog check covers the publishing device, where firstGoalAt reads null until the server write lands
  return Boolean(cm.firstGoalAt || cm.goalLog?.length);
}

function renderHouse(cm) {
  if (!houseBetsActive()) return null;
  const row = el('div', 'bets-house');
  if (!cm.offer) {
    row.appendChild(el('div', 'bets-caption', 'House opens when the next lineup is set.'));
    return row;
  }
  if (houseClosed(cm)) {
    // collapsed: the disabled buttons only pushed the feed and challenges down
    const was = [cm.red, cm.blue].map((pair) => `${label(pair)} ${fmtOdds(cm.offer.winner?.[teamKey(pair)])}`).join(', ');
    row.appendChild(el('div', 'bets-caption', `Closed at first goal · odds were ${was}`));
    return row;
  }
  const buttons = el('div', 'live-score-buttons bets-odds');
  for (const [side, pair, cls] of [['Red', cm.red, 'red_select'], ['Blue', cm.blue, 'blue_select']]) {
    const odds = cm.offer.winner?.[teamKey(pair)];
    const btn = el('button', cls, `${side} wins ${fmtOdds(odds)}`);
    btn.type = 'button';
    btn.disabled = !odds;
    btn.addEventListener('click', () => openBetSheet({
      outcome: { test: 'winner', team: pair, threshold: null }, odds, title: `${label(pair)} to win`, matchupKey: cm.matchupKey,
    }));
    buttons.appendChild(btn);
  }
  row.appendChild(buttons);
  for (const prop of cm.offer.props || []) {
    const line = el('div', 'bets-prop');
    line.appendChild(el('span', 'bets-prop-label', describeOutcome(prop.outcome, label)));
    for (const [text, negate, odds] of [['Yes', false, prop.oddsYes], ['No', true, prop.oddsNo]]) {
      const btn = el('button', 'bets-prop-btn', `${text} ${fmtOdds(odds)}`);
      btn.type = 'button';
      btn.disabled = !odds;
      const outcome = { ...prop.outcome, negate };
      btn.addEventListener('click', () => openBetSheet({
        outcome: { ...outcome, propId: prop.id }, odds, title: describeOutcome(outcome, label), matchupKey: cm.matchupKey,
      }));
      line.appendChild(btn);
    }
    row.appendChild(line);
  }
  // Only the live-scoring phone writes goals: without live mode the cutoff is unknown and every house bet is refunded.
  const live = Boolean(cm.liveStartedAt || cm.liveId);
  row.appendChild(el('div', 'bets-caption', live ? 'Closes at first goal'
    : 'Closes at first goal · live mode only'));
  return row;
}

function renderChallengeButton(cm) {
  // ponytail: offer is null between a logged match and the next lineup publish -> no target match
  if (!BETTING.challenges || !BETTING.liveSync || !cm.offer) return null;
  const btn = el('button', 'bets-challenge-btn', 'Challenge someone…');
  btn.type = 'button';
  btn.addEventListener('click', () => openChallengeForm(cm));
  return btn;
}

/** who + stake (+ result) / outcome (/ actions, below the outcome they act on) */
function feedLine(className, who, what, tail, actions = null) {
  const li = el('li', className);
  const top = el('div', 'bets-feed-top');
  top.append(...who);
  if (tail) top.appendChild(tail);
  li.append(top, el('div', 'bets-feed-what', what));
  if (actions) li.appendChild(actions);
  return li;
}

function houseFeedLine(bet, now) {
  const r = resolveHouseBet(bet, allMatches || [], now);
  let tail = null;
  if (r.status !== 'open') {
    tail = el('span', `bets-feed-result ${r.status}`, r.status === 'won' ? 'won ' : r.status);
    if (r.status === 'won') tail.appendChild(footballs(r.payout));
  }
  return feedLine('', [el('span', 'bets-feed-bettor', bet.bettor), footballs(bet.stake)],
    `${describeOutcome(bet.outcome, label)} · ${fmtOdds(bet.odds)}`, tail);
}

function stakes(bet) {
  const span = el('span', 'bets-feed-stakes');
  span.append(footballs(bet.challengerStake), ' vs ', footballs(bet.opponentStake));
  return span;
}

function challengeFeedLine(bet, now, cm) {
  const r = resolveChallenge(bet, allMatches || [], now);
  const who = [el('span', 'bets-feed-bettor', `${bet.challenger} → ${bet.opponent || 'anyone'}`), stakes(bet)];
  const what = describeOutcome(bet.outcome, label);
  const pot = bet.challengerStake + bet.opponentStake;
  if (r.status === 'open') {
    const actions = el('span', 'bets-feed-actions');
    const fgMs = cm?.firstGoalAt?.toMillis?.();
    const closed = cm?.matchupKey === bet.matchupKey && houseClosed(cm) && !(fgMs && bet.placedAt > fgMs);
    if (closed) actions.appendChild(el('span', 'bets-feed-result', 'closed at first goal'));
    else if (BETTING.challenges) {
      const accept = el('button', 'bets-feed-btn bets-accept', 'Accept');
      accept.type = 'button';
      accept.addEventListener('click', () => openAcceptSheet(bet));
      actions.appendChild(accept);
    }
    const withdraw = el('button', 'bets-feed-btn bets-withdraw', 'Withdraw');
    withdraw.type = 'button';
    withdraw.addEventListener('click', async () => {
      // anyone's phone can withdraw (no accounts), so never on a single mis-tap next to Accept
      const ok = await showConfirm(`Withdraw ${bet.challenger}'s challenge?\n${what}`,
        { confirmLabel: 'Withdraw', cancelLabel: 'Keep', type: 'warning' });
      if (ok) withdrawChallenge(bet.id).then(() => showToast('Challenge withdrawn', 'success'), challengeError);
    });
    actions.appendChild(withdraw);
    return feedLine('bets-feed-challenge', who, what, null, actions);
  }
  const tail = el('span', `bets-feed-result ${r.status === 'lost' ? 'won' : r.status}`);
  const winner = { won: bet.challenger, lost: bet.acceptedBy }[r.status];
  if (winner) tail.append(`${winner} won `, footballs(pot));
  else if (r.status === 'pending') tail.textContent = isLockedIn(bet) ? 'locked in' : `accepted by ${bet.acceptedBy}`;
  else tail.textContent = r.status;
  return feedLine('bets-feed-challenge', who, what, tail);
}

function feedList(bets, now, cm) {
  const list = el('ul', 'bets-feed');
  for (const bet of bets) list.appendChild(bet.kind === 'challenge' ? challengeFeedLine(bet, now, cm) : houseFeedLine(bet, now));
  return list;
}

/** Today's bets on the shared matchup, then the results of the last logged match if that was
 *  another matchup: setting the next lineup right after Submit must not hide who just won. */
function renderFeed(cm) {
  const now = Date.now();
  const today = dayKey(now);
  const todays = getBets()
    .filter((b) => !b.void && (b.kind === 'house' || b.kind === 'challenge') && dayKey(b.placedAt) === today)
    .sort((a, b) => b.placedAt - a.placedAt);
  const parts = [];
  const current = todays.filter((b) => b.matchupKey === cm.matchupKey);
  if (current.length) parts.push(feedList(current, now, cm));

  let last = null;
  for (const m of allMatches || []) {
    if (!m.deleted && typeof m.timestamp === 'number' && dayKey(m.timestamp) === today && (!last || m.timestamp > last.timestamp)) last = m;
  }
  const lastKey = last ? matchupKey(last.teamA, last.teamB) : '';
  if (lastKey && lastKey !== cm.matchupKey) {
    const resolvedBy = (b) => (b.kind === 'house' ? resolveHouseBet(b, allMatches, now) : resolveChallenge(b, allMatches, now)).matchId === last.id;
    const lastBets = todays.filter((b) => b.matchupKey === lastKey && resolvedBy(b));
    if (lastBets.length) parts.push(el('div', 'bets-feed-heading', `Last match: ${label(last.teamA)} vs ${label(last.teamB)}`), feedList(lastBets, now, cm));
  }
  return parts;
}

/** Who can bet: everyone except the four players in the match. */
const playerNames = (key) => allPlayers.map((p) => p.id).filter((n) => !matchupPlayers(key).includes(n)).sort();

function fillSelect(select, names, keep) {
  select.replaceChildren(...names.map(([value, text]) => new Option(text, value)));
  if (names.some(([value]) => value === keep)) select.value = keep;
}

function challengeError(err) {
  const m = err?.message || '';
  if (m.startsWith('taken:')) showToast(`Already taken by ${m.slice(6)}`, 'warning');
  else if (m === 'withdrawn') showToast('Challenge was withdrawn', 'warning');
  else if (m === 'not-you') showToast('This challenge is for someone else', 'warning');
  else if (m === 'own') showToast("You can't accept your own challenge", 'warning');
  else if (m === 'insufficient') showToast('Not enough golden footballs', 'warning');
  else if (m.startsWith('insufficient:')) showToast(`${m.slice(13)} doesn't have enough golden footballs`, 'warning');
  else if (m === 'too-much') showToast(`Stakes are limited to ${BETTING.maxStake} golden footballs`, 'warning');
  else if (m.startsWith('playing:')) showToast(`${m.slice(8)} is playing in this match and can't bet on it`, 'warning');
  else if (m === 'closed') showToast('Challenge is closed', 'warning');
  else if (m === 'changed') showToast('The shared match changed — challenge not posted', 'warning');
  else { console.warn('[betting] challenge failed', err); showToast('Challenge failed', 'error'); }
}

const TEST_LABELS = {
  winner: 'Win', marginAtLeast: 'Win by …', shutout: 'Win 5:0', goesToFourFour: 'Goes to 4:4',
  durationOver: 'Duration over …', scoresFirst: 'Scores first', firstScorerWins: 'First scorer wins', comebackAtLeast: 'Comeback from …',
};

const THRESHOLD = {
  marginAtLeast: ['Margin', (k) => `${k}+ goals`],
  comebackAtLeast: ['Trailing by', (k) => `${k} goal${k === 1 ? '' : 's'}`],
  durationOver: ['Longer than', mmss],
};

function numberInput(className, value) {
  const input = el('input', className);
  input.type = 'number';
  input.min = '1';
  input.step = '1';
  input.inputMode = 'numeric';
  if (value !== undefined) input.value = String(value);
  return input;
}

function field(text, control, tag = 'label') {
  const wrap = el(tag, 'bet-sheet-field');
  wrap.append(el('span', 'bet-sheet-field-label', text), control);
  return wrap;
}

/** "Payout: 18⚽ · Balance: 100⚽" with the golden-football icon on every amount. */
function amounts(node, pairs) {
  node.replaceChildren();
  pairs.forEach(([text, n], i) => node.append(i ? ` · ${text} ` : `${text} `, footballs(n)));
}

/** Disable the sheet's confirm button while someone can't cover their stake, and say who. */
function guardBalance(sheet, info, short) {
  const okBtn = sheet.closest('.confirm-dialog')?.querySelector('.confirm-btn-ok');
  if (okBtn) okBtn.disabled = short.length > 0;
  if (short.length) info.appendChild(el('div', 'bet-sheet-short', `Not enough golden footballs: ${short.join(', ')}`));
}

async function openChallengeForm(cm) {
  const sheet = el('div', 'bet-sheet');
  sheet.appendChild(el('div', 'bet-sheet-title', 'Challenge'));

  const challengerSelect = el('select', 'challenge-challenger');
  const opponentSelect = el('select', 'challenge-opponent');
  fillSelect(challengerSelect, [['', 'Who is challenging?'], ...playerNames(cm.matchupKey).map((n) => [n, n])], readBettor());
  const fillOpponents = () => fillSelect(opponentSelect,
    [['', 'Anyone'], ...playerNames(cm.matchupKey).filter((n) => n !== challengerSelect.value).map((n) => [n, n])], opponentSelect.value);
  fillOpponents();

  const testSelect = el('select', 'challenge-test');
  fillSelect(testSelect, OUTCOME_TESTS.map((t) => [t.id, TEST_LABELS[t.id] || t.id]), 'winner');
  const teamSelect = el('select', 'challenge-team');
  fillSelect(teamSelect, [[teamKey(cm.red), label(cm.red)], [teamKey(cm.blue), label(cm.blue)]]);
  const teams = { [teamKey(cm.red)]: cm.red, [teamKey(cm.blue)]: cm.blue };
  const thresholdSelect = el('select', 'challenge-threshold');
  let negate = false;
  const sideToggle = el('div', 'bet-sheet-chips challenge-side');
  sideToggle.setAttribute('role', 'group');
  sideToggle.setAttribute('aria-label', 'Side');
  const sideButtons = [['I claim it', false], ['I bet against', true]].map(([text, value]) => {
    const btn = el('button', 'bet-chip', text);
    btn.type = 'button';
    btn.addEventListener('click', () => { negate = value; update(); });
    sideToggle.appendChild(btn);
    return [btn, value];
  });
  const preview = el('div', 'bet-sheet-title challenge-preview');

  const myStake = numberInput('bet-sheet-stake challenge-my-stake', 10);
  const theirStake = numberInput('bet-sheet-stake challenge-their-stake', 10);
  myStake.setAttribute('aria-label', 'Challenger stake');
  theirStake.setAttribute('aria-label', 'Opponent stake');
  const stakeRow = el('div', 'challenge-stakes');
  stakeRow.append(myStake, el('span', 'challenge-vs', 'vs'), theirStake);
  const info = el('div', 'bet-sheet-info');
  const lockNote = el('div', 'bet-sheet-info challenge-lock-note');

  const teamRow = field('Team', teamSelect);
  const thresholdRow = field('By', thresholdSelect);
  const def = () => OUTCOME_TESTS.find((t) => t.id === testSelect.value);
  function outcome() {
    const d = def();
    return { test: d.id, team: d.hasTeam ? teams[teamSelect.value] : null,
      threshold: d.thresholds ? Number(thresholdSelect.value) : null, negate };
  }
  function update() {
    const d = def();
    teamRow.hidden = !d.hasTeam;
    thresholdRow.hidden = !d.thresholds;
    if (d.thresholds) {
      const [text, fmt] = THRESHOLD[d.id] || ['By', String];
      thresholdRow.firstChild.textContent = text;
      fillSelect(thresholdSelect, d.thresholds.map((k) => [String(k), fmt(k)]), thresholdSelect.value);
    }
    for (const [btn, value] of sideButtons) {
      btn.classList.toggle('active', value === negate);
      btn.setAttribute('aria-pressed', String(value === negate));
    }
    preview.textContent = describeOutcome(outcome(), label);
    const mine = Number(myStake.value) || 0;
    const theirs = Number(theirStake.value) || 0;
    const challenger = challengerSelect.value || 'Challenger';
    const opponent = opponentSelect.value;
    info.replaceChildren(`${challenger} `, footballs(mine), ` vs ${opponent || 'anyone'} `, footballs(theirs),
      ' · winner gets ', footballs(mine + theirs));
    const balances = [[`${challenger}:`, challengerSelect.value ? available(challengerSelect.value) : 0]];
    if (opponent) balances.push([`${opponent}:`, available(opponent)]);
    const balanceLine = el('div');
    amounts(balanceLine, balances.map(([who, n], i) => [i ? who : `Balance ${who}`, n]));
    info.appendChild(balanceLine);
    // A named opponent is locked in straight away; "anyone" needs someone to accept.
    lockNote.textContent = opponent ? `Locks in straight away for ${opponent} — no accept needed.` : 'Open until someone accepts.';
    const okBtn = sheet.closest('.confirm-dialog')?.querySelector('.confirm-btn-ok');
    if (okBtn) okBtn.textContent = opponent ? 'Lock in' : 'Post challenge';
    guardBalance(sheet, info, [[challengerSelect.value, mine], [opponent, theirs]]
      .filter(([who, n]) => who && n > available(who)).map(([who]) => who));
  }
  challengerSelect.addEventListener('change', () => { fillOpponents(); update(); });
  opponentSelect.addEventListener('change', update);
  for (const node of [testSelect, teamSelect, thresholdSelect]) node.addEventListener('change', update);
  for (const node of [myStake, theirStake]) node.addEventListener('input', update);
  update();

  const grid = el('div', 'bet-sheet-grid');
  grid.append(field('Challenger', challengerSelect), field('Against', opponentSelect), field('Bet', testSelect),
    teamRow, thresholdRow, field('Side', sideToggle, 'div'), field('Stakes', stakeRow, 'div'));
  sheet.append(grid, preview, info, lockNote);
  const pending = showConfirm('', { contentElement: sheet, confirmLabel: 'Post challenge', cancelLabel: 'Cancel' });
  update(); // the dialog exists now: label its confirm button
  const ok = await pending;
  if (!ok) return;

  const challenger = challengerSelect.value;
  const challengerStake = Number(myStake.value);
  const opponentStake = Number(theirStake.value);
  const whole = (n) => Number.isInteger(n) && n >= 1;
  if (!challenger || !whole(challengerStake) || !whole(opponentStake)) {
    showToast('Pick a challenger and whole-number stakes', 'warning');
    return;
  }
  saveBettor(challenger);
  try {
    const id = await placeChallenge({ challenger, opponent: opponentSelect.value || null, outcome: outcome(), challengerStake, opponentStake, matchupKey: cm.matchupKey });
    showToast(opponentSelect.value ? 'Challenge locked in — tap to undo' : 'Challenge posted — tap to undo', 'success', BETTING.undoWindowMs, () => {
      withdrawChallenge(id).catch(challengeError);
    });
  } catch (err) {
    challengeError(err);
  }
}

/** "Live 1:1 · posted at 0:45" so nobody accepts a bet the score has already decided. */
function liveContext(cm, bet) {
  const startedMs = cm?.matchupKey === bet.matchupKey ? cm.liveStartedAt?.toMillis?.() : null;
  if (!startedMs) return null;
  const goals = cm.goalLog || [];
  const red = goals.filter((g) => g.team === 'red').length;
  const posted = bet.placedAt >= startedMs ? `posted at ${formatMsToMMSS(bet.placedAt - startedMs)}` : 'posted before kick-off';
  return `Live ${red}:${goals.length - red} · ${posted}`;
}

async function openAcceptSheet(bet) {
  const sheet = el('div', 'bet-sheet');
  // the acceptor's side, said positively (the challenger claims the opposite)
  sheet.appendChild(el('div', 'bet-sheet-title', `You back: ${describeOutcome({ ...bet.outcome, negate: !bet.outcome.negate }, label)}`));
  sheet.appendChild(el('div', 'bet-sheet-info', `${bet.challenger} claims: ${describeOutcome(bet.outcome, label)}`));
  const context = liveContext(getCurrentMatch(), bet);
  if (context) sheet.appendChild(el('div', 'bet-sheet-info bets-live-context', context));
  const acceptorSelect = el('select', 'challenge-acceptor');
  const names = bet.opponent ? [bet.opponent] : playerNames(bet.matchupKey).filter((n) => n !== bet.challenger);
  fillSelect(acceptorSelect, [...(bet.opponent ? [] : [['', 'Who accepts?']]), ...names.map((n) => [n, n])], readBettor());
  const info = el('div', 'bet-sheet-info');
  const update = () => {
    const balance = acceptorSelect.value ? available(acceptorSelect.value) : 0;
    amounts(info, [['Your stake', bet.opponentStake], ['win', bet.challengerStake + bet.opponentStake], ['Balance:', balance]]);
    guardBalance(sheet, info, acceptorSelect.value && bet.opponentStake > balance ? [acceptorSelect.value] : []);
  };
  acceptorSelect.addEventListener('change', update);
  update();
  sheet.append(field('Who accepts', acceptorSelect), info);
  const pending = showConfirm('', { contentElement: sheet, confirmLabel: 'Accept', cancelLabel: 'Cancel' });
  update(); // the dialog exists now: guard its confirm button
  const ok = await pending;
  if (!ok) return;
  const acceptor = acceptorSelect.value;
  if (!acceptor) { showToast('Pick who accepts', 'warning'); return; }
  saveBettor(acceptor);
  try {
    await acceptChallenge(bet.id, acceptor);
    showToast('Challenge accepted', 'success');
  } catch (err) {
    challengeError(err);
  }
}

function readBettor() {
  try { return localStorage.getItem(BETTOR_KEY) || ''; } catch { return ''; }
}

function saveBettor(name) {
  try { localStorage.setItem(BETTOR_KEY, name); } catch { /* storage unavailable */ }
}

async function openBetSheet({ outcome, odds, title, matchupKey: key }) {
  const sheet = el('div', 'bet-sheet');
  sheet.appendChild(el('div', 'bet-sheet-title', `${title} · ${fmtOdds(odds)}`));

  const bettorSelect = el('select', 'bet-sheet-bettor');
  fillSelect(bettorSelect, [['', 'Who is betting?'], ...playerNames(key).map((n) => [n, n])], readBettor());

  const chips = el('div', 'bet-sheet-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Stake');
  const stakeInput = numberInput('bet-sheet-stake');
  stakeInput.placeholder = 'Other';
  stakeInput.setAttribute('aria-label', 'Stake');
  const chipButtons = BETTING.stakeChips.map((chip) => {
    const btn = el('button', 'bet-chip', String(chip));
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => { stakeInput.value = String(chip); update(); });
    chips.appendChild(btn);
    return [btn, chip];
  });
  chips.appendChild(stakeInput);

  const info = el('div', 'bet-sheet-info');
  function update() {
    const stake = Number(stakeInput.value) || 0;
    for (const [btn, chip] of chipButtons) {
      btn.classList.toggle('active', chip === stake);
      btn.setAttribute('aria-pressed', String(chip === stake));
    }
    const balance = bettorSelect.value ? available(bettorSelect.value) : 0;
    amounts(info, [['Payout:', Math.round(stake * odds)], ['Balance:', balance]]);
    guardBalance(sheet, info, bettorSelect.value && stake > balance ? [bettorSelect.value] : []);
  }
  stakeInput.addEventListener('input', update);
  bettorSelect.addEventListener('change', update);
  update();

  sheet.append(field('Bettor', bettorSelect), chips, info);
  const pending = showConfirm('', { contentElement: sheet, confirmLabel: 'Place bet', cancelLabel: 'Cancel' });
  update(); // the dialog exists now: guard its confirm button
  const ok = await pending;
  if (!ok) return;

  const bettor = bettorSelect.value;
  const stake = Number(stakeInput.value);
  if (!bettor || !Number.isInteger(stake) || stake < 1) {
    showToast('Pick a bettor and a whole-number stake', 'warning');
    return;
  }
  saveBettor(bettor);
  try {
    const id = await placeHouseBet({ bettor, stake, outcome, expectedOdds: odds, matchupKey: key });
    showToast('Bet placed — tap to undo', 'success', BETTING.undoWindowMs, () => {
      undoBet(id).catch((err) => { console.warn('[betting] undo failed', err); showToast('Undo failed', 'error'); });
    });
  } catch (err) {
    if (err.message === 'closed') showToast('Bet not accepted — betting had closed', 'warning');
    else if (err.message === 'changed') showToast('Odds changed — bet not placed, check the new odds', 'warning');
    else if (err.message === 'insufficient') showToast('Not enough golden footballs', 'warning');
    else if (err.message === 'too-much') showToast(`Stakes are limited to ${BETTING.maxStake} golden footballs`, 'warning');
    else if (err.message.startsWith('playing:')) showToast(`${err.message.slice(8)} is playing in this match and can't bet on it`, 'warning');
    else { console.warn('[betting] bet failed', err); showToast('Bet failed', 'error'); }
  }
}

function tickTimer() {
  const timer = document.querySelector('#betsContent .live-timer');
  if (!timer) return;
  const elapsed = Date.now() - Number(timer.dataset.startedMs);
  timer.textContent = formatMsToMMSS(elapsed);
  const tl = document.querySelector('#betsContent .bets-timeline');
  if (tl) drawTimeline(tl, elapsed);
}

function render() {
  const box = document.getElementById('betsBox');
  const content = document.getElementById('betsContent');
  const heading = document.getElementById('betsHeading');
  if (!box || !content) return;
  const cm = getCurrentMatch();
  const visible = BETTING.enabled && Boolean(cm?.matchupKey);
  box.style.display = visible ? '' : 'none';
  if (heading) heading.style.display = visible ? '' : 'none';
  if (!visible) {
    content.replaceChildren();
    return;
  }
  content.replaceChildren(...[renderHeader(cm), renderLive(cm), renderHouse(cm), renderChallengeButton(cm), ...renderFeed(cm)].filter(Boolean));
  // Only the timer and timeline tick; rebuilding buttons every second would eat taps.
  const live = Boolean(content.querySelector('.live-timer'));
  if (live && !timerId) timerId = setInterval(tickTimer, 1000);
  if (!live && timerId) { clearInterval(timerId); timerId = null; }
}

export function initBettingUI() {
  if (initialized || !BETTING.enabled) return;
  initialized = true;
  for (const evt of ['current-match-updated', 'bets-updated', 'matches-updated', 'teams-updated']) {
    window.addEventListener(evt, render);
  }
  // after the sync controller has flipped its live flag
  for (const evt of ['live-started', 'live-ended']) window.addEventListener(evt, () => setTimeout(render, 0));
  render();
}
