import { useEffect, useState } from "react";
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
import { auth } from "./firebase";
export function useAuth() {
  const [state, setState] = useState<{
    loading: boolean;
    user: User | null;
    roles: Role[];
  }>({ loading: true, user: null, roles: [] });
  useEffect(
    () =>
      onIdTokenChanged(auth, async (user) => {
        if (!user) {
          setState({ loading: false, user: null, roles: [] });
          return;
        }
        const token = await user.getIdTokenResult();
        if (auth.currentUser?.uid !== user.uid) return;
        const roles = roleSchema.array().catch([]).parse(token.claims.roles);
        setState({ loading: false, user, roles });
      }),
    [],
  );
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
