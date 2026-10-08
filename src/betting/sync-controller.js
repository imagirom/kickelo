// src/betting/sync-controller.js
// Publishes this device's lineup / live state to meta/currentMatch, asking before
// it would replace a shared match that is live or has open bets.
import { teamA1Select, teamA2Select, teamB1Select, teamB2Select } from '../dom-elements.js';
import { pairFromSelects, teamKey } from '../teams/team-identity.js';
import { getTeamRecord } from '../teams/team-service.js';
import { showConfirm, showToast } from '../toast.js';
import { BETTING } from './betting-config.js';
import { matchupKey, isFullLineup } from './matchup.js';
import { shouldClearAfterSubmit, shouldPublishLineup, needsOverwriteConfirm, isLiveTakeover, ownsLive, showNotSharedHint } from './current-match.js';
import { getCurrentMatch, publishLineup, publishPositions, publishLiveStart, publishGoal, publishLiveEnd } from './current-match-service.js';
import { getBets } from './bets-service.js';
import { openStakeFor } from './ledger.js';
import { allMatches } from '../match-data-service.js';

let initialized = false;
let liveId = null; // set once this device's live claim has committed (the shared doc may say otherwise later)
let liveKey = null; // matchup that claim was made on
let goalPush = null; // in-flight goal write; goals are written one at a time, latest log last
let goalDirty = false;
let liveEpoch = 0; // bumped on live start/end, so a claim that commits after its live mode ended is undone
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

/** Open bets on the shared matchup. A match this phone just logged has no server timestamp yet
 *  (null until the write lands); it counts as logged now, so picking the next lineup right after
 *  Submit does not claim that the just-resolved bets would be refunded. */
function openFor(cur) {
  if (!cur?.matchupKey) return { count: 0, stake: 0 };
  const now = Date.now();
  const matches = (allMatches || []).map((m) => (m.timestamp == null ? { ...m, timestamp: now } : m));
  return openStakeFor(getBets(), matches, cur.matchupKey, now);
}

const newLiveId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function confirmReplace(current, open) {
  const lines = [`Replace the current match ${label(current.red)} vs ${label(current.blue)}?`];
  if (open.count) lines.push(`${open.count} bet${open.count === 1 ? '' : 's'} (${open.stake} golden footballs) will be refunded unless this lineup plays again today.`);
  if (current.liveStartedAt || current.liveId) lines.push('It is currently live.');
  return showConfirm(lines.join('\n'), { confirmLabel: 'Replace', cancelLabel: 'Keep shared match', type: 'warning' });
}

/** Returns true if the shared doc now carries this device's lineup. The overwrite condition is
 *  re-checked inside the write transaction on the fresh doc: only a doc that newly needs asking
 *  (another matchup, now live or with bets) brings the dialog back, with fresh counts. */
async function syncLineup() {
  let current = getCurrentMatch();
  let confirmedKey = null; // shared matchup the user agreed to replace
  for (let attempt = 0; attempt < 5; attempt++) {
    // read on every round: the lineup may change while a dialog is open
    const { red, blue, positions, key } = readLineup();
    const decision = shouldPublishLineup(current, red, blue, positions);
    if (decision === 'skip') return Boolean(key) && current?.matchupKey === key;
    const needsAsk = (cur) => cur?.matchupKey !== confirmedKey && needsOverwriteConfirm(cur, key, openFor(cur).count);
    try {
      if (decision === 'positions') {
        await publishPositions({ red, blue, positions }, { guard: (fresh) => shouldPublishLineup(fresh, red, blue, positions) !== 'replace' });
        return true;
      }
      if (needsAsk(current)) {
        const pair = `${current.matchupKey}>${key}`;
        if (declined === pair) return false;
        if (!(await confirmReplace(current, openFor(current)))) { declined = pair; return false; }
        confirmedKey = current.matchupKey;
        continue;
      }
      // Live here: claim it in the same write, so the new offer is never open after goals were scored.
      const claim = liveLocal ? newLiveId() : null;
      const goals = localGoals;
      const epoch = liveEpoch;
      await publishLineup({ red, blue, positions }, {
        guard: (fresh) => shouldPublishLineup(fresh, red, blue, positions) === 'replace' && !needsAsk(fresh),
        liveId: claim, goalLog: goals,
      });
      liveId = null; // a replace clears the shared live fields unless claimed here
      if (claim) claimed(claim, key, goals, epoch);
      return true;
    } catch (err) {
      if (err.message !== 'stale') throw err;
      current = err.current ?? null;
    }
  }
  throw new Error('stale');
}

/** A live claim committed: own it, catch up on goals scored meanwhile, or undo it if live mode ended. */
function claimed(claim, key, goals, epoch) {
  if (epoch !== liveEpoch) { publishLiveEnd({ liveId: claim }).catch(warn); return; }
  liveId = claim;
  liveKey = key;
  if (localGoals !== goals) pushGoals();
}

/** Writes the latest local goal log, one transaction at a time so an older log never lands last. */
function pushGoals() {
  if (!liveId) return;
  if (goalPush) { goalDirty = true; return; }
  goalPush = (async () => {
    do {
      goalDirty = false;
      await publishGoal(liveId, localGoals);
    } while (goalDirty && liveId);
  })().catch(warn).finally(() => { goalPush = null; });
}

/** One reconcile pass: share the lineup, then claim live scoring if live mode runs here unowned.
 *  Taking over another phone's live match is always asked first, also when this phone's snapshot
 *  had not shown it yet: the claim transaction then reports the fresh doc and the question follows. */
async function syncOnce() {
  const { key } = readLineup();
  if (declined && !declined.endsWith(`>${key}`)) declined = null; // local lineup changed
  const live = liveLocal; // a live-start mid-pass re-runs the pass, so it always gets the takeover question
  let cur = getCurrentMatch();
  let takeoverOf = null; // liveId of the other phone the user agreed to take over from
  for (let attempt = 0; attempt < 3; attempt++) {
    if (live && !ownsLive(cur, liveId) && isLiveTakeover(cur, key) && cur.liveId !== takeoverOf) {
      const other = `${cur.matchupKey}#${cur.liveId}`;
      if (takeoverDeclined === other) return;
      const ok = await showConfirm('This match is already live on another phone.\nTake over live scoring here?',
        { confirmLabel: 'Take over', cancelLabel: 'Keep other phone', type: 'warning' });
      if (!ok) { takeoverDeclined = other; return; }
      liveId = null; // re-claim below
      takeoverOf = cur.liveId;
    }
    if (!(await syncLineup())) return;
    const nowKey = readLineup().key;
    if (!live || !liveLocal || (liveId && liveKey === nowKey)) return;
    const claim = newLiveId();
    const goals = localGoals;
    const epoch = liveEpoch;
    try {
      await publishLiveStart(claim, nowKey, goals, takeoverOf);
    } catch (err) {
      if (err.message !== 'stale') throw err;
      cur = err.current ?? null;
      continue;
    }
    claimed(claim, nowKey, goals, epoch);
    return;
  }
  throw new Error('stale');
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

  window.addEventListener('current-match-updated', () => {
    renderNotShared();
    // The phone we declined to take over from has ended its live match: claim it here now.
    const cur = getCurrentMatch();
    if (liveLocal && takeoverDeclined && !cur?.liveId && !cur?.liveStartedAt) {
      takeoverDeclined = null;
      scheduleSync();
    }
  });

  window.addEventListener('lineup-changed', () => {
    if (!(navigator.userActivation?.hasBeenActive ?? true)) return; // never on page load
    scheduleSync();
  });

  window.addEventListener('live-started', () => {
    liveEpoch++;
    liveId = null;
    liveKey = null;
    liveLocal = true;
    localGoals = [];
    takeoverDeclined = null;
    declined = null; // a deliberate live start asks again about replacing the shared match
    scheduleSync();
  });

  // Goals and end go to the shared doc only while it still carries this device's liveId (checked in
  // the transaction): never after a declined overwrite, a skipped lineup, or another phone taking over.
  window.addEventListener('live-goal', (e) => {
    localGoals = e.detail || [];
    pushGoals();
  });

  // Final-score submits never fire live-ended; close the house on the logged matchup here.
  window.addEventListener('match-submitted', (e) => {
    const { teamA, teamB } = e.detail || {};
    if (shouldClearAfterSubmit(getCurrentMatch(), teamA || [], teamB || [])) {
      publishLiveEnd({ matchupKey: getCurrentMatch().matchupKey }).catch(warn);
    }
  });

  window.addEventListener('live-ended', () => {
    const mine = liveId;
    liveEpoch++;
    liveId = null;
    liveKey = null;
    liveLocal = false;
    localGoals = [];
    if (mine) publishLiveEnd({ liveId: mine }).catch(warn);
    renderNotShared();
  });
}
