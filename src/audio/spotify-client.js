// Spotify Connect client: PKCE OAuth (no backend secret) + Web API playback.
// Tells the user's active Spotify device to play a track via
// PUT /v1/me/player/play while this web app stays in the foreground.
// Requires Spotify Premium and an ACTIVE device (open Spotify + hit play once).

import { SPOTIFY_CLIENT_ID, SPOTIFY_SCOPES } from './sound-config.js';
import { showToast } from '../toast.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const PLAY_URL = 'https://api.spotify.com/v1/me/player/play';
const DEVICES_URL = 'https://api.spotify.com/v1/me/player/devices';
const TRANSFER_URL = 'https://api.spotify.com/v1/me/player';

const LS = {
  access: 'spotify_access_token',
  refresh: 'spotify_refresh_token',
  expires: 'spotify_expires_at',
  verifier: 'spotify_pkce_verifier',
  state: 'spotify_oauth_state',
  device: 'spotify_device_id',
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

/** Pure: assemble the Spotify authorize URL. Includes `state` when provided. */
export function buildAuthUrl(challenge, redirect, state) {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirect,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES,
  });
  if (state) params.set('state', state);
  return `${AUTH_URL}?${params.toString()}`;
}

// --- auth flow ---
/** Start login: store verifier + state, redirect to Spotify. */
export async function connect() {
  const verifier = randomString(64);
  const state = randomString(16);
  localStorage.setItem(LS.verifier, verifier);
  localStorage.setItem(LS.state, state);
  const challenge = await challengeFromVerifier(verifier);
  window.location.href = buildAuthUrl(challenge, redirectUri(), state);
}

function storeTokens(data) {
  localStorage.setItem(LS.access, data.access_token);
  if (data.refresh_token) localStorage.setItem(LS.refresh, data.refresh_token);
  localStorage.setItem(LS.expires, String(Date.now() + (data.expires_in - 60) * 1000));
}

function clearAuthUrl() {
  const url = new URL(window.location.href);
  url.search = '';
  window.history.replaceState({}, document.title, url.toString());
}

/**
 * Handle the ?code= / ?error= redirect on page load.
 * Returns true ONLY when tokens were successfully obtained.
 */
export async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  const code = params.get('code');
  if (!error && !code) return false; // nothing to process; leave URL untouched

  const returnedState = params.get('state');
  const expectedState = localStorage.getItem(LS.state);
  const verifier = localStorage.getItem(LS.verifier);
  let success = false;
  try {
    if (error) {
      console.warn('[spotify] auth error', error);
      showToast("Spotify couldn't authorize this account — you may not be on the app's allowlist. Ask the owner to add your Spotify email.", 'error');
    } else if (!verifier || !returnedState || returnedState !== expectedState) {
      console.warn('[spotify] auth state mismatch or missing verifier');
    } else {
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
      if (data.access_token) { storeTokens(data); success = true; }
    }
  } catch (err) {
    console.warn('[spotify] token exchange failed', err);
  } finally {
    localStorage.removeItem(LS.verifier);
    localStorage.removeItem(LS.state);
    clearAuthUrl();
  }
  return success;
}

// Single-flight refresh: concurrent callers share one in-flight refresh so the
// rotating refresh token is only spent once.
let refreshPromise = null;
function refresh() {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function doRefresh() {
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

/** Pure: the play endpoint, targeting a specific device when one is known. */
export function playUrl(deviceId) {
  return deviceId
    ? `${PLAY_URL}?device_id=${encodeURIComponent(deviceId)}`
    : PLAY_URL;
}

/** Pure: spotify:track:ID -> https://open.spotify.com/track/ID (opens the app on mobile). */
export function openUrl(uri) {
  const [, type, id] = uri.split(':');
  return `https://open.spotify.com/${type}/${id}`;
}

/** Pure: choose the best device from a Spotify devices list (active first, else first). */
export function pickDeviceId(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return null;
  const active = devices.find((d) => d && d.is_active);
  return (active || devices[0]).id || null;
}

async function fetchDevices(token) {
  try {
    const res = await fetch(DEVICES_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.devices) ? data.devices : [];
  } catch (err) {
    console.warn('[spotify] fetchDevices failed', err);
    return [];
  }
}

/** Refresh the stored device id from the API (pre-arm). Best-effort, quiet, never throws. */
export async function armDevice() {
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const id = pickDeviceId(await fetchDevices(token));
    if (id) localStorage.setItem(LS.device, id);
    return id;
  } catch (err) {
    console.warn('[spotify] armDevice failed', err);
    return null;
  }
}

async function transferTo(token, deviceId) {
  try {
    await fetch(TRANSFER_URL, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_ids: [deviceId], play: false }),
    });
  } catch (err) {
    console.warn('[spotify] transfer failed', err);
  }
}

async function sendPlay(token, uri, positionMs, deviceId) {
  return fetch(playUrl(deviceId), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
  });
}

/** Play a track on the user's device. Targets the stored device id, and on a
 *  404 (device gone idle) re-arms + transfers + retries once. Never throws. */
export async function playTrack(uri, { positionMs = 0 } = {}) {
  try {
    const token = await getAccessToken();
    if (!token) {
      // Not connected: offer the track itself. window.open runs inside the click, so no popup blocker.
      showToast('🎵 Spotify not connected — tap to open the song.', 'info', 8000,
        () => window.open(openUrl(uri), '_blank', 'noopener'));
      return;
    }

    let deviceId = localStorage.getItem(LS.device) || null;
    let res = await sendPlay(token, uri, positionMs, deviceId);

    // 404 = no active/targeted device. Re-arm from the devices list, wake it, retry once.
    if (res.status === 404) {
      const recovered = pickDeviceId(await fetchDevices(token));
      if (recovered) {
        localStorage.setItem(LS.device, recovered);
        await transferTo(token, recovered);
        res = await sendPlay(token, uri, positionMs, recovered);
      }
    }

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
  if (isConnected()) armDevice(); // refresh the stored device id on load
}
