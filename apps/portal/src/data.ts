import { useEffect, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  onIdTokenChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  verifyBeforeUpdateEmail,
} from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import {
  directoryPreferencesSchema,
  memberRsvpSchema,
  onlineFormSchema,
  safeReturnPath,
  type DirectoryEntry,
  type DirectoryPreferences,
  type Occurrence,
} from "@sycamore/shared";
export const local =
  import.meta.env.VITE_USE_EMULATORS === "true" || import.meta.env.DEV;
const app = initializeApp(
  {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "demo-key",
    authDomain:
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
      "demo-sycamore.firebaseapp.com",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-sycamore",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "demo-app",
  },
  "member-portal",
);
export const auth = getAuth(app);
const functions = getFunctions(app, "us-central1");
if (local) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
} else if (import.meta.env.VITE_PORTAL_APP_CHECK_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(
      import.meta.env.VITE_PORTAL_APP_CHECK_SITE_KEY,
    ),
    isTokenAutoRefreshEnabled: true,
  });
}
export const portalConfigured =
  local || !!import.meta.env.VITE_PORTAL_APP_CHECK_SITE_KEY;
export const callPortal = async <T>(
  name: string,
  input: unknown = {},
): Promise<T> => (await httpsCallable<unknown, T>(functions, name)(input)).data;
export type PortalEvent = Occurrence & { description: string; zone: string };
export type MemberProfile = {
  person: { name: string; email: string; phone: string };
  preferences: DirectoryPreferences;
  rsvps: { eventId: string; date: string; status: string }[];
};
export function usePortalAuth() {
  const [user, setUser] = useState(auth.currentUser);
  const [loading, setLoading] = useState(true);
  useEffect(
    () =>
      onIdTokenChanged(auth, (value) => {
        setUser(value);
        setLoading(false);
      }),
    [],
  );
  return { user, loading };
}
export async function signIn(email: string, password: string) {
  await setPersistence(auth, browserSessionPersistence);
  await signInWithEmailAndPassword(auth, email, password);
}
export const signOutPortal = () => signOut(auth);
const linkEmailKey = "sycamore.memberLinkEmail";
// The link returns only to this portal's own origin, which Firebase also
// checks against the project's authorized domains.
export async function requestSignInLink(email: string, returnTo: string) {
  const url = new URL("/", location.origin);
  url.searchParams.set("return", safeReturnPath(returnTo));
  await sendSignInLinkToEmail(auth, email, {
    url: url.toString(),
    handleCodeInApp: true,
  });
  try {
    localStorage.setItem(linkEmailKey, email);
  } catch {
    // Opening the link then asks for the email again.
  }
}
export function pendingSignInLink() {
  if (!isSignInWithEmailLink(auth, location.href)) return null;
  const link = location.href;
  const target = safeReturnPath(new URL(link).searchParams.get("return"));
  // Keep the one-time code out of history and reloads before it is used.
  history.replaceState(null, "", "/");
  let email = "";
  try {
    email = localStorage.getItem(linkEmailKey) || "";
  } catch {
    email = "";
  }
  return { link, target, email };
}
export async function finishSignInLink(link: string, email: string) {
  await setPersistence(auth, browserSessionPersistence);
  await signInWithEmailLink(auth, email, link);
  try {
    localStorage.removeItem(linkEmailKey);
  } catch {
    // Nothing to forget.
  }
}
export function signInLinkError(error: unknown) {
  const code = (error as { code?: string }).code || "";
  if (
    code === "auth/invalid-action-code" ||
    code === "auth/expired-action-code"
  )
    return "This sign-in link has expired or was already used. Request a new link.";
  if (code === "auth/invalid-email" || code === "auth/missing-email")
    return "Enter the email address the link was sent to.";
  if (code === "auth/user-disabled")
    return "This account is unavailable. Contact the church office.";
  if (
    code === "auth/internal-error" ||
    code === "auth/admin-restricted-operation"
  )
    return "This email is not linked to a member account. Contact the church office.";
  return "Sign-in could not be finished. Request a new link.";
}
export async function changeSignInEmail(email: string) {
  if (!auth.currentUser) throw new Error("Sign in again first.");
  try {
    await verifyBeforeUpdateEmail(auth.currentUser, email, {
      url: new URL("/", location.origin).toString(),
    });
  } catch (error) {
    if ((error as { code?: string }).code === "auth/requires-recent-login")
      throw new Error(
        "Sign out and sign in again, then change your sign-in email.",
      );
    throw error;
  }
}
export const verifyEmail = async () => {
  if (auth.currentUser) await sendEmailVerification(auth.currentUser);
};
export const getPublicEvents = () =>
  callPortal<PortalEvent[]>("portalPublicEvents");
export const getMemberEvents = () =>
  callPortal<PortalEvent[]>("portalMemberEvents");
export const getMe = () => callPortal<MemberProfile>("portalMe");
export const getDirectory = () =>
  callPortal<DirectoryEntry[]>("portalDirectory");
export const saveSharing = (value: DirectoryPreferences) =>
  callPortal(
    "saveDirectoryPreferences",
    directoryPreferencesSchema.parse(value),
  );
export const rsvp = (value: unknown) =>
  callPortal("portalRsvp", memberRsvpSchema.parse(value));
export const submitForm = (value: unknown) =>
  callPortal("submitOnlineForm", onlineFormSchema.parse(value));
export function portalError(error: unknown) {
  return error instanceof Error && !error.message.startsWith("[")
    ? error.message
    : "Please check the fields and try again.";
}
