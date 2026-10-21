import { useEffect, useRef, useState } from "react";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  onIdTokenChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { roleSchema, type Role } from "@sycamore/shared";
import { auth, privateCacheReady } from "./firebase";
import { securityCall } from "./security";
import { staffWeb } from "../platform";
export function useAuth() {
  const generation = useRef(0);
  const signedInUid = useRef("");
  const [state, setState] = useState<{
    loading: boolean;
    user: User | null;
    roles: Role[];
    kiosk: boolean;
    assured: boolean;
    error: string;
    validUntil?: number;
  }>({
    loading: true,
    user: null,
    roles: [],
    kiosk: false,
    assured: false,
    error: "",
  });
  useEffect(
    () =>
      onIdTokenChanged(auth, async (user) => {
        // The staff web holds records only in memory. Reloading on sign-out or a change of
        // account drops every listener and cached document before anyone else signs in.
        // The records leave the screen first, so a reload that is blocked or cancelled shows none.
        if (
          staffWeb &&
          signedInUid.current &&
          user?.uid !== signedInUid.current
        ) {
          setState({
            loading: true,
            user: null,
            roles: [],
            kiosk: false,
            assured: false,
            error: "",
          });
          window.dispatchEvent(new Event("church-security-cleared"));
          location.reload();
          return;
        }
        signedInUid.current = user?.uid || "";
        const attempt = ++generation.current;
        try {
          await privateCacheReady;
        } catch {
          setState({
            loading: false,
            user: null,
            roles: [],
            kiosk: false,
            assured: false,
            error:
              "Close other app windows and restart to clear the old private cache.",
          });
          return;
        }
        if (!user) {
          setState({
            loading: false,
            user: null,
            roles: [],
            kiosk: false,
            assured: false,
            error: "",
          });
          return;
        }
        let token;
        try {
          token = await user.getIdTokenResult();
        } catch {
          if (
            attempt === generation.current &&
            auth.currentUser?.uid === user.uid
          )
            setState({
              loading: false,
              user,
              roles: [],
              kiosk: false,
              assured: false,
              error:
                "Your sign-in could not be verified. Check your connection, then sign out and sign in again.",
            });
          return;
        }
        if (
          auth.currentUser?.uid !== user.uid ||
          attempt !== generation.current
        )
          return;
        const roles = roleSchema.array().catch([]).parse(token.claims.roles);
        if (token.claims.kiosk === true) {
          setState({
            loading: false,
            user,
            roles: [],
            kiosk: true,
            assured: false,
            error: "",
          });
          return;
        }
        try {
          let status = await securityCall<{
            assured: boolean;
            canActivate: boolean;
            expiresAt: number;
          }>("staffSecurityStatus");
          if (!status.assured && status.canActivate) {
            await securityCall("activateStaffAccess");
            status = await securityCall("staffSecurityStatus");
          }
          if (
            auth.currentUser?.uid === user.uid &&
            attempt === generation.current
          )
            setState({
              loading: false,
              user,
              roles,
              kiosk: false,
              assured: status.assured,
              error: "",
              validUntil: status.expiresAt,
            });
        } catch {
          if (
            auth.currentUser?.uid === user.uid &&
            attempt === generation.current
          )
            setState({
              loading: false,
              user,
              roles,
              kiosk: false,
              assured: false,
              error:
                "Staff access could not be verified. Check your connection or contact an administrator.",
            });
        }
      }),
    [],
  );
  useEffect(() => {
    if (!state.assured || !state.user) return;
    const uid = state.user.uid;
    const timer = window.setInterval(() => {
      if (state.validUntil && Date.now() >= state.validUntil) {
        setState((previous) => ({
          ...previous,
          assured: false,
          error: "Your staff sign-in expired. Sign out and sign in again.",
        }));
        return;
      }
      void securityCall<{ assured: boolean; roles: Role[] }>(
        "staffSecurityStatus",
      )
        .then((value) => {
          if (
            value.assured &&
            [...value.roles].sort().join() !== [...state.roles].sort().join() &&
            auth.currentUser?.uid === uid
          )
            void auth.currentUser.getIdToken(true);
          if (!value.assured)
            setState((previous) =>
              previous.user?.uid === uid
                ? { ...previous, assured: false }
                : previous,
            );
        })
        .catch((error: { code?: string }) => {
          if (
            [
              "functions/permission-denied",
              "functions/unauthenticated",
            ].includes(error.code || "")
          )
            void signOut(auth);
        });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [state.assured, state.user, state.validUntil, state.roles]);
  return state;
}
export async function signIn(
  email: string,
  password: string,
  keepSignedIn: boolean,
) {
  await setPersistence(
    auth,
    keepSignedIn ? browserLocalPersistence : browserSessionPersistence,
  );
  await signInWithEmailAndPassword(auth, email, password);
}
export const signOutUser = () => signOut(auth);
