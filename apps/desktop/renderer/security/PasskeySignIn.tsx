import { useState } from "react";
import { Button, Field, Input, MessageBar } from "@fluentui/react-components";
import { signInWithCustomToken, type Auth } from "firebase/auth";
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { passkeyBeginSchema, passkeyFinishSchema } from "@sycamore/shared";

// In-page passkey sign-in for pages served from the church security origin (the portal and the staff web).
export function PasskeySignIn({
  auth,
  call,
}: {
  auth: Auth;
  call: <T>(name: string, input: unknown) => Promise<T>;
}) {
  const [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const begin = await call<{
        id: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      }>("beginPasskeySignIn", passkeyBeginSchema.parse({ email }));
      const response = await startAuthentication({
        optionsJSON: begin.options,
      });
      const result = await call<{ token: string }>(
        "finishPasskeySignIn",
        passkeyFinishSchema.parse({ challengeId: begin.id, response }),
      );
      await signInWithCustomToken(auth, result.token);
    } catch {
      setError(
        "Passkey sign-in failed. Check the email, your device and your connection.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface communication-panel">
      <Field label="Passkey account email">
        <Input
          type="email"
          autoComplete="username webauthn"
          value={email}
          onChange={(_, data) => setEmail(data.value)}
        />
      </Field>
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <Button disabled={busy || !email} onClick={() => void signIn()}>
        Sign in with passkey
      </Button>
    </section>
  );
}
