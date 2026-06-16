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
