// src/betting/sync-controller.js
// Publishes this device's lineup / live state to meta/currentMatch, asking before
// it would replace a shared match that is live or has open bets.
import { teamA1Select, teamA2Select, teamB1Select, teamB2Select } from '../dom-elements.js';
import { pairFromSelects, teamKey } from '../teams/team-identity.js';
import { getTeamRecord } from '../teams/team-service.js';
import { showConfirm, showToast } from '../toast.js';
import { BETTING } from './betting-config.js';
import { matchupKey } from './matchup.js';
import { shouldPublishLineup, needsOverwriteConfirm } from './current-match.js';
import { getCurrentMatch, publishLineup, publishPositions, publishLiveStart, publishGoal, publishLiveEnd } from './current-match-service.js';
import { getOpenBetsFor } from './bets-service.js';

let initialized = false;
let isLiveHere = false;
let lastWarnAt = 0;

export function isLiveOnThisDevice() {
  return isLiveHere;
}

function warn(err) {
  console.warn('[betting] live sync failed', err);
  if (Date.now() - lastWarnAt > 60000) {
    lastWarnAt = Date.now();
    showToast('Live sync failed — others may not see this match.', 'warning');
  }
}

function setNotShared(visible) {
  const hint = document.getElementById('betsNotShared');
  if (hint) hint.style.display = visible ? '' : 'none';
}

function readLineup() {
  const { red, blue } = pairFromSelects(teamA1Select?.value, teamA2Select?.value, teamB1Select?.value, teamB2Select?.value);
  const positions = {
    redDefense: teamA1Select?.value || '', redOffense: teamA2Select?.value || '',
    blueDefense: teamB1Select?.value || '', blueOffense: teamB2Select?.value || '',
  };
  return { red, blue, positions };
}

const label = (pair) => getTeamRecord(teamKey(pair))?.name || pair.join(' + ');

/** Returns true if the shared doc now carries this device's lineup. */
async function syncLineup(retry = true) {
  const { red, blue, positions } = readLineup();
  const current = getCurrentMatch();
  const decision = shouldPublishLineup(current, red, blue, positions);
  if (decision === 'skip') return current?.matchupKey === matchupKey(red, blue);
  if (decision === 'positions') {
    await publishPositions({ red, blue, positions });
    setNotShared(false);
    return true;
  }
  const expectedUpdatedAtMs = current?.updatedAt?.toMillis?.() ?? null;
  const open = current?.matchupKey ? getOpenBetsFor(current.matchupKey) : [];
  if (needsOverwriteConfirm(current, matchupKey(red, blue), open.length)) {
    const stake = open.reduce((sum, b) => sum + b.stake, 0);
    const lines = [`Replace the current match ${label(current.red)} vs ${label(current.blue)}?`];
    if (open.length) lines.push(`${open.length} bet${open.length === 1 ? '' : 's'} (${stake} golden footballs) will be refunded.`);
    if (current.liveStartedAt) lines.push('It is currently live.');
    const ok = await showConfirm(lines.join('\n'), { confirmLabel: 'Replace', cancelLabel: 'Keep shared match', type: 'warning' });
    if (!ok) { setNotShared(true); return false; }
  }
  try {
    await publishLineup({ red, blue, positions }, { expectedUpdatedAtMs });
    setNotShared(false);
    return true;
  } catch (err) {
    if (err.message === 'stale' && retry) return syncLineup(false);
    throw err;
  }
}

export function initSyncController() {
  if (initialized || !BETTING.enabled || !BETTING.liveSync) return;
  initialized = true;

  window.addEventListener('lineup-changed', () => {
    if (!(navigator.userActivation?.hasBeenActive ?? true)) return; // never on page load
    syncLineup().catch(warn);
  });

  window.addEventListener('live-started', async () => {
    isLiveHere = true;
    try {
      if (await syncLineup()) await publishLiveStart();
    } catch (err) { warn(err); }
  });

  window.addEventListener('live-goal', (e) => {
    if (isLiveHere) publishGoal(e.detail).catch(warn);
  });

  window.addEventListener('live-ended', () => {
    if (!isLiveHere) return;
    isLiveHere = false;
    publishLiveEnd().catch(warn);
  });
}
