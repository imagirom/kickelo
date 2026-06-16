// Low-latency local sound-effect playback via the Web Audio API.
// Mobile browsers block audio until a user gesture, so unlock() MUST be called
// from within a gesture handler (the "Start live mode" tap) before playback.

let ctx = null;
const buffers = new Map(); // src -> Promise<AudioBuffer>

/** Create/resume the AudioContext from within a user gesture. Idempotent. */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function load(src) {
  if (!buffers.has(src)) {
    const promise = fetch(src)
      .then(r => r.arrayBuffer())
      .then(arr => ctx.decodeAudioData(arr))
      .catch(err => { buffers.delete(src); throw err; });
    buffers.set(src, promise);
  }
  return buffers.get(src);
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
