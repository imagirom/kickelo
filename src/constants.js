// src/constants.js

// Game configuration
export const MAX_GOALS = 5;

// ELO rating system configuration
export const STARTING_ELO = 1500;
export const ELO_K_FACTOR = 40;  // K-factor determines how much ratings change per game
export const ELO_RATING_SCALE = 400;  // Scale factor in the ELO formula (standard is 400)

// Player activity threshold (in days)
export const INACTIVE_THRESHOLD_DAYS = 14;  // Players inactive for 2 weeks

// Session configuration
export const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes in ms

// Badge / emoji configuration
export const BADGE_THRESHOLDS = Object.freeze({
	medic: {
		lookbackDays: 7,
		minUniqueTeammates: 3,
		teammateLossStreakLength: 3,
	},
	rollercoaster: {
		minLeadChanges: 3,
	},
	chillComeback: {
		requireFinalScore: '5:4',
	},
	gardener: {
		requiredWeekdays: 5,
	},
	goldenPhi: {
		minWins: 5,
	},
});


// Cake team: when these two players are on the same winning team, everyone gets cake 🎂
export const CAKE_TEAM = Object.freeze(['Sarah', 'Simon']);

// Badge registry: every leaderboard emoji, in collection order. Drives the emoji tally
// (player-stats-batch.js), the player page's collection and the main page's emoji stats.
//   kind: 'event'  - earned by a single match, counted once per match
//         'points' - earned by a single match, counts the number it shows (points)
//         'streak' - counted once per level reached from minLength on (a 5-win 🔥 streak = 3), plus the max length
//         'state'  - counted once per day on which it was (newly) earned, see status-emojis.md
//         'medal'  - counted once per completed tournament
//   introducedAt: first day the badge could be earned (from git history, see status-emojis.md);
//                 awards from earlier matches are not counted.
export const BADGE_INFO = Object.freeze({
	'🔥': { name: 'Win streak', kind: 'streak', minLength: 3, introducedAt: '2025-08-05', rule: 'Win 3 or more matches in a row.' },
	'🐍': { name: 'Snake', kind: 'streak', minLength: 7, introducedAt: '2025-11-19', rule: 'Alternate wins and losses for 7 or more matches.' },
	'🧱': { name: 'Wall', kind: 'streak', minLength: 3, introducedAt: '2026-03-17', rule: 'Concede at most one goal as defender in 3 or more games in a row.' },
	'φ': { name: 'Golden streak', kind: 'streak', minLength: BADGE_THRESHOLDS.goldenPhi.minWins, introducedAt: '2025-11-23', rule: `Win 5:4 ${BADGE_THRESHOLDS.goldenPhi.minWins} times without a 4:5 loss in between.` },
	'🧗': { name: 'Climber', kind: 'streak', minLength: 3, introducedAt: '2025-11-19', rule: 'Gain Elo on 3 or more played days in a row.' },
	'⛰': { name: 'Summit', kind: 'state', introducedAt: '2025-11-19', rule: 'Reach a new personal Elo peak above the starting Elo.' },
	'👑': { name: 'Record holder', kind: 'state', introducedAt: '2025-11-19', rule: 'Set the highest Elo anyone has reached in the season (above 1600).' },
	'🐦‍🔥': { name: 'Phoenix', kind: 'state', introducedAt: '2025-11-19', rule: 'Win back more Elo in a day than you lost on your previous played day.' },
	'🩹': { name: 'Medic', kind: 'state', introducedAt: '2025-11-23', rule: 'Win with 3 different teammates who were on a 3+ loss streak, within 7 days.' },
	'🌊': { name: 'Streak breaker', kind: 'points', introducedAt: '2025-11-19', rule: 'Beat an opponent on a 5+ win streak. One point per streaking opponent.' },
	'🐕': { name: 'Underdog', kind: 'points', introducedAt: '2025-11-19', rule: 'Win against a team rated 100+ Elo higher. One point per 100 Elo.' },
	'🪃': { name: 'Boomerang', kind: 'points', introducedAt: '2025-11-19', rule: 'Win after trailing by 2+ goals. Points = the biggest deficit erased.' },
	'📄': { name: 'Clean sheet', kind: 'event', introducedAt: '2025-11-19', rule: 'Win 5:0.' },
	'🎩': { name: 'Hat trick', kind: 'event', introducedAt: '2026-03-20', rule: 'Win with 3 goals in a row within 40 seconds.' },
	'☕': { name: 'Coffee break', kind: 'event', introducedAt: '2025-11-23', rule: 'Win a match that took 2:30 minutes or less.' },
	'🎢': { name: 'Rollercoaster', kind: 'event', introducedAt: '2025-11-23', rule: `Win a match in which the lead changed ${BADGE_THRESHOLDS.rollercoaster.minLeadChanges}+ times.` },
	'🐧': { name: 'Chill comeback', kind: 'event', introducedAt: '2025-11-23', rule: 'Win 5:4 after trailing the whole match.' },
	'🎂': { name: 'Cake', kind: 'event', introducedAt: '2026-03-20', rule: `${CAKE_TEAM.join(' and ')} win together: everyone playing or waiting gets cake.` },
	'🥇': { name: 'Gold medal', kind: 'medal', introducedAt: '2026-04-10', rule: 'Win a tournament.' },
	'🥈': { name: 'Silver medal', kind: 'medal', introducedAt: '2026-04-10', rule: 'Finish second in a tournament.' },
	'🥉': { name: 'Bronze medal', kind: 'medal', introducedAt: '2026-04-10', rule: 'Finish third in a tournament.' },
	'⚽': { name: 'Participant', kind: 'medal', introducedAt: '2026-04-10', rule: 'Play in a tournament without reaching the podium.' },
});

// Tournament badge configuration
export const TOURNAMENT_BADGE_DURATION_DAYS = 7;

// Match editing configuration
export const MATCH_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_EDITABLE_MATCHES = 10; // Only the N most recent matches can be edited

// Pause configuration
// Set specific dates when the ELO system should be paused
// Format: 'YYYY-MM-DD' (e.g., '2025-12-25' for Christmas)
export const PAUSE_DATES = [
	// '2025-12-09',
];

export const PAUSE_MESSAGE = "The ELO system is taking a break today!";
export const PAUSE_IMAGE_PATH = "assets/pause_image.jpeg";
