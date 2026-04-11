# Kickelo Project Overview

## Purpose and Current Status

Kickelo is a web application for tracking foosball (table soccer) matches with Elo (overall + role-based offense/defense) and OpenSkill ratings. It supports:
- Manual and live match entry (with optional goal timelines)
- Rich player stats, leaderboards, and streak/badge indicators
- Season-aware stats recomputation and daily deltas
- Suggested 2v2 pairings with waiting‑karma logic
- 1v1 and 2v2 matches across all stats and history views

The app is production‑ready, with real‑time Firestore updates, a modular ES‑module frontend, and a responsive UI.

## Technical Overview

- **Frontend:** Vanilla JavaScript (ES modules) built with Vite, HTML, CSS (custom properties)
- **Backend/Database:** Firebase Firestore with multi‑tab IndexedDB persistence
- **Authentication:** Firebase Auth with a shared email + password gate
- **Storage:** Firebase Storage for optional vibration logs
- **Hosting:** Firebase Hosting (Vite build outputs to `dist`)
- **State Management:** In‑memory caches (`allPlayers`, `allMatches`, stats cache) refreshed via Firestore listeners
- **UI:** DOM manipulation, modals, Chart.js for charts

## App Flow

1. Auth gate is shown until the shared password is accepted.
2. On login, Firestore listeners attach for players and matches.
3. Cached arrays update, triggering UI refreshes and stats recomputation.
4. Match submissions update player Elo, write match records, and optionally upload vibration logs.

## Core Features

- **Match entry:** Manual scoring or live mode with goal log and duration tracking.
- **Match editing:** Edit scores, swap teams/scores, or soft-delete matches via the recent matches display.
- **1v1 + 2v2 support:** Team sizes must match; the same player can be selected twice for 1v1.
- **Role‑based Elo:** Offense/defense Elo only updates when positions are confirmed.
- **Ranked matches:** Matches can be flagged as ranked/unranked.
- **Tournaments:** Structured competitions with 5 formats (single/double elimination, Swiss, round robin, double round robin). Includes bracket visualization, automatic winner cascading, match editing with cascade support, and final rankings.
- **Pause days:** Configurable date list to pause the app with an overlay.
- **Pairing suggestions:** Session‑aware 2v2 suggestions using recency + waiting‑karma weighting.

## Data Model

- **Players:** `{ id, name, elo, games }`
- **Matches:**
  ```
  {
    id,
    teamA, teamB, winner,
    goalsA, goalsB,
    eloDelta, timestamp,
    positionsConfirmed?, ranked?,
    goalLog?, matchDuration?,
    vibrationLogPath?,
    pairingMetadata?,
    tournamentId?, tournamentGameId?,
    tournamentGameName?, tournamentName?,
    edited?, editedAt?, editHistory?,
    deleted?
  }
  ```
  - `teamA`/`teamB` are arrays with length 1 (1v1) or 2 (2v2).
  - `pairingMetadata` tracks pairing origin and waiting players.
  - Tournament fields link a match to a tournament game for cross-referencing.
- **Tournaments:** Single documents at `/tournaments/{id}` containing:
  ```
  {
    name, format, state (setup|in_progress|completed|deleted),
    teams[], games[], defaultGameOrder[],
    config { seedingMode, swissRounds?, grandFinalReset? },
    finalRankings?,
    createdAt, lockedAt?, completedAt?, deletedAt?
  }
  ```
  - Games are embedded as an array of `TournamentGame` objects with DAG slots for winner/loser cascading.

## File‑by‑File Highlights

### App & UI
- `src/app.js`: App bootstrap, auth gate, listener lifecycle, pause screen.
- `src/match-form-handler.js`: Validation, live mode, Elo updates, match writes, vibration logs, tournament game integration.
- `src/match-edit-service.js`, `src/match-edit-modal.js`: Match editing logic and UI with tournament cascade support.
- `src/leaderboard-display.js`, `src/recent-matches-display.js`: Core UI views (recent matches includes tournament context tags).
- `src/player-stats-component.js`: Player modal with charts and tables.
- `src/match-timeline.js`: SVG timeline rendering for goal logs.

### Tournaments
- `src/tournament/tournament-engine.js`: Pure-function DAG engine — game completion, winner cascading, rankings, validation.
- `src/tournament/tournament-formats.js`: Bracket/schedule generators for all 5 formats.
- `src/tournament/tournament-service.js`: Firestore CRUD, tournament locking, game completion, match editing cascade.
- `src/tournament/tournament-ui.js`: UI rendering, bracket visualization, event binding, format selection.

### Data & Analytics
- `src/firebase-service.js`: Firebase init + persistence, emulator hooks (commented).
- `src/player-data-service.js`, `src/match-data-service.js`: Real‑time listeners + cache updates.
- `src/player-stats-batch.js`: Single‑pass stats engine (Elo/OpenSkill, badges, streaks).
- `src/stats-cache-service.js`: Cached stats store with update events.
- `src/pairing-service.js`: 2v2 suggestion engine + waiting‑karma logic.
- `src/season-service.js`: Season selection and K‑factor override.

### Server/Admin
- `functions/`: Firebase Cloud Functions (separate Node 22 package).
- `admin/`: One‑off admin scripts (backup, recompute Elo, cleanup).

## Testing

- Tests live in `test/`
- `npm test` runs all suites: stats, cache, match editing, tournament engine
- `test/tournament-engine.test.js` covers all formats, DAG cascading, rankings, editing, and game count validation (~290 tests)

## Performance Optimizations

- Batch stats computation in `src/player-stats-batch.js` reduces repeated per‑stat passes.
- Stats caching in `src/stats-cache-service.js` speeds leaderboard and modal rendering.

---

Keep this document updated as features or architecture evolve.
