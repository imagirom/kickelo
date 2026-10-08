// src/betting/sync-controller.js
// Publishes this device's lineup / live state to meta/currentMatch, asking before
// it would replace a shared match that is live or has open bets.
import { teamA1Select, teamA2Select, teamB1Select, teamB2Select } from '../dom-elements.js';
import { pairFromSelects, teamKey } from '../teams/team-identity.js';
import { getTeamRecord } from '../teams/team-service.js';
import { showConfirm, showToast } from '../toast.js';
import { BETTING } from './betting-config.js';
import { matchupKey, isFullLineup } from './matchup.js';
import { shouldClearAfterSubmit, shouldPublishLineup, needsOverwriteConfirm, isLiveTakeover, ownsLive, liveClaimUpdate, showNotSharedHint } from './current-match.js';
import { getCurrentMatch, publishLineup, publishPositions, publishLiveStart, publishGoal, publishLiveEnd } from './current-match-service.js';
import { getOpenBetsFor } from './bets-service.js';

let initialized = false;
let liveId = null; // set while this device owns the live match in the shared doc
let liveLocal = false; // core live mode is on here (it may start before the teams are set)
let localGoals = []; // latest goal log from 'live-goal', published when live is claimed late
let declined = null; // `${sharedKey}>${localKey}` the user chose to keep; no re-asking until either changes
let takeoverDeclined = null; // shared live match the user chose not to take over (until live restarts)
let syncScheduled = false;
let syncing = false;
let rerun = false;
let lastWarnAt = 0;

export function isLiveOnThisDevice() {
  return ownsLive(getCurrentMatch(), liveId);
}

function warn(err) {
  console.warn('[betting] live sync failed', err);
  if (Date.now() - lastWarnAt > 60000) {
    lastWarnAt = Date.now();
    showToast('Live sync failed — others may not see this match.', 'warning');
  }
}

function readLineup() {
  const { red, blue } = pairFromSelects(teamA1Select?.value, teamA2Select?.value, teamB1Select?.value, teamB2Select?.value);
  const positions = {
    redDefense: teamA1Select?.value || '', redOffense: teamA2Select?.value || '',
    blueDefense: teamB1Select?.value || '', blueOffense: teamB2Select?.value || '',
  };
  const key = isFullLineup(red, blue) ? matchupKey(red, blue) : null;
  return { red, blue, positions, key };
}

/** Derived from state on every call; skipped mid-sync so it never flickers while a write or dialog is pending. */
function renderNotShared() {
  if (syncing || syncScheduled) return;
  const hint = document.getElementById('betsNotShared');
  if (hint) hint.style.display = showNotSharedHint(getCurrentMatch(), readLineup().key, { live: liveLocal, liveId }) ? '' : 'none';
}

const label = (pair) => getTeamRecord(teamKey(pair))?.name || pair.join(' + ');

/** Returns true if the shared doc now carries this device's lineup. */
async function syncLineup(retry = true) {
  const { red, blue, positions, key } = readLineup();
  const current = getCurrentMatch();
  const decision = shouldPublishLineup(current, red, blue, positions);
  if (decision === 'skip') return Boolean(key) && current?.matchupKey === key;
  if (decision === 'positions') {
    await publishPositions({ red, blue, positions });
    return true;
  }
  const expectedUpdatedAtMs = current?.updatedAt?.toMillis?.() ?? null;
  const open = current?.matchupKey ? getOpenBetsFor(current.matchupKey) : [];
  if (needsOverwriteConfirm(current, key, open.length)) {
    const pair = `${current.matchupKey}>${key}`;
    if (declined === pair) return false;
    const stake = open.reduce((sum, b) => sum + b.stake, 0);
    const lines = [`Replace the current match ${label(current.red)} vs ${label(current.blue)}?`];
    if (open.length) lines.push(`${open.length} bet${open.length === 1 ? '' : 's'} (${stake} golden footballs) will be refunded unless this lineup plays again today.`);
    if (current.liveStartedAt || current.liveId) lines.push('It is currently live.');
    const ok = await showConfirm(lines.join('\n'), { confirmLabel: 'Replace', cancelLabel: 'Keep shared match', type: 'warning' });
    if (!ok) { declined = pair; return false; }
  }
  try {
    await publishLineup({ red, blue, positions }, { expectedUpdatedAtMs });
    liveId = null; // a replace clears the shared live fields; re-claimed below if live here
    return true;
  } catch (err) {
    if (err.message === 'stale' && retry) return syncLineup(false);
    throw err;
  }
}

/** One reconcile pass: share the lineup, then claim live scoring if live mode runs here unowned. */
async function syncOnce() {
  const { key } = readLineup();
  if (declined && !declined.endsWith(`>${key}`)) declined = null; // local lineup changed
  const live = liveLocal; // a live-start mid-pass re-runs the pass, so it always gets the takeover question
  const cur = getCurrentMatch();
  const takeover = live && !ownsLive(cur, liveId) && isLiveTakeover(cur, key);
  if (takeover) {
    const other = `${cur.matchupKey}#${cur.liveId}`;
    if (takeoverDeclined === other) return;
    const ok = await showConfirm('This match is already live on another phone.\nTake over live scoring here?',
      { confirmLabel: 'Take over', cancelLabel: 'Keep other phone', type: 'warning' });
    if (!ok) { takeoverDeclined = other; return; }
  }
  if (!(await syncLineup())) return;
  if (!live || !liveLocal || ownsLive(getCurrentMatch(), liveId)) return;
  liveId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await publishLiveStart(liveId, liveClaimUpdate(getCurrentMatch(), readLineup().key, localGoals));
  } catch (err) { liveId = null; throw err; }
}

/** Coalesces bursts (notifyRolesChanged fires once per team) into one pass per tick and never
 *  runs two passes at once: a change during a pass or dialog re-runs it once with the latest lineup. */
function scheduleSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  setTimeout(async () => {
    if (syncing) { syncScheduled = false; rerun = true; return; }
    syncing = true;
    syncScheduled = false;
    try {
      do { rerun = false; await syncOnce().catch(warn); } while (rerun);
    } finally { syncing = false; renderNotShared(); }
  }, 0);
}

export function initSyncController() {
  if (initialized || !BETTING.enabled || !BETTING.liveSync) return;
  initialized = true;

  window.addEventListener('current-match-updated', renderNotShared);

  window.addEventListener('lineup-changed', () => {
    if (!(navigator.userActivation?.hasBeenActive ?? true)) return; // never on page load
    scheduleSync();
  });

  window.addEventListener('live-started', () => {
    liveId = null;
    liveLocal = true;
    localGoals = [];
    takeoverDeclined = null;
    scheduleSync();
  });

  // Goals and end go to the shared doc only while it still carries this device's liveId:
  // never after a declined overwrite, a skipped lineup, or another phone taking over.
  window.addEventListener('live-goal', (e) => {
    localGoals = e.detail || [];
    if (ownsLive(getCurrentMatch(), liveId)) publishGoal(e.detail).catch(warn);
  });

  // Final-score submits never fire live-ended; close the house on the logged matchup here.
  window.addEventListener('match-submitted', (e) => {
    const { teamA, teamB } = e.detail || {};
    if (shouldClearAfterSubmit(getCurrentMatch(), teamA || [], teamB || [])) publishLiveEnd().catch(warn);
  });

  window.addEventListener('live-ended', () => {
    const owned = ownsLive(getCurrentMatch(), liveId);
    liveId = null;
    liveLocal = false;
    localGoals = [];
    if (owned) publishLiveEnd().catch(warn);
    renderNotShared();
  });
}
