import { getMessaging, getToken, deleteToken, onMessage, isSupported } from 'firebase/messaging';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from './firebase-service.js';
import { auth, db } from './firebase-service.js';
import { notifyOnMatchCheckbox } from './dom-elements.js';
import { serverTimestamp, deleteField } from 'firebase/firestore';
import { showToast } from './toast.js';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
let initialized = false;
let currentToken = null;
let messagingInstance = null;
let suppressToggle = false;
let unsubscribeUserDoc = null;

async function getMessagingInstance() {
    if (messagingInstance) return messagingInstance;
    const supported = await isSupported();
    if (!supported) return null;
    messagingInstance = getMessaging();
    return messagingInstance;
}

function getUserDocRef() {
    const user = auth.currentUser;
    if (!user) return null;
    return doc(db, 'users', user.uid);
}

async function setOptInState(enabled) {
    const userRef = getUserDocRef();
    if (!userRef) return;
    await setDoc(userRef, {
        notificationsEnabled: enabled,
        lastActiveAt: serverTimestamp()
    }, { merge: true });
}

async function storeToken(token) {
    const userRef = getUserDocRef();
    if (!userRef) return;
    await setDoc(userRef, {
        notificationsEnabled: true,
        lastOptInAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
        fcmTokens: {
            [token]: true
        }
    }, { merge: true });
}

async function removeToken(token) {
    const userRef = getUserDocRef();
    if (!userRef) return;
    await updateDoc(userRef, {
        [`fcmTokens.${token}`]: deleteField()
    });
}

function updateCheckboxState(value) {
    if (!notifyOnMatchCheckbox) return;
    suppressToggle = true;
    notifyOnMatchCheckbox.checked = value;
    suppressToggle = false;
}

async function enableNotifications() {
    if (!VAPID_KEY) {
        console.warn('Missing VITE_FIREBASE_VAPID_KEY. Notifications are disabled.');
        updateCheckboxState(false);
        showToast('Notifications are not configured yet. Please set VITE_FIREBASE_VAPID_KEY.', 'warning');
        return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        updateCheckboxState(false);
        await setOptInState(false);
        return;
    }

    const messaging = await getMessagingInstance();
    if (!messaging) {
        updateCheckboxState(false);
        return;
    }

    const swPath = import.meta.env.DEV
        ? '/src/firebase-messaging-sw.js'
        : '/firebase-messaging-sw.js';
    const registration = await navigator.serviceWorker.register(swPath, { type: 'module' });
    const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration
    });

    if (!token) {
        console.warn('FCM token was not generated.');
        updateCheckboxState(false);
        await setOptInState(false);
        return;
    }

    currentToken = token;
    await storeToken(token);
}

async function disableNotifications() {
    await setOptInState(false);
    const messaging = await getMessagingInstance();
    if (messaging && currentToken) {
        try {
            await deleteToken(messaging);
            await removeToken(currentToken);
        } catch (error) {
            console.warn('Failed to delete FCM token:', error);
        }
    }
    currentToken = null;
}

function hasActiveTokens(data) {
    const tokens = data?.fcmTokens || {};
    return Object.keys(tokens).length > 0;
}

function watchUserDoc() {
    const userRef = getUserDocRef();
    if (!userRef || !notifyOnMatchCheckbox) return;
    if (unsubscribeUserDoc) unsubscribeUserDoc();

    unsubscribeUserDoc = onSnapshot(userRef, (snapshot) => {
        if (!snapshot.exists()) {
            updateCheckboxState(false);
            return;
        }
        const data = snapshot.data();
        const enabled = Boolean(data.notificationsEnabled) && hasActiveTokens(data);
        updateCheckboxState(enabled);
    }, (error) => {
        console.warn('Failed to listen to notification preferences:', error);
    });
}

function setupForegroundNotifications() {
    getMessagingInstance().then((messaging) => {
        if (!messaging) return;
        onMessage(messaging, (payload) => {
            const title = payload.notification?.title || 'New match submitted';
            const body = payload.notification?.body || 'Join the session now.';
            if (Notification.permission === 'granted') {
                new Notification(title, { body, icon: '/assets/football.svg' });
            }
        });
    });
}

export async function initializeNotifications() {
    if (initialized) return;
    initialized = true;

    if (!notifyOnMatchCheckbox) {
        return;
    }

    notifyOnMatchCheckbox.disabled = true;

    const supported = await isSupported();
    if (!supported) {
        notifyOnMatchCheckbox.title = 'Notifications are not supported in this browser.';
        return;
    }

    notifyOnMatchCheckbox.disabled = false;
    watchUserDoc();

    notifyOnMatchCheckbox.addEventListener('change', async () => {
        if (suppressToggle) return;
        if (notifyOnMatchCheckbox.checked) {
            await enableNotifications();
        } else {
            await disableNotifications();
        }
    });

    setupForegroundNotifications();
}
