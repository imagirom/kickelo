// src/teams/team-edit-modal.js
// Modal UI for editing a team's name + Spotify entrance song + start time.
// Mirrors the match edit modal's structure/classes for visual consistency.

import { setTeamRecord, getTeamRecord } from './team-service.js';
import { normalizeTrackUri } from './team-identity.js';
import { showToast } from '../toast.js';

let currentModal = null;

function closeTeamEditModal() {
  if (!currentModal) return;
  currentModal.classList.remove('confirm-visible');
  const modal = currentModal;
  currentModal = null;
  modal.addEventListener('transitionend', () => modal.remove(), { once: true });
  setTimeout(() => modal.remove(), 350);
}

/** Build a labeled field row: <label> + control. */
function field(labelText, control, hintText) {
  const row = document.createElement('div');
  row.className = 'team-edit-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  row.appendChild(label);
  row.appendChild(control);
  if (hintText) {
    const hint = document.createElement('div');
    hint.className = 'team-edit-hint';
    hint.textContent = hintText;
    row.appendChild(hint);
  }
  return row;
}

/**
 * Open the edit modal for a team.
 * @param {string} key       team key
 * @param {string[]} players sorted pair
 */
export function openTeamEditModal(key, players) {
  if (currentModal) closeTeamEditModal();

  const record = getTeamRecord(key) || {};
  const playersLabel = players.join(' + ');

  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop edit-modal-backdrop';

  const dialog = document.createElement('div');
  dialog.className = 'confirm-dialog edit-modal-dialog';

  const title = document.createElement('div');
  title.className = 'edit-modal-title';
  title.textContent = 'Edit Team';
  dialog.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'edit-modal-original';
  subtitle.textContent = playersLabel;
  dialog.appendChild(subtitle);

  const scrollBody = document.createElement('div');
  scrollBody.className = 'confirm-scroll-body';

  // Team name
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'team-edit-input';
  nameInput.placeholder = 'e.g. MaMa';
  nameInput.value = record.name || '';
  scrollBody.appendChild(field('Team name', nameInput, 'Leave empty to show the player names instead.'));

  // Entrance song URI
  const songInput = document.createElement('input');
  songInput.type = 'text';
  songInput.className = 'team-edit-input';
  songInput.placeholder = 'spotify:track:… or open.spotify.com/track/…';
  songInput.value = record.songUri || '';
  scrollBody.appendChild(field(
    'Entrance song',
    songInput,
    'Paste a Spotify track URI or share link. Plays when this team starts live mode. Leave empty for none.'
  ));

  // Start time (seconds)
  const startInput = document.createElement('input');
  startInput.type = 'number';
  startInput.min = '0';
  startInput.step = '1';
  startInput.className = 'team-edit-input';
  startInput.placeholder = '0';
  startInput.value = record.songPositionMs ? Math.round(record.songPositionMs / 1000) : '';
  scrollBody.appendChild(field('Start at (seconds)', startInput, 'Where the song begins, in seconds (e.g. 51).'));

  dialog.appendChild(scrollBody);

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'confirm-buttons';

  const btnCancel = document.createElement('button');
  btnCancel.className = 'confirm-btn confirm-btn-cancel';
  btnCancel.type = 'button';
  btnCancel.textContent = 'Cancel';

  const btnSave = document.createElement('button');
  btnSave.className = 'confirm-btn confirm-btn-ok';
  btnSave.type = 'button';
  btnSave.textContent = 'Save';

  btnRow.appendChild(btnCancel);
  btnRow.appendChild(btnSave);
  dialog.appendChild(btnRow);

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  currentModal = backdrop;
  requestAnimationFrame(() => backdrop.classList.add('confirm-visible'));

  btnCancel.addEventListener('click', closeTeamEditModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeTeamEditModal(); });

  btnSave.addEventListener('click', async () => {
    const rawSong = songInput.value.trim();
    let songUri = null;
    if (rawSong) {
      songUri = normalizeTrackUri(rawSong);
      if (!songUri) {
        showToast('That doesn’t look like a Spotify track link or URI.', 'error');
        songInput.focus();
        return;
      }
    }
    const seconds = parseFloat(startInput.value);
    const songPositionMs = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;

    btnSave.disabled = true;
    btnSave.textContent = 'Saving…';
    try {
      await setTeamRecord(key, players, { name: nameInput.value, songUri, songPositionMs });
      showToast('Team saved.', 'success');
      closeTeamEditModal();
    } catch (err) {
      console.error('Failed to save team:', err);
      showToast('Failed to save team — see console.', 'error');
      btnSave.disabled = false;
      btnSave.textContent = 'Save';
    }
  });

  requestAnimationFrame(() => nameInput.focus());
}
