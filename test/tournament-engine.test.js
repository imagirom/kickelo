// Tournament Engine + Format Tests
// Tests the pure logic without Firebase dependency.

import {
  generateTeamName,
  createGame,
  getGameById,
  getReadyGames,
  getNextDefaultGame,
  validateTournamentSetup,
  initializeBracket,
  completeGame,
  isTournamentComplete,
  isSwissRoundComplete,
  getCurrentSwissRound,
  computeFinalRankings,
  getDownstreamGames,
  hasCompletedDownstream,
  uncompleteGame,
} from '../src/tournament/tournament-engine.js';

import {
  nextPowerOf2,
  generateBracketSeedings,
  generateSingleElimBracket,
  generateDoubleElimBracket,
  generateSwissFirstRound,
  generateSwissRound,
  generateRoundRobinSchedule,
  generateDoubleRoundRobinSchedule,
} from '../src/tournament/tournament-formats.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    failed++;
  } else {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    console.error(`  ✗ ${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  } else {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    console.error(`  ✗ ${message}: expected throw`);
    failed++;
  } catch (e) {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

function makeTeams(n) {
  const teams = [];
  for (let i = 0; i < n; i++) {
    const name1 = `Player${String.fromCharCode(65 + i * 2)}`;
    const name2 = `Player${String.fromCharCode(65 + i * 2 + 1)}`;
    teams.push({
      id: `t${i + 1}`,
      name: generateTeamName([name1, name2]),
      players: [name1, name2],
      seed: i + 1,
      avgElo: 1000 - i * 10,
    });
  }
  return teams;
}

function makeTournament(teams, format, games, defaultGameOrder, config = {}) {
  return {
    format,
    state: 'in_progress',
    teams,
    games,
    defaultGameOrder,
    config,
    finalRankings: null,
    completedAt: null,
  };
}

// Play all games in a single-elim tournament deterministically (higher seed wins)
function playAllSingleElim(tournament) {
  let safety = 100;
  while (!isTournamentComplete(tournament) && safety-- > 0) {
    const ready = getReadyGames(tournament);
    if (ready.length === 0) break;
    for (const game of ready) {
      // Higher seed = lower number = team in slot 0 usually
      completeGame(tournament, game.id, 0, `match-${game.id}`, [5, 3]);
    }
  }
}

// ===========================================================================
console.log('\n=== generateTeamName ===');
// ===========================================================================

assertEq(generateTeamName(['Alice', 'Bob']), 'Al & Bo', 'two players');
assertEq(generateTeamName(['charlie']), 'Ch', 'one player');
assertEq(generateTeamName([]), 'Team', 'empty');
assertEq(generateTeamName(null), 'Team', 'null');
assertEq(generateTeamName(['X']), 'X', 'single char player');

// ===========================================================================
console.log('\n=== Utilities ===');
// ===========================================================================

assertEq(nextPowerOf2(1), 1, 'nextPowerOf2(1)');
assertEq(nextPowerOf2(3), 4, 'nextPowerOf2(3)');
assertEq(nextPowerOf2(4), 4, 'nextPowerOf2(4)');
assertEq(nextPowerOf2(5), 8, 'nextPowerOf2(5)');
assertEq(nextPowerOf2(9), 16, 'nextPowerOf2(9)');

{
  const s = generateBracketSeedings(8);
  assertEq(s.length, 8, 'seedings length 8');
  assertEq(s[0], 1, 'seed 1 is first');
  assertEq(s[1], 8, 'seed 8 is second (1v8)');
  assertEq(s[2], 4, 'seed 4 is third');
  assertEq(s[3], 5, 'seed 5 is fourth (4v5)');
  assert(s[4] === 2 && s[5] === 7, '2v7 in second half');
  assert(s[6] === 3 && s[7] === 6, '3v6 in second half');
}

// ===========================================================================
console.log('\n=== validateTournamentSetup ===');
// ===========================================================================

{
  const teams = makeTeams(4);
  const r = validateTournamentSetup(teams, 'single_elim', {});
  assert(r.valid, '4 teams single_elim is valid');
  assertEq(r.errors.length, 0, 'no errors');
}

{
  const r = validateTournamentSetup([], 'single_elim', {});
  assert(!r.valid, 'empty teams invalid');
}

{
  const r = validateTournamentSetup(makeTeams(2), 'bogus', {});
  assert(!r.valid, 'bogus format invalid');
}

{
  const teams = [
    { id: 't1', name: 'A', players: ['Alice', 'Bob'], seed: 1 },
    { id: 't2', name: 'B', players: ['Alice', 'Charlie'], seed: 2 },
  ];
  const r = validateTournamentSetup(teams, 'single_elim', {});
  assert(!r.valid, 'duplicate player detected');
  assert(r.errors.some(e => e.includes('Alice')), 'error mentions Alice');
}

// ===========================================================================
console.log('\n=== Single Elimination — 4 teams ===');
// ===========================================================================

{
  const teams = makeTeams(4);
  const { games, defaultGameOrder } = generateSingleElimBracket(teams);

  assertEq(games.length, 3, '4 teams → 3 games');
  assertEq(defaultGameOrder.length, 3, '3 games in order');

  // R1: 2 games (Semifinal), then Final
  const r1Games = games.filter(g => g.round === 1);
  assertEq(r1Games.length, 2, '2 semifinal games');
  assert(r1Games[0].roundName.includes('Semifinal'), 'round 1 named Semifinal');

  const final = games.find(g => g.id === 'f');
  assert(final != null, 'final game exists');
  assertEq(final.roundName, 'Final', 'final named correctly');

  // Initialize and check
  const t = makeTournament(teams, 'single_elim', games, defaultGameOrder);
  initializeBracket(t);

  const ready = getReadyGames(t);
  assertEq(ready.length, 2, '2 games ready initially');

  // Play semifinal 1: team 1 wins
  const newlyReady = completeGame(t, 'r1-g1', 0, 'match-1', [5, 2]);
  assertEq(newlyReady.length, 0, 'final not ready yet');

  // Play semifinal 2: team 2 wins
  const newlyReady2 = completeGame(t, 'r1-g2', 0, 'match-2', [5, 3]);
  assertEq(newlyReady2.length, 1, 'final now ready');
  assertEq(newlyReady2[0], 'f', 'final game ID');

  // Play final
  completeGame(t, 'f', 0, 'match-3', [5, 1]);
  assert(isTournamentComplete(t), 'tournament complete');
  assertEq(t.state, 'completed', 'state set to completed');

  const rankings = computeFinalRankings(t);
  assertEq(rankings[0].rank, 1, 'first place rank');
  assertEq(rankings.length, 4, 'all teams ranked');
}

// ===========================================================================
console.log('\n=== Single Elimination — 5 teams (byes) ===');
// ===========================================================================

{
  const teams = makeTeams(5);
  const { games, defaultGameOrder } = generateSingleElimBracket(teams);

  // bracketSize=8, so 7 games
  assertEq(games.length, 7, '5 teams in bracket of 8 → 7 games');

  const t = makeTournament(teams, 'single_elim', games, defaultGameOrder);
  initializeBracket(t);

  // 3 byes (seeds 6,7,8 don't exist), so 3 R1 games auto-completed
  const byes = t.games.filter(g => g.isBye);
  assertEq(byes.length, 3, '3 bye games');

  // R1 has one playable game (seed 4 vs seed 5)
  const readyR1 = getReadyGames(t).filter(g => g.round === 1);
  assertEq(readyR1.length, 1, 'one R1 game to play');
  assert(
    readyR1[0].teams.every(team => team.teamId != null),
    'R1 game has both teams filled'
  );

  // One R2 game should be ready (seeds 2 vs 3, both got byes)
  const readyR2 = getReadyGames(t).filter(g => g.round === 2);
  assertEq(readyR2.length, 1, 'one R2 game ready from cascaded byes');

  // Play through
  playAllSingleElim(t);
  assert(isTournamentComplete(t), '5-team tournament completes');
}

// ===========================================================================
console.log('\n=== Single Elimination — 8 teams ===');
// ===========================================================================

{
  const teams = makeTeams(8);
  const { games } = generateSingleElimBracket(teams);

  assertEq(games.length, 7, '8 teams → 7 games');

  const t = makeTournament(teams, 'single_elim', games, games.map(g => g.id));
  initializeBracket(t);

  const byes = t.games.filter(g => g.isBye);
  assertEq(byes.length, 0, 'no byes for power of 2');

  const ready = getReadyGames(t);
  assertEq(ready.length, 4, '4 QF games ready');
  assert(ready[0].roundName.includes('Quarterfinal'), 'named Quarterfinal');

  playAllSingleElim(t);
  assert(isTournamentComplete(t), '8-team completes');

  const rankings = computeFinalRankings(t);
  assertEq(rankings[0].rank, 1, 'champion ranked 1');
  // In SE, QF losers share rank 5 (4 wins=3 > 4 wins=2 > ... )
  // Actually with our ranking: winner has 3 wins, finalist 2, SF losers 1, QF losers 0
  assertEq(rankings[0].wins, 3, 'champion has 3 wins');
}

// ===========================================================================
console.log('\n=== Single Elimination — 3rd place match ===');
// ===========================================================================

{
  const teams = makeTeams(4);
  const { games } = generateSingleElimBracket(teams, { thirdPlaceMatch: true });

  assertEq(games.length, 4, '4 teams + 3rd place = 4 games');
  const thirdPlace = games.find(g => g.id === '3rd');
  assert(thirdPlace != null, '3rd place game exists');
  assertEq(thirdPlace.roundName, 'Third Place', 'correct name');
  // 3rd place sources from semifinal losers
  assert(thirdPlace.slots[0].sourceOutcome === 'loser', 'slot 0 from loser');
  assert(thirdPlace.slots[1].sourceOutcome === 'loser', 'slot 1 from loser');
}

// ===========================================================================
console.log('\n=== Single Elimination — 16 teams ===');
// ===========================================================================

{
  const teams = makeTeams(16);
  const { games } = generateSingleElimBracket(teams);

  assertEq(games.length, 15, '16 teams → 15 games');
  const r1 = games.filter(g => g.round === 1);
  assertEq(r1.length, 8, '8 round-of-16 games');
  assert(r1[0].roundName.includes('Round of 16'), 'named Round of 16');

  const t = makeTournament(teams, 'single_elim', games, games.map(g => g.id));
  initializeBracket(t);
  playAllSingleElim(t);
  assert(isTournamentComplete(t), '16-team completes');
}

// ===========================================================================
console.log('\n=== Single Elimination — 2 teams ===');
// ===========================================================================

{
  const teams = makeTeams(2);
  const { games } = generateSingleElimBracket(teams);

  assertEq(games.length, 1, '2 teams → 1 game (Final)');
  assertEq(games[0].roundName, 'Final', 'it is the Final');

  const t = makeTournament(teams, 'single_elim', games, games.map(g => g.id));
  initializeBracket(t);
  assertEq(getReadyGames(t).length, 1, 'final ready');

  completeGame(t, 'f', 0, 'match-f', [5, 0]);
  assert(isTournamentComplete(t), 'completes');
}

// ===========================================================================
console.log('\n=== Double Elimination — 4 teams ===');
// ===========================================================================

{
  const teams = makeTeams(4);
  const { games, defaultGameOrder } = generateDoubleElimBracket(teams);

  // 4 teams: WB: 2+1=3, LB: 2*(2-1)=2 rounds → 1+1=2 games, GF: 1 = total 6
  assertEq(games.length, 6, '4-team DE → 6 games');

  const wb = games.filter(g => g.bracket === 'winners');
  const lb = games.filter(g => g.bracket === 'losers');
  const gf = games.filter(g => g.bracket === 'grand_final');
  assertEq(wb.length, 3, '3 WB games');
  assertEq(lb.length, 2, '2 LB games');
  assertEq(gf.length, 1, '1 GF');

  const t = makeTournament(teams, 'double_elim', games, defaultGameOrder);
  initializeBracket(t);

  // WB R1: 2 games ready
  assertEq(getReadyGames(t).length, 2, '2 WB R1 games ready');

  // Play WB R1
  completeGame(t, 'wb-r1-g1', 0, 'm1', [5, 2]);
  completeGame(t, 'wb-r1-g2', 0, 'm2', [5, 3]);

  // Now WB Final and LB R1 should be ready
  const ready2 = getReadyGames(t);
  const readyIds = ready2.map(g => g.id).sort();
  assert(readyIds.includes('wb-f'), 'WB Final ready');
  assert(readyIds.includes('lb-r1-g1'), 'LB R1 ready');

  // Play LB R1 and WB Final
  completeGame(t, 'lb-r1-g1', 0, 'm3', [5, 4]);
  completeGame(t, 'wb-f', 0, 'm4', [5, 1]);

  // LB R2 (LB Final) should be ready: LB R1 winner vs WB Final loser
  const ready3 = getReadyGames(t);
  assert(ready3.some(g => g.bracket === 'losers'), 'LB R2 ready');

  // Play LB Final
  const lbFinal = ready3.find(g => g.bracket === 'losers');
  completeGame(t, lbFinal.id, 0, 'm5', [5, 2]);

  // GF ready
  const ready4 = getReadyGames(t);
  assertEq(ready4.length, 1, 'GF ready');
  assertEq(ready4[0].id, 'gf', 'GF game');

  completeGame(t, 'gf', 0, 'm6', [5, 0]);
  assert(isTournamentComplete(t), 'DE tournament complete');

  const rankings = computeFinalRankings(t);
  assertEq(rankings[0].rank, 1, 'champion is rank 1');
  assertEq(rankings.length, 4, 'all teams ranked');
}

// ===========================================================================
console.log('\n=== Double Elimination — 8 teams ===');
// ===========================================================================

{
  const teams = makeTeams(8);
  const { games, defaultGameOrder } = generateDoubleElimBracket(teams);

  // 8 teams: WB 7, LB 6, GF 1 = 14
  assertEq(games.length, 14, '8-team DE → 14 games');

  const t = makeTournament(teams, 'double_elim', games, defaultGameOrder);
  initializeBracket(t);

  // Play through: higher seed (slot 0) always wins
  let safety = 50;
  while (!isTournamentComplete(t) && safety-- > 0) {
    const ready = getReadyGames(t);
    if (ready.length === 0) break;
    for (const game of ready) {
      completeGame(t, game.id, 0, `match-${game.id}`, [5, 3]);
    }
  }

  assert(isTournamentComplete(t), '8-team DE completes');
  const completed = t.games.filter(g => g.status === 'completed' && !g.isBye).length;
  assert(completed > 0, 'games were played');
}

// ===========================================================================
console.log('\n=== Double Elimination — 5 teams (byes) ===');
// ===========================================================================

{
  const teams = makeTeams(5);
  const { games, defaultGameOrder } = generateDoubleElimBracket(teams);

  const t = makeTournament(teams, 'double_elim', games, defaultGameOrder);
  initializeBracket(t);

  const byes = t.games.filter(g => g.isBye);
  assertEq(byes.length, 4, '4 byes in 8-bracket DE for 5 teams (3 WB + 1 LB cascade)');

  let safety = 50;
  while (!isTournamentComplete(t) && safety-- > 0) {
    const ready = getReadyGames(t);
    if (ready.length === 0) break;
    for (const game of ready) {
      completeGame(t, game.id, 0, `match-${game.id}`, [5, 3]);
    }
  }

  assert(isTournamentComplete(t), '5-team DE completes');
}

// ===========================================================================
console.log('\n=== Swiss — 6 teams ===');
// ===========================================================================

{
  const teams = makeTeams(6);
  const config = { swissRounds: 3 };

  const { games: r1Games, defaultGameOrder: r1Order } = generateSwissFirstRound(teams);
  assertEq(r1Games.length, 3, 'Swiss R1: 3 games for 6 teams');
  assert(r1Games.every(g => g.status === 'ready'), 'all R1 games ready');

  const t = makeTournament(teams, 'swiss', r1Games, r1Order, config);

  // Play R1: all slot 0 wins
  for (const game of getReadyGames(t)) {
    completeGame(t, game.id, 0, `match-${game.id}`, [5, 3]);
  }
  assert(isSwissRoundComplete(t, 1), 'round 1 complete');
  assertEq(getCurrentSwissRound(t), 1, 'current round is 1');

  // Generate R2
  const { newGames: r2Games, newGameOrder: r2Order } = generateSwissRound(t, 2);
  assertEq(r2Games.length, 3, 'Swiss R2: 3 games');

  // Verify no rematches in R2 — build r1Pairs BEFORE pushing r2 to t.games
  // (r1Games === t.games by reference)
  const r1Pairs = new Set();
  for (const g of r1Games) {
    if (!g.isBye) {
      const ids = [g.teams[0].teamId, g.teams[1].teamId].sort().join('|');
      r1Pairs.add(ids);
    }
  }

  t.games.push(...r2Games);
  t.defaultGameOrder.push(...r2Order);

  for (const g of r2Games) {
    if (!g.isBye) {
      const ids = [g.teams[0].teamId, g.teams[1].teamId].sort().join('|');
      assert(!r1Pairs.has(ids), `R2 game ${g.id} is not a rematch`);
    }
  }

  // Play R2
  for (const game of getReadyGames(t)) {
    completeGame(t, game.id, 0, `match-${game.id}`, [5, 2]);
  }
  assert(isSwissRoundComplete(t, 2), 'round 2 complete');

  // Generate and play R3
  const { newGames: r3Games, newGameOrder: r3Order } = generateSwissRound(t, 3);
  t.games.push(...r3Games);
  t.defaultGameOrder.push(...r3Order);

  for (const game of getReadyGames(t)) {
    completeGame(t, game.id, 0, `match-${game.id}`, [5, 1]);
  }

  assert(isTournamentComplete(t), 'Swiss tournament complete after 3 rounds');

  const rankings = computeFinalRankings(t);
  assertEq(rankings.length, 6, 'all 6 teams ranked');
  assert(rankings[0].wins >= rankings[1].wins, 'rank 1 has most wins');
}

// ===========================================================================
console.log('\n=== Swiss — 5 teams (odd, byes) ===');
// ===========================================================================

{
  const teams = makeTeams(5);
  const config = { swissRounds: 3 };

  const { games: r1Games, defaultGameOrder: r1Order } = generateSwissFirstRound(teams);
  assertEq(r1Games.length, 3, 'Swiss R1 with 5 teams: 2 games + 1 bye = 3');
  const r1Byes = r1Games.filter(g => g.isBye);
  assertEq(r1Byes.length, 1, 'one bye in R1');

  const t = makeTournament(teams, 'swiss', r1Games, r1Order, config);

  // Play R1
  for (const game of getReadyGames(t)) {
    completeGame(t, game.id, 0, `match-${game.id}`, [5, 3]);
  }

  // Generate R2
  const { newGames: r2Games, newGameOrder: r2Order } = generateSwissRound(t, 2);
  t.games.push(...r2Games);
  t.defaultGameOrder.push(...r2Order);
  const r2Byes = r2Games.filter(g => g.isBye);
  assertEq(r2Byes.length, 1, 'one bye in R2');

  // The R2 bye should be a different team than R1 bye
  const r1ByeTeam = r1Byes[0].teams[0].teamId;
  const r2ByeTeam = r2Byes[0].teams[0].teamId;
  assert(r1ByeTeam !== r2ByeTeam, 'different team gets bye in R2');
}

// ===========================================================================
console.log('\n=== Round Robin — 4 teams ===');
// ===========================================================================

{
  const teams = makeTeams(4);
  const { games, defaultGameOrder } = generateRoundRobinSchedule(teams);

  // 4 teams: 4*3/2 = 6 games
  assertEq(games.length, 6, '4 teams → 6 RR games');
  assertEq(defaultGameOrder.length, 6, '6 games in order');

  // All games should be ready (no DAG dependencies)
  assert(games.every(g => g.status === 'ready'), 'all games ready');

  // Each team should play every other team exactly once
  const matchups = new Set();
  for (const game of games) {
    const pair = [game.teams[0].teamId, game.teams[1].teamId].sort().join('|');
    assert(!matchups.has(pair), `unique matchup: ${pair}`);
    matchups.add(pair);
  }
  assertEq(matchups.size, 6, '6 unique matchups');

  // Play all
  const t = makeTournament(teams, 'round_robin', games, defaultGameOrder);
  for (const game of games) {
    completeGame(t, game.id, 0, `match-${game.id}`, [5, 3]);
  }
  assert(isTournamentComplete(t), 'RR complete');

  const rankings = computeFinalRankings(t);
  assertEq(rankings.length, 4, 'all teams ranked');
}

// ===========================================================================
console.log('\n=== Round Robin — 5 teams (odd) ===');
// ===========================================================================

{
  const teams = makeTeams(5);
  const { games } = generateRoundRobinSchedule(teams);

  // 5 teams: 5*4/2 = 10 games
  assertEq(games.length, 10, '5 teams → 10 RR games');

  // Each team plays 4 games
  const gameCounts = new Map();
  for (const team of teams) gameCounts.set(team.id, 0);
  for (const game of games) {
    gameCounts.set(game.teams[0].teamId, gameCounts.get(game.teams[0].teamId) + 1);
    gameCounts.set(game.teams[1].teamId, gameCounts.get(game.teams[1].teamId) + 1);
  }
  for (const [tid, count] of gameCounts) {
    assertEq(count, 4, `team ${tid} plays 4 games`);
  }
}

// ===========================================================================
console.log('\n=== Engine — completeGame errors ===');
// ===========================================================================

{
  const teams = makeTeams(4);
  const { games, defaultGameOrder } = generateSingleElimBracket(teams);
  const t = makeTournament(teams, 'single_elim', games, defaultGameOrder);
  initializeBracket(t);

  assertThrows(() => completeGame(t, 'nonexistent', 0, 'm', [5, 0]), 'throws on bad game ID');
  assertThrows(() => completeGame(t, 'f', 0, 'm', [5, 0]), 'throws on not-ready game');
  assertThrows(() => completeGame(t, 'r1-g1', 2, 'm', [5, 0]), 'throws on bad winnerIndex');

  completeGame(t, 'r1-g1', 0, 'm', [5, 0]);
  assertThrows(() => completeGame(t, 'r1-g1', 0, 'm2', [5, 0]), 'throws on already completed');
}

// ===========================================================================
console.log('\n=== Engine — getNextDefaultGame ===');
// ===========================================================================

{
  const teams = makeTeams(4);
  const { games, defaultGameOrder } = generateSingleElimBracket(teams);
  const t = makeTournament(teams, 'single_elim', games, defaultGameOrder);
  initializeBracket(t);

  const next = getNextDefaultGame(t);
  assertEq(next.id, 'r1-g1', 'first default game is r1-g1');

  completeGame(t, 'r1-g1', 0, 'm1', [5, 0]);
  const next2 = getNextDefaultGame(t);
  assertEq(next2.id, 'r1-g2', 'next default game after r1-g1');
}

// ===========================================================================
console.log('\n=== Rankings — Single Elim ===');
// ===========================================================================

{
  const teams = makeTeams(8);
  const { games, defaultGameOrder } = generateSingleElimBracket(teams);
  const t = makeTournament(teams, 'single_elim', games, defaultGameOrder);
  initializeBracket(t);
  playAllSingleElim(t);

  const rankings = computeFinalRankings(t);

  // Seed 1 always won → champion
  assertEq(rankings[0].teamId, 't1', 'seed 1 is champion');
  assertEq(rankings[0].wins, 3, 'champion has 3 wins');
  assertEq(rankings[0].losses, 0, 'champion has 0 losses');

  // Finalist (lost the final to seed 1) should have 2 wins
  assertEq(rankings[1].wins, 2, 'finalist has 2 wins');
}

// ===========================================================================
console.log('\n=== Rankings — Round Robin with goal diff tiebreaker ===');
// ===========================================================================

{
  const teams = makeTeams(3);
  const { games, defaultGameOrder } = generateRoundRobinSchedule(teams);
  const t = makeTournament(teams, 'round_robin', games, defaultGameOrder);

  // Circular wins: t1 beats t2, t2 beats t3, t3 beats t1
  // But with different scores for goal diff
  for (const game of games) {
    const t0 = game.teams[0].teamId;
    const t1id = game.teams[1].teamId;
    if ((t0 === 't1' && t1id === 't2') || (t0 === 't2' && t1id === 't1')) {
      const winner = t0 === 't1' ? 0 : 1;
      const score = t0 === 't1' ? [5, 1] : [1, 5]; // t1 scores 5, t2 scores 1
      completeGame(t, game.id, winner, `m-${game.id}`, score);
    } else if ((t0 === 't2' && t1id === 't3') || (t0 === 't3' && t1id === 't2')) {
      const winner = t0 === 't2' ? 0 : 1;
      const score = t0 === 't2' ? [5, 3] : [3, 5]; // t2 scores 5, t3 scores 3
      completeGame(t, game.id, winner, `m-${game.id}`, score);
    } else {
      const winner = t0 === 't3' ? 0 : 1;
      const score = t0 === 't3' ? [5, 4] : [4, 5]; // t3 scores 5, t1 scores 4
      completeGame(t, game.id, winner, `m-${game.id}`, score);
    }
  }

  const rankings = computeFinalRankings(t);
  // All teams have 1 win, 1 loss. Tiebreak by goal diff:
  // t1: +4 (beat t2 5-1) -1 (lost to t3 4-5) = +3
  // t2: +2 (beat t3 5-3) -4 (lost to t1 1-5) = -2
  // t3: +1 (beat t1 5-4) -2 (lost to t2 3-5) = -1
  assertEq(rankings[0].teamId, 't1', 'best goal diff is t1');
  assertEq(rankings[2].teamId, 't2', 'worst goal diff is t2');
}

// ===========================================================================
console.log('\n=== Single Elimination — 10 teams ===');
// ===========================================================================

{
  const teams = makeTeams(10);
  const { games } = generateSingleElimBracket(teams);

  // bracketSize=16, so 15 games
  assertEq(games.length, 15, '10 teams in bracket of 16 → 15 games');

  const t = makeTournament(teams, 'single_elim', games, games.map(g => g.id));
  initializeBracket(t);

  const byes = t.games.filter(g => g.isBye);
  assertEq(byes.length, 6, '6 byes for 10 teams in 16-bracket');

  playAllSingleElim(t);
  assert(isTournamentComplete(t), '10-team SE completes');
}

// ===========================================================================
console.log('\n=== Double Elimination — GF Reset ===');
// ===========================================================================

{
  const teams = makeTeams(4);
  const { games, defaultGameOrder } = generateDoubleElimBracket(teams, { grandFinalReset: true });

  const gfReset = games.find(g => g.id === 'gf-reset');
  assert(gfReset != null, 'GF reset game exists');
  assertEq(gfReset.roundName, 'Grand Final Reset', 'correct name');
  assert(games.length === 7, '4-team DE with reset → 7 games');
}

// ===========================================================================
// uncompleteGame & downstream helpers
// ===========================================================================

console.log(`\n=== uncompleteGame — 4-team Single Elim ===`);
{
  const teams = makeTeams(4);
  const { games, defaultGameOrder } = generateSingleElimBracket(teams, {});
  const t = makeTournament(teams, 'single_elim', games, defaultGameOrder);
  initializeBracket(t);

  // Play first semifinal: t1 beats t4
  const sf1 = getGameById(t, 'r1-g1');
  assert(sf1.status === 'ready', 'SF1 is ready');
  completeGame(t, 'r1-g1', 0, 'match-1', [6, 3]);

  // Check downstream of r1-g1 is the final
  const downstream = getDownstreamGames(t, 'r1-g1');
  assert(downstream.length === 1, 'SF1 has 1 downstream game');
  assertEq(downstream[0].game.id, 'f', 'downstream game is the final');

  // No completed downstream yet
  assertEq(hasCompletedDownstream(t, 'r1-g1'), false, 'no completed downstream after SF1');

  // Uncomplete should work
  uncompleteGame(t, 'r1-g1');
  assertEq(sf1.status, 'ready', 'SF1 back to ready after uncomplete');
  assertEq(sf1.result, null, 'SF1 result cleared');

  // Final should have lost team0 assignment
  const final_ = getGameById(t, 'f');
  assertEq(final_.teams[0].teamId, null, 'final team0 cleared after uncomplete');
  assertEq(final_.status, 'waiting', 'final back to waiting');

  // Re-complete with different winner: t4 beats t1
  completeGame(t, 'r1-g1', 1, 'match-1b', [3, 6]);
  assertEq(final_.teams[0].teamId, 't4', 'final team0 is now t4 (new winner)');
}

console.log(`\n=== uncompleteGame — blocks when downstream completed ===`);
{
  const teams = makeTeams(4);
  const { games, defaultGameOrder } = generateSingleElimBracket(teams, {});
  const t = makeTournament(teams, 'single_elim', games, defaultGameOrder);
  initializeBracket(t);

  // Play both semis and the final
  completeGame(t, 'r1-g1', 0, 'm1', [6, 3]);
  completeGame(t, 'r1-g2', 0, 'm2', [6, 2]);
  completeGame(t, 'f', 0, 'm3', [6, 4]);

  // Now SF1 has completed downstream (the final)
  assertEq(hasCompletedDownstream(t, 'r1-g1'), true, 'SF1 has completed downstream');

  // Uncomplete should throw
  assertThrows(() => uncompleteGame(t, 'r1-g1'), 'cannot uncomplete SF1 with completed final');

  // But uncompleting the final itself should work
  uncompleteGame(t, 'f');
  assertEq(getGameById(t, 'f').status, 'ready', 'final back to ready');
  assertEq(t.state, 'in_progress', 'tournament back to in_progress');
}

console.log(`\n=== uncompleteGame — double elim cascade ===`);
{
  const teams = makeTeams(4);
  const { games, defaultGameOrder } = generateDoubleElimBracket(teams, {});
  const t = makeTournament(teams, 'double_elim', games, defaultGameOrder);
  initializeBracket(t);

  // Play WB SF1
  completeGame(t, 'wb-r1-g1', 0, 'de-m1', [6, 2]);

  // The loser should have propagated to LB
  const lbGames = t.games.filter(g => g.bracket === 'losers');
  const lbWithTeam = lbGames.find(g => g.teams.some(team => team.teamId === 't4'));
  assert(lbWithTeam != null, 'loser t4 cascaded to losers bracket');

  // Uncomplete WB SF1
  uncompleteGame(t, 'wb-r1-g1');
  const wbSf1 = getGameById(t, 'wb-r1-g1');
  assertEq(wbSf1.status, 'ready', 'WB SF1 back to ready');

  // LB game should have lost the team assignment
  const lbAfter = t.games.filter(g => g.bracket === 'losers' && g.teams.some(team => team.teamId === 't4'));
  assertEq(lbAfter.length, 0, 'loser t4 cleared from losers bracket');
}

console.log(`\n=== getDownstreamGames — no downstream for final ===`);
{
  const teams = makeTeams(4);
  const { games, defaultGameOrder } = generateSingleElimBracket(teams, {});
  const t = makeTournament(teams, 'single_elim', games, defaultGameOrder);
  initializeBracket(t);

  const downstream = getDownstreamGames(t, 'f');
  assertEq(downstream.length, 0, 'final has no downstream');
}

// ===========================================================================
console.log('\n=== Double Round Robin — 4 teams ===');
// ===========================================================================

{
  const teams = makeTeams(4);
  const { games, defaultGameOrder } = generateDoubleRoundRobinSchedule(teams);

  // 4 teams: each pair plays twice → 4*3/2 * 2 = 12 games
  assertEq(games.length, 12, '4 teams → 12 DRR games');
  assertEq(defaultGameOrder.length, 12, '12 games in order');

  // All games should be ready
  assert(games.every(g => g.status === 'ready'), 'all DRR games ready');

  // Each pair should appear exactly twice
  const matchupCounts = new Map();
  for (const game of games) {
    const pair = [game.teams[0].teamId, game.teams[1].teamId].sort().join('|');
    matchupCounts.set(pair, (matchupCounts.get(pair) || 0) + 1);
  }
  assertEq(matchupCounts.size, 6, '6 unique pairs');
  for (const [pair, count] of matchupCounts) {
    assertEq(count, 2, `${pair} plays exactly twice`);
  }

  // Each team plays 6 games (3 opponents × 2)
  for (const team of teams) {
    const count = games.filter(g =>
      g.teams[0].teamId === team.id || g.teams[1].teamId === team.id
    ).length;
    assertEq(count, 6, `${team.name} plays 6 games`);
  }

  // Second half should have swapped team order compared to first half
  const firstHalf = games.slice(0, 6);
  const secondHalf = games.slice(6);
  for (let i = 0; i < firstHalf.length; i++) {
    assertEq(secondHalf[i].teams[0].teamId, firstHalf[i].teams[1].teamId,
      `game ${i}: second half team0 = first half team1`);
    assertEq(secondHalf[i].teams[1].teamId, firstHalf[i].teams[0].teamId,
      `game ${i}: second half team1 = first half team0`);
  }

  // Play all and verify completion + rankings
  const t = makeTournament(teams, 'double_round_robin', games, defaultGameOrder);
  for (const game of games) {
    completeGame(t, game.id, 0, `match-${game.id}`, [5, 3]);
  }
  assert(isTournamentComplete(t), 'DRR complete');

  const rankings = computeFinalRankings(t);
  assertEq(rankings.length, 4, 'all teams ranked in DRR');
}

// ===========================================================================
console.log('\n=== Double Round Robin — 3 teams (odd) ===');
// ===========================================================================

{
  const teams = makeTeams(3);
  const { games } = generateDoubleRoundRobinSchedule(teams);

  // 3 teams: 3*2/2 * 2 = 6 games
  assertEq(games.length, 6, '3 teams → 6 DRR games');

  // Each team plays 4 games
  for (const team of teams) {
    const count = games.filter(g =>
      g.teams[0].teamId === team.id || g.teams[1].teamId === team.id
    ).length;
    assertEq(count, 4, `${team.name} plays 4 games`);
  }
}

// ===========================================================================
console.log('\n=== Double Round Robin — 5 teams (odd) ===');
// ===========================================================================

{
  const teams = makeTeams(5);
  const { games } = generateDoubleRoundRobinSchedule(teams);

  // 5 teams: 5*4/2 * 2 = 20 games
  assertEq(games.length, 20, '5 teams → 20 DRR games');

  // Each team plays 8 games (4 opponents × 2)
  for (const team of teams) {
    const count = games.filter(g =>
      g.teams[0].teamId === team.id || g.teams[1].teamId === team.id
    ).length;
    assertEq(count, 8, `${team.name} plays 8 games`);
  }
}

// ===========================================================================
console.log('\n=== Double Round Robin — validation ===');
// ===========================================================================

{
  const result = validateTournamentSetup(
    [{ id: 't1', name: 'A', players: ['p1', 'p2'] }, { id: 't2', name: 'B', players: ['p3', 'p4'] }],
    'double_round_robin',
    {}
  );
  assert(result.valid, 'double_round_robin is a valid format');

  const bad = validateTournamentSetup(
    [{ id: 't1', name: 'A', players: ['p1'] }],
    'double_round_robin',
    {}
  );
  assert(!bad.valid, 'DRR with 1 team is invalid');
}

// ===========================================================================
console.log('\n=== estimateGameCount — correctness and edge cases ===');
// ===========================================================================

{
  // Extracted estimateGameCount logic for testing
  function estimateGameCount(numTeams, format, config = {}) {
    if (numTeams < 2) return 0;
    switch (format) {
      case 'single_elim':
        return numTeams - 1;
      case 'double_elim': {
        const total = 2 * numTeams - 2 + 1;
        return config.grandFinalReset ? total + 1 : total;
      }
      case 'swiss': {
        const rounds = config.swissRounds || Math.ceil(Math.log2(numTeams));
        return Math.floor(numTeams / 2) * rounds;
      }
      case 'round_robin':
        return numTeams * (numTeams - 1) / 2;
      case 'double_round_robin':
        return numTeams * (numTeams - 1);
      default:
        return '?';
    }
  }

  // Edge cases that previously returned negative
  assertEq(estimateGameCount(0, 'single_elim'), 0, 'SE 0 teams → 0 (not negative)');
  assertEq(estimateGameCount(1, 'single_elim'), 0, 'SE 1 team → 0');
  assertEq(estimateGameCount(0, 'double_elim'), 0, 'DE 0 teams → 0 (not negative)');
  assertEq(estimateGameCount(1, 'double_elim'), 0, 'DE 1 team → 0');
  assertEq(estimateGameCount(0, 'round_robin'), 0, 'RR 0 teams → 0');
  assertEq(estimateGameCount(0, 'double_round_robin'), 0, 'DRR 0 teams → 0');

  // Normal cases
  assertEq(estimateGameCount(4, 'single_elim'), 3, 'SE 4 teams → 3');
  assertEq(estimateGameCount(8, 'single_elim'), 7, 'SE 8 teams → 7');
  assertEq(estimateGameCount(4, 'double_elim'), 7, 'DE 4 teams → 7');
  assertEq(estimateGameCount(4, 'double_elim', { grandFinalReset: true }), 8, 'DE 4 teams + reset → 8');
  assertEq(estimateGameCount(4, 'swiss'), 4, 'Swiss 4 teams → 4 (2 rounds)');
  assertEq(estimateGameCount(4, 'swiss', { swissRounds: 3 }), 6, 'Swiss 4 teams 3 rounds → 6');
  assertEq(estimateGameCount(4, 'round_robin'), 6, 'RR 4 teams → 6');
  assertEq(estimateGameCount(5, 'round_robin'), 10, 'RR 5 teams → 10');
  assertEq(estimateGameCount(4, 'double_round_robin'), 12, 'DRR 4 teams → 12');
  assertEq(estimateGameCount(5, 'double_round_robin'), 20, 'DRR 5 teams → 20');

  // All estimates must be non-negative for any valid team count
  for (let n = 0; n <= 16; n++) {
    for (const fmt of ['single_elim', 'double_elim', 'swiss', 'round_robin', 'double_round_robin']) {
      const count = estimateGameCount(n, fmt);
      assert(count >= 0, `estimateGameCount(${n}, '${fmt}') = ${count} ≥ 0`);
    }
  }
}

// ===========================================================================
// Summary
// ===========================================================================

console.log(`\n${'='.repeat(60)}`);
console.log(`Tournament Engine Tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(60)}`);

if (failed > 0) process.exit(1);
