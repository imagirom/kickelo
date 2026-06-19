// Shows each side's team name (or player names) above the Start-live-mode
// button, coloured by side. Updates on select changes and team-data updates.

import { teamA1Select, teamA2Select, teamB1Select, teamB2Select } from '../dom-elements.js';
import { pairFromSelects, teamKey } from './team-identity.js';
import { getTeamRecord } from './team-service.js';

function labelFor(players) {
  if (!players || players.length === 0) return '';
  const record = getTeamRecord(teamKey(players));
  return record?.name ? record.name : players.join(' + ');
}

/** Refresh both labels from the current selects + team records. */
export function updateLiveTeamLabels() {
  const redEl = document.getElementById('liveTeamLabelRed');
  const blueEl = document.getElementById('liveTeamLabelBlue');
  const vsEl = document.getElementById('liveTeamVs');
  if (!redEl || !blueEl) return;
  const { red, blue } = pairFromSelects(
    teamA1Select?.value, teamA2Select?.value, teamB1Select?.value, teamB2Select?.value
  );
  const redText = labelFor(red);
  const blueText = labelFor(blue);
  redEl.textContent = redText;
  blueEl.textContent = blueText;
  // Only show "vs" once both sides have a team.
  if (vsEl) vsEl.style.visibility = redText && blueText ? 'visible' : 'hidden';
}

/** Wire the labels: react to lineup changes (manual or programmatic) and team-data updates. */
export function initLiveTeamLabels() {
  [teamA1Select, teamA2Select, teamB1Select, teamB2Select].forEach((sel) => {
    if (sel) sel.addEventListener('change', updateLiveTeamLabels);
  });
  // Suggest-pairing / tournament prefill / swaps set selects programmatically
  // (no native 'change' event), so also listen for the lineup-changed signal.
  window.addEventListener('lineup-changed', updateLiveTeamLabels);
  window.addEventListener('teams-updated', updateLiveTeamLabels);
  updateLiveTeamLabels();
}
