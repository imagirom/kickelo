// Import the shared, centrally-managed match data
import { allMatches } from './match-data-service.js';
import { recentMatchesList, recentMatchesHeading } from './dom-elements.js';
import { createTimelineWithLabel } from './match-timeline.js';
import { filterMatchesBySeason, getSelectedSeason } from './season-service.js';
import { getSeasonMatchDelta } from './stats-cache-service.js';
import { canEditMatch } from './match-edit-service.js';
import { openEditModal } from './match-edit-modal.js';


function createMatchListItem(match) {
    const li = document.createElement("li");

    const teamAPlayers = match.teamA.map(player => `<span style="color: #ce848c;">${player}</span>`).join(` <span style="color: #ce848c;">&</span> `);
    const teamBPlayers = match.teamB.map(player => `<span style="color: #6cabc2;">${player}</span>`).join(` <span style="color: #6cabc2;">&</span> `);

    const winner = match.winner === "A" ? teamAPlayers : teamBPlayers;
    const loser = match.winner === "A" ? teamBPlayers : teamAPlayers;

    // Default to "-" if goals are not available
    const goalsA = match.goalsA ?? "-";
    const goalsB = match.goalsB ?? "-";
    const winnerGoals = match.winner === "A" ? goalsA : goalsB;
    const loserGoals = match.winner === "A" ? goalsB : goalsA;

    const seasonDelta = getSeasonMatchDelta(match);
    const deltaDisplay = seasonDelta ?? 0;
    const deltaLabel = match.deleted
        ? ''
        : match.ranked === false
            ? '(unranked)'
            : `(Elo Δ: ${deltaDisplay})`;

    // Colored elo delta badge for the right side
    const deltaHtml = match.deleted || match.ranked === false
        ? (match.ranked === false && !match.deleted ? '<span class="match-elo-badge unranked">unranked</span>' : '')
        : deltaDisplay > 0
            ? `<span class="match-elo-badge positive">▲ ${deltaDisplay}</span>`
            : deltaDisplay < 0
                ? `<span class="match-elo-badge negative">▼ ${Math.abs(deltaDisplay)}</span>`
                : `<span class="match-elo-badge neutral">± 0</span>`;

    // Edited / deleted / tournament indicators
    const deletedTag = match.deleted
        ? '<span class="match-deleted-tag">(deleted)</span>'
        : '';
    const editedTag = !match.deleted && Array.isArray(match.editHistory) && match.editHistory.length > 0
        ? '<span class="match-edited-tag">(edited)</span>'
        : '';
    const tournamentLabel = match.tournamentGameName
        ? (match.tournamentName
            ? `${match.tournamentName} — ${match.tournamentGameName}`
            : match.tournamentGameName)
        : '';
    const tournamentTag = tournamentLabel
        ? `<span class="match-tournament-tag">🏆 ${tournamentLabel}</span>`
        : '';

    // Top row: result text + edit button
    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'center';
    topRow.innerHTML = `<span class="match-result-text" style="flex: 1;">${winner} <strong>${winnerGoals}:${loserGoals}</strong> ${loser}${deletedTag}${editedTag}${tournamentTag}</span>${deltaHtml}`;
    if (match.deleted) {
        li.classList.add('match-deleted');
    }

    // Edit button
    const { editable } = canEditMatch(match);
    if (editable) {
        const editBtn = document.createElement('button');
        editBtn.className = 'match-edit-btn';
        editBtn.title = 'Edit this match';
        editBtn.textContent = '✏️';
        editBtn.type = 'button';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(match);
        });
        topRow.appendChild(editBtn);
    }
    li.appendChild(topRow);

    // If live match, add timeline
    if (Array.isArray(match.goalLog) && match.goalLog.length > 0) {
        const timelineWithLabel = createTimelineWithLabel(match.goalLog);
        if (timelineWithLabel) {
            li.appendChild(timelineWithLabel);
        }
    }
    return li;
}

// Helper to render matches to the DOM with a fade effect
function renderMatchesToDom(matches) {
    // Fade out the heading and list
    recentMatchesHeading.classList.add("hidden");
    recentMatchesList.classList.add("hidden");

    setTimeout(() => { // Small delay for fade-out effect
        recentMatchesHeading.textContent = "Recent Matches";
        recentMatchesList.innerHTML = ""; // Clear the list

        if (matches.length === 0) {
            recentMatchesList.innerHTML = "<li>No matches found.</li>";
        } else {
            matches.forEach(match => {
                const li = createMatchListItem(match);
                recentMatchesList.appendChild(li);
            });
        }

        // Fade in the heading and list
        recentMatchesHeading.classList.remove("hidden");
        recentMatchesList.classList.remove("hidden");
    }, 150); // Match the duration of the CSS transition
}

/**
 * Initializes the recent matches display. It performs an initial render
 * and then listens for the 'matches-updated' event to automatically refresh.
 */
export function initializeRecentMatchesDisplay() {
    const n_matches = 10; // Number of matches to display

    const updateDisplay = () => {
        // Since allMatches is pre-sorted newest-to-oldest, we just need the first N items.
        const seasonMatches = filterMatchesBySeason(allMatches, getSelectedSeason());
        const recent = seasonMatches.slice(0, n_matches);
        renderMatchesToDom(recent);
        console.log("Recent matches display updated.");
    };

    // Perform the initial render as soon as the component is initialized.
    // This handles the case where the data is already available.
    updateDisplay();

    // Listen for the custom event dispatched by the data service when matches are updated.
    window.addEventListener('matches-updated', updateDisplay);
    window.addEventListener('season-changed', updateDisplay);

    console.log("Recent matches display initialized and listening for 'matches-updated' event.");
}
