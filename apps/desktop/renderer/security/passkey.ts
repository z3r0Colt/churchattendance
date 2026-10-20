import {
  browserSessionPersistence,
  setPersistence,
  signInWithCustomToken,
  type Auth,
} from "firebase/auth";
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { passkeyBeginSchema, passkeyFinishSchema } from "@sycamore/shared";

export type SecurityCall = <T>(name: string, input: unknown) => Promise<T>;

// The account a Firebase custom token was made for, or "" when it cannot be read.
export function tokenUid(token: string) {
  try {
    const part = token.split(".")[1] || "";
    const bytes = Uint8Array.from(
      atob(part.replace(/-/g, "+").replace(/_/g, "/")),
      (char) => char.charCodeAt(0),
    );
    const uid = (
      JSON.parse(new TextDecoder().decode(bytes)) as { uid?: unknown }
    ).uid;
    return typeof uid === "string" ? uid : "";
  } catch {
    return "";
  }
}

// Signs in with a passkey inside a page on the church security origin (the portal's
// staff security page and the staff web). The sign-in lasts only for this browser tab,
// so a borrowed browser keeps nothing once the tab closes. On the staff web, whose Auth
// already keeps to the tab, setting it again changes nothing.
// When confirming the person already signed in, pass their uid: a passkey for any other
// account stops here before signing in. That is only a guard in the page; the server
// already binds the passkey to the account for the email.
// Never use this for the desktop's browser handoff. On the desktop sign-in screen that
// handoff uses the screen's "Keep this PC signed in" choice; Confirm in browser and
// Open browser sign-in and passkeys keep the current sign-in's choice.
export async function passkeySignIn(
  auth: Auth,
  call: SecurityCall,
  email: string,
  expectedUid?: string,
) {
  const begin = await call<{
    id: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>("beginPasskeySignIn", passkeyBeginSchema.parse({ email }));
  const response = await startAuthentication({ optionsJSON: begin.options });
  const { token } = await call<{ token: string }>(
    "finishPasskeySignIn",
    passkeyFinishSchema.parse({ challengeId: begin.id, response }),
  );
  if (expectedUid !== undefined) {
    const uid = tokenUid(token);
    if (!uid || uid !== expectedUid)
      throw new Error("That passkey is for another account.");
  }
  await setPersistence(auth, browserSessionPersistence);
  return signInWithCustomToken(auth, token);
}
