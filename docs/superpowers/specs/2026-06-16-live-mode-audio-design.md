# Live-mode audio — design

**Date:** 2026-06-16
**Status:** Approved (pending spec review)

## Summary

Add audio to the kicker tracker's **live mode**. Two playback channels and an
extensible trigger registry, with exactly two triggers wired in this first cut:

- **(a)** distinct sound effects for **red-goal** vs **blue-goal**.
- **(b)** **Spotify** plays *Danger Zone* (Kenny Loggins) on the **4:2 → 4:3**
  transition — the trailing team scores their 3rd while the other team sits on
  match-point 4. The comfortable lead just got nervy.

The point of the first cut is the *plumbing*: two playback channels plus a
central registry so wiring a future event is a one-line change. We are **not**
building a catalog of events now.

## Context

- Live mode lives in `src/match-form-handler.js`. Goal events are the
  `btnRedScored` / `btnBlueScored` click handlers (lines ~739–751), which push
  `{ team, timestamp }` onto `goalLog`. Match win is determined at submit
  (line ~264).
- `MAX_GOALS = 5` (`src/constants.js`). Matches are first-to-exactly-5: one team
  must finish on 5, the other below.
- There is **no audio** anywhere in the app today — greenfield.
- The app already deals with device APIs and permission gates (`devicemotion`
  listener; browser notifications in `src/notification-service.js`).
- `public/` is served at the web root by Vite (so `public/sounds/x.mp3` →
  `/sounds/x.mp3`).
- `src/app.js` has an init function — the right place to hook OAuth redirect
  handling.

### Playback device

Sound plays on the **single phone currently used to track the score**. Because
the scorekeeper *taps* the "Red/Blue scored" buttons, every goal is a user
gesture — so audio plays even on mobile browsers (where autoplay is otherwise
blocked). The first gesture (Start live mode) unlocks the audio context.

### Why Spotify works here despite mobile limits

Spotify's Web Playback SDK does **not** support mobile browsers, and 30-second
preview URLs are mostly gone. The viable path is the **Spotify Connect Web
API**: `PUT /v1/me/player/play` tells the user's *active Connect device* to play
a track. The web app stays in the foreground and fires a plain HTTPS request;
Spotify plays the audio in the **background**. Constraints (all accepted):

- **Premium** required for playback control (free → `403`).
- **OAuth login** required (Authorization Code + PKCE, fully client-side).
- An **active device** must exist. A fully-closed Spotify app → `404 No active
  device`. The phone's own Spotify must be woken once (open it, hit play), after
  which it can be controlled in the background until the OS evicts it.

## Architecture

A small **sound dispatcher** with two **channel drivers**, fed by a **code
registry**.

```
match-form-handler.js
  └─ emit('goalRed' | 'goalBlue' | 'dangerZone', ctx) ─▶ sound-events.js (dispatcher)
                                                            │ looks up registry
                                 sound-config.js (registry) ┤
                                                            ▼
                                       ┌────────────────────┴────────────────────┐
                                  sfx-player.js                          spotify-client.js
                               (Web Audio, local files)              (Connect Web API, OAuth)
```

### New modules (under `src/audio/`)

| Module | Responsibility | Key interface |
|---|---|---|
| `sound-config.js` | The registry: event name → action | exported object `{ goalRed: {channel:'sfx', src}, goalBlue: {...}, dangerZone: {channel:'spotify', uri, positionMs} }` |
| `sound-events.js` | Dispatcher: route an emitted event to its channel; never throw | `emit(eventName, ctx)` |
| `sfx-player.js` | Web Audio engine: unlock, preload, play local clips | `unlock()`, `preload(srcs)`, `play(src)` |
| `spotify-client.js` | PKCE OAuth, token lifecycle, Connect playback, panel UI | `connect()`, `handleRedirect()`, `playTrack(uri, {positionMs})`, `getStatus()` |

**Wiring a future event = add one registry entry in `sound-config.js` + one
`emit()` call at the detection site.** This is the deliverable the user asked
for ("easy to wire individual ones later").

### Alternatives considered

- **(B) Direct calls** — each site calls `sfx.play()` / `spotify.playTrack()`
  directly. Fewer files, but config is scattered and the "easy to wire later"
  goal is weaker. Rejected.
- **(C) DOM `CustomEvent` bus** (like the existing `tournament-game-selected`)
  — more decoupled but harder to trace for a feature this small. Rejected.

## SFX channel

- **Assets:** `public/sounds/goals/`. Bundle **several** royalty-free candidate
  clips per colour (`red-1.mp3 … red-N.mp3`, `blue-1.mp3 … blue-N.mp3`) so the
  user can audition by editing one path in `sound-config.js`.
- **Engine:** Web Audio API (`AudioBufferSourceNode`) for low latency and
  overlap. The `AudioContext` is created and `resume()`d on the **Start live
  mode** tap (a user gesture); buffers are preloaded then. Subsequent goal taps
  play reliably on mobile.
- **Registry defaults:** `goalRed → red-1.mp3`, `goalBlue → blue-1.mp3`.
- **Failure:** a missing/undecodable file is caught and logged; never blocks the
  match.

## Spotify channel

- **Auth:** Authorization Code + **PKCE** (no backend, no client secret).
  Scopes: `user-modify-playback-state`, `user-read-playback-state`.
- **Tokens:** access + refresh tokens in `localStorage`; silent refresh on
  expiry via the token endpoint with the PKCE verifier.
- **Redirect:** on app init (`src/app.js`), detect `?code=` in the URL, exchange
  for tokens, then strip the query params from the URL.
- **Playback:** `PUT /v1/me/player/play` with `{ uris: ['spotify:track:<DangerZone>'] }`,
  optional `position_ms`. Web app stays foreground; Spotify plays in background.
- **Active-device handling:** `404 No active device` → toast *"Open Spotify and
  hit play once to enable music."* Status surfaced live in the panel.
- **UI:** a **"Connect Spotify"** control in the live-panel header
  (`index.html:306`), showing one of: *Not connected → Connect* / *Connected ✓*
  / *Premium required* / *No active device — tap to wake*.
- **Track:** `Danger Zone` URI stored as a config constant in `sound-config.js`;
  exact URI resolved during implementation.

## Trigger detection (in `src/match-form-handler.js`)

- **Goal sounds:** in the existing `btnRedScored` / `btnBlueScored` handlers,
  after `goalLog.push(...)`, call `emit('goalRed')` / `emit('goalBlue')`.
- **Danger Zone — precise rule:** evaluate the score *after* the goal. Fire
  **only** when *the scoring team's new count is 3 and the opponent is on 4*.
  This uniquely identifies the 4:2 → 4:3 transition (trailing team scoring their
  3rd). It does **not** fire on 3:3 → 4:3 (leader scoring). Symmetric for
  red/blue. On match → `emit('dangerZone')`.

Truth table (scorer's new count, opponent count) → danger zone?

| Before | Goal by | After | Danger? |
|---|---|---|---|
| 4:2 | trailing (2→3) | 4:3 | ✅ |
| 2:4 | trailing (2→3) | 3:4 | ✅ |
| 3:3 | either (3→4) | 4:3 | ❌ (leader) |
| 4:3 | trailing (3→4) | 4:4 | ❌ |
| 3:2 | leading (3→4) | 4:2 | ❌ |

The detector is a **pure function** `isDangerZone(redBefore, blueBefore, scorer)
→ boolean` so it can be unit-tested in isolation.

## Prerequisites (one-time, user)

- Register a **Spotify Developer app** → obtain a **Client ID**; add redirect
  URIs for production (`https://kickelo.web.app/`) and the dev origin. Exact
  values provided during implementation.
- **Spotify Premium** on the test account.
- Client ID lives in a config constant (public by design for PKCE; not secret).

## Error handling

All audio is best-effort and isolated: any SFX or Spotify failure (missing file,
denied autoplay, expired token, no active device, `403`/`404`) is caught and
logged, and never blocks goal logging or match submission.

## Testing

- **Unit:** `isDangerZone(...)` across the truth table above, in the existing
  `test/*.test.js` node-test style (add a `test:audio` script).
- **Manual:** SFX and Spotify drivers are thin I/O wrappers — verified via the
  running app and Playwright (goal taps produce sound; 4:2→4:3 triggers the
  Spotify call; connect/active-device states render correctly).

## Out of scope (deliberately)

- A catalog of additional events (match start, hat trick, comeback, shutout,
  upset, etc.) — the registry makes these one-liners to add later.
- An in-app settings UI for configuring sounds at runtime (code-level registry
  only).
- Deep-linking / foreground Spotify launches.
- Music on each player's personal phone (single scorekeeping device only).
