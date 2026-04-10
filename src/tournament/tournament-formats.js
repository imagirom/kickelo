// Tournament Format Generators — bracket/schedule creation for each format.
// Each generator returns { games, defaultGameOrder } suitable for the tournament engine.

import { createGame } from './tournament-engine.js';

// --- Utilities ---

export function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Standard bracket seedings: ensures top seeds meet in later rounds.
 * For size 8: [1, 8, 4, 5, 2, 7, 3, 6] → games (1v8), (4v5), (2v7), (3v6)
 */
export function generateBracketSeedings(size) {
  if (size === 1) return [1];
  if (size === 2) return [1, 2];
  const half = generateBracketSeedings(size / 2);
  const result = [];
  for (const seed of half) {
    result.push(seed);
    result.push(size + 1 - seed);
  }
  return result;
}

/**
 * Get a human-readable name for a round based on games remaining.
 */
function getElimRoundName(gamesInRound) {
  if (gamesInRound === 1) return 'Final';
  if (gamesInRound === 2) return 'Semifinal';
  if (gamesInRound === 4) return 'Quarterfinal';
  return `Round of ${gamesInRound * 2}`;
}

function gameRoundName(baseName, position, totalInRound) {
  if (totalInRound === 1) return baseName;
  return `${baseName} ${position}`;
}

// =============================================================================
// SINGLE ELIMINATION
// =============================================================================

export function generateSingleElimBracket(teams, config = {}) {
  const numTeams = teams.length;
  const bracketSize = nextPowerOf2(numTeams);
  const numRounds = Math.log2(bracketSize);
  const seedings = generateBracketSeedings(bracketSize);

  const games = [];
  const gamesByRound = []; // gamesByRound[roundIdx] = [game, game, ...]

  // Round 1: pair seeds
  const round1 = [];
  for (let i = 0; i < seedings.length; i += 2) {
    const pos = i / 2 + 1;
    const gamesInRound = bracketSize / 2;
    const isFinalRound = numRounds === 1;
    const roundName = getElimRoundName(gamesInRound);
    const game = createGame({
      id: isFinalRound ? 'f' : `r1-g${pos}`,
      round: 1,
      roundName: gameRoundName(roundName, pos, gamesInRound),
      position: pos,
      bracket: 'main',
      slots: [
        { sourceGameId: null, sourceOutcome: null, seed: seedings[i] },
        { sourceGameId: null, sourceOutcome: null, seed: seedings[i + 1] },
      ],
    });
    round1.push(game);
    games.push(game);
  }
  gamesByRound.push(round1);

  // Subsequent rounds
  for (let r = 2; r <= numRounds; r++) {
    const prevGames = gamesByRound[r - 2];
    const roundGames = [];
    const gamesInRound = prevGames.length / 2;
    const roundName = getElimRoundName(gamesInRound);

    for (let i = 0; i < prevGames.length; i += 2) {
      const pos = i / 2 + 1;
      const isFinal = r === numRounds;
      const gameId = isFinal ? 'f' : `r${r}-g${pos}`;

      const game = createGame({
        id: gameId,
        round: r,
        roundName: gameRoundName(roundName, pos, gamesInRound),
        position: pos,
        bracket: 'main',
        slots: [
          { sourceGameId: prevGames[i].id, sourceOutcome: 'winner', seed: null },
          { sourceGameId: prevGames[i + 1].id, sourceOutcome: 'winner', seed: null },
        ],
      });
      roundGames.push(game);
      games.push(game);
    }
    gamesByRound.push(roundGames);
  }

  // Optional 3rd place match
  if (config.thirdPlaceMatch && numRounds >= 2) {
    const sfGames = gamesByRound[numRounds - 2];
    if (sfGames.length === 2) {
      const game = createGame({
        id: '3rd',
        round: numRounds,
        roundName: 'Third Place',
        position: 2,
        bracket: 'main',
        slots: [
          { sourceGameId: sfGames[0].id, sourceOutcome: 'loser', seed: null },
          { sourceGameId: sfGames[1].id, sourceOutcome: 'loser', seed: null },
        ],
      });
      games.push(game);
    }
  }

  // Default game order: round by round, left to right
  const defaultGameOrder = games.filter(g => g.id !== '3rd').map(g => g.id);
  if (games.find(g => g.id === '3rd')) {
    // Insert 3rd place match before the final
    const fIdx = defaultGameOrder.indexOf('f');
    defaultGameOrder.splice(fIdx, 0, '3rd');
  }

  return { games, defaultGameOrder };
}

// =============================================================================
// DOUBLE ELIMINATION
// =============================================================================

export function generateDoubleElimBracket(teams, config = {}) {
  const numTeams = teams.length;
  const bracketSize = nextPowerOf2(numTeams);
  const numWBRounds = Math.log2(bracketSize);
  const seedings = generateBracketSeedings(bracketSize);

  const games = [];
  const wbByRound = []; // wbByRound[roundIdx] = [game, ...]

  // --- Winners Bracket ---
  // WB Round 1
  const wbR1 = [];
  for (let i = 0; i < seedings.length; i += 2) {
    const pos = i / 2 + 1;
    const gamesInRound = bracketSize / 2;
    const rName = getElimRoundName(gamesInRound);
    const game = createGame({
      id: `wb-r1-g${pos}`,
      round: 1,
      roundName: gameRoundName(`Winners ${rName}`, pos, gamesInRound),
      position: pos,
      bracket: 'winners',
      slots: [
        { sourceGameId: null, sourceOutcome: null, seed: seedings[i] },
        { sourceGameId: null, sourceOutcome: null, seed: seedings[i + 1] },
      ],
    });
    wbR1.push(game);
    games.push(game);
  }
  wbByRound.push(wbR1);

  // WB Rounds 2+
  for (let r = 2; r <= numWBRounds; r++) {
    const prev = wbByRound[r - 2];
    const roundGames = [];
    const gamesInRound = prev.length / 2;
    const isWBFinal = r === numWBRounds;
    const rName = isWBFinal ? 'Winners Final' : `Winners ${getElimRoundName(gamesInRound)}`;

    for (let i = 0; i < prev.length; i += 2) {
      const pos = i / 2 + 1;
      const gameId = isWBFinal ? 'wb-f' : `wb-r${r}-g${pos}`;
      const game = createGame({
        id: gameId,
        round: r,
        roundName: isWBFinal ? rName : gameRoundName(rName, pos, gamesInRound),
        position: pos,
        bracket: 'winners',
        slots: [
          { sourceGameId: prev[i].id, sourceOutcome: 'winner', seed: null },
          { sourceGameId: prev[i + 1].id, sourceOutcome: 'winner', seed: null },
        ],
      });
      roundGames.push(game);
      games.push(game);
    }
    wbByRound.push(roundGames);
  }

  // --- Losers Bracket ---
  // Pattern: LB has 2*(numWBRounds-1) rounds
  // Odd rounds (1,3,5...): internal (LB survivors pair up, or WB R1 losers for LB R1)
  // Even rounds (2,4,6...): drop-down (LB survivors vs WB losers)
  const numLBRounds = 2 * (numWBRounds - 1);
  const lbByRound = [];

  for (let lbr = 1; lbr <= numLBRounds; lbr++) {
    const k = Math.ceil(lbr / 2); // which "pair" of LB rounds (1-indexed)
    const gamesInRound = bracketSize / Math.pow(2, k + 1);
    const isOdd = lbr % 2 === 1;
    const isLBFinal = lbr === numLBRounds;
    const roundGames = [];

    if (lbr === 1) {
      // LB R1: WB R1 losers paired up
      const wbR1Games = wbByRound[0];
      for (let i = 0; i < wbR1Games.length; i += 2) {
        const pos = i / 2 + 1;
        const game = createGame({
          id: `lb-r1-g${pos}`,
          round: lbr,
          roundName: gameRoundName('Losers Round 1', pos, gamesInRound),
          position: pos,
          bracket: 'losers',
          slots: [
            { sourceGameId: wbR1Games[i].id, sourceOutcome: 'loser', seed: null },
            { sourceGameId: wbR1Games[i + 1].id, sourceOutcome: 'loser', seed: null },
          ],
        });
        roundGames.push(game);
        games.push(game);
      }
    } else if (isOdd) {
      // Odd LB round > 1: pair up previous LB round winners
      const prevLB = lbByRound[lbr - 2]; // previous LB round's games
      for (let i = 0; i < prevLB.length; i += 2) {
        const pos = i / 2 + 1;
        const rName = isLBFinal ? 'Losers Final' : `Losers Round ${lbr}`;
        const game = createGame({
          id: isLBFinal ? 'lb-f' : `lb-r${lbr}-g${pos}`,
          round: lbr,
          roundName: isLBFinal ? rName : gameRoundName(rName, pos, gamesInRound),
          position: pos,
          bracket: 'losers',
          slots: [
            { sourceGameId: prevLB[i].id, sourceOutcome: 'winner', seed: null },
            { sourceGameId: prevLB[i + 1].id, sourceOutcome: 'winner', seed: null },
          ],
        });
        roundGames.push(game);
        games.push(game);
      }
    } else {
      // Even LB round: LB survivors vs WB dropouts
      const prevLB = lbByRound[lbr - 2];
      const wbDropRound = lbr / 2 + 1; // which WB round's losers drop down
      const wbDropGames = wbByRound[wbDropRound - 1];
      for (let i = 0; i < gamesInRound; i++) {
        const pos = i + 1;
        const rName = isLBFinal ? 'Losers Final' : `Losers Round ${lbr}`;
        const game = createGame({
          id: isLBFinal ? 'lb-f' : `lb-r${lbr}-g${pos}`,
          round: lbr,
          roundName: isLBFinal ? rName : gameRoundName(rName, pos, gamesInRound),
          position: pos,
          bracket: 'losers',
          slots: [
            { sourceGameId: prevLB[i].id, sourceOutcome: 'winner', seed: null },
            { sourceGameId: wbDropGames[i].id, sourceOutcome: 'loser', seed: null },
          ],
        });
        roundGames.push(game);
        games.push(game);
      }
    }

    lbByRound.push(roundGames);
  }

  // --- Grand Final ---
  const lbFinal = lbByRound[lbByRound.length - 1];
  const lbFinalGame = lbFinal[lbFinal.length - 1];

  const gf = createGame({
    id: 'gf',
    round: numWBRounds + numLBRounds + 1,
    roundName: 'Grand Final',
    position: 1,
    bracket: 'grand_final',
    slots: [
      { sourceGameId: 'wb-f', sourceOutcome: 'winner', seed: null },
      { sourceGameId: lbFinalGame.id, sourceOutcome: 'winner', seed: null },
    ],
  });
  games.push(gf);

  // Optional GF reset
  if (config.grandFinalReset) {
    const gfReset = createGame({
      id: 'gf-reset',
      round: numWBRounds + numLBRounds + 2,
      roundName: 'Grand Final Reset',
      position: 1,
      bracket: 'grand_final',
      slots: [
        // If the LB champion wins GF, they play again
        // Both slots source from the GF — winner and loser swap
        { sourceGameId: 'gf', sourceOutcome: 'winner', seed: null },
        { sourceGameId: 'gf', sourceOutcome: 'loser', seed: null },
      ],
    });
    games.push(gfReset);
  }

  // Default game order: interleave WB and LB by round
  const defaultGameOrder = [];
  // WB R1
  for (const g of wbByRound[0]) defaultGameOrder.push(g.id);
  // Then interleave: WB Rn, LB R(2n-3), LB R(2n-2) for n >= 2
  for (let wbr = 2; wbr <= numWBRounds; wbr++) {
    for (const g of wbByRound[wbr - 1]) defaultGameOrder.push(g.id);
    const lbIdx1 = 2 * (wbr - 1) - 2; // LB round index (0-based)
    const lbIdx2 = 2 * (wbr - 1) - 1;
    if (lbIdx1 >= 0 && lbIdx1 < lbByRound.length) {
      for (const g of lbByRound[lbIdx1]) defaultGameOrder.push(g.id);
    }
    if (lbIdx2 >= 0 && lbIdx2 < lbByRound.length) {
      for (const g of lbByRound[lbIdx2]) defaultGameOrder.push(g.id);
    }
  }
  // Remaining LB rounds not yet included
  for (let i = 0; i < lbByRound.length; i++) {
    for (const g of lbByRound[i]) {
      if (!defaultGameOrder.includes(g.id)) defaultGameOrder.push(g.id);
    }
  }
  defaultGameOrder.push('gf');
  if (config.grandFinalReset) defaultGameOrder.push('gf-reset');

  return { games, defaultGameOrder };
}

// =============================================================================
// SWISS
// =============================================================================

/**
 * Generate the first Swiss round (random or seeded pairings).
 */
export function generateSwissFirstRound(teams, config = {}) {
  // Sort teams by seed for initial pairing
  const sorted = [...teams].sort((a, b) => a.seed - b.seed);

  const games = [];
  let byeTeamId = null;

  const active = [...sorted];
  // Handle odd number: lowest seed gets a bye
  if (active.length % 2 === 1) {
    const byeTeam = active.pop();
    byeTeamId = byeTeam.id;
    games.push(createGame({
      id: 'swiss-r1-bye',
      round: 1,
      roundName: 'Round 1 Bye',
      position: Math.ceil(active.length / 2) + 1,
      bracket: 'main',
      slots: [
        { sourceGameId: null, sourceOutcome: null, seed: null },
        { sourceGameId: null, sourceOutcome: null, seed: null },
      ],
    }));
    // Set up the bye game
    const byeGame = games[games.length - 1];
    byeGame.teams = [{ teamId: byeTeam.id, name: byeTeam.name }, { teamId: null, name: null }];
    byeGame.isBye = true;
    byeGame.status = 'completed';
    byeGame.result = { winner: 0, matchId: null, score: [0, 0] };
  }

  // Pair: #1 vs #(N/2+1), #2 vs #(N/2+2), etc. (fold pairing)
  const half = Math.floor(active.length / 2);
  for (let i = 0; i < half; i++) {
    const t1 = active[i];
    const t2 = active[half + i];
    const pos = i + 1;
    const game = createGame({
      id: `swiss-r1-g${pos}`,
      round: 1,
      roundName: `Round 1, Game ${pos}`,
      position: pos,
      bracket: 'main',
      slots: [
        { sourceGameId: null, sourceOutcome: null, seed: null },
        { sourceGameId: null, sourceOutcome: null, seed: null },
      ],
    });
    game.teams = [
      { teamId: t1.id, name: t1.name },
      { teamId: t2.id, name: t2.name },
    ];
    game.status = 'ready';
    games.push(game);
  }

  const defaultGameOrder = games.filter(g => !g.isBye).map(g => g.id);
  return { games, defaultGameOrder };
}

/**
 * Generate the next Swiss round based on current standings.
 * Call after all games in the previous round are complete.
 */
export function generateSwissRound(tournament, roundNumber) {
  const teams = tournament.teams;
  const existingGames = tournament.games;

  // Build standings
  const standings = computeSwissStandingsForPairing(teams, existingGames);

  // Track already-played pairs
  const playedPairs = new Set();
  for (const game of existingGames) {
    if (game.result && !game.isBye) {
      const ids = [game.teams[0]?.teamId, game.teams[1]?.teamId].filter(Boolean).sort();
      if (ids.length === 2) playedPairs.add(ids.join('|'));
    }
  }

  // Track teams that already had a bye
  const hadBye = new Set();
  for (const game of existingGames) {
    if (game.isBye && game.result) {
      const tid = game.teams[game.result.winner]?.teamId;
      if (tid) hadBye.add(tid);
    }
  }

  const active = [...standings];
  const newGames = [];
  let byeTeam = null;

  // Handle odd teams
  if (active.length % 2 === 1) {
    // Give bye to lowest-ranked team that hasn't had one
    for (let i = active.length - 1; i >= 0; i--) {
      if (!hadBye.has(active[i].teamId)) {
        byeTeam = active.splice(i, 1)[0];
        break;
      }
    }
    // If all have had byes, give to lowest
    if (!byeTeam) {
      byeTeam = active.pop();
    }
  }

  // Pair teams: split into halves, use backtracking to avoid rematches
  const half = Math.floor(active.length / 2);
  const upper = active.slice(0, half);
  const lower = active.slice(half);

  const pairings = findNonRematchPairing(upper, lower, playedPairs);

  // Create games
  for (let i = 0; i < pairings.length; i++) {
    const [t1, t2] = pairings[i];
    const pos = i + 1;
    const game = createGame({
      id: `swiss-r${roundNumber}-g${pos}`,
      round: roundNumber,
      roundName: `Round ${roundNumber}, Game ${pos}`,
      position: pos,
      bracket: 'main',
      slots: [
        { sourceGameId: null, sourceOutcome: null, seed: null },
        { sourceGameId: null, sourceOutcome: null, seed: null },
      ],
    });
    game.teams = [
      { teamId: t1.teamId, name: t1.teamName },
      { teamId: t2.teamId, name: t2.teamName },
    ];
    game.status = 'ready';
    newGames.push(game);
  }

  // Bye game
  if (byeTeam) {
    const byeGame = createGame({
      id: `swiss-r${roundNumber}-bye`,
      round: roundNumber,
      roundName: `Round ${roundNumber} Bye`,
      position: pairings.length + 1,
      bracket: 'main',
      slots: [
        { sourceGameId: null, sourceOutcome: null, seed: null },
        { sourceGameId: null, sourceOutcome: null, seed: null },
      ],
    });
    byeGame.teams = [{ teamId: byeTeam.teamId, name: byeTeam.teamName }, { teamId: null, name: null }];
    byeGame.isBye = true;
    byeGame.status = 'completed';
    byeGame.result = { winner: 0, matchId: null, score: [0, 0] };
    newGames.push(byeGame);
  }

  const newGameOrder = newGames.filter(g => !g.isBye).map(g => g.id);
  return { newGames, newGameOrder };
}

function computeSwissStandingsForPairing(teams, games) {
  const stats = new Map();
  for (const team of teams) {
    stats.set(team.id, { teamId: team.id, teamName: team.name, wins: 0, seed: team.seed });
  }

  for (const game of games) {
    if (!game.result) continue;
    const winnerId = game.teams[game.result.winner]?.teamId;
    if (winnerId && stats.has(winnerId)) stats.get(winnerId).wins++;
  }

  return Array.from(stats.values()).sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    return a.seed - b.seed;
  });
}

/**
 * Find a pairing of upper and lower halves that avoids rematches.
 * Uses backtracking; falls back to sequential pairing if impossible.
 */
function findNonRematchPairing(upper, lower, playedPairs) {
  const n = upper.length;
  const used = new Array(n).fill(false);
  const result = new Array(n).fill(-1);

  function backtrack(i) {
    if (i === n) return true;
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const key = [upper[i].teamId, lower[j].teamId].sort().join('|');
      if (playedPairs.has(key)) continue;
      used[j] = true;
      result[i] = j;
      if (backtrack(i + 1)) return true;
      used[j] = false;
    }
    return false;
  }

  if (!backtrack(0)) {
    // No rematch-free pairing possible — fall back to sequential
    for (let i = 0; i < n; i++) result[i] = i;
  }

  return result.map((j, i) => [upper[i], lower[j]]);
}

// =============================================================================
// ROUND ROBIN
// =============================================================================

export function generateRoundRobinSchedule(teams, config = {}) {
  const n = teams.length;
  const isOdd = n % 2 === 1;
  // Circle method: if odd, add a dummy team for byes
  const entries = [...teams.map(t => ({ teamId: t.id, name: t.name }))];
  if (isOdd) entries.push({ teamId: null, name: null }); // dummy = bye
  const numEntries = entries.length;
  const numRounds = numEntries - 1;

  const games = [];
  const defaultGameOrder = [];

  // Circle method: fix entries[0], rotate the rest
  const rotating = entries.slice(1);

  for (let round = 0; round < numRounds; round++) {
    const roundNum = round + 1;
    const current = [entries[0], ...rotating];
    const gamesInRound = Math.floor(numEntries / 2);
    let gamePos = 0;

    for (let i = 0; i < gamesInRound; i++) {
      const t1 = current[i];
      const t2 = current[numEntries - 1 - i];

      // Skip if either is the dummy (bye)
      if (!t1.teamId || !t2.teamId) continue;

      gamePos++;
      const gameId = `rr-r${roundNum}-g${gamePos}`;
      const game = createGame({
        id: gameId,
        round: roundNum,
        roundName: `Round ${roundNum}, Game ${gamePos}`,
        position: gamePos,
        bracket: 'main',
        slots: [
          { sourceGameId: null, sourceOutcome: null, seed: null },
          { sourceGameId: null, sourceOutcome: null, seed: null },
        ],
      });
      game.teams = [
        { teamId: t1.teamId, name: t1.name },
        { teamId: t2.teamId, name: t2.name },
      ];
      game.status = 'ready';
      games.push(game);
      defaultGameOrder.push(gameId);
    }

    // Rotate: move last element to position 1
    rotating.unshift(rotating.pop());
  }

  return { games, defaultGameOrder };
}

/**
 * Generate a Double Round Robin schedule: each pair of teams plays twice.
 * Second half mirrors the first half with home/away swapped.
 */
export function generateDoubleRoundRobinSchedule(teams, config = {}) {
  const { games: firstHalf, defaultGameOrder: firstOrder } = generateRoundRobinSchedule(teams, config);
  const numFirstRounds = firstHalf.length > 0
    ? Math.max(...firstHalf.map(g => g.round))
    : 0;

  const secondHalf = [];
  const secondOrder = [];

  for (const game of firstHalf) {
    const newRound = game.round + numFirstRounds;
    const gameId = `drr-r${newRound}-g${game.position}`;
    const rematch = createGame({
      id: gameId,
      round: newRound,
      roundName: `Round ${newRound}, Game ${game.position}`,
      position: game.position,
      bracket: 'main',
      slots: [
        { sourceGameId: null, sourceOutcome: null, seed: null },
        { sourceGameId: null, sourceOutcome: null, seed: null },
      ],
    });
    // Swap team order for the return leg
    rematch.teams = [
      { teamId: game.teams[1].teamId, name: game.teams[1].name },
      { teamId: game.teams[0].teamId, name: game.teams[0].name },
    ];
    rematch.status = 'ready';
    secondHalf.push(rematch);
    secondOrder.push(gameId);
  }

  return {
    games: [...firstHalf, ...secondHalf],
    defaultGameOrder: [...firstOrder, ...secondOrder],
  };
}
