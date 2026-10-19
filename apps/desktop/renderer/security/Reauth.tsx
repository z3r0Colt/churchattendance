import { useEffect, useRef, useState, type FormEvent } from "react";
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
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorResolver,
} from "firebase/auth";
import { auth } from "../data/firebase";
import { hostReauth } from "../data/reauth";
import { browserStaffSignIn, securityCall } from "../data/security";
import { staffWeb } from "../platform";
import { passkeySignIn } from "./passkey";

type Pending = { resolve: () => void; reject: (cause: Error) => void };
// The browser confirmation's own plain reasons, such as another account approving.
function browserReason(cause: unknown) {
  const value = cause as { code?: unknown; message?: unknown };
  return (value.code === undefined ||
    value.code === "functions/permission-denied") &&
    typeof value.message === "string"
    ? value.message
    : "";
}

// Asks the signed-in person to confirm it is them before a sensitive account change.
// Password and authenticator code work everywhere; the staff web confirms a passkey in
// the page and the desktop confirms through the browser security page.
export function ReauthHost() {
  const [pending, setPending] = useState<Pending | null>(null),
    [resolver, setResolver] = useState<MultiFactorResolver | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  // The request on screen and the confirmation running for it. A confirmation answers
  // only while it is still the one running, so a late answer from an earlier one
  // never settles or closes a newer request.
  const shown = useRef<Pending | null>(null),
    running = useRef<AbortController | null>(null);
  // Shows a request, or none, and stops any confirmation still running.
  function show(request: Pending | null) {
    running.current?.abort();
    running.current = null;
    shown.current = request;
    setPending(request);
    setResolver(null);
    setBusy(false);
    setError("");
    setNotice("");
  }
  useEffect(() => hostReauth(show), []);
  const email = auth.currentUser?.email || "";
  function finish(outcome: "done" | "cancel", request = shown.current) {
    if (!request || request !== shown.current) return;
    show(null);
    if (outcome === "done") request.resolve();
    else
      request.reject(new Error("Confirmation cancelled. Nothing was changed."));
  }
  async function attempt(
    action: (signal: AbortSignal) => Promise<unknown>,
    explain = false,
  ) {
    const request = shown.current;
    if (!request) return;
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    const current = () => running.current === controller;
    setBusy(true);
    setError("");
    try {
      await action(controller.signal);
      if (current()) finish("done", request);
    } catch (cause) {
      // Cancelled, or replaced by a newer request: that one has its own answer.
      if (!current()) return;
      if (
        (cause as { code?: string }).code === "auth/multi-factor-auth-required"
      ) {
        setResolver(getMultiFactorResolver(auth, cause as MultiFactorError));
        return;
      }
      setNotice("");
      setError(
        (explain && browserReason(cause)) ||
          "That did not confirm your sign-in. Check the details and try again.",
      );
    } finally {
      if (current()) {
        running.current = null;
        setBusy(false);
      }
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
  // Confirms in this tab, and only as the person already signed in.
  async function passkey() {
    const user = auth.currentUser;
    if (!user) throw new Error("Sign in again.");
    await passkeySignIn(auth, securityCall, email, user.uid);
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
              {/* Distinct keys give each step a fresh input, so the typed password
                  never carries into the code field as plain text. */}
              {resolver ? (
                <Field key="code" label="Authenticator code" required>
                  <Input
                    name="code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    required
                  />
                </Field>
              ) : (
                <Field key="password" label="Password" required>
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
                  void (staffWeb
                    ? attempt(passkey)
                    : attempt(
                        (signal) =>
                          browserStaffSignIn(setNotice, {
                            sameAccount: true,
                            signal,
                          }),
                        true,
                      ))
                }
              >
                {staffWeb ? "Confirm with passkey" : "Confirm in browser"}
              </Button>
              {/* Cancel stays available while a browser confirmation waits. */}
              <Button onClick={() => finish("cancel")}>Cancel</Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
