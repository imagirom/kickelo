# Kickelo

Kickelo is a web app for tracking foosball matches with Elo (overall + role‑based offense/defense) and OpenSkill ratings. It supports live and manual match entry, 1v1 and 2v2 play, rich stats, and real‑time updates via Firestore.

## Features

- Live match mode with goal timeline and match duration
- 1v1 and 2v2 matches across all stats and history views
- Role‑based Elo (offense/defense) when positions are confirmed
- Leaderboards, streaks, badges, and player stats charts
- 2v2 pairing suggestions with waiting‑karma logic
- Season selection with optional K‑factor overrides
- Match editing with goal log handling and soft delete
- **Tournaments** — structured competitions with bracket/schedule management (see below)
- Optional vibration log uploads to Firebase Storage

## Tech Stack

- **Frontend:** Vanilla JS (ES modules) + Vite
- **Charts:** Chart.js
- **Ratings:** Elo + OpenSkill
- **Backend:** Firebase Firestore/Auth/Storage
- **Hosting:** Firebase Hosting (`dist` output)

## Getting Started

### Prerequisites

- Node.js (project uses Vite; Firebase Functions package targets Node 22)
- Firebase project access if you plan to run against production data

### Install

```bash
npm install
```

### Run locally

```bash
npm run dev
```

### Build & preview

```bash
npm run build
npm run preview
```

## Tests

```bash
npm test
```

Or run individual suites:

```bash
npm run test:stats
npm run test:cache
npm run test:edit
npm run test:tournament
```

## Firebase Emulators

`firebase.json` defines emulator ports. In development mode, `src/firebase-service.js` automatically connects to Firestore (7070) and Auth (9099). Start these alongside Vite:

```bash
npx firebase-tools emulators:start --only firestore,auth --import=./firebase_emulator_cache
```

See the golden-football betting section below for local login and test instructions.

## Tournaments

Kickelo supports structured tournaments with fixed teams and automatic bracket/schedule management.

### Supported Formats

| Format | Description | Games for N teams |
|--------|-------------|-------------------|
| Single Elimination | Standard knockout bracket (padded to next power of 2 with byes) | N − 1 |
| Double Elimination | Winners + losers brackets with grand final | ~2N − 1 |
| Swiss | Pairing based on standings each round; configurable round count | ⌊N/2⌋ × rounds |
| Round Robin | Every pair plays once | N(N−1)/2 |
| Double Round Robin | Every pair plays twice (home/away swapped in second half) | N(N−1) |

### Tournament Lifecycle

1. **Create** — give it a name.
2. **Setup** — add teams (1 or 2 players each; all teams must be the same size), choose a format, and configure options (seeding mode, Swiss rounds, etc.).
3. **Lock** — confirms the bracket/schedule. Games are generated and the tournament moves to `in_progress`. This cannot be undone.
4. **Play** — select the next game or pick any ready game from the list. Players are auto-filled in the match form. Tournament games count as normal ranked matches.
5. **Complete** — once all games are played, final rankings are computed. A "Re-do" button lets you create a new tournament with the same teams and seeding.

### Key Behaviours

- **Editing tournament matches**: Allowed as long as no downstream game (that depends on the result) has been played. Editing cascades updated winners to subsequent rounds.
- **Soft delete**: Tournaments and matches can be marked as deleted without removing data.
- **Tournament context**: Recent matches display shows the tournament name and game name (e.g. "Summer Cup — Semi-Final 1").
- **Normal games**: Can be played freely between tournament games.

### Data Model

Tournaments are stored as single Firestore documents (`/tournaments/{id}`) with an embedded games array. Match documents link back via `tournamentId`, `tournamentGameId`, `tournamentGameName`, and `tournamentName` fields.

### Source Files

- `src/tournament/tournament-engine.js` — pure-function DAG engine (complete, uncomplete, rankings, validation)
- `src/tournament/tournament-formats.js` — bracket/schedule generators for all formats
- `src/tournament/tournament-service.js` — Firestore CRUD, lock, game completion
- `src/tournament/tournament-ui.js` — UI rendering, bracket visualization, event binding

## Notifications (Opt-in)

Kickelo can send push notifications when a match is submitted.

### Setup

1. Enable Cloud Messaging for the Firebase project.
2. Create a Web Push certificate in Firebase Console → Project Settings → Cloud Messaging.
3. Add the VAPID key to a local env file for Vite:

```bash
VITE_FIREBASE_VAPID_KEY=YOUR_PUBLIC_VAPID_KEY
```

4. Deploy the Cloud Functions and Firestore rules:

```bash
firebase deploy --only functions,firestore:rules
```

### Notes

- Notifications require HTTPS (localhost is OK for development).
- Users can opt in/out via the UI toggle below the headline.
- The session-start notification gap can be configured via the Functions env var `SESSION_GAP_MS` (defaults to 30 minutes).

### Emulator troubleshooting

If the Functions emulator fails to start with missing modules or analysis errors:

```bash
cd functions
npm install
```

Then re-run:

```bash
firebase emulators:start --only functions
```

If you still see `Functions codebase could not be analyzed successfully`, open the Functions emulator logs for the full stack trace and check for:

- Missing dependencies in `functions/package.json`
- Syntax/runtime errors in `functions/index.js`
- Node version mismatch (Functions uses Node 22)

## Admin Scripts

One‑off admin scripts live in `admin/` and use `firebase-admin`. They require service account credentials provided via environment (for example, `GOOGLE_APPLICATION_CREDENTIALS`). Do not commit keys or backups to the repository. Run these scripts carefully against the correct project.

## Project Docs

These were created by and used mainly for use with AI tools.
- `overview.md`: Current architecture and feature overview
- `BATCH_STATS.md`: Batch stats computation details
- `PAUSE_FEATURE.md`, `vibration_tracking.md`, `waiting_karma.md`: Feature docs

## Golden-football betting

- Live match duration ends at the final goal. The clock stops when a team reaches five and resumes if that goal is removed. New matches retain their start time separately so delayed submission does not change the betting cutoff; older matches remain supported.
- **ALL IN** fills the stake with the selected bettor's available balance, including an unclaimed daily allowance, up to the existing 10,000-ball stake limit.
- With an empty wallet, **Borrow 10 · repay 13** advances ten balls. Thirteen are deducted from the next daily allowance earned by betting on a later day, leaving seven of the usual twenty. Only one loan may be outstanding, with at most one advance per UTC day. Loans cannot be undone; undoing a bet does not cancel its loan. Like existing stakes, affordability is checked by the shared-account client; rules enforce the fixed loan terms, immutable entries and daily duplicate protection.
- The normal board shows the two winner buttons and two Yes/No prop rows (four additional choices).
- **Advanced betting** is collapsed by default. **Combine two bets (AND)** joins two predictions on the current match. Both must win. Scoring combinations use the existing goal-sequence model, accounting for correlation. Combinations involving duration use the fitted duration probability and assume duration and scoring are independent conditional on the Elo gap. This is a pricing approximation; the normal house margin is applied once and the odds cap is retained. The selector excludes impossible and redundant combinations. The picker uses the winner selections and the props currently offered on the normal board; both Yes and No sides of duration bets can be combined too. Missing result data refunds the entire ticket. Betting closes at the first goal.

Deploy the updated `firestore.rules` together with the frontend for credit and combined bets. Existing published lineups gain AND offers when the next match is published.

For a local preview, use Node 22.12+ and Java 21+, then run:

```bash
npm ci
npx firebase-tools emulators:start --only firestore,auth --import=./firebase_emulator_cache
# In another terminal:
npm run dev
```

Development mode automatically connects to the local Firestore and Auth emulators. Tests create an emulator-only login with password `test-password-e2e` (`node -e "import('./e2e/helpers.js').then(m => m.ensureTestUser())"`). Run `npm test` for logic tests and `npm run test:e2e -- --workers=1` for browser/rules checks; one worker is required because they share emulator data.
