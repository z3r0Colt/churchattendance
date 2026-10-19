import { initializeApp } from "firebase/app";
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  initializeAuth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  clearIndexedDbPersistence,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { staffWeb } from "../platform";
export const emulators =
  import.meta.env.VITE_USE_EMULATORS === "true" || import.meta.env.DEV;
export const configured =
  emulators || !!import.meta.env.VITE_FIREBASE_PROJECT_ID;
const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "demo-key",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    "demo-sycamore.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-sycamore",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "demo-sycamore.appspot.com",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "demo-app",
});
// The staff web keeps its sign-in to this tab and its records in memory, so a shared or
// borrowed browser holds nothing after the tab closes. The desktop keeps the persistent roll-call cache.
export const auth = staffWeb
  ? initializeAuth(app, { persistence: browserSessionPersistence })
  : getAuth(app);
export const db = initializeFirestore(app, {
  localCache: staffWeb
    ? memoryLocalCache()
    : persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
});
// One-time upgrade from the old direct private-record subscriptions. Fail closed if another tab holds the cache open.
export const privateCacheReady =
  staffWeb || localStorage.getItem("private-cache-version") === "7"
    ? Promise.resolve()
    : clearIndexedDbPersistence(db).then(() =>
        localStorage.setItem("private-cache-version", "7"),
      );
export const functions = getFunctions(app, "us-central1");
export const storage = getStorage(app);
if (emulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
