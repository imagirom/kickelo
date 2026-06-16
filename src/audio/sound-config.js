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
