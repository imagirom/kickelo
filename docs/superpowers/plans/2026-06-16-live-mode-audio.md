# Live-mode Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audio to live mode — distinct SFX for red/blue goals, and Spotify "Danger Zone" on the 4:2→4:3 transition — built on an extensible trigger registry so future events are one-line wirings.

**Architecture:** A central code registry (`sound-config.js`) maps logical event names to actions. A dispatcher (`sound-events.js`) routes each emitted event to one of two channel drivers: a Web Audio SFX player (`sfx-player.js`) for bundled local clips, and a Spotify Connect client (`spotify-client.js`) using PKCE OAuth + the Web API. Trigger sites in `match-form-handler.js` call `emit(eventName)`.

**Tech Stack:** Vanilla ES modules, Vite, Web Audio API, Spotify Web API (Authorization Code + PKCE), existing node-script test harness (`node test/*.test.js`).

---

## Spec reference

`docs/superpowers/specs/2026-06-16-live-mode-audio-design.md`

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/audio/danger-zone.js` | Pure trigger detector(s) | Create |
| `src/audio/sound-config.js` | Registry + Spotify constants | Create |
| `src/audio/sfx-player.js` | Web Audio SFX engine | Create |
| `src/audio/spotify-client.js` | PKCE OAuth + Connect playback + panel UI | Create |
| `src/audio/sound-events.js` | Dispatcher: event → channel | Create |
| `public/sounds/goals/` | Bundled candidate goal clips | Create |
| `test/audio.test.js` | Unit tests (detector + auth URL) | Create |
| `src/match-form-handler.js` | Emit goal/danger events; unlock+preload on live start | Modify |
| `src/app.js` | Handle Spotify OAuth redirect; init Spotify UI | Modify |
| `index.html` | "Connect Spotify" button in live-panel header | Modify |
| `package.json` | `test:audio` script | Modify |

---

## Task 1: Pure danger-zone detector (TDD)

**Files:**
- Create: `src/audio/danger-zone.js`
- Test: `test/audio.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `test/audio.test.js`:

```js
// Live-mode audio: pure logic tests (no browser, no network).
import { isDangerZone } from '../src/audio/danger-zone.js';

let passed = 0;
let failed = 0;

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    console.error(`  ✗ ${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  } else {
    console.log(`  ✓ ${message}`);
  }
}

console.log('\n=== isDangerZone (4:2 -> 4:3 transition) ===');
// Fires only when the trailing team scores their 3rd while opponent is on 4.
assertEq(isDangerZone(4, 2, 'blue'), true,  '4:2, blue scores -> 4:3');
assertEq(isDangerZone(2, 4, 'red'),  true,  '2:4, red scores  -> 3:4');
assertEq(isDangerZone(3, 3, 'red'),  false, '3:3, red scores  -> 4:3 (leader, not danger)');
assertEq(isDangerZone(3, 3, 'blue'), false, '3:3, blue scores -> 3:4 (leader, not danger)');
assertEq(isDangerZone(4, 3, 'blue'), false, '4:3, blue scores -> 4:4 (deuce, not danger)');
assertEq(isDangerZone(3, 4, 'red'),  false, '3:4, red scores  -> 4:4 (deuce, not danger)');
assertEq(isDangerZone(3, 2, 'red'),  false, '3:2, red scores  -> 4:2 (no, opponent on 2)');
assertEq(isDangerZone(4, 1, 'blue'), false, '4:1, blue scores -> 4:2 (no, scorer reaches 2)');
assertEq(isDangerZone(0, 0, 'red'),  false, '0:0, red scores  -> 1:0 (no)');

console.log(`\n${'='.repeat(60)}`);
console.log(`Audio Tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/audio.test.js`
Expected: FAIL — `Cannot find module '.../src/audio/danger-zone.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/audio/danger-zone.js`:

```js
// Pure trigger detectors for live-mode audio events.
// Matches are first-to-MAX_GOALS (5). "Danger zone" is the 4:2 -> 4:3
// transition: the TRAILING team scores their 3rd while the opponent sits on
// match-point 4. The comfortable lead just got nervy.

/**
 * @param {number} redBefore   red score before this goal
 * @param {number} blueBefore  blue score before this goal
 * @param {'red'|'blue'} scorer team that just scored
 * @returns {boolean} true only for the 4:2 -> 4:3 transition (either colour leading)
 */
export function isDangerZone(redBefore, blueBefore, scorer) {
  const scorerBefore = scorer === 'red' ? redBefore : blueBefore;
  const opponentScore = scorer === 'red' ? blueBefore : redBefore;
  const scorerAfter = scorerBefore + 1;
  return scorerAfter === 3 && opponentScore === 4;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/audio.test.js`
Expected: PASS — `Audio Tests: 9 passed, 0 failed`

- [ ] **Step 5: Add the test script**

In `package.json` `scripts`, add `"test:audio": "node test/audio.test.js"` and append `&& npm run test:audio` to the `"test"` script. The `"test"` line becomes:

```json
"test": "npm run test:stats && npm run test:cache && npm run test:edit && npm run test:tournament && npm run test:audio",
"test:audio": "node test/audio.test.js",
```

- [ ] **Step 6: Commit**

```bash
git add src/audio/danger-zone.js test/audio.test.js package.json
git commit -m "feat(audio): pure danger-zone (4:2->4:3) detector + tests"
```

---

## Task 2: Sound registry config

**Files:**
- Create: `src/audio/sound-config.js`

- [ ] **Step 1: Create the registry**

Create `src/audio/sound-config.js`:

```js
// Central registry: logical event name -> audio action.
// Wiring a NEW event later = add one entry here + one emit() at the trigger site.
//
// Action shapes:
//   { channel: 'sfx',     src }                 -> local file under public/sounds/
//   { channel: 'spotify', uri, positionMs }     -> Spotify track URI

// --- Spotify app credentials ---
// Public by design for the PKCE flow (NOT a secret). Register an app at
// https://developer.spotify.com/dashboard, add redirect URIs for prod
// (https://kickelo.web.app/) and dev (your http://localhost:5173 origin),
// then paste the Client ID here.
export const SPOTIFY_CLIENT_ID = 'REPLACE_WITH_YOUR_SPOTIFY_CLIENT_ID';
export const SPOTIFY_SCOPES = 'user-modify-playback-state user-read-playback-state';

// "Danger Zone" — Kenny Loggins. Resolve the real track URI during
// implementation (Spotify desktop: right-click track -> Share -> Copy Spotify URI).
export const DANGER_ZONE_URI = 'spotify:track:REPLACE_WITH_DANGER_ZONE_TRACK_ID';

// --- Event registry ---
// To audition a different SFX clip, just change the `src` path to another file
// in public/sounds/goals/.
export const soundRegistry = {
  goalRed:    { channel: 'sfx', src: '/sounds/goals/red-1.mp3' },
  goalBlue:   { channel: 'sfx', src: '/sounds/goals/blue-1.mp3' },
  dangerZone: { channel: 'spotify', uri: DANGER_ZONE_URI, positionMs: 0 },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/audio/sound-config.js
git commit -m "feat(audio): sound registry + Spotify config constants"
```

---

## Task 3: SFX assets + Web Audio player

**Files:**
- Create: `public/sounds/goals/*.mp3`
- Create: `src/audio/sfx-player.js`

- [ ] **Step 1: Create the assets directory**

```bash
mkdir -p public/sounds/goals
```

- [ ] **Step 2: Generate guaranteed placeholder tones (so the pipeline works end-to-end)**

Requires `ffmpeg` (preinstalled on the dev machine; `pacman -S ffmpeg` if missing). Generates two distinct short blips:

```bash
ffmpeg -y -f lavfi -i "sine=frequency=660:duration=0.16" -af "afade=t=out:st=0.10:d=0.06,volume=0.6" public/sounds/goals/red-1.mp3
ffmpeg -y -f lavfi -i "sine=frequency=392:duration=0.16" -af "afade=t=out:st=0.10:d=0.06,volume=0.6" public/sounds/goals/blue-1.mp3
```

Expected: two files exist. Verify: `ls -la public/sounds/goals/` shows `red-1.mp3`, `blue-1.mp3` (>0 bytes).

- [ ] **Step 3: Fetch several royalty-free candidates to audition (Mixkit — free, no attribution)**

Download a handful of distinct candidates so the user can swap them in via `sound-config.js`. URLs may change; verify each returns HTTP 200 and a non-trivial size, skip any that 404. Example set:

```bash
cd public/sounds/goals
for url in \
  "https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3:red-2.mp3" \
  "https://assets.mixkit.co/active_storage/sfx/2570/2570-preview.mp3:red-3.mp3" \
  "https://assets.mixkit.co/active_storage/sfx/270/270-preview.mp3:blue-2.mp3" \
  "https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3:blue-3.mp3" ; do
    u="${url%%:*}"; f="${url##*:}";
    code=$(curl -s -L -o "$f" -w "%{http_code}" "$u");
    if [ "$code" != "200" ] || [ ! -s "$f" ]; then echo "SKIP $f ($code)"; rm -f "$f"; else echo "OK $f"; fi
done
cd -
```

Expected: some `red-2/3.mp3`, `blue-2/3.mp3` present (any that 404 are skipped — placeholder tones from Step 2 remain the registry default, so the pipeline still works regardless).

- [ ] **Step 4: Create the SFX player**

Create `src/audio/sfx-player.js`:

```js
// Low-latency local sound-effect playback via the Web Audio API.
// Mobile browsers block audio until a user gesture, so unlock() MUST be called
// from within a gesture handler (the "Start live mode" tap) before playback.

let ctx = null;
const buffers = new Map(); // src -> AudioBuffer

/** Create/resume the AudioContext from within a user gesture. Idempotent. */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

async function load(src) {
  if (buffers.has(src)) return buffers.get(src);
  const res = await fetch(src);
  const arr = await res.arrayBuffer();
  const buf = await ctx.decodeAudioData(arr);
  buffers.set(src, buf);
  return buf;
}

/** Preload sources so first playback has no fetch/decode latency. Best-effort. */
export async function preload(srcs) {
  if (!ctx) return;
  await Promise.all(srcs.map(s => load(s).catch(err => console.warn('[sfx] preload failed', s, err))));
}

/** Play a local sound file. Best-effort; never throws. */
export async function play(src) {
  try {
    if (!ctx) return;            // not unlocked yet -> silently no-op
    if (ctx.state === 'suspended') await ctx.resume();
    const buf = await load(src);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    node.start(0);
  } catch (err) {
    console.warn('[sfx] play failed', src, err);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add public/sounds/goals src/audio/sfx-player.js
git commit -m "feat(audio): Web Audio SFX player + candidate goal clips"
```

---

## Task 4: Spotify Connect client (PKCE OAuth + playback)

**Files:**
- Create: `src/audio/spotify-client.js`
- Modify: `test/audio.test.js` (add buildAuthUrl test)

- [ ] **Step 1: Write the failing test for the pure auth-URL builder**

Append to `test/audio.test.js` BEFORE the summary block:

```js
import { buildAuthUrl } from '../src/audio/spotify-client.js';

console.log('\n=== buildAuthUrl ===');
{
  const url = new URL(buildAuthUrl('CHALLENGE123', 'https://example.test/'));
  assertEq(url.origin + url.pathname, 'https://accounts.spotify.com/authorize', 'auth endpoint');
  assertEq(url.searchParams.get('response_type'), 'code', 'response_type=code');
  assertEq(url.searchParams.get('code_challenge_method'), 'S256', 'S256 method');
  assertEq(url.searchParams.get('code_challenge'), 'CHALLENGE123', 'challenge passed through');
  assertEq(url.searchParams.get('redirect_uri'), 'https://example.test/', 'redirect_uri passed through');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/audio.test.js`
Expected: FAIL — `Cannot find module '.../src/audio/spotify-client.js'`

- [ ] **Step 3: Create the Spotify client**

Create `src/audio/spotify-client.js`:

```js
// Spotify Connect client: PKCE OAuth (no backend secret) + Web API playback.
// Tells the user's active Spotify device to play a track via
// PUT /v1/me/player/play while this web app stays in the foreground.
// Requires Spotify Premium and an ACTIVE device (open Spotify + hit play once).

import { SPOTIFY_CLIENT_ID, SPOTIFY_SCOPES } from './sound-config.js';
import { showToast } from '../toast.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const PLAY_URL = 'https://api.spotify.com/v1/me/player/play';

const LS = {
  access: 'spotify_access_token',
  refresh: 'spotify_refresh_token',
  expires: 'spotify_expires_at',
  verifier: 'spotify_pkce_verifier',
};

function redirectUri() {
  return window.location.origin + '/';
}

// --- PKCE helpers ---
function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFromVerifier(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

/** Pure: assemble the Spotify authorize URL. */
export function buildAuthUrl(challenge, redirect) {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirect,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// --- auth flow ---
/** Start login: store verifier, redirect to Spotify. */
export async function connect() {
  const verifier = randomString(64);
  localStorage.setItem(LS.verifier, verifier);
  const challenge = await challengeFromVerifier(verifier);
  window.location.href = buildAuthUrl(challenge, redirectUri());
}

function storeTokens(data) {
  localStorage.setItem(LS.access, data.access_token);
  if (data.refresh_token) localStorage.setItem(LS.refresh, data.refresh_token);
  localStorage.setItem(LS.expires, String(Date.now() + (data.expires_in - 60) * 1000));
}

/** Handle the ?code= redirect on page load. Returns true if a code was processed. */
export async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return false;
  const verifier = localStorage.getItem(LS.verifier);
  try {
    if (verifier) {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: SPOTIFY_CLIENT_ID,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri(),
          code_verifier: verifier,
        }),
      });
      const data = await res.json();
      if (data.access_token) storeTokens(data);
    }
  } catch (err) {
    console.warn('[spotify] token exchange failed', err);
  } finally {
    localStorage.removeItem(LS.verifier);
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, document.title, url.toString());
  }
  return true;
}

async function refresh() {
  const refreshToken = localStorage.getItem(LS.refresh);
  if (!refreshToken) return null;
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    const data = await res.json();
    if (data.access_token) { storeTokens(data); return data.access_token; }
  } catch (err) {
    console.warn('[spotify] refresh failed', err);
  }
  return null;
}

export function isConnected() {
  return !!localStorage.getItem(LS.access);
}

async function getAccessToken() {
  const token = localStorage.getItem(LS.access);
  const expires = Number(localStorage.getItem(LS.expires) || 0);
  if (token && Date.now() < expires) return token;
  return refresh();
}

/** Play a track on the active device. Best-effort; never throws. */
export async function playTrack(uri, { positionMs = 0 } = {}) {
  try {
    const token = await getAccessToken();
    if (!token) { showToast('Connect Spotify to enable music.', 'info'); return; }
    const res = await fetch(PLAY_URL, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
    });
    if (res.status === 404) showToast('Open Spotify and hit play once to enable music.', 'warning');
    else if (res.status === 403) showToast('Spotify Premium required for playback.', 'error');
    else if (res.status === 401) showToast('Spotify session expired — reconnect.', 'error');
  } catch (err) {
    console.warn('[spotify] playTrack failed', err);
  }
}

/** Wire the live-panel "Connect Spotify" button + status label. */
export function initSpotifyUI() {
  const btn = document.getElementById('spotifyConnectBtn');
  if (!btn) return;
  const render = () => { btn.textContent = isConnected() ? 'Spotify ✓' : 'Connect Spotify'; };
  btn.addEventListener('click', () => { if (!isConnected()) connect(); });
  render();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/audio.test.js`
Expected: PASS — buildAuthUrl assertions pass (total now 14 passed).

Note: `toast.js` imports nothing browser-only at module top? If importing `spotify-client.js` in node fails due to a transitive DOM dependency in `toast.js`, move the `buildAuthUrl` + constants into the test via a direct import path is not an option — instead verify `toast.js` has no top-level DOM access. If it does, the test still only needs `buildAuthUrl`; keep `showToast` imported lazily by leaving it as-is (it is only *called* inside functions, and ES module import of `toast.js` runs its top-level code). If node errors, change the `showToast` import to a dynamic `import()` inside the catch/branches. (Check `src/toast.js` top level first; it defines functions only, so static import is expected to work.)

- [ ] **Step 5: Commit**

```bash
git add src/audio/spotify-client.js test/audio.test.js
git commit -m "feat(audio): Spotify Connect client (PKCE OAuth + playback) + tests"
```

---

## Task 5: Sound events dispatcher

**Files:**
- Create: `src/audio/sound-events.js`

- [ ] **Step 1: Create the dispatcher**

Create `src/audio/sound-events.js`:

```js
// Dispatcher: route a logical event name to its configured channel.
// Best-effort — audio must never break the match flow.

import { soundRegistry } from './sound-config.js';
import * as sfx from './sfx-player.js';
import { playTrack } from './spotify-client.js';

/** Fire the audio configured for `eventName` in sound-config.js. */
export function emit(eventName) {
  const entry = soundRegistry[eventName];
  if (!entry) return;
  try {
    if (entry.channel === 'sfx') {
      sfx.play(entry.src);
    } else if (entry.channel === 'spotify') {
      playTrack(entry.uri, { positionMs: entry.positionMs || 0 });
    }
  } catch (err) {
    console.warn('[sound] emit failed', eventName, err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/audio/sound-events.js
git commit -m "feat(audio): event dispatcher routing to SFX/Spotify channels"
```

---

## Task 6: Wire triggers into the match form

**Files:**
- Modify: `src/match-form-handler.js`

- [ ] **Step 1: Add imports**

At the top of `src/match-form-handler.js`, after the existing `import { MAX_GOALS, STARTING_ELO } from './constants.js';` (line ~17), add:

```js
import { emit } from './audio/sound-events.js';
import { unlock, preload } from './audio/sfx-player.js';
import { soundRegistry } from './audio/sound-config.js';
import { isDangerZone } from './audio/danger-zone.js';
```

- [ ] **Step 2: Unlock + preload SFX when live mode starts**

In `setLiveMode`, inside the `if (enabled) {` branch, immediately after `matchStartTime = Date.now();` add:

```js
        unlock(); // resume AudioContext from this user gesture (mobile autoplay)
        preload([soundRegistry.goalRed.src, soundRegistry.goalBlue.src]);
```

- [ ] **Step 3: Emit goal SFX + danger-zone from the score handlers**

Replace the existing `btnRedScored` / `btnBlueScored` click handlers (lines ~739–752) with:

```js
btnRedScored.addEventListener('click', () => {
    if (!liveMode) return;
    const redGoals = goalLog.filter(g => g.team === 'red').length;
    const blueGoals = goalLog.filter(g => g.team === 'blue').length;
    if (redGoals >= MAX_GOALS) return;
    const danger = isDangerZone(redGoals, blueGoals, 'red');
    goalLog.push({ team: 'red', timestamp: Date.now() - matchStartTime });
    renderGoalTimeline();
    syncScoreSelectors(); // Ensure score display updates
    emit('goalRed');
    if (danger) emit('dangerZone');
});
btnBlueScored.addEventListener('click', () => {
    if (!liveMode) return;
    const redGoals = goalLog.filter(g => g.team === 'red').length;
    const blueGoals = goalLog.filter(g => g.team === 'blue').length;
    if (blueGoals >= MAX_GOALS) return;
    const danger = isDangerZone(redGoals, blueGoals, 'blue');
    goalLog.push({ team: 'blue', timestamp: Date.now() - matchStartTime });
    renderGoalTimeline();
    syncScoreSelectors(); // Ensure score display updates
    emit('goalBlue');
    if (danger) emit('dangerZone');
});
```

- [ ] **Step 4: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds (no import/resolution errors).

- [ ] **Step 5: Run the unit tests**

Run: `npm run test:audio`
Expected: PASS — all assertions green.

- [ ] **Step 6: Commit**

```bash
git add src/match-form-handler.js
git commit -m "feat(audio): emit goal SFX + Danger Zone on live-mode scoring"
```

---

## Task 7: Spotify redirect handling + Connect button

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`

- [ ] **Step 1: Add the Connect Spotify button to the live-panel header**

In `index.html`, in the live-panel header (lines ~306–309), add the button after the `cancelLiveMode` button so the header becomes:

```html
      <div class="live-panel-header">
        <span id="liveMatchTimer" class="live-timer" style="display: none;">00:00</span>
        <button id="cancelLiveMode" type="button" class="live-cancel-btn" style="display: none;">Cancel</button>
        <button id="spotifyConnectBtn" type="button" class="spotify-connect-btn">Connect Spotify</button>
      </div>
```

- [ ] **Step 2: Add imports to app.js**

In `src/app.js`, after the tournament UI import (line ~16), add:

```js
import { handleRedirect, initSpotifyUI } from './audio/spotify-client.js';
```

- [ ] **Step 3: Process the OAuth redirect early on load**

In `src/app.js`, in the `else` branch right after `hidePauseScreen();` (line ~153), add:

```js
    handleRedirect(); // exchange ?code= for Spotify tokens, then clean the URL
```

- [ ] **Step 4: Initialize the Spotify UI control**

In `src/app.js`, immediately after `setupMatchForm();` (line ~223), add:

```js
    initSpotifyUI();
```

- [ ] **Step 5: Build to verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add index.html src/app.js
git commit -m "feat(audio): Spotify OAuth redirect handling + Connect button"
```

---

## Task 8: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Prerequisites**

- Register a Spotify app, set `SPOTIFY_CLIENT_ID` in `sound-config.js`, add redirect URIs `http://localhost:5173/` (Spotify accepts loopback for dev) and `https://kickelo.web.app/`.
- Set `DANGER_ZONE_URI` to the real Kenny Loggins "Danger Zone" track URI.
- Have Spotify Premium + the Spotify app open and playing once (active device).

- [ ] **Step 2: SFX path (works without Spotify)**

Run `npm run dev`, open the app, unlock the board, click **Start live mode**, then **Red scored** / **Blue scored**. Expected: distinct sounds per colour. Verify via Playwright that the buttons fire without console errors.

- [ ] **Step 3: Danger-zone path**

In live mode, drive the score to **4:2** (e.g. red to 4, blue to 2), then click the trailing team's **scored** button to reach **4:3**. Expected: Spotify starts "Danger Zone" on the active device. Driving 3:3→4:3 instead must NOT trigger it.

- [ ] **Step 4: Active-device + auth edge cases**

With Spotify closed, trigger danger zone → expect the "Open Spotify and hit play once" toast, no crash. Disconnected → "Connect Spotify to enable music." toast. The Connect button reflects connected state.

- [ ] **Step 5: Full test suite**

Run: `npm test`
Expected: all suites pass including `test:audio`.

---

## Self-review notes

- **Spec coverage:** two-channel architecture (Tasks 2–5) ✓; goal SFX red/blue (Tasks 3,6) ✓; Danger Zone on 4:2→4:3 (Tasks 1,6) ✓; code registry / easy future wiring (Task 2) ✓; PKCE OAuth + Connect + active-device handling (Task 4) ✓; Connect button in live panel (Task 7) ✓; redirect handling in app.js (Task 7) ✓; pure-function unit tests (Tasks 1,4) ✓; best-effort isolation (every driver try/catches) ✓; prerequisites (Task 8) ✓.
- **Type consistency:** `emit(eventName)`, `isDangerZone(redBefore, blueBefore, scorer)`, `buildAuthUrl(challenge, redirect)`, `playTrack(uri, {positionMs})`, registry keys `goalRed/goalBlue/dangerZone`, element id `spotifyConnectBtn` — all consistent across tasks.
- **Open setup items (not placeholders — require external accounts):** `SPOTIFY_CLIENT_ID`, `DANGER_ZONE_URI`, Spotify redirect URIs. Filled in Task 8 Step 1.
