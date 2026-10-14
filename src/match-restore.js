// src/match-restore.js
// Keeps the lineup and a running live match across page reloads: mobile browsers often drop a
// background tab (e.g. while a Spotify link is open), which used to lose the live match.
// Saved per local day; a new day starts clean.
const KEY = 'kickelo.matchForm';
const dayOf = (ms) => new Date(ms).toDateString();

/** { lineup: [a1, a2, b1, b2] | null, live: { startedAt, goalLog } | null } saved today, else null. */
export function loadSaved(now = Date.now(), storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    return saved?.day === dayOf(now) ? saved : null;
  } catch {
    return null; // storage unavailable or corrupt: nothing to restore
  }
}

export function save(patch, now = Date.now(), storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify({ lineup: null, live: null, ...loadSaved(now, storage), ...patch, day: dayOf(now) }));
  } catch { /* storage unavailable: restoring is best-effort */ }
}
