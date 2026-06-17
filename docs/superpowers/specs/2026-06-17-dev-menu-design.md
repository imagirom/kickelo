# Hidden dev menu + Spotify allowlist info — design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)
**Builds on:** [2026-06-16-live-mode-audio-design.md](2026-06-16-live-mode-audio-design.md)

## Summary

Hide the Spotify integration behind a secret gesture, and surface the Spotify
"development mode" allowlist limitation to users.

- A full-width, visually unobtrusive **secret tap strip** at the bottom of the
  page. **Three taps within 1.5s** reveal a **dev menu** below it.
- The **Connect Spotify** button moves from the live-mode panel into that dev
  menu. The menu is a generic container ready for future developer options.
- The reveal does **not** persist — on reload the menu is hidden again.
- The dev menu carries a standing **allowlist note**, and `handleRedirect()`
  shows a **toast** when Spotify redirects back with an `?error=`.

## Context

- The Connect Spotify button currently lives in the live-panel header
  (`index.html:309`); `initSpotifyUI()` (in `src/audio/spotify-client.js`) wires
  it by the id `#spotifyConnectBtn`. Moving the DOM node to the dev menu needs
  **no JS change** to the button wiring — it still finds the same id.
- `handleRedirect()` already detects `?error=` in the OAuth redirect but only
  `console.warn`s. Today is 2026-06-17; the Spotify app is in Development Mode.
- The app has an existing collapse idiom (`#leaderboardOptions` + `.collapsed`,
  toggled in `src/app.js`) — the dev menu styling can follow the same look.
- Main content ends after the Tournaments section; modal/overlay divs
  (`#playerStatsBackdrop`, `#pauseOverlay`, `#passwordGate`) follow before
  `</body>`. The strip + menu go at the end of the main content, before those
  overlays.

### Spotify development-mode reality

When a non-allowlisted Spotify account tries to authorize an app in Development
Mode, Spotify usually shows **its own error page** ("not configured to allow
your account") and **often does not redirect back** to our app — so we
frequently never regain control to show a message. Therefore:

- A **standing note** in the dev menu is the reliable channel (always visible).
- A **toast** on `?error=` covers only the cases where Spotify does redirect
  back with an error (e.g. user-denied consent, some allowlist denials).

We cannot perfectly distinguish "not allowlisted" from "user denied"; the
messaging covers both.

## Components

### 1. Secret tap strip (`#devUnlockStrip`)
A full-width element (~28px tall, transparent, no label) appended at the end of
the main content. Unobtrusive but tappable. Its only job is to receive taps.

### 2. Triple-tap reveal — `src/dev-menu.js`
Exports `initDevMenu()`, wired from `src/app.js` on load.

- **Pure core (unit-tested):** `registerTap(timestamps, now, windowMs = 1500, needed = 3)`
  → `{ timestamps, reveal }`. It appends `now`, drops timestamps older than
  `windowMs`, and returns `reveal: true` when `needed` taps fall within the
  window. On reveal it returns an empty `timestamps` (counter resets).
- **DOM shell:** keeps a `let taps = []` array, calls `registerTap` on each
  `click`, reveals the menu when `reveal` is true. No timers needed beyond the
  window arithmetic, but a trailing `setTimeout` may prune stale taps for tidiness.
- **No persistence:** module state is in-memory; a reload re-hides the menu.

### 3. Dev menu (`#devMenu`)
Hidden by default (`display: none`). On reveal, shown **expanded** below the
strip. Contents:
- Heading "Developer options"
- The moved **Connect Spotify** button (`#spotifyConnectBtn`) + status label
- Standing **allowlist note** (see message below)
- Generic container — future dev options append here.

### 4. Allowlist messaging
- **Standing note** (in `#devMenu`): "Spotify linking only works for accounts
  added to the app in the Spotify dashboard. If linking fails, ask Roman to add
  your Spotify email."
- **Toast** in `handleRedirect()` on `?error=`: "Spotify couldn't authorize this
  account — you may not be on the app's allowlist. Ask the owner to add your
  Spotify email." (`showToast(..., 'error')`), in addition to the existing
  `console.warn`.

## Files touched

| File | Change |
|---|---|
| `index.html` | Add `#devUnlockStrip` + `#devMenu` (with moved Spotify button + note) at end of main content; remove the Spotify button from the live-panel header |
| `src/styles.css` | Styles for `#devUnlockStrip` (unobtrusive, full-width) and `#devMenu` (hidden/visible) |
| `src/dev-menu.js` (new) | `registerTap` pure helper + `initDevMenu()` DOM wiring |
| `src/app.js` | Call `initDevMenu()` on load (alongside `initSpotifyUI()`) |
| `src/audio/spotify-client.js` | Add the `?error=` toast in `handleRedirect()` |
| `test/dev-menu.test.js` (new) | Unit-test `registerTap`; add `test:devmenu` npm script |

## Testing

- **Unit:** `registerTap` across cases: <3 taps → no reveal; 3 taps within window
  → reveal + reset; 3 taps spanning > windowMs → no reveal; taps resume cleanly
  after a reveal. Node-script style matching the existing `test/*.test.js`.
- **Manual:** triple-tap the strip → menu appears with Connect Spotify + note;
  reload → hidden again; Connect still drives Danger Zone in live mode; a denied
  / non-allowlisted login that redirects back shows the error toast.

## Out of scope

- Persisting the unlocked state across reloads.
- Any actual "further development options" beyond the Spotify button (the
  container is only made ready for them).
- Changes to the Spotify auth/playback logic itself (only the `?error=` toast).
