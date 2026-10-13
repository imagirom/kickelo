import { MAX_GOALS } from './constants.js';

export function lastGoalMs(goalLog) {
  return goalLog?.length ? goalLog[goalLog.length - 1].timestamp : null;
}

export function isDecided(goalLog = []) {
  return ['red', 'blue'].some(team => goalLog.filter(g => g.team === team).length >= MAX_GOALS);
}

// The live clock freezes at the winning goal and resumes if that goal is removed.
export function liveElapsedMs(goalLog, elapsedMs) {
  return isDecided(goalLog) ? lastGoalMs(goalLog) : elapsedMs;
}
