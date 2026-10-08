// src/betting/betting-config.js
// Golden-football betting switches and tuning. Code-level, like sound-config.js.
export const BETTING = {
  enabled: true,            // master switch: nothing betting-related renders, syncs or writes when false
  liveSync: true,           // publish/subscribe meta/currentMatch (shared live view); house bets need it
  houseWinner: true,
  houseProps: { enabled: false, count: 2, maxRatio: 3, minSamples: 30 },   // phase 2
  challenges: false,                                                      // phase 3
  margin: 0.05,
  oddsClamp: [1.05, 10],
  dailyAllowance: 20,
  undoWindowMs: 5000,
  maxStake: 10000,        // also enforced in firestore.rules (isStake)
  stakeChips: [5, 10, 25],
};

/** House bets need the shared live state for the first-goal cutoff. */
export function houseBetsActive(cfg = BETTING) {
  return cfg.enabled && cfg.liveSync && cfg.houseWinner;
}

export function propsActive(cfg = BETTING) {
  return houseBetsActive(cfg) && Boolean(cfg.houseProps?.enabled);
}
