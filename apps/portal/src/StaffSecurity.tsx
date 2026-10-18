import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  Title3,
} from "@fluentui/react-components";
import {
  onIdTokenChanged,
  signInWithCustomToken,
  signOut,
} from "firebase/auth";
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialRequestOptionsJSON,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import {
  emptySecuritySchema,
  passkeyBeginSchema,
  passkeyFinishSchema,
  passkeyRemoveSchema,
  handoffApproveSchema,
} from "@sycamore/shared";
import {
  StaffPasswordForm,
  StaffEnrollment,
} from "../../desktop/renderer/security/Factors";
import { lightTheme } from "../../desktop/renderer/theme/brand";
import { auth, callPortal } from "./data";
export function StaffSecurity() {
  const [user, setUser] = useState(auth.currentUser),
    [ready, setReady] = useState(false),
    [eligible, setEligible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [email, setEmail] = useState(""),
    [keys, setKeys] = useState<{ id: string; createdAt: string }[]>([]),
    [compared, setCompared] = useState(false),
    [refresh, setRefresh] = useState(0);
  const fragment = new URLSearchParams(location.hash.slice(1)),
    id = fragment.get("id") || "",
    challenge = fragment.get("challenge") || "";
  const handoff = /^[a-f0-9]{64}$/.test(id) && /^[a-f0-9]{64}$/.test(challenge);
  useEffect(
    () =>
      onIdTokenChanged(auth, (value) => {
        setUser(value);
        setReady(false);
        setEligible(false);
        setKeys([]);
        setError("");
      }),
    [],
  );
  useEffect(() => {
    if (!user) return;
    let lastActivity = Date.now();
    const activity = () => {
      lastActivity = Date.now();
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity >= 30 * 60_000) void signOut(auth);
    }, 30_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [user]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(
        "The security request failed. Check your sign-in, connection and church security settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      try {
        let status = await callPortal<{
          assured: boolean;
          canActivate: boolean;
        }>("staffSecurityStatus");
        if (!status.assured && status.canActivate) {
          await callPortal("activateStaffAccess");
          status = await callPortal("staffSecurityStatus");
        }
        if (!active) return;
        setEligible(true);
        setReady(status.assured);
        if (status.assured) {
          const result = await callPortal<typeof keys>("listMyPasskeys");
          if (active) setKeys(result);
        }
      } catch {
        if (active)
          setError(
            "Staff access could not be verified. Sign in again or contact another administrator.",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [user, refresh]);
  return (
    <FluentProvider theme={lightTheme} className="portal">
      <main>
        <div className="wordmark">SYCAMORE RPC</div>
        <Title3 as="h1">Staff account security</Title3>
        {error && <MessageBar intent="error">{error}</MessageBar>}
        {notice && <MessageBar intent="info">{notice}</MessageBar>}
        {!user ? (
          <>
            <StaffPasswordForm auth={auth} />
            <section className="surface communication-panel">
              <Field label="Passkey account email">
                <Input
                  type="email"
                  autoComplete="username webauthn"
                  value={email}
                  onChange={(_, data) => setEmail(data.value)}
                />
              </Field>
              <Button
                disabled={busy || !email}
                onClick={() =>
                  void run(async () => {
                    const begin = await callPortal<{
                      id: string;
                      options: PublicKeyCredentialRequestOptionsJSON;
                    }>(
                      "beginPasskeySignIn",
                      passkeyBeginSchema.parse({ email }),
                    );
                    const response = await startAuthentication({
                      optionsJSON: begin.options,
                    });
                    const result = await callPortal<{ token: string }>(
                      "finishPasskeySignIn",
                      passkeyFinishSchema.parse({
                        challengeId: begin.id,
                        response,
                      }),
                    );
                    await signInWithCustomToken(auth, result.token);
                  })
                }
              >
                Sign in with passkey
              </Button>
            </section>
          </>
        ) : !eligible ? (
          <Button onClick={() => void signOut(auth)}>Sign out</Button>
        ) : !ready ? (
          <StaffEnrollment
            auth={auth}
            refresh={() => setRefresh((value) => value + 1)}
          />
        ) : (
          <>
            <p>Signed in as {user.email}. Staff access is verified.</p>
            {handoff && (
              <section className="surface communication-panel">
                <Title3>Approve your desktop sign-in</Title3>
                <p>
                  Compare this code with the app on your own PC. If you did not
                  start this sign-in, close this page.
                </p>
                <strong>{id.slice(-8)}</strong>
                <Checkbox
                  label="This code matches the app on my own PC"
                  checked={compared}
                  onChange={(_, data) => setCompared(data.checked === true)}
                />
                <Button
                  disabled={busy || !compared}
                  onClick={() =>
                    void run(async () => {
                      await callPortal(
                        "approveDesktopSignIn",
                        handoffApproveSchema.parse({ id, challenge }),
                      );
                      history.replaceState(null, "", "/staff-security");
                      setNotice("Approved. Return to the desktop app.");
                      setCompared(false);
                    })
                  }
                >
                  Approve desktop sign-in
                </Button>
              </section>
            )}
            <section className="surface communication-panel">
              <Title3>My passkeys</Title3>
              <p>
                Passkeys require your device's PIN or biometric verification.
                Keep an authenticator or another passkey for recovery.
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const begin = await callPortal<{
                      id: string;
                      options: PublicKeyCredentialCreationOptionsJSON;
                    }>(
                      "beginPasskeyRegistration",
                      emptySecuritySchema.parse({}),
                    );
                    const response = await startRegistration({
                      optionsJSON: begin.options,
                    });
                    await callPortal(
                      "finishPasskeyRegistration",
                      passkeyFinishSchema.parse({
                        challengeId: begin.id,
                        response,
                      }),
                    );
                    setRefresh((value) => value + 1);
                    setNotice("Passkey added.");
                  })
                }
              >
                Add passkey
              </Button>
              {!keys.length && <p>No passkeys are registered.</p>}
              {keys.map((key, index) => (
                <div key={key.id}>
                  <span>
                    Passkey {index + 1}, registered{" "}
                    {new Date(key.createdAt).toLocaleDateString()}{" "}
                  </span>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Remove this passkey and revoke existing staff sign-ins?",
                        )
                      )
                        void run(async () => {
                          await callPortal(
                            "removeMyPasskey",
                            passkeyRemoveSchema.parse({ id: key.id }),
                          );
                          await signOut(auth);
                        });
                    }}
                  >
                    Remove passkey {index + 1}
                  </Button>
                </div>
              ))}
            </section>
            <p>
              Security changes and desktop approval require a sign-in within
              five minutes. Sign out and sign in again if needed. For a lost
              factor, contact another administrator.
            </p>
            <Button onClick={() => void signOut(auth)}>Sign out</Button>
          </>
        )}
      </main>
    </FluentProvider>
  );
}
