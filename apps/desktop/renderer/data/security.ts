import { connectedOperation } from "../../../pwa/runtime";
import { httpsCallable } from "firebase/functions";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithCustomToken,
} from "firebase/auth";
import { handoffSchema } from "@sycamore/shared";
import { auth, functions } from "./firebase";
import { native, staffSecurityUrl } from "../platform";
import { tokenUid } from "../security/passkey";
import { withRecentSignIn } from "./reauth";
// Sensitive account actions ask the person to confirm it is them, then try once more.
export const securityCall = <T = unknown>(
  name: string,
  input: unknown = {},
): Promise<T> =>
  withRecentSignIn(
    () => connectedOperation(async () => (await httpsCallable<unknown, T>(functions, name)(input)).data),
  );
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
// Waits between checks for the browser approval, ending at once if cancelled.
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    function stop() {
      window.clearTimeout(timer);
      reject(signal!.reason);
    }
    signal?.addEventListener("abort", stop, { once: true });
  });
}
export type BrowserSignInOptions = {
  // Stops waiting for the browser, for example when the person cancels. Nobody is
  // signed in after it fires, even if the browser approves later.
  signal?: AbortSignal;
} & (
  | {
      // Confirm the account already signed in on this PC instead of signing in anew.
      // That sign-in keeps lasting as it already does.
      sameAccount: true;
      keep?: never;
    }
  | {
      sameAccount?: false;
      // The sign-in screen's "Keep this PC signed in" choice: kept after the app
      // closes, or only until then. Left out, the sign-in lasts as the current one does.
      keep?: boolean;
    }
);
// Signs in on this PC once the person approves on the church security page in their
// browser. The sign-in screen accepts whichever account approves; confirming it is you
// accepts only the account already signed in.
export async function browserStaffSignIn(
  notice: (text: string) => void,
  options: BrowserSignInOptions = {},
) {
  const { signal } = options;
  signal?.throwIfAborted();
  const id = random(),
    verifier = random();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  signal?.throwIfAborted();
  const url = new URL(staffSecurityUrl());
  url.hash = new URLSearchParams({ id, challenge }).toString();
  if (native) await native.openStaffSecurity(id, challenge);
  else window.open(url.href, "_blank", "noopener,noreferrer");
  signal?.throwIfAborted();
  notice(
    `Finish sign-in in your browser. Approve only if it shows this code: ${id.slice(-8)}.`,
  );
  const input = handoffSchema.parse(
    options.sameAccount
      ? { id, verifier, sameAccount: true }
      : { id, verifier },
  );
  const expires = Date.now() + 3 * 60_000;
  while (Date.now() < expires) {
    signal?.throwIfAborted();
    const result = await securityCall<{ pending?: boolean; token?: string }>(
      "completeDesktopSignIn",
      input,
    );
    signal?.throwIfAborted();
    if (result.token) {
      // The server already refuses another account's approval; this checks once more.
      const current = auth.currentUser?.uid;
      if (
        options.sameAccount &&
        (!current || tokenUid(result.token) !== current)
      )
        throw new Error("Approve with the account signed in on this PC.");
      if (options.keep !== undefined) {
        await setPersistence(
          auth,
          options.keep ? browserLocalPersistence : browserSessionPersistence,
        );
        signal?.throwIfAborted();
      }
      await signInWithCustomToken(auth, result.token);
      return;
    }
    await pause(1500, signal);
  }
  throw new Error("Browser sign-in expired. Start again.");
}
