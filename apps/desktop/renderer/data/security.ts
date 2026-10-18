import { httpsCallable } from "firebase/functions";
import { signInWithCustomToken } from "firebase/auth";
import { auth, functions, emulators } from "./firebase";
export const securityCall = async <T = unknown>(
  name: string,
  input: unknown = {},
): Promise<T> => (await httpsCallable<unknown, T>(functions, name)(input)).data;
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
export async function browserStaffSignIn(notice: (text: string) => void) {
  const id = random(),
    verifier = random();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const configured =
    import.meta.env.VITE_STAFF_AUTH_ORIGIN ||
    (emulators ? "http://localhost:5174" : "");
  const url = new URL("/staff-security", configured);
  url.hash = new URLSearchParams({ id, challenge }).toString();
  if (window.desktop) await window.desktop.openStaffSecurity(id, challenge);
  else window.open(url.href, "_blank", "noopener,noreferrer");
  notice(
    `Finish sign-in in your browser. Approve only if it shows this code: ${id.slice(-8)}.`,
  );
  const expires = Date.now() + 3 * 60_000;
  while (Date.now() < expires) {
    const result = await securityCall<{ pending?: boolean; token?: string }>(
      "completeDesktopSignIn",
      { id, verifier },
    );
    if (result.token) {
      await signInWithCustomToken(auth, result.token);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error("Browser sign-in expired. Start again.");
}
