// src/match-edit-modal.js
// Modal UI for editing a submitted match.

import { allPlayers } from './player-data-service.js';
import { canEditMatch, saveMatchEdit, softDeleteMatch } from './match-edit-service.js';
import { MAX_GOALS } from './constants.js';
import { showConfirm, showToast } from './toast.js';
import { canEditTournamentGame, updateTournamentGameResult, getTournamentById } from './tournament/tournament-service.js';

let currentModal = null;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Determine the tournament winner index (0 or 1) from the edited match data.
 * Maps the match's teamA/teamB to tournament game's team slots.
 */
async function determineTournamentWinnerIndex(tournamentId, gameId, edited, matchWinner) {
    const tournament = getTournamentById(tournamentId);
    if (!tournament) throw new Error('Tournament not found');

    const game = tournament.games.find(g => g.id === gameId);
    if (!game) throw new Error('Tournament game not found');

    // Get team players from tournament
    const t0 = tournament.teams.find(t => t.id === game.teams[0]?.teamId);
    const t1 = tournament.teams.find(t => t.id === game.teams[1]?.teamId);

    const t0Players = t0 ? [...new Set(t0.players)].sort() : [];
    const t1Players = t1 ? [...new Set(t1.players)].sort() : [];

    const editedTeamA = [...new Set(edited.teamA)].sort();

    const arrEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    // Determine: is match teamA = tournament team0 or team1?
    if (arrEq(editedTeamA, t0Players)) {
        // teamA = team0: winner 'A' means winnerIndex 0
        return matchWinner === 'A' ? 0 : 1;
    } else if (arrEq(editedTeamA, t1Players)) {
        // teamA = team1: winner 'A' means winnerIndex 1
        return matchWinner === 'A' ? 1 : 0;
    }

    // Fallback: assume original mapping
    return matchWinner === 'A' ? 0 : 1;
}

/**
 * Determine the tournament score in team0/team1 order from the edited match data.
 */
function determineTournamentScore(tournamentId, gameId, edited) {
    const tournament = getTournamentById(tournamentId);
    if (!tournament) return [edited.goalsA, edited.goalsB];

    const game = tournament.games.find(g => g.id === gameId);
    if (!game) return [edited.goalsA, edited.goalsB];

    const t0 = tournament.teams.find(t => t.id === game.teams[0]?.teamId);
    const t0Players = t0 ? [...new Set(t0.players)].sort() : [];
    const editedTeamA = [...new Set(edited.teamA)].sort();
    const arrEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    // If match teamA = tournament team0, score is [goalsA, goalsB]
    // If match teamA = tournament team1, score is [goalsB, goalsA]
    if (arrEq(editedTeamA, t0Players)) {
        return [edited.goalsA, edited.goalsB];
    }
    return [edited.goalsB, edited.goalsA];
}

/**
 * Build a player <select> dropdown pre-filled with the given value.
 * @param {string} selectedValue - Current player name.
 * @param {string} placeholder - Placeholder text.
 * @param {string} cssClass - Extra CSS class for team color.
 * @returns {HTMLSelectElement}
 */
function buildPlayerSelect(selectedValue, placeholder, cssClass) {
    const select = document.createElement('select');
    select.className = `edit-modal-select ${cssClass}`;

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = placeholder;
    select.appendChild(defaultOpt);

    const players = allPlayers.map(p => p.id).sort();
    for (const name of players) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    }

    select.value = selectedValue || '';
    return select;
}

/**
 * Build a goals <select> dropdown pre-filled with the given value.
 * @param {number} selectedValue - Current goals count.
 * @param {string} cssClass - Extra CSS class for team color.
 * @returns {HTMLSelectElement}
 */
function buildGoalsSelect(selectedValue, cssClass) {
    const select = document.createElement('select');
    select.className = `edit-modal-select edit-modal-goals ${cssClass}`;

    for (let i = 0; i <= MAX_GOALS; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = String(i);
        select.appendChild(opt);
    }

    select.value = String(selectedValue ?? 0);
    return select;
}

/**
 * Build the change summary element that updates live as the user edits.
 */
function buildChangeSummary(original, getEdited) {
    const container = document.createElement('div');
    container.className = 'edit-modal-changes';

    function update() {
        const edited = getEdited();
        const changes = [];

        if (JSON.stringify(edited.teamA) !== JSON.stringify(original.teamA)) {
            changes.push(`Team Red: ${original.teamA.join(' & ')} → ${edited.teamA.join(' & ')}`);
        }
        if (JSON.stringify(edited.teamB) !== JSON.stringify(original.teamB)) {
            changes.push(`Team Blue: ${original.teamB.join(' & ')} → ${edited.teamB.join(' & ')}`);
        }
        if (edited.goalsA !== original.goalsA || edited.goalsB !== original.goalsB) {
            changes.push(`Score: ${original.goalsA}:${original.goalsB} → ${edited.goalsA}:${edited.goalsB}`);
        }
        if (edited.ranked !== (original.ranked ?? true)) {
            changes.push(`Ranked: ${original.ranked ?? true ? 'Yes' : 'No'} → ${edited.ranked ? 'Yes' : 'No'}`);
        }

        // Goal log warning
        const hasGoalLog = Array.isArray(original.goalLog) && original.goalLog.length > 0;
        const scoreChanged = edited.goalsA !== original.goalsA || edited.goalsB !== original.goalsB;
        if (hasGoalLog && scoreChanged) {
            const isJustSwapped = edited.goalsA === original.goalsB && edited.goalsB === original.goalsA;
            if (isJustSwapped) {
                changes.push('⚠ Goal log: teams will be swapped to match');
            } else {
                changes.push('⚠ Goal log will be discarded (score changed)');
            }
        }

        if (changes.length === 0) {
            container.innerHTML = '<span class="edit-modal-no-changes">No changes</span>';
        } else {
            container.innerHTML = changes.map(c => {
                const isWarning = c.startsWith('⚠');
                return `<div class="edit-modal-change-item${isWarning ? ' goal-log-warning' : ''}">• ${escapeHtml(c)}</div>`;
            }).join('');
        }
    }

    return { element: container, update };
}

/**
 * Open the edit modal for a given match.
 * @param {object} match - The match object from allMatches.
 */
export async function openEditModal(match) {
    if (currentModal) {
        closeEditModal();
    }

    const editCheck = canEditMatch(match);
    if (!editCheck.editable) {
        return;
    }

    // Check tournament editability if this is a tournament match
    if (match.tournamentId && match.tournamentGameId) {
        const tournamentCheck = await canEditTournamentGame(match.tournamentId, match.tournamentGameId);
        if (!tournamentCheck.editable) {
            showToast(tournamentCheck.reason, 'warning', 4000);
            return;
        }
    }

    const is2v2 = match.teamA.length === 2;

    // Build backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop edit-modal-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog edit-modal-dialog';

    // Title
    const title = document.createElement('div');
    title.className = 'edit-modal-title';
    title.textContent = 'Edit Match';
    dialog.appendChild(title);

    // Scrollable body
    const scrollBody = document.createElement('div');
    scrollBody.className = 'confirm-scroll-body';

    // Original match reference
    const originalRef = document.createElement('div');
    originalRef.className = 'edit-modal-original';
    const teamANames = match.teamA.map(p => `<span style="color: #ce848c;">${escapeHtml(p)}</span>`).join(' & ');
    const teamBNames = match.teamB.map(p => `<span style="color: #6cabc2;">${escapeHtml(p)}</span>`).join(' & ');
    const winnerNames = match.winner === 'A' ? teamANames : teamBNames;
    const loserNames = match.winner === 'A' ? teamBNames : teamANames;
    const wGoals = match.winner === 'A' ? match.goalsA : match.goalsB;
    const lGoals = match.winner === 'A' ? match.goalsB : match.goalsA;
    originalRef.innerHTML = `<span class="edit-modal-original-label">Original:</span> ${winnerNames} ${wGoals}:${lGoals} ${loserNames}`;
    scrollBody.appendChild(originalRef);

    // --- Teams row (side by side) ---
    const teamsRow = document.createElement('div');
    teamsRow.className = 'edit-modal-teams-row';

    // --- Team A (Red) ---
    const teamASection = document.createElement('div');
    teamASection.className = 'edit-modal-team edit-modal-team-red';

    const teamALabel = document.createElement('div');
    teamALabel.className = 'edit-modal-team-label';
    teamALabel.textContent = 'Team Red';
    teamASection.appendChild(teamALabel);

    const teamA1Select = buildPlayerSelect(match.teamA[0], 'Red defense', 'edit-red');
    teamASection.appendChild(teamA1Select);
    let teamA2Select = null;
    if (is2v2) {
        teamA2Select = buildPlayerSelect(match.teamA[1], 'Red offense', 'edit-red');
        teamASection.appendChild(teamA2Select);
    }
    teamsRow.appendChild(teamASection);

    // --- Team B (Blue) ---
    const teamBSection = document.createElement('div');
    teamBSection.className = 'edit-modal-team edit-modal-team-blue';

    const teamBLabel = document.createElement('div');
    teamBLabel.className = 'edit-modal-team-label';
    teamBLabel.textContent = 'Team Blue';
    teamBSection.appendChild(teamBLabel);

    const teamB1Select = buildPlayerSelect(match.teamB[0], 'Blue defense', 'edit-blue');
    teamBSection.appendChild(teamB1Select);
    let teamB2Select = null;
    if (is2v2) {
        teamB2Select = buildPlayerSelect(match.teamB[1], 'Blue offense', 'edit-blue');
        teamBSection.appendChild(teamB2Select);
    }
    teamsRow.appendChild(teamBSection);
    scrollBody.appendChild(teamsRow);

    // --- Score (centered below teams) ---
    const scoreSection = document.createElement('div');
    scoreSection.className = 'edit-modal-score';

    const goalsASelect = buildGoalsSelect(match.goalsA, 'edit-red');
    const goalsBSelect = buildGoalsSelect(match.goalsB, 'edit-blue');
    const scoreSeparator = document.createElement('span');
    scoreSeparator.className = 'edit-modal-score-sep';
    scoreSeparator.textContent = ':';

    scoreSection.appendChild(goalsASelect);
    scoreSection.appendChild(scoreSeparator);
    scoreSection.appendChild(goalsBSelect);
    scrollBody.appendChild(scoreSection);

    // --- Ranked checkbox ---
    const rankedRow = document.createElement('div');
    rankedRow.className = 'edit-modal-option-row';
    const rankedLabel = document.createElement('label');
    const rankedCheckbox = document.createElement('input');
    rankedCheckbox.type = 'checkbox';
    rankedCheckbox.checked = match.ranked ?? true;
    rankedLabel.appendChild(rankedCheckbox);
    rankedLabel.appendChild(document.createTextNode(' Ranked match'));
    rankedRow.appendChild(rankedLabel);
    scrollBody.appendChild(rankedRow);

    // --- Quick actions ---
    const quickActions = document.createElement('div');
    quickActions.className = 'edit-modal-quick-actions';

    const swapTeamsBtn = document.createElement('button');
    swapTeamsBtn.className = 'confirm-btn confirm-btn-cancel';
    swapTeamsBtn.textContent = '⇆ Swap Teams';
    swapTeamsBtn.type = 'button';
    swapTeamsBtn.addEventListener('click', () => {
        // Swap player selections only (not the score)
        const tmpA1 = teamA1Select.value;
        const tmpA2 = teamA2Select?.value;
        const tmpB1 = teamB1Select.value;
        const tmpB2 = teamB2Select?.value;
        teamA1Select.value = tmpB1;
        teamB1Select.value = tmpA1;
        if (is2v2) {
            teamA2Select.value = tmpB2;
            teamB2Select.value = tmpA2;
        }
        changeSummary.update();
    });
    quickActions.appendChild(swapTeamsBtn);

    const swapWinnerBtn = document.createElement('button');
    swapWinnerBtn.className = 'confirm-btn confirm-btn-cancel';
    swapWinnerBtn.textContent = '↕ Swap Score';
    swapWinnerBtn.type = 'button';
    swapWinnerBtn.addEventListener('click', () => {
        const tmpGA = goalsASelect.value;
        goalsASelect.value = goalsBSelect.value;
        goalsBSelect.value = tmpGA;
        changeSummary.update();
    });
    quickActions.appendChild(swapWinnerBtn);

    scrollBody.appendChild(quickActions);

    // --- Delete (soft) button ---
    const deleteRow = document.createElement('div');
    deleteRow.className = 'edit-modal-quick-actions';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'confirm-btn confirm-btn-cancel';
    deleteBtn.style.color = '#e07a7a';
    deleteBtn.textContent = match.deleted ? '↩ Restore Match' : '🗑 Delete Match';
    deleteBtn.type = 'button';
    deleteRow.appendChild(deleteBtn);
    scrollBody.appendChild(deleteRow);

    // --- Change summary ---
    function getEditedValues() {
        const teamA = [teamA1Select.value].concat(teamA2Select ? [teamA2Select.value] : []).filter(Boolean);
        const teamB = [teamB1Select.value].concat(teamB2Select ? [teamB2Select.value] : []).filter(Boolean);
        return {
            teamA: teamA.length > 0 ? teamA : match.teamA,
            teamB: teamB.length > 0 ? teamB : match.teamB,
            goalsA: parseInt(goalsASelect.value, 10),
            goalsB: parseInt(goalsBSelect.value, 10),
            ranked: rankedCheckbox.checked,
        };
    }

    const changeSummary = buildChangeSummary(match, getEditedValues);
    scrollBody.appendChild(changeSummary.element);
    changeSummary.update();

    dialog.appendChild(scrollBody);

    // Wire up live change detection on all inputs
    const allInputs = [teamA1Select, teamA2Select, teamB1Select, teamB2Select, goalsASelect, goalsBSelect, rankedCheckbox].filter(Boolean);
    allInputs.forEach(input => {
        input.addEventListener('change', changeSummary.update);
    });

    // Auto-set other goals to MAX when one changes (same behavior as main form)
    goalsASelect.addEventListener('change', () => {
        if (goalsASelect.value !== String(MAX_GOALS)) {
            goalsBSelect.value = String(MAX_GOALS);
        }
        changeSummary.update();
    });
    goalsBSelect.addEventListener('change', () => {
        if (goalsBSelect.value !== String(MAX_GOALS)) {
            goalsASelect.value = String(MAX_GOALS);
        }
        changeSummary.update();
    });

    // --- Buttons ---
    const btnRow = document.createElement('div');
    btnRow.className = 'confirm-buttons';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'confirm-btn confirm-btn-cancel';
    btnCancel.textContent = 'Cancel';
    btnCancel.type = 'button';

    const btnSave = document.createElement('button');
    btnSave.className = 'confirm-btn confirm-btn-ok';
    btnSave.textContent = 'Save Changes';
    btnSave.type = 'button';

    btnRow.appendChild(btnCancel);
    btnRow.appendChild(btnSave);
    dialog.appendChild(btnRow);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    currentModal = backdrop;

    // Animate in
    requestAnimationFrame(() => backdrop.classList.add('confirm-visible'));

    // Event handlers
    btnCancel.addEventListener('click', closeEditModal);
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeEditModal();
    });

    // Delete button handler
    deleteBtn.addEventListener('click', async () => {
        const isDeleted = !!match.deleted;
        const action = isDeleted ? 'restore' : 'mark as deleted';
        const proceed = await showConfirm(
            isDeleted
                ? 'Restore this match? It will be included in rankings again.'
                : 'Mark this match as deleted? It will be excluded from rankings but kept in history.',
            { confirmLabel: isDeleted ? 'Restore' : 'Delete', cancelLabel: 'Cancel', type: 'warning' }
        );
        if (!proceed) return;

        deleteBtn.disabled = true;
        deleteBtn.textContent = isDeleted ? 'Restoring…' : 'Deleting…';

        const success = await softDeleteMatch(match, !isDeleted);
        if (success) {
            closeEditModal();
        } else {
            deleteBtn.disabled = false;
            deleteBtn.textContent = isDeleted ? '↩ Restore Match' : '🗑 Delete Match';
        }
    });

    btnSave.addEventListener('click', async () => {
        const edited = getEditedValues();

        // Determine goal log impact
        const hasGoalLog = Array.isArray(match.goalLog) && match.goalLog.length > 0;
        const scoreChanged = edited.goalsA !== match.goalsA || edited.goalsB !== match.goalsB;
        let goalLogAction = null; // null = no change, 'swap' = swap teams, 'discard' = remove

        if (hasGoalLog && scoreChanged) {
            const isJustSwapped = edited.goalsA === match.goalsB && edited.goalsB === match.goalsA;
            goalLogAction = isJustSwapped ? 'swap' : 'discard';
        }

        // Build confirmation message
        const warnings = [];
        const isRanked = match.ranked ?? true;
        if (isRanked && edited.ranked) {
            warnings.push('This will trigger Elo recalculation for all affected players.');
        }
        if (goalLogAction === 'discard') {
            warnings.push('The goal log (live match timeline) will be permanently discarded because the score changed.');
        } else if (goalLogAction === 'swap') {
            warnings.push('The goal log teams will be swapped to match the new score.');
        }
        // Tournament-specific warning
        if (match.tournamentId && match.tournamentGameId) {
            const oldWinnerSide = match.goalsA > match.goalsB ? 'A' : 'B';
            const newWinnerSide = edited.goalsA > edited.goalsB ? 'A' : 'B';
            if (oldWinnerSide !== newWinnerSide) {
                warnings.push('⚠️ This changes the winner — the tournament bracket will be updated accordingly.');
            } else if (scoreChanged) {
                warnings.push('The tournament game score will be updated.');
            }
        }

        if (warnings.length > 0) {
            const proceed = await showConfirm(
                warnings.join('\n\n') + '\n\nContinue?',
                { confirmLabel: 'Save', cancelLabel: 'Go back', type: 'warning' }
            );
            if (!proceed) return;
        }

        btnSave.disabled = true;
        btnSave.textContent = 'Saving…';

        const success = await saveMatchEdit(match, edited, goalLogAction);
        if (success) {
            // If this is a tournament match and the winner changed, cascade the update
            if (match.tournamentId && match.tournamentGameId) {
                const oldWinner = match.goalsA > match.goalsB ? 'A' : 'B';
                const newWinner = edited.goalsA > edited.goalsB ? 'A' : 'B';
                const oldScore = [match.goalsA, match.goalsB];
                const newScore = [edited.goalsA, edited.goalsB];
                const winnerChanged = oldWinner !== newWinner;
                const scoreChanged2 = oldScore[0] !== newScore[0] || oldScore[1] !== newScore[1];

                if (winnerChanged || scoreChanged2) {
                    try {
                        // Determine winnerIndex in tournament terms
                        // The match stores teams in form order, tournament stores in slot order
                        // We need to figure out which tournament team won
                        // team0 players = match's original teamA? Not necessarily if swapped during play
                        // Safest: look at edited teamA/teamB and match to tournament teams
                        const tournamentWinnerIndex = await determineTournamentWinnerIndex(
                            match.tournamentId, match.tournamentGameId, edited, newWinner
                        );
                        // Score in tournament order (team0 goals, team1 goals)
                        const tournamentScore = determineTournamentScore(
                            match.tournamentId, match.tournamentGameId, edited
                        );
                        await updateTournamentGameResult(
                            match.tournamentId,
                            match.tournamentGameId,
                            tournamentWinnerIndex,
                            match.id,
                            tournamentScore
                        );
                        showToast('Tournament bracket updated', 'success');
                    } catch (err) {
                        console.error('Failed to update tournament:', err);
                        showToast('Match saved but tournament update failed: ' + err.message, 'warning', 5000);
                    }
                }
            }
            closeEditModal();
        } else {
            btnSave.disabled = false;
            btnSave.textContent = 'Save Changes';
        }
    });

    // Focus save button
    requestAnimationFrame(() => btnSave.focus());
}

function closeEditModal() {
    if (!currentModal) return;
    currentModal.classList.remove('confirm-visible');
    const modal = currentModal;
    currentModal = null;
    modal.addEventListener('transitionend', () => modal.remove(), { once: true });
    setTimeout(() => modal.remove(), 350);
}
