import './styles.css'; // Global styles

// Import services and display functions
import { showPlayerModal } from './modal-handler.js';
import { initializePlayerManager } from './player-manager.js';
import { setOnPlayerClick, initializeLeaderboardDisplay } from './leaderboard-display.js';
import { initializeRecentMatchesDisplay } from './recent-matches-display.js';
import { suggestPairing } from './pairing-service.js';
import { setupMatchForm } from './match-form-handler.js';
import { showPlayerStats } from './player-stats-component.js';
import { initializeMatchesData, resetMatchDataListener, refreshSeasonStats } from './match-data-service.js';
import { PAUSE_DATES, PAUSE_MESSAGE, PAUSE_IMAGE_PATH } from './constants.js';
import { getSelectedSeason } from './season-service.js';
import { initializeNotifications } from './notification-service.js';
import { initializeActivityHeatmap } from './activity-heatmap.js';
import { initializeTournamentUI } from './tournament/tournament-ui.js';
import { handleRedirect, initSpotifyUI } from './audio/spotify-client.js';
import { initDevMenu } from './dev-menu.js';

import { auth } from './firebase-service.js';
import { onAuthStateChanged, signInWithEmailAndPassword, setPersistence, browserLocalPersistence, signOut } from 'firebase/auth';
import {initializePlayersData, resetPlayerDataListener} from "./player-data-service.js";

// --- App State ---
// This will hold the unsubscribe functions for our listeners
let activeListeners = [];
let isAppOnline = false;
const SHARED_EMAIL = 'apps.imagirom@gmail.com';

/**
 * Checks if today is a pause day.
 * @returns {boolean} True if the app should be paused today
 */
function isPauseDay() {
    const today = new Date();
    const todayString = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    return PAUSE_DATES.includes(todayString);
}

/**
 * Shows the pause overlay and hides the main content.
 */
function showPauseScreen() {
    const pauseOverlay = document.getElementById('pauseOverlay');
    const pauseMessageElement = document.getElementById('pauseMessage');
    const pauseImageElement = document.getElementById('pauseImage');
    
    pauseMessageElement.textContent = PAUSE_MESSAGE;
    pauseImageElement.src = PAUSE_IMAGE_PATH;
    pauseOverlay.style.display = 'flex';
    
    // Hide the main content
    document.body.classList.add('paused');
}

/**
 * Hides the pause overlay and shows the main content.
 */
function hidePauseScreen() {
    const pauseOverlay = document.getElementById('pauseOverlay');
    pauseOverlay.style.display = 'none';
    document.body.classList.remove('paused');
}

/**
 * Attaches all Firestore listeners and initializes UI components.
 * This function is called ONLY when we have a valid user.
 */
function goOnline() {
    if (isAppOnline) return; // Prevent running if already online
    console.log("App is going online: attaching listeners.");
    isAppOnline = true;

    // Start the data services and store their unsubscribe functions
    activeListeners.push(initializeMatchesData());
    activeListeners.push(initializePlayersData());

    // Initialize the UI components that depend on that data
    initializeLeaderboardDisplay();
    initializeRecentMatchesDisplay();
    initializeActivityHeatmap();
    initializePlayerManager();
    initializeNotifications();
    initializeTournamentUI();
}

/**
 * Detaches all Firestore listeners.
 * This is called when the user signs out or the connection is lost.
 */
function goOffline() {
    if (!isAppOnline) return;
    console.log("App is going offline: detaching listeners.");
    isAppOnline = false;

    // Call each unsubscribe function
    activeListeners.forEach(unsubscribe => unsubscribe());

    // Clear the array for the next session
    activeListeners = [];

    // Reset data listeners so they can be re-initialized
    resetMatchDataListener();
    resetPlayerDataListener();
}

function showPasswordGate(message = '') {
    const gate = document.getElementById('passwordGate');
    const error = document.getElementById('passwordError');
    if (error) error.textContent = message;
    if (gate) gate.style.display = 'flex';
}

function hidePasswordGate() {
    const gate = document.getElementById('passwordGate');
    if (gate) gate.style.display = 'none';
}

function setupPasswordGate() {
    const passwordInput = document.getElementById('passwordInput');
    const passwordSubmit = document.getElementById('passwordSubmit');
    const error = document.getElementById('passwordError');
    if (!passwordInput || !passwordSubmit) return;

    const attemptSignIn = async () => {
        const password = passwordInput.value;
        if (!password) {
            if (error) error.textContent = 'Please enter the password.';
            return;
        }
        if (error) error.textContent = '';
        try {
            await signInWithEmailAndPassword(auth, SHARED_EMAIL, password);
            passwordInput.value = '';
        } catch (signInError) {
            console.error('Password sign-in failed:', signInError);
            if (error) error.textContent = 'Incorrect password.';
        }
    };

    passwordSubmit.addEventListener('click', attemptSignIn);
    passwordInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            attemptSignIn();
        }
    });
}

// --- Main Application Logic ---

// Check if today is a pause day
if (isPauseDay()) {
    console.log("Today is a pause day. Showing pause screen.");
    showPauseScreen();
} else {
    hidePauseScreen();
    handleRedirect(); // exchange ?code= for Spotify tokens, then clean the URL
        setupPasswordGate();
        setPersistence(auth, browserLocalPersistence).catch((error) => {
                console.warn('Failed to set auth persistence:', error);
        });
    
    // onAuthStateChanged is the central controller for the app's online/offline state.
        onAuthStateChanged(auth, async (user) => {
            console.log('[auth] state changed:', {
                hasUser: Boolean(user),
                email: user?.email ?? null,
                isAnonymous: user?.isAnonymous ?? null
            });
            if (!user) {
                goOffline();
                showPasswordGate();
                return;
            }

            let providerId = null;
            try {
                const tokenResult = await user.getIdTokenResult(true);
                providerId = tokenResult?.signInProvider ?? null;
                console.log('[auth] token provider:', providerId);
            } catch (error) {
                console.warn('[auth] failed to refresh token:', error);
            }

            if (user.isAnonymous || (user.email && user.email !== SHARED_EMAIL) || providerId === 'anonymous') {
                signOut(auth).catch((error) => {
                    console.warn('Failed to sign out non-shared user:', error);
                });
                goOffline();
                showPasswordGate();
                return;
            }

            try {
                goOffline();
                goOnline();
                hidePasswordGate();
            } catch (error) {
                console.warn('Failed to refresh auth token:', error);
                signOut(auth).catch((signOutError) => {
                    console.warn('Failed to sign out after token error:', signOutError);
                });
                goOffline();
                showPasswordGate('Please re-enter the password.');
            }
        });

    // Setup event listeners for global actions
    document.getElementById('btnSuggest').onclick = () => {
        showPlayerModal(suggestPairing); // Pass the suggestPairing function as a callback
    };

    // Player click handler for the leaderboard
    const clickPlayer = (playerName) => {
        console.log(`Player clicked: ${playerName}`);
        showPlayerStats(playerName);
    };
    setOnPlayerClick(clickPlayer);

    window.addEventListener('season-changed', (event) => {
        const season = event.detail?.season ?? getSelectedSeason();
        refreshSeasonStats(season);
    });

    // Setup match form submission
    setupMatchForm();
    initSpotifyUI();
    initDevMenu();
}

// Football animation logic
window.onload = async () => {
    // initializePlayerManager();
    // initializeLeaderboardDisplay();
    // initializeRecentMatchesDisplay();
    // console.log("Page loaded and initialized.");

    const football = document.getElementById('football');
    football.style.animation = 'flyIn 2s ease-out forwards';
    football.addEventListener('animationend', function () {
        football.style.animation = '';
    }, { once: true });
};

document.getElementById('football').addEventListener('click', function () {
    const football = this;
    football.style.animation = 'spin 2s ease-in-out forwards';
    football.addEventListener('animationend', function () {
        football.style.animation = '';
    }, { once: true });
});

// Leaderboard options toggle
document.getElementById('leaderboardOptionsToggle').addEventListener('click', function () {
    const optionsPanel = document.getElementById('leaderboardOptions');
    optionsPanel.classList.toggle('collapsed');
    this.classList.toggle('rotated');
});
