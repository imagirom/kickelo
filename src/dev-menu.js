// Hidden developer menu, revealed by a secret triple-tap on a bottom strip.
// The reveal does not persist — a page reload hides it again.

/**
 * Pure triple-tap accumulator.
 * @param {number[]} timestamps  prior tap times (ms) still within the window
 * @param {number} now           current tap time (ms)
 * @param {number} windowMs      window all taps must fall within
 * @param {number} needed        taps required to trigger a reveal
 * @returns {{ timestamps: number[], reveal: boolean }}
 *   On reveal, timestamps resets to [] so counting starts fresh.
 */
export function registerTap(timestamps, now, windowMs = 1500, needed = 3) {
  const recent = [...timestamps, now].filter((t) => now - t < windowMs);
  if (recent.length >= needed) {
    return { timestamps: [], reveal: true };
  }
  return { timestamps: recent, reveal: false };
}

/** Wire the secret strip so a triple-tap reveals the dev menu. */
export function initDevMenu() {
  const strip = document.getElementById('devUnlockStrip');
  const menu = document.getElementById('devMenu');
  if (!strip || !menu) return;

  let taps = [];
  const tap = () => {
    const result = registerTap(taps, Date.now());
    taps = result.timestamps;
    if (result.reveal) menu.style.display = 'block';
  };
  strip.addEventListener('click', tap);
}
