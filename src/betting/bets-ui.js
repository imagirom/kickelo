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
import { resolveHouseBet, dayKey } from './ledger.js';
import { getCurrentMatch } from './current-match-service.js';
import { getBets, placeHouseBet, undoBet, available } from './bets-service.js';
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
    btn.addEventListener('click', () => openBetSheet(pair, odds));
    buttons.appendChild(btn);
  }
  row.append(buttons, el('div', 'bets-caption', closed ? 'Closed at first goal' : 'closes at first goal'));
  return row;
}

function renderFeed(cm) {
  const now = Date.now();
  const today = dayKey(now);
  const bets = getBets()
    .filter((b) => !b.void && b.kind === 'house' && b.matchupKey === cm.matchupKey && dayKey(b.placedAt) === today)
    .sort((a, b) => b.placedAt - a.placedAt);
  if (bets.length === 0) return null;
  const list = el('ul', 'bets-feed');
  for (const bet of bets) {
    const li = el('li');
    li.append(el('span', 'bets-feed-bettor', bet.bettor), footballs(bet.stake),
      el('span', null, ` on ${label(bet.outcome?.team)} @${bet.odds}`));
    const r = resolveHouseBet(bet, allMatches || [], now);
    if (r.status !== 'open') {
      const text = r.status === 'won' ? `won ${r.payout}` : r.status;
      li.appendChild(el('span', `bets-feed-result ${r.status}`, text));
    }
    list.appendChild(li);
  }
  return list;
}

function readBettor() {
  try { return localStorage.getItem(BETTOR_KEY) || ''; } catch { return ''; }
}

function saveBettor(name) {
  try { localStorage.setItem(BETTOR_KEY, name); } catch { /* storage unavailable */ }
}

async function openBetSheet(team, odds) {
  const sheet = el('div', 'bet-sheet');
  sheet.appendChild(el('div', 'bet-sheet-title', `${label(team)} to win @${odds}`));

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
    const id = await placeHouseBet({ bettor, stake, team });
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
  content.replaceChildren(...[renderHeader(cm), renderLive(cm), renderHouse(cm), renderFeed(cm)].filter(Boolean));
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
