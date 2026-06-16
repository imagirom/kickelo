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
