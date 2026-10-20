import { initializeApp } from "firebase/app";
import { firebaseDeployment } from "@sycamore/shared";
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
import { emulators, staffWeb } from "../platform";
export const configured =
  emulators || !!import.meta.env.VITE_FIREBASE_PROJECT_ID;
const app = initializeApp(firebaseDeployment(import.meta.env, emulators, staffWeb ? location.origin : undefined));
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
  staffWeb || localStorage.getItem("private-cache-version") === "8"
    ? Promise.resolve()
    : clearIndexedDbPersistence(db).then(() =>
        localStorage.setItem("private-cache-version", "8"),
      );
export const functions = getFunctions(app, "us-central1");
export const storage = getStorage(app);
if (emulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
