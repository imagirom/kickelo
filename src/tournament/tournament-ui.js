// Tournament UI — List, create, detail views for tournaments.

import {
  initializeTournamentsData, getVisibleTournaments, getTournamentById,
  createTournament, addTeam, removeTeam, updateTeamName,
  updateTournamentConfig, lockTournament, submitTournamentGameResult,
  generateNextSwissRound, softDeleteTournament, cloneTournament,
} from './tournament-service.js';
import {
  getReadyGames, getNextDefaultGame, getGameById,
  isSwissRoundComplete, getCurrentSwissRound, isTournamentComplete,
  generateTeamName,
} from './tournament-engine.js';
import { allMatches } from '../match-data-service.js';
import { showToast, showConfirm } from '../toast.js';

let currentView = 'list'; // 'list' | 'detail'
let selectedTournamentId = null;
let container = null;

// Tournament match mode state (shared with match form)
let activeTournamentGame = null;

const FORMAT_LABELS = {
  single_elim: 'Single Elimination',
  double_elim: 'Double Elimination',
  swiss: 'Swiss',
  round_robin: 'Round Robin',
  double_round_robin: 'Double Round Robin',
};

const STATE_LABELS = {
  setup: 'Setup',
  in_progress: 'In Progress',
  completed: 'Completed',
  deleted: 'Deleted',
};

/**
 * Initialize the tournaments UI section.
 */
export function initializeTournamentUI() {
  container = document.getElementById('tournamentsContainer');
  if (!container) return;

  initializeTournamentsData();
  window.addEventListener('tournaments-updated', render);
  render();
}

/**
 * Get current active tournament game (for match form integration).
 */
export function getActiveTournamentGame() {
  return activeTournamentGame;
}

/**
 * Clear tournament game mode (called after match submission or cancel).
 */
export function clearActiveTournamentGame() {
  activeTournamentGame = null;
  render();
}

function render() {
  if (!container) return;
  if (currentView === 'detail' && selectedTournamentId) {
    renderDetail();
  } else {
    renderList();
  }
}

// =========================================================================
// List View
// =========================================================================

function renderList() {
  currentView = 'list';
  const tournaments = getVisibleTournaments();

  let html = '';

  // Create button
  html += `<div class="tournament-create-form" id="tournamentCreateForm" style="display:none;">
    <input type="text" id="tournamentNameInput" placeholder="Tournament name" maxlength="60" />
    <input type="password" id="tournamentPasswordInput" placeholder="Admin password (optional)" />
    <div class="tournament-create-row">
      <button id="tournamentCreateConfirm">Create</button>
      <button id="tournamentCreateCancel" style="background:#3a3a3a;">Cancel</button>
    </div>
  </div>`;
  html += `<button id="tournamentCreateBtn" style="margin-bottom:12px;">➕ Create Tournament</button>`;

  // Tournament list
  if (tournaments.length === 0) {
    html += `<p style="text-align:center;color:#777;">No tournaments yet.</p>`;
  } else {
    html += `<ul class="tournament-list">`;
    for (const t of tournaments) {
      const formatLabel = t.format ? FORMAT_LABELS[t.format] || t.format : 'No format';
      const stateLabel = STATE_LABELS[t.state] || t.state;
      html += `<li class="tournament-card" data-id="${t.id}">
        <div class="tournament-card-header">
          <span class="tournament-card-name">${escapeHtml(t.name)}</span>
          <div class="tournament-card-meta">
            <span class="tournament-format-badge">${formatLabel}</span>
            <span class="tournament-badge ${t.state}">${stateLabel}</span>
          </div>
        </div>
        <div style="font-size:0.85em;color:#888;margin-top:4px;">
          ${t.teams.length} teams${t.state === 'completed' ? ' · ✅ Complete' : ''}
        </div>
      </li>`;
    }
    html += `</ul>`;
  }

  container.innerHTML = html;

  // Event listeners
  const createBtn = container.querySelector('#tournamentCreateBtn');
  const createForm = container.querySelector('#tournamentCreateForm');
  const confirmBtn = container.querySelector('#tournamentCreateConfirm');
  const cancelBtn = container.querySelector('#tournamentCreateCancel');
  const nameInput = container.querySelector('#tournamentNameInput');
  const passwordInput = container.querySelector('#tournamentPasswordInput');

  createBtn.addEventListener('click', () => {
    createForm.style.display = createForm.style.display === 'none' ? 'block' : 'none';
    createBtn.style.display = createForm.style.display === 'none' ? 'block' : 'none';
    if (createForm.style.display !== 'none') nameInput.focus();
  });

  cancelBtn.addEventListener('click', () => {
    createForm.style.display = 'none';
    createBtn.style.display = 'block';
  });

  confirmBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    confirmBtn.disabled = true;
    try {
      const id = await createTournament(name, passwordInput.value || null);
      selectedTournamentId = id;
      currentView = 'detail';
      // Will re-render on snapshot update
    } catch (err) {
      console.error('Failed to create tournament:', err);
      showToast('Error: ' + err.message, 'error');
    }
    confirmBtn.disabled = false;
  });

  // Card clicks
  container.querySelectorAll('.tournament-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedTournamentId = card.dataset.id;
      currentView = 'detail';
      render();
    });
  });
}

// =========================================================================
// Detail View
// =========================================================================

function renderDetail() {
  const t = getTournamentById(selectedTournamentId);
  if (!t) {
    renderList();
    return;
  }

  let html = `<div class="tournament-detail">`;

  // Header
  html += `<div class="tournament-detail-header">
    <span class="tournament-detail-title">🏆 ${escapeHtml(t.name)}</span>
    <button class="tournament-back-btn" id="tournamentBackBtn">← Back</button>
  </div>`;
  html += `<div style="margin-bottom:12px;">
    <span class="tournament-badge ${t.state}">${STATE_LABELS[t.state] || t.state}</span>
    ${t.format ? `<span class="tournament-format-badge" style="margin-left:6px;">${FORMAT_LABELS[t.format] || t.format}</span>` : ''}
  </div>`;

  if (t.state === 'setup') {
    html += renderSetupView(t);
  } else if (t.state === 'in_progress') {
    html += renderInProgressView(t);
  } else if (t.state === 'completed') {
    html += renderCompletedView(t);
  }

  // Delete action
  if (t.state !== 'deleted') {
    html += `<div class="tournament-actions">
      <button class="tournament-delete-btn" id="tournamentDeleteBtn">🗑 Delete Tournament</button>
    </div>`;
  }

  html += `</div>`;
  container.innerHTML = html;

  // Back button
  container.querySelector('#tournamentBackBtn')?.addEventListener('click', () => {
    currentView = 'list';
    selectedTournamentId = null;
    render();
  });

  // Delete button
  container.querySelector('#tournamentDeleteBtn')?.addEventListener('click', async () => {
    const confirmed = await showConfirm(`Delete tournament "${t.name}"? It will be hidden from view.`, { type: 'warning', confirmLabel: '🗑 Delete' });
    if (!confirmed) return;
    try {
      await softDeleteTournament(t.id);
      currentView = 'list';
      selectedTournamentId = null;
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // Phase-specific event binding
  if (t.state === 'setup') {
    bindSetupEvents(t);
  } else if (t.state === 'in_progress') {
    bindInProgressEvents(t);
  } else if (t.state === 'completed') {
    bindCompletedEvents(t);
  }

  // Bracket tab switching (DE)
  bindBracketTabs(t);
}

// =========================================================================
// Setup View
// =========================================================================

function renderSetupView(t) {
  let html = '';

  // Teams list
  html += `<h3 style="color:#ccc;margin:0 0 8px;">Teams (${t.teams.length})</h3>`;
  html += `<ul class="tournament-teams-list">`;
  for (const team of t.teams) {
    html += `<li class="tournament-team-item" data-team-id="${team.id}">
      <span class="team-seed">#${team.seed}</span>
      <input type="text" class="team-name-input" value="${escapeHtml(team.name)}" 
             data-team-id="${team.id}" style="flex:1;margin:0 8px;" />
      <span class="team-players">${team.players.join(', ')}</span>
      <button class="team-remove" data-team-id="${team.id}">✕</button>
    </li>`;
  }
  html += `</ul>`;

  // Add team controls
  html += `<div class="tournament-add-team">
    <select id="addTeamPlayer1"><option value="">Player 1...</option></select>
    <select id="addTeamPlayer2"><option value="">Player 2 (opt.)</option></select>
    <button id="addTeamBtn">➕ Add</button>
  </div>`;

  // Format selector
  html += `<div class="tournament-format-selector">
    <label>Format</label>
    <select id="tournamentFormatSelect">
      <option value="" ${!t.format ? 'selected' : ''}>Select format...</option>
      <option value="single_elim" ${t.format === 'single_elim' ? 'selected' : ''}>Single Elimination</option>
      <option value="double_elim" ${t.format === 'double_elim' ? 'selected' : ''}>Double Elimination</option>
      <option value="swiss" ${t.format === 'swiss' ? 'selected' : ''}>Swiss</option>
      <option value="round_robin" ${t.format === 'round_robin' ? 'selected' : ''}>Round Robin</option>
      <option value="double_round_robin" ${t.format === 'double_round_robin' ? 'selected' : ''}>Double Round Robin</option>
    </select>
  </div>`;

  // Config
  html += `<div class="tournament-config">
    <label>
      Seeding:
      <select id="tournamentSeedingSelect">
        <option value="elo" ${t.config?.seedingMode === 'elo' ? 'selected' : ''}>By Elo</option>
        <option value="random" ${t.config?.seedingMode === 'random' ? 'selected' : ''}>Random</option>
      </select>
    </label>
  </div>`;

  // Lock button
  const canLock = t.teams.length >= 2 && t.format;
  html += `<button class="tournament-lock-btn" id="tournamentLockBtn" 
    ${canLock ? '' : 'disabled'}>
    🔒 Lock In & Start
  </button>`;
  if (!canLock) {
    html += `<p style="text-align:center;color:#888;font-size:0.85em;margin-top:4px;">
      Need at least 2 teams and a format to start.
    </p>`;
  }

  return html;
}

function bindSetupEvents(t) {
  // Populate player dropdowns
  const playerNames = getAvailablePlayers();
  const sel1 = container.querySelector('#addTeamPlayer1');
  const sel2 = container.querySelector('#addTeamPlayer2');
  populatePlayerSelect(sel1, playerNames);
  populatePlayerSelect(sel2, playerNames, true);

  // Add team (with duplicate player check)
  container.querySelector('#addTeamBtn')?.addEventListener('click', async () => {
    const p1 = sel1.value;
    const p2 = sel2.value;
    if (!p1) { sel1.focus(); return; }
    const players = p2 ? [p1, p2] : [p1];

    // Check for duplicate players across teams
    const existingPlayers = new Map();
    for (const team of t.teams) {
      for (const pl of team.players) {
        existingPlayers.set(pl, team.name);
      }
    }
    for (const pl of players) {
      if (existingPlayers.has(pl)) {
        showToast(`${pl} is already on team "${existingPlayers.get(pl)}"`, 'error');
        return;
      }
    }

    try {
      await addTeam(t.id, players);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // Remove team (with confirmation)
  container.querySelectorAll('.team-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const teamId = btn.dataset.teamId;
      const team = t.teams.find(tm => tm.id === teamId);
      const teamLabel = team ? team.name : teamId;
      const confirmed = await showConfirm(`Remove team "${teamLabel}"?`, { type: 'warning', confirmLabel: 'Remove' });
      if (!confirmed) return;
      try {
        await removeTeam(t.id, teamId);
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });
  });

  // Team name editing
  container.querySelectorAll('.team-name-input').forEach(input => {
    let debounceTimer;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const teamId = input.dataset.teamId;
        const newName = input.value.trim();
        if (newName) {
          try {
            await updateTeamName(t.id, teamId, newName);
          } catch (err) {
            console.error('Failed to update team name:', err);
          }
        }
      }, 500);
    });
  });

  // Format selection
  container.querySelector('#tournamentFormatSelect')?.addEventListener('change', async (e) => {
    try {
      await updateTournamentConfig(t.id, { format: e.target.value || null });
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // Seeding mode
  container.querySelector('#tournamentSeedingSelect')?.addEventListener('change', async (e) => {
    try {
      await updateTournamentConfig(t.id, { config: { ...t.config, seedingMode: e.target.value } });
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // Lock (with uniform team size check and game count preview)
  container.querySelector('#tournamentLockBtn')?.addEventListener('click', async () => {
    // Validate uniform team sizes
    const sizes = new Set(t.teams.map(tm => tm.players.length));
    if (sizes.size > 1) {
      showToast('All teams must have the same number of players (all singles or all doubles).', 'error');
      return;
    }

    const gameCount = estimateGameCount(t.teams.length, t.format, t.config);
    const approx = t.format === 'double_elim' ? '~' : '';
    const confirmed = await showConfirm(
      `Lock tournament "${t.name}" with ${t.teams.length} teams in ${FORMAT_LABELS[t.format]}?\n\nThis will create ${approx}${gameCount} games. This cannot be undone.`,
      { type: 'warning', confirmLabel: '🔒 Lock In' }
    );
    if (!confirmed) return;

    const btn = container.querySelector('#tournamentLockBtn');
    btn.disabled = true;
    btn.textContent = 'Locking...';
    try {
      const playerElos = getPlayerElos();
      await lockTournament(t.id, playerElos);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = '🔒 Lock In & Start';
    }
  });
}

// =========================================================================
// In-Progress View
// =========================================================================

function renderInProgressView(t) {
  let html = '';

  // Play next game button
  const nextGame = getNextDefaultGame(t);
  if (nextGame) {
    const t0 = nextGame.teams[0]?.name || 'TBD';
    const t1 = nextGame.teams[1]?.name || 'TBD';
    html += `<button class="tournament-play-btn" id="playNextGameBtn" data-game-id="${nextGame.id}">
      ▶ Play Next: ${escapeHtml(nextGame.roundName)} — ${escapeHtml(t0)} vs ${escapeHtml(t1)}
    </button>`;
  }

  // Swiss: generate next round
  if (t.format === 'swiss') {
    const currentRound = getCurrentSwissRound(t);
    const maxRounds = t.config?.swissRounds || Math.ceil(Math.log2(t.teams.length));
    if (isSwissRoundComplete(t, currentRound) && currentRound < maxRounds) {
      html += `<button class="tournament-swiss-btn" id="swissNextRoundBtn">
        📋 Generate Round ${currentRound + 1}
      </button>`;
    }
  }

  // Bracket / standings visualization
  html += renderBracketVisualization(t);

  // Game list
  html += renderGameList(t);

  return html;
}

function bindInProgressEvents(t) {
  // Play next game
  container.querySelector('#playNextGameBtn')?.addEventListener('click', () => {
    const gameId = container.querySelector('#playNextGameBtn').dataset.gameId;
    startTournamentGame(t, gameId);
  });

  // Click on ready game
  container.querySelectorAll('.tournament-game-item.ready').forEach(item => {
    item.addEventListener('click', () => {
      startTournamentGame(t, item.dataset.gameId);
    });
  });

  // Swiss next round
  container.querySelector('#swissNextRoundBtn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#swissNextRoundBtn');
    btn.disabled = true;
    try {
      await generateNextSwissRound(t.id);
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
    btn.disabled = false;
  });

  // Bracket match clicks
  container.querySelectorAll('.bracket-match.ready').forEach(el => {
    el.addEventListener('click', () => {
      startTournamentGame(t, el.dataset.gameId);
    });
  });
}

// =========================================================================
// Completed View
// =========================================================================

function renderCompletedView(t) {
  let html = '';

  // Rankings
  if (t.finalRankings && t.finalRankings.length > 0) {
    html += `<h3 style="color:#ccc;margin:0 0 8px;">🏅 Final Rankings</h3>`;
    html += `<table class="tournament-rankings">
      <thead><tr>
        <th>Rank</th><th>Team</th><th>W</th><th>L</th>
      </tr></thead><tbody>`;
    for (const r of t.finalRankings) {
      const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : '';
      html += `<tr>
        <td>${medal} ${r.rank}</td>
        <td>${escapeHtml(r.teamName)}</td>
        <td>${r.wins}</td>
        <td>${r.losses}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  // Bracket / standings visualization
  html += renderBracketVisualization(t);

  // All games
  html += renderGameList(t);

  // Re-do button
  html += `<div style="margin-top: 16px; text-align: center;">
    <button id="tournamentRedoBtn" class="tournament-btn" style="font-size: 0.95em;">🔄 Re-do Tournament</button>
  </div>`;

  return html;
}

function bindCompletedEvents(t) {
  const container = document.getElementById('tournamentDetail');
  if (!container) return;

  container.querySelector('#tournamentRedoBtn')?.addEventListener('click', async () => {
    const defaultName = t.name + ' (rematch)';
    const confirmed = await showConfirm(
      `Create a new tournament with the same teams and format?`,
      {
        confirmLabel: '🔄 Re-do',
        type: 'info',
        contentElement: (() => {
          const el = document.createElement('div');
          el.innerHTML = `<input type="text" id="redoTournamentName" value="${escapeHtml(defaultName)}" 
            style="width:100%;padding:8px;margin-top:8px;border-radius:4px;border:1px solid #555;background:#333;color:#eee;font-size:0.95em;"
            placeholder="New tournament name">`;
          return el;
        })()
      }
    );
    if (!confirmed) return;

    const nameInput = document.getElementById('redoTournamentName');
    const newName = nameInput?.value?.trim() || defaultName;

    try {
      const newId = await cloneTournament(t.id, newName);
      selectedTournamentId = newId;
      currentView = 'detail';
      showToast(`Tournament "${newName}" created!`, 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });
}

// =========================================================================
// Game List (shared between in-progress and completed views)
// =========================================================================

function renderGameList(t) {
  let html = `<h3 style="color:#ccc;margin:8px 0;">Games</h3>`;
  html += `<ul class="tournament-games-list">`;

  // Group by bracket for DE
  const games = t.games.filter(g => !g.isBye);
  let grouped;
  if (t.format === 'double_elim') {
    const wb = games.filter(g => g.bracket === 'winners');
    const lb = games.filter(g => g.bracket === 'losers');
    const gf = games.filter(g => g.bracket === 'grand_final');
    grouped = [
      { label: 'Winners Bracket', games: wb },
      { label: 'Losers Bracket', games: lb },
      { label: 'Grand Final', games: gf },
    ].filter(g => g.games.length > 0);
  } else {
    grouped = [{ label: null, games }];
  }

  for (const group of grouped) {
    if (group.label) {
      html += `<li style="padding:6px 0;font-weight:bold;color:#aaa;font-size:0.85em;">
        ${group.label}
      </li>`;
    }
    for (const game of group.games) {
      const t0 = game.teams[0]?.name || '<span class="tbd">TBD</span>';
      const t1 = game.teams[1]?.name || '<span class="tbd">TBD</span>';
      const statusClass = game.status;

      let scoreText = '';
      if (game.result) {
        scoreText = `${game.result.score[0]} : ${game.result.score[1]}`;
      }

      html += `<li class="tournament-game-item ${statusClass}" data-game-id="${game.id}">
        <span class="tournament-game-name">${escapeHtml(game.roundName)}</span>
        <span class="tournament-game-matchup">${t0} vs ${t1}</span>
        <span class="tournament-game-score">${scoreText}</span>
        <span class="tournament-game-status ${statusClass}">${
          game.status === 'completed' ? '✓' : game.status === 'ready' ? '▶ Play' : '⏳'
        }</span>
      </li>`;
    }
  }

  html += `</ul>`;
  return html;
}

// =========================================================================
// Tournament Game Mode (match form integration)
// =========================================================================

function startTournamentGame(tournament, gameId) {
  const game = getGameById(tournament, gameId);
  if (!game) { showToast('Game not found', 'error'); return; }
  if (game.status !== 'ready') { showToast('This game is not ready to play yet.', 'warning'); return; }

  activeTournamentGame = {
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    gameId: game.id,
    gameName: game.roundName,
    team0: {
      ...game.teams[0],
      players: tournament.teams.find(t => t.id === game.teams[0]?.teamId)?.players || [],
    },
    team1: {
      ...game.teams[1],
      players: tournament.teams.find(t => t.id === game.teams[1]?.teamId)?.players || [],
    },
  };

  // Dispatch event so match form can pick it up
  window.dispatchEvent(new CustomEvent('tournament-game-selected', {
    detail: activeTournamentGame
  }));

  // Scroll to match form
  const matchForm = document.getElementById('matchForm');
  if (matchForm) {
    matchForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/**
 * Called after a match is submitted for a tournament game.
 * Cascades the result in the tournament.
 * @param {string} matchId - Firestore match document ID
 * @param {number} goalsA - Goals scored by team in red side
 * @param {number} goalsB - Goals scored by team in blue side
 * @param {number} winnerIndex - 0 or 1, index in tournament game slots
 */
export async function completeTournamentMatch(matchId, goalsA, goalsB, winnerIndex) {
  if (!activeTournamentGame) return;

  const { tournamentId, gameId } = activeTournamentGame;
  const score = [goalsA, goalsB];

  try {
    await submitTournamentGameResult(tournamentId, gameId, winnerIndex, matchId, score);
  } catch (err) {
    console.error('Failed to submit tournament game result:', err);
    showToast('Tournament result error: ' + err.message, 'error');
  }

  activeTournamentGame = null;
}

// =========================================================================
// Bracket / Standings Visualization
// =========================================================================

function renderBracketVisualization(t) {
  if (!t.games || t.games.length === 0) return '';

  if (t.format === 'single_elim') {
    return renderEliminationBracket(t.games.filter(g => !g.isBye && g.bracket === 'main'), 'Bracket');
  }

  if (t.format === 'double_elim') {
    const wb = t.games.filter(g => !g.isBye && g.bracket === 'winners');
    const lb = t.games.filter(g => !g.isBye && g.bracket === 'losers');
    const gf = t.games.filter(g => !g.isBye && g.bracket === 'grand_final');
    let html = `<div class="bracket-tabs">
      <button class="bracket-tab active" data-tab="wb">Winners</button>
      <button class="bracket-tab" data-tab="lb">Losers</button>
    </div>`;
    html += `<div class="bracket-tab-content" id="bracket-wb">${renderEliminationBracket([...wb, ...gf], null)}</div>`;
    html += `<div class="bracket-tab-content" id="bracket-lb" style="display:none;">${renderEliminationBracket(lb, null)}</div>`;
    return html;
  }

  if (t.format === 'swiss') {
    return renderSwissStandings(t);
  }

  if (t.format === 'round_robin' || t.format === 'double_round_robin') {
    return renderRoundRobinStandings(t);
  }

  return '';
}

function renderEliminationBracket(games, title) {
  if (games.length === 0) return '';

  // Group games by round
  const roundMap = new Map();
  for (const g of games) {
    if (!roundMap.has(g.round)) roundMap.set(g.round, []);
    roundMap.get(g.round).push(g);
  }
  // Sort rounds
  const rounds = Array.from(roundMap.keys()).sort((a, b) => a - b);

  let html = '';
  if (title) html += `<h3 style="color:#ccc;margin:8px 0;">${escapeHtml(title)}</h3>`;
  html += `<div class="bracket-container"><div class="bracket-scroll">`;

  for (const roundNum of rounds) {
    const roundGames = roundMap.get(roundNum).sort((a, b) => a.position - b.position);
    const roundLabel = roundGames[0]?.roundName?.replace(/ \d+$/, '') || `Round ${roundNum}`;
    html += `<div class="bracket-round">`;
    html += `<div class="bracket-round-header">${escapeHtml(roundLabel)}</div>`;
    for (const game of roundGames) {
      const t0Name = game.teams[0]?.name || 'TBD';
      const t1Name = game.teams[1]?.name || 'TBD';
      const isCompleted = game.status === 'completed';
      const isReady = game.status === 'ready';
      const winner = isCompleted ? game.result?.winner : null;
      const score = isCompleted && game.result?.score ? game.result.score : null;

      html += `<div class="bracket-match ${isReady ? 'ready' : ''} ${isCompleted ? 'completed' : ''}" data-game-id="${game.id}">`;
      html += `<div class="bracket-team ${winner === 0 ? 'winner' : ''} ${!game.teams[0]?.teamId ? 'tbd' : ''}">
        <span class="bracket-team-name">${escapeHtml(t0Name)}</span>
        <span class="bracket-team-score">${score ? score[0] : ''}</span>
      </div>`;
      html += `<div class="bracket-team ${winner === 1 ? 'winner' : ''} ${!game.teams[1]?.teamId ? 'tbd' : ''}">
        <span class="bracket-team-name">${escapeHtml(t1Name)}</span>
        <span class="bracket-team-score">${score ? score[1] : ''}</span>
      </div>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  html += `</div></div>`;
  return html;
}

function renderSwissStandings(t) {
  // Build standings from completed games
  const teamStats = new Map();
  for (const team of t.teams) {
    teamStats.set(team.id, { name: team.name, wins: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 });
  }

  for (const g of t.games) {
    if (g.status !== 'completed' || g.isBye || !g.result) continue;
    const winnerId = g.teams[g.result.winner]?.teamId;
    const loserId = g.teams[1 - g.result.winner]?.teamId;
    if (winnerId && teamStats.has(winnerId)) teamStats.get(winnerId).wins++;
    if (loserId && teamStats.has(loserId)) teamStats.get(loserId).losses++;
    if (g.result.score) {
      const [s0, s1] = g.result.score;
      const t0 = g.teams[0]?.teamId;
      const t1 = g.teams[1]?.teamId;
      if (t0 && teamStats.has(t0)) { teamStats.get(t0).goalsFor += s0; teamStats.get(t0).goalsAgainst += s1; }
      if (t1 && teamStats.has(t1)) { teamStats.get(t1).goalsFor += s1; teamStats.get(t1).goalsAgainst += s0; }
    }
  }

  const standings = Array.from(teamStats.values()).sort((a, b) =>
    (b.wins - a.wins) || ((b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst))
  );

  let html = `<h3 style="color:#ccc;margin:8px 0;">📊 Standings</h3>`;
  html += `<table class="tournament-rankings">
    <thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>GD</th></tr></thead><tbody>`;
  standings.forEach((s, i) => {
    const gd = s.goalsFor - s.goalsAgainst;
    html += `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>${s.wins}</td>
      <td>${s.losses}</td>
      <td>${gd >= 0 ? '+' : ''}${gd}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

function renderRoundRobinStandings(t) {
  return renderSwissStandings(t);
}

function bindBracketTabs(t) {
  const tabs = container.querySelectorAll('.bracket-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(tb => tb.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      container.querySelectorAll('.bracket-tab-content').forEach(c => c.style.display = 'none');
      const content = container.querySelector(`#bracket-${target}`);
      if (content) content.style.display = 'block';
    });
  });
}

// =========================================================================
// Helpers
// =========================================================================

function estimateGameCount(numTeams, format, config = {}) {
  if (numTeams < 2) return 0;
  switch (format) {
    case 'single_elim':
      return numTeams - 1;
    case 'double_elim': {
      // WB + LB + GF (+ optional reset)
      const total = 2 * numTeams - 2 + 1;
      return config.grandFinalReset ? total + 1 : total;
    }
    case 'swiss': {
      const rounds = config.swissRounds || Math.ceil(Math.log2(numTeams));
      return Math.floor(numTeams / 2) * rounds;
    }
    case 'round_robin':
      return numTeams * (numTeams - 1) / 2;
    case 'double_round_robin':
      return numTeams * (numTeams - 1);
    default:
      return '?';
  }
}

function getAvailablePlayers() {
  // Collect unique player names from recent matches
  const names = new Set();
  if (allMatches) {
    for (const m of allMatches) {
      if (Array.isArray(m.teamA)) m.teamA.forEach(p => names.add(p));
      if (Array.isArray(m.teamB)) m.teamB.forEach(p => names.add(p));
    }
  }
  return Array.from(names).sort();
}

function getPlayerElos() {
  // Build player Elo map from match data (use latest computed stats)
  // For now, return empty — the tournament service defaults to 1500
  // TODO: integrate with player-stats-batch for real Elo values
  return {};
}

function populatePlayerSelect(select, players, optional = false) {
  const currentValue = select.value;
  const firstOption = optional ? '<option value="">Player 2 (opt.)</option>' : '<option value="">Player 1...</option>';
  select.innerHTML = firstOption + players.map(p =>
    `<option value="${escapeHtml(p)}" ${p === currentValue ? 'selected' : ''}>${escapeHtml(p)}</option>`
  ).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
