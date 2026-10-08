// src/betting/bets-ui.js
// Bets box under the match form: shared match header, live view for spectators,
// house winner odds, place-bet sheet and today's bet feed for this matchup.
import { allPlayers } from '../player-data-service.js';
import { allMatches } from '../match-data-service.js';
import { teamKey } from '../teams/team-identity.js';
import { getTeamRecord } from '../teams/team-service.js';
import { showConfirm, showToast } from '../toast.js';
import { createTimelineSVG, formatMsToMMSS } from '../match-timeline.js';
import { BETTING, houseBetsActive } from './betting-config.js';
import { describeOutcome, OUTCOME_TESTS, mmss } from './outcomes.js';
import { resolveHouseBet, resolveChallenge, dayKey } from './ledger.js';
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
  row.append(el('span', 'live-team-label red', label(cm.red)), icon, el('span', 'live-team-label blue', label(cm.blue)));
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
  const svg = createTimelineSVG(goals);
  if (svg) {
    const tl = el('div', 'bets-timeline');
    tl.innerHTML = svg; // generated markup: numbers and fixed strings only
    row.appendChild(tl);
  }
  return row;
}

function renderHouse(cm) {
  if (!houseBetsActive()) return null;
  const row = el('div', 'bets-house');
  if (!cm.offer) {
    row.appendChild(el('div', 'bets-caption', 'House opens when the next lineup is set.'));
    return row;
  }
  // goalLog check covers the publishing device, where firstGoalAt reads null until the server write lands
  const closed = Boolean(cm.firstGoalAt || cm.goalLog?.length);
  const buttons = el('div', 'live-score-buttons bets-odds');
  for (const [side, pair, cls] of [['Red', cm.red, 'red_select'], ['Blue', cm.blue, 'blue_select']]) {
    const odds = cm.offer.winner?.[teamKey(pair)];
    const btn = el('button', cls, `${side} wins ${odds}×`);
    btn.type = 'button';
    btn.disabled = closed || !odds;
    btn.addEventListener('click', () => openBetSheet({
      outcome: { test: 'winner', team: pair, threshold: null }, odds, title: `${label(pair)} to win`,
    }));
    buttons.appendChild(btn);
  }
  row.appendChild(buttons);
  for (const prop of cm.offer.props || []) {
    const line = el('div', 'bets-prop');
    line.appendChild(el('span', 'bets-prop-label', describeOutcome(prop.outcome, label)));
    for (const [text, negate, odds] of [['Yes', false, prop.oddsYes], ['No', true, prop.oddsNo]]) {
      const btn = el('button', 'bets-prop-btn', `${text} ${odds}×`);
      btn.type = 'button';
      btn.disabled = closed || !odds;
      const outcome = { ...prop.outcome, negate };
      btn.addEventListener('click', () => openBetSheet({
        outcome: { ...outcome, propId: prop.id }, odds, title: describeOutcome(outcome, label),
      }));
      line.appendChild(btn);
    }
    row.appendChild(line);
  }
  row.appendChild(el('div', 'bets-caption', closed ? 'Closed at first goal' : 'closes at first goal'));
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

function houseFeedLine(bet, now) {
  const li = el('li');
  li.append(el('span', 'bets-feed-bettor', bet.bettor), footballs(bet.stake),
    el('span', null, `${describeOutcome(bet.outcome, label)} @${bet.odds}`));
  const r = resolveHouseBet(bet, allMatches || [], now);
  if (r.status !== 'open') {
    const text = r.status === 'won' ? `won ${r.payout}` : r.status;
    li.appendChild(el('span', `bets-feed-result ${r.status}`, text));
  }
  return li;
}

function challengeFeedLine(bet, now) {
  const li = el('li', 'bets-feed-challenge');
  li.append(el('span', 'bets-feed-bettor', `${bet.challenger} → ${bet.opponent || 'anyone'}:`),
    el('span', null, `${describeOutcome(bet.outcome, label)} · ${bet.challengerStake} vs ${bet.opponentStake}`));
  const r = resolveChallenge(bet, allMatches || [], now);
  const pot = bet.challengerStake + bet.opponentStake;
  if (r.status === 'open') {
    const actions = el('span', 'bets-feed-actions');
    const accept = el('button', 'bets-feed-btn bets-accept', 'Accept');
    const withdraw = el('button', 'bets-feed-btn bets-withdraw', 'Withdraw');
    accept.type = 'button';
    withdraw.type = 'button';
    accept.addEventListener('click', () => openAcceptSheet(bet));
    withdraw.addEventListener('click', () => {
      withdrawChallenge(bet.id).then(() => showToast('Challenge withdrawn', 'success'), challengeError);
    });
    actions.append(accept, withdraw);
    li.appendChild(actions);
    return li;
  }
  const text = {
    pending: `accepted by ${bet.acceptedBy}`,
    won: `${bet.challenger} won ${pot}`,
    lost: `${bet.acceptedBy} won ${pot}`,
  }[r.status] || r.status;
  li.appendChild(el('span', `bets-feed-result ${r.status === 'lost' ? 'won' : r.status}`, text));
  return li;
}

function renderFeed(cm) {
  const now = Date.now();
  const today = dayKey(now);
  const bets = getBets()
    .filter((b) => !b.void && (b.kind === 'house' || (b.kind === 'challenge' && BETTING.challenges))
      && b.matchupKey === cm.matchupKey && dayKey(b.placedAt) === today)
    .sort((a, b) => b.placedAt - a.placedAt);
  if (bets.length === 0) return null;
  const list = el('ul', 'bets-feed');
  for (const bet of bets) list.appendChild(bet.kind === 'challenge' ? challengeFeedLine(bet, now) : houseFeedLine(bet, now));
  return list;
}

const playerNames = () => allPlayers.map((p) => p.id).sort();

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
  else if (m === 'closed') showToast('Challenge is closed', 'warning');
  else { console.warn('[betting] challenge failed', err); showToast('Challenge failed', 'error'); }
}

const TEST_LABELS = {
  winner: 'Win', marginAtLeast: 'Win by …', shutout: 'Win 5:0', goesToFourFour: 'Goes to 4:4',
  durationOver: 'Duration over …', scoresFirst: 'Scores first', firstScorerWins: 'First scorer wins', comebackAtLeast: 'Comeback from …',
};

function numberInput(className, value) {
  const input = el('input', className);
  input.type = 'number';
  input.min = '1';
  input.step = '1';
  input.inputMode = 'numeric';
  input.value = String(value);
  return input;
}

function field(text, control) {
  const wrap = el('label', 'bet-sheet-field');
  wrap.append(el('span', 'bet-sheet-field-label', text), control);
  return wrap;
}

async function openChallengeForm(cm) {
  const sheet = el('div', 'bet-sheet');
  sheet.appendChild(el('div', 'bet-sheet-title', 'Challenge'));

  const challengerSelect = el('select', 'challenge-challenger');
  const opponentSelect = el('select', 'challenge-opponent');
  fillSelect(challengerSelect, [['', 'Who is challenging?'], ...playerNames().map((n) => [n, n])], readBettor());
  const fillOpponents = () => fillSelect(opponentSelect,
    [['', 'Anyone'], ...playerNames().filter((n) => n !== challengerSelect.value).map((n) => [n, n])], opponentSelect.value);
  fillOpponents();

  const testSelect = el('select', 'challenge-test');
  fillSelect(testSelect, OUTCOME_TESTS.map((t) => [t.id, TEST_LABELS[t.id] || t.id]), 'winner');
  const teamSelect = el('select', 'challenge-team');
  fillSelect(teamSelect, [[teamKey(cm.red), label(cm.red)], [teamKey(cm.blue), label(cm.blue)]]);
  const teams = { [teamKey(cm.red)]: cm.red, [teamKey(cm.blue)]: cm.blue };
  const thresholdSelect = el('select', 'challenge-threshold');
  let negate = false;
  const sideToggle = el('div', 'bet-sheet-chips challenge-side');
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
  const stakes = el('div', 'bet-sheet-chips');
  stakes.append(field('My stake', myStake), field('Their stake', theirStake));
  const info = el('div', 'bet-sheet-info');

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
      const fmt = d.id === 'durationOver' ? mmss : (k) => (d.id === 'comebackAtLeast' ? `${k} down` : `${k}+`);
      fillSelect(thresholdSelect, d.thresholds.map((k) => [String(k), fmt(k)]), thresholdSelect.value);
    }
    for (const [btn, value] of sideButtons) btn.classList.toggle('active', value === negate);
    preview.textContent = describeOutcome(outcome(), label);
    const pot = (Number(myStake.value) || 0) + (Number(theirStake.value) || 0);
    const balance = challengerSelect.value ? Math.round(available(challengerSelect.value)) : 0;
    info.textContent = `You win ${pot} if right · Balance: ${balance}`;
  }
  const teamRow = field('Team', teamSelect);
  const thresholdRow = field('By', thresholdSelect);
  challengerSelect.addEventListener('change', () => { fillOpponents(); update(); });
  for (const node of [testSelect, teamSelect, thresholdSelect]) node.addEventListener('change', update);
  for (const node of [myStake, theirStake]) node.addEventListener('input', update);
  update();

  sheet.append(field('Challenger', challengerSelect), field('Against', opponentSelect), field('Bet', testSelect),
    teamRow, thresholdRow, sideToggle, preview, stakes, info);
  const ok = await showConfirm('', { contentElement: sheet, confirmLabel: 'Challenge', cancelLabel: 'Cancel' });
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
    const id = await placeChallenge({ challenger, opponent: opponentSelect.value || null, outcome: outcome(), challengerStake, opponentStake });
    showToast('Challenge posted — tap to undo', 'success', BETTING.undoWindowMs, () => {
      withdrawChallenge(id).catch(challengeError);
    });
  } catch (err) {
    challengeError(err);
  }
}

async function openAcceptSheet(bet) {
  const sheet = el('div', 'bet-sheet');
  sheet.appendChild(el('div', 'bet-sheet-title',
    `${bet.challenger}: ${describeOutcome(bet.outcome, label)} · ${bet.challengerStake} vs ${bet.opponentStake}`));
  const acceptorSelect = el('select', 'challenge-acceptor');
  const names = bet.opponent ? [bet.opponent] : playerNames().filter((n) => n !== bet.challenger);
  fillSelect(acceptorSelect, [...(bet.opponent ? [] : [['', 'Who accepts?']]), ...names.map((n) => [n, n])], readBettor());
  const info = el('div', 'bet-sheet-info');
  const update = () => {
    const balance = acceptorSelect.value ? Math.round(available(acceptorSelect.value)) : 0;
    info.textContent = `You win ${bet.challengerStake + bet.opponentStake} if it doesn't happen · Your stake: ${bet.opponentStake} · Balance: ${balance}`;
  };
  acceptorSelect.addEventListener('change', update);
  update();
  sheet.append(acceptorSelect, info);
  const ok = await showConfirm('', { contentElement: sheet, confirmLabel: 'Accept', cancelLabel: 'Cancel' });
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

async function openBetSheet({ outcome, odds, title }) {
  const sheet = el('div', 'bet-sheet');
  sheet.appendChild(el('div', 'bet-sheet-title', `${title} @${odds}`));

  const bettorSelect = el('select', 'bet-sheet-bettor');
  bettorSelect.appendChild(new Option('Who is betting?', ''));
  for (const name of allPlayers.map((p) => p.id).sort()) bettorSelect.appendChild(new Option(name, name));
  bettorSelect.value = readBettor();

  const chips = el('div', 'bet-sheet-chips');
  const stakeInput = el('input', 'bet-sheet-stake');
  stakeInput.type = 'number';
  stakeInput.min = '1';
  stakeInput.step = '1';
  stakeInput.inputMode = 'numeric';
  stakeInput.placeholder = 'Stake';
  for (const chip of BETTING.stakeChips) {
    const btn = el('button', 'bet-chip', String(chip));
    btn.type = 'button';
    btn.addEventListener('click', () => { stakeInput.value = String(chip); update(); });
    chips.appendChild(btn);
  }
  chips.appendChild(stakeInput);

  const info = el('div', 'bet-sheet-info');
  function update() {
    const stake = Number(stakeInput.value) || 0;
    const balance = bettorSelect.value ? available(bettorSelect.value) : 0;
    info.textContent = `Payout: ${Math.round(stake * odds)} · Balance: ${Math.round(balance)}`;
  }
  stakeInput.addEventListener('input', update);
  bettorSelect.addEventListener('change', update);
  update();

  sheet.append(bettorSelect, chips, info);
  const ok = await showConfirm('', { contentElement: sheet, confirmLabel: 'Place bet', cancelLabel: 'Cancel' });
  if (!ok) return;

  const bettor = bettorSelect.value;
  const stake = Number(stakeInput.value);
  if (!bettor || !Number.isInteger(stake) || stake < 1) {
    showToast('Pick a bettor and a whole-number stake', 'warning');
    return;
  }
  saveBettor(bettor);
  try {
    const id = await placeHouseBet({ bettor, stake, outcome });
    showToast('Bet placed — tap to undo', 'success', BETTING.undoWindowMs, () => {
      undoBet(id).catch((err) => { console.warn('[betting] undo failed', err); showToast('Undo failed', 'error'); });
    });
  } catch (err) {
    if (err.message === 'closed') showToast('Bet not accepted — betting had closed', 'warning');
    else if (err.message === 'insufficient') showToast('Not enough golden footballs', 'warning');
    else { console.warn('[betting] bet failed', err); showToast('Bet failed', 'error'); }
  }
}

function tickTimer() {
  const timer = document.querySelector('#betsContent .live-timer');
  if (timer) timer.textContent = formatMsToMMSS(Date.now() - Number(timer.dataset.startedMs));
}

function render() {
  const box = document.getElementById('betsBox');
  const content = document.getElementById('betsContent');
  if (!box || !content) return;
  const cm = getCurrentMatch();
  if (!BETTING.enabled || !cm?.matchupKey) {
    box.style.display = 'none';
    content.replaceChildren();
    return;
  }
  box.style.display = '';
  content.replaceChildren(...[renderHeader(cm), renderLive(cm), renderHouse(cm), renderChallengeButton(cm), renderFeed(cm)].filter(Boolean));
  // Only the timer text ticks; rebuilding buttons every second would eat taps.
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
