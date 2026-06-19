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
  if (!redEl || !blueEl) return;
  const { red, blue } = pairFromSelects(
    teamA1Select?.value, teamA2Select?.value, teamB1Select?.value, teamB2Select?.value
  );
  redEl.textContent = labelFor(red);
  blueEl.textContent = labelFor(blue);
}

/** Wire the labels: react to select changes and to team-data updates. */
export function initLiveTeamLabels() {
  [teamA1Select, teamA2Select, teamB1Select, teamB2Select].forEach((sel) => {
    if (sel) sel.addEventListener('change', updateLiveTeamLabels);
  });
  window.addEventListener('teams-updated', updateLiveTeamLabels);
  updateLiveTeamLabels();
}
