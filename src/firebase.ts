import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);

export const auth: Auth | null = isFirebaseConfigured
  ? getAuth(getApps().length ? getApp() : initializeApp(config))
  : null;

export const app = isFirebaseConfigured ? getApp() : null;
export const db: Firestore | null = app ? getFirestore(app) : null;
export const functions: Functions | null = app ? getFunctions(app) : null;
export const useFirebaseEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';

if (useFirebaseEmulators && auth && db && functions) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export const authPersistence = auth
  ? setPersistence(auth, browserLocalPersistence)
  : Promise.resolve();
