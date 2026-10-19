import { useState } from "react";
import { Button, Field, Input, MessageBar } from "@fluentui/react-components";
import type { Auth } from "firebase/auth";
import { passkeySignIn, type SecurityCall } from "./passkey";

// In-page passkey sign-in for pages served from the church security origin (the portal and the staff web).
// The sign-in lasts only for this browser tab.
export function PasskeySignIn({
  auth,
  call,
}: {
  auth: Auth;
  call: SecurityCall;
}) {
  const [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      await passkeySignIn(auth, call, email);
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
