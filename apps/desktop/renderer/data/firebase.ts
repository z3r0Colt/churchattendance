import { initializeApp } from "firebase/app";
import { firebaseDeployment } from "@sycamore/shared";
import {
  browserSessionPersistence,
  connectAuthEmulator,
  initializeAuth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  clearIndexedDbPersistence,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { emulators, staffWeb } from "../platform";
export const configured =
  emulators || !!import.meta.env.VITE_FIREBASE_PROJECT_ID;
const app = initializeApp(firebaseDeployment(import.meta.env, emulators, staffWeb ? location.origin : undefined));
// Browser session restoration may retain this session. Explicit sign-out is required on shared devices.
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
export const db = initializeFirestore(app, { localCache: memoryLocalCache() });
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
