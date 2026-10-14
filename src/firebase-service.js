import { initializeApp } from 'firebase/app';
import { getAnalytics } from "firebase/analytics";
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    getFirestore,
    collection,
    doc,
    addDoc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    query,
    where,
    orderBy,
    limit,
    connectFirestoreEmulator,
    onSnapshot,
    runTransaction,
    serverTimestamp,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getStorage, ref as storageRef, connectStorageEmulator } from 'firebase/storage';


const firebaseConfig = {
  apiKey: "AIzaSyBHGbErkiS33J_h5Xoanzhl6rC7yWo1R08",
  authDomain: "kickelo.firebaseapp.com",
  projectId: "kickelo",
  storageBucket: "kickelo.firebasestorage.app",
  messagingSenderId: "1075750769009",
  appId: "1:1075750769009:web:8a8b02540be5c9522be6d0",
  measurementId: "G-8V6P1V4Z4G"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Use multi-tab IndexedDb persistence.
initializeFirestore(app,
  {localCache:
    persistentLocalCache(/*settings*/{tabManager: persistentMultipleTabManager()})
  }
);

const db = getFirestore(app);

const auth = getAuth(app);
const functions = getFunctions(app);
const storage = getStorage(app);

if (import.meta.env.DEV) {
    // Firestore emulator
    connectFirestoreEmulator(db, '127.0.0.1', Number(import.meta.env.VITE_FIRESTORE_PORT || 7070));
    // Auth emulator
    connectAuthEmulator(auth, `http://127.0.0.1:${import.meta.env.VITE_AUTH_PORT || 9099}`);
    connectFunctionsEmulator(functions, '127.0.0.1', Number(import.meta.env.VITE_FUNCTIONS_PORT || 5001));
    // Storage emulator
    // connectStorageEmulator(storage, '127.0.0.1', 9199);
}

// Export db and all necessary Firestore functions
export {
    db,
    functions,
    httpsCallable,
    collection,
    doc,
    addDoc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    runTransaction,
    serverTimestamp,
    auth,
    storage,
    storageRef
};