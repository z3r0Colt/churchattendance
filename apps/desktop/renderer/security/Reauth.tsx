import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
} from "@fluentui/react-components";
import {
  EmailAuthProvider,
  getMultiFactorResolver,
  reauthenticateWithCredential,
  signInWithCustomToken,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorResolver,
} from "firebase/auth";
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { passkeyBeginSchema, passkeyFinishSchema } from "@sycamore/shared";
import { auth } from "../data/firebase";
import { hostReauth } from "../data/reauth";
import { browserStaffSignIn, securityCall } from "../data/security";
import { staffWeb } from "../platform";

type Pending = { resolve: () => void; reject: (cause: Error) => void };

// Asks the signed-in person to confirm it is them before a sensitive account change.
// Password and authenticator code work everywhere; the staff web confirms a passkey in
// the page and the desktop confirms through the browser security page.
export function ReauthHost() {
  const [pending, setPending] = useState<Pending | null>(null),
    [resolver, setResolver] = useState<MultiFactorResolver | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => hostReauth(setPending), []);
  const email = auth.currentUser?.email || "";
  function finish(outcome: "done" | "cancel") {
    if (outcome === "done") pending?.resolve();
    else
      pending?.reject(
        new Error("Confirmation cancelled. Nothing was changed."),
      );
    setPending(null);
    setResolver(null);
    setError("");
    setNotice("");
  }
  async function attempt(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      finish("done");
    } catch (cause) {
      if (
        (cause as { code?: string }).code === "auth/multi-factor-auth-required"
      ) {
        setResolver(getMultiFactorResolver(auth, cause as MultiFactorError));
        return;
      }
      setError(
        "That did not confirm your sign-in. Check the details and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // React passes submit events up through portals, so keep this one from the form beneath.
    event.stopPropagation();
    const form = new FormData(event.currentTarget);
    const user = auth.currentUser;
    if (!user) return;
    if (resolver) {
      const hint = resolver.hints.find(
        (row) => row.factorId === TotpMultiFactorGenerator.FACTOR_ID,
      );
      if (!hint) {
        setError("This account needs a supported authenticator.");
        return;
      }
      void attempt(() =>
        resolver.resolveSignIn(
          TotpMultiFactorGenerator.assertionForSignIn(
            hint.uid,
            String(form.get("code")),
          ),
        ),
      );
    } else
      void attempt(() =>
        reauthenticateWithCredential(
          user,
          EmailAuthProvider.credential(email, String(form.get("password"))),
        ),
      );
  }
  async function passkey() {
    const begin = await securityCall<{
      id: string;
      options: PublicKeyCredentialRequestOptionsJSON;
    }>("beginPasskeySignIn", passkeyBeginSchema.parse({ email }));
    const response = await startAuthentication({ optionsJSON: begin.options });
    const result = await securityCall<{ token: string }>(
      "finishPasskeySignIn",
      passkeyFinishSchema.parse({ challengeId: begin.id, response }),
    );
    await signInWithCustomToken(auth, result.token);
  }
  return (
    <Dialog
      open={!!pending}
      modalType="alert"
      onOpenChange={(_, data) => {
        if (!data.open) finish("cancel");
      }}
    >
      <DialogSurface className="record-dialog">
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>Confirm it is you</DialogTitle>
            <DialogContent className="drawer-form">
              <p>
                This change needs a sign-in within the last five minutes.
                Confirm as {email} to continue.
              </p>
              {resolver ? (
                <Field label="Authenticator code" required>
                  <Input
                    name="code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    required
                  />
                </Field>
              ) : (
                <Field label="Password" required>
                  <Input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </Field>
              )}
              {error && <MessageBar intent="error">{error}</MessageBar>}
              {notice && <MessageBar intent="info">{notice}</MessageBar>}
            </DialogContent>
            <DialogActions fluid>
              <Button type="submit" appearance="primary" disabled={busy}>
                Confirm
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void attempt(
                    staffWeb ? passkey : () => browserStaffSignIn(setNotice),
                  )
                }
              >
                {staffWeb ? "Confirm with passkey" : "Confirm in browser"}
              </Button>
              <Button disabled={busy} onClick={() => finish("cancel")}>
                Cancel
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
