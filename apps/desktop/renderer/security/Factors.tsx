import { useState, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  Field,
  Input,
  MessageBar,
  Select,
  Title3,
} from "@fluentui/react-components";
import {
  getMultiFactorResolver,
  multiFactor,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  type Auth,
  type MultiFactorError,
  type MultiFactorResolver,
  type TotpSecret,
} from "firebase/auth";

// tabOnly keeps the sign-in to this browser tab, as the staff web requires.
export function StaffPasswordForm({
  auth,
  tabOnly = false,
}: {
  auth: Auth;
  tabOnly?: boolean;
}) {
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null),
    [factor, setFactor] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [keep, setKeep] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (resolver)
        await resolver.resolveSignIn(
          TotpMultiFactorGenerator.assertionForSignIn(
            factor,
            String(form.get("code")),
          ),
        );
      else {
        await setPersistence(
          auth,
          keep && !tabOnly
            ? browserLocalPersistence
            : browserSessionPersistence,
        );
        await signInWithEmailAndPassword(
          auth,
          String(form.get("email")),
          String(form.get("password")),
        );
      }
    } catch (cause) {
      if (
        (cause as { code?: string }).code === "auth/multi-factor-auth-required"
      ) {
        const next = getMultiFactorResolver(auth, cause as MultiFactorError);
        const hint = next.hints.find(
          (row) => row.factorId === TotpMultiFactorGenerator.FACTOR_ID,
        );
        if (hint) {
          setResolver(next);
          setFactor(hint.uid);
        } else
          setError(
            "This account needs a supported authenticator. Ask an administrator for recovery.",
          );
      } else setError("Sign-in failed. Check your credentials and connection.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="drawer-form" onSubmit={submit}>
      {resolver ? (
        <>
          <Field label="Authenticator">
            <Select value={factor} onChange={(e) => setFactor(e.target.value)}>
              {resolver.hints
                .filter(
                  (row) => row.factorId === TotpMultiFactorGenerator.FACTOR_ID,
                )
                .map((row) => (
                  <option key={row.uid} value={row.uid}>
                    {row.displayName || "Authenticator"}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Authenticator code" required>
            <Input
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="Email" required>
            <Input name="email" type="email" autoComplete="username" required />
          </Field>
          <Field label="Password" required>
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          {!tabOnly && (
            <Checkbox
              label="Keep this PC signed in"
              checked={keep}
              onChange={(_, data) => setKeep(data.checked === true)}
            />
          )}
        </>
      )}
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <Button type="submit" appearance="primary" disabled={busy}>
        {busy ? "Signing in" : "Sign in"}
      </Button>
      {resolver && (
        <Button onClick={() => setResolver(null)}>Start again</Button>
      )}
    </form>
  );
}
export function StaffEnrollment({
  auth,
  refresh,
}: {
  auth: Auth;
  refresh: () => void;
}) {
  const user = auth.currentUser!,
    [secret, setSecret] = useState<TotpSecret | null>(null),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(
        "Security setup could not finish. Sign in again and check the church's MFA configuration.",
      );
    } finally {
      setBusy(false);
    }
  }
  const enrolled = multiFactor(user).enrolledFactors.length > 0;
  return (
    <section className="surface communication-panel">
      <Title3 as="h1">Protect your staff account</Title3>
      <p>
        Staff records stay closed until your verified account completes MFA or
        passkey sign-in.
      </p>
      {!user.emailVerified ? (
        <>
          <p>Verify your sign-in email before adding an authenticator.</p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await sendEmailVerification(user);
                setNotice(
                  "Verification email requested. Open it, then refresh.",
                );
              })
            }
          >
            Send verification email
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await user.reload();
                await user.getIdToken(true);
                refresh();
              })
            }
          >
            Refresh verification
          </Button>
        </>
      ) : enrolled ? (
        <p>
          An authenticator is enrolled. Sign out and sign in again with its code
          to open staff records.
        </p>
      ) : (
        <>
          <p>
            Use an authenticator app. The setup key stays on this screen and is
            not saved in the app.
          </p>
          {!secret ? (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setSecret(
                    await TotpMultiFactorGenerator.generateSecret(
                      await multiFactor(user).getSession(),
                    ),
                  ),
                )
              }
            >
              Set up authenticator
            </Button>
          ) : (
            <>
              <Field label="Authenticator setup key">
                <Input value={secret.secretKey} readOnly autoComplete="off" />
              </Field>
              <Field label="Authenticator code">
                <Input
                  value={code}
                  onChange={(_, data) => setCode(data.value)}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                />
              </Field>
              <Button
                disabled={busy || !/^\d{6}$/.test(code)}
                onClick={() =>
                  void run(async () => {
                    await multiFactor(user).enroll(
                      TotpMultiFactorGenerator.assertionForEnrollment(
                        secret,
                        code,
                      ),
                      "Church authenticator",
                    );
                    setSecret(null);
                    setCode("");
                    await signOut(auth);
                  })
                }
              >
                Confirm authenticator and sign out
              </Button>
            </>
          )}
        </>
      )}
      {notice && <MessageBar intent="info">{notice}</MessageBar>}
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <Button disabled={busy} onClick={() => void signOut(auth)}>
        Sign out
      </Button>
      <p>
        For a lost authenticator or passkey, contact another church
        administrator. Recovery does not grant new roles.
      </p>
    </section>
  );
}
