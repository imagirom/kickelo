# Teams: names + entrance songs + 4:4 song + Spotify reliability — design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)
**Builds on:** [2026-06-16-live-mode-audio-design.md](2026-06-16-live-mode-audio-design.md),
[2026-06-17-dev-menu-design.md](2026-06-17-dev-menu-design.md)

## Summary

Introduce **team identity** (a player pair, its colour, its name, its entrance
song) and use it for several features, built in two phases:

- **Phase 1 — Audio (no Firestore):** a global **4:4 "golden"** trigger, and a
  **Spotify reliability** fix for the idle-device problem.
- **Phase 2 — Team subsystem (Firestore):** persisted **team records** (name +
  entrance song) keyed by player pair, with seeding, a dev-gated edit UI in the
  team-ELO leaderboard, bracketed name display, a coloured display above the
  Start-live-mode button, and entrance songs played on live-mode start.

## Context

- **Team-ELO criterion (looked up):** `leaderboard-display.js renderTeamLeaderboard`
  shows pairs with **≥5 games** in the selected season. So "gets a team ELO in
  All-time" = a pair with ≥5 games in the All-time season. Teams are keyed by the
  sorted pair (`createTeamKey` → `players.sort().join('::')`) in
  `player-stats-batch.js`.
- The match form exposes the current teams via
  `teamA1Select/teamA2Select/teamB1Select/teamB2Select` (`.value.trim()`).
  **Red = Team A, Blue = Team B** (consistent with the goal buttons / `goalsA/B`).
- `firebase-service.js` exports `db, collection, doc, getDoc, getDocs, setDoc,
  onSnapshot`. Real-time data pattern: `player-data-service.js` (`onSnapshot` →
  in-memory array → debounced `*-updated` CustomEvent).
- `firestore.rules` gates collections with `canAccess()` (signed-in, non-anonymous);
  `meta` and `tournaments` allow broad write to such users.
- Audio system (shipped): `sound-config.js` registry, `sound-events.js emit()`,
  `spotify-client.js` (PKCE, `playTrack`), score triggers in
  `match-form-handler.js`, dev menu in `dev-menu.js` (in-memory reveal, re-hidden
  each reload).

### Name-mapping caveat

The requested songs/names use first names ("Marc & Manuel"); records key on the
**stored** player-name strings (likely full names, e.g. "Marc Ickler"). The seed
will be built against the live roster; any first name that can't be unambiguously
matched is flagged to the user rather than guessed.

## Phase 1 — Audio additions

### 4:4 "golden" trigger
- New pure detector in `src/audio/danger-zone.js` (rename file concept stays;
  it's the triggers module): `isFourFour(redBefore, blueBefore, scorer)` → true
  when the goal makes the score 4:4 (i.e. `scorerAfter === MAX_GOALS - 1 &&
  opponentScore === MAX_GOALS - 1`).
- Registered **code-level** in `sound-config.js`:
  `fourFour: { channel: 'spotify', uri: 'spotify:track:5Cp75TUMrHF6c8xbhdligS', positionMs: 0 }`.
- Emitted from both score handlers (computed from pre-push scores, like
  `dangerZone`): after the push, `if (isFourFour(...)) emit('fourFour')`.
- Unit-tested across the truth table (4:3→4:4 ✓ either side; 3:3→4:3 ✗; 4:4 only
  reachable as 3:4→4:4 / 4:3→4:4).

### Spotify reliability (full)
Goal: fix "play fails after Spotify has been idle a few minutes" (device drops
off Connect). In `spotify-client.js`:
- `getDevices()` → `GET /v1/me/player/devices`; remember the active/most-recent
  device's `device_id` in `localStorage` (`spotify_device_id`).
- `playTrack` issues `PUT /v1/me/player/play?device_id=<id>` when an id is known
  (wakes that specific device).
- **Auto-recover on 404:** fetch devices, `PUT /v1/me/player`
  (`{ device_ids:[id], play:false }`) to reactivate, then **retry the play once**.
  Only if no device exists at all → fall back to the existing "open Spotify and
  hit play once" toast.
- **Pre-arm:** on successful `connect()`/token-load and on live-mode start, call
  `getDevices()` to refresh the stored `device_id`.
- Scopes unchanged (`user-read-playback-state` + `user-modify-playback-state`
  already cover devices + transfer).

## Phase 2 — Team subsystem

### Modules
- `src/teams/team-identity.js` (pure): `teamKey(a, b)` (sorted, `::`-joined,
  matching `createTeamKey`); `pairFromSelects(a1, a2, b1, b2)` →
  `{ red:[…], blue:[…] }` (trimmed, empties dropped, each pair deduped); the
  random conflict picker `pickEntrance(records)` → one record or null.
- `src/teams/team-service.js`: `onSnapshot` on `teams` → in-memory `Map` keyed by
  `teamKey`; `getTeamRecord(key)`; `getCurrentTeamRecords()` (using the selects);
  `setTeamName(key, players, name)` (writes via `setDoc(..., { merge:true })`,
  stamping `updatedAt`); `initializeTeams()` (listener), `seedInitialTeams()`.

### Firestore
- Collection `teams`, doc id = `teamKey`. Doc:
  `{ players: [sortedPair], name: string|null, songUri: string|null,
     songPositionMs: number, updatedAt: serverTimestamp }`.
- Rule (mirrors `meta`): `match /teams/{teamId}` — `allow read: if canAccess();`
  `allow write: if canAccess() && request.resource.data.players is list && (!('name' in …) || name is string) && (!('songUri' in …) || songUri is string)`.

### Seeding
- Code constant `INITIAL_TEAMS` (resolved to real player-name pairs):
  - Names: **MaMa** = Manuel & Marc, **SaSi** = Sarah & Simon, plus a few obvious
    picks from `kicker_team_names/`.
  - Entrance songs: Dominic & Jannis → `spotify:track:476V2d6iA2tWXgQboKmTtA`;
    Marc & Manuel → `spotify:track:3z8h0TU7ReDPLIbEnYhWZb` @ `positionMs: 51000`;
    Tobi & Roman → `spotify:track:590NTsqsSXMSDA7zuAPZdu`.
    (Marc & Manuel get both a name *and* a song.)
- A **dev-menu "Seed initial teams" button** writes the constant **idempotently**:
  for each entry, only set fields that are absent on the existing doc (never
  clobber a manually-edited name/song). One click in production seeds everyone.

### Dev-mode flag (shared)
- `dev-menu.js` exposes `isDevMode()` and dispatches a `dev-mode-changed`
  CustomEvent when the triple-tap reveals the menu. In-memory only (re-hidden each
  reload), consistent with the shipped dev menu.
- The team leaderboard and the seed button react to this flag/event.

### Leaderboard (team-ELO view, `leaderboard-display.js renderTeamLeaderboard`)
- Name shown in brackets behind players: `Manuel + Marc (MaMa)` (only when named).
- A per-team **edit button (✏️)** rendered only when `isDevMode()` is true; on
  `dev-mode-changed`, re-render so buttons appear/disappear. Click → small
  prompt/modal pre-filled with the current name → `setTeamName(...)`. (Name
  editing only this phase; song editing is future work.)

### Above Start-live-mode display
- A container inserted **before `#toggleLiveMode`** in `index.html` with two
  labels (red, blue). On any team-select `change` (and on team-data updates), each
  label shows the team's **name in its colour** (red `.red_select` colour / blue
  `.blue_select` colour) if the pair is named, else the joined player names. A pair
  with an empty/partial selection shows nothing for that side.

### Entrance songs on live-mode start
- In `setLiveMode(true)`: read `getCurrentTeamRecords()`; collect records that have
  a `songUri`; `pickEntrance(...)` (random if both) → `playTrack(uri,
  { positionMs })` via the Phase-1 reliable path. No song if neither team has one.
- This supersedes nothing in the existing goal/danger-zone triggers; later score
  triggers (Danger Zone, 4:4) simply start a new track as before.

## Testing
- **Unit (node):** `isFourFour` truth table; `teamKey` ordering/idempotence;
  `pairFromSelects` (trim/empty/dedup); `pickEntrance` (returns one of the inputs;
  null when none). Add to existing `test/audio.test.js` (4:4) and a new
  `test/teams.test.js` (+`test:teams` script).
- **Manual / in-browser:** seed button writes docs; bracketed names render; edit
  button appears only in dev mode and persists a rename; above-button labels track
  selections and colours; entrance song plays on live-mode start (and the random
  pick when both teams have one); 4:4 plays "golden"; Spotify reliability recovers
  after an idle gap.

## Out of scope
- Editing entrance songs via UI (stored in Firestore now; editing is future work).
- Persisting dev-mode unlock across reloads.
- Auto-generating names for all qualifying teams (only the seeded set + manual
  edits).
- Team colours beyond the existing red/blue sides.
