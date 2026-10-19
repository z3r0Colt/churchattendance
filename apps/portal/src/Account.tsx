import { useState, type FormEvent } from "react";
import {
  Button,
  Field,
  Input,
  MessageBar,
  Tab,
  TabList,
} from "@fluentui/react-components";
import {
  auth,
  changeSignInEmail,
  finishSignInLink,
  portalConfigured,
  portalError,
  requestSignInLink,
  signIn,
  signInLinkError,
} from "./data";

export type PendingLink = { link: string; target: string; email: string };

export function SignIn({ returnTo }: { returnTo: string }) {
  const [mode, setMode] = useState("link");
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email")).trim();
    setBusy(true);
    setError("");
    try {
      if (mode === "link") {
        await requestSignInLink(email, returnTo);
        setSentTo(email);
      } else await signIn(email, String(data.get("password")));
    } catch {
      setError(
        mode === "link"
          ? "The link could not be sent. Check the email address and your connection."
          : "Sign-in failed. Check your email, password and connection.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card narrow" onSubmit={submit}>
      <h2>Member sign in</h2>
      <p>
        Use the account linked by the church administrator. Public form
        submission does not create a member login.
      </p>
      <TabList
        selectedValue={mode}
        onTabSelect={(_, row) => {
          setMode(String(row.value));
          setError("");
          setSentTo("");
        }}
      >
        <Tab value="link">Email me a link</Tab>
        <Tab value="password">Use my password</Tab>
      </TabList>
      <Field label="Email" required>
        <Input name="email" type="email" required autoComplete="username" />
      </Field>
      {mode === "password" && (
        <Field label="Password" required>
          <Input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </Field>
      )}
      {sentTo && (
        <MessageBar intent="success">
          If {sentTo} belongs to a member account, a sign-in link is on its way.
          Open it on this device. Each link works once.
        </MessageBar>
      )}
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <Button
        type="submit"
        appearance="primary"
        disabled={busy || !portalConfigured}
      >
        {mode === "link" ? "Send sign-in link" : "Sign in"}
      </Button>
    </form>
  );
}

export function FinishSignIn({
  pending,
  done,
}: {
  pending: PendingLink;
  done: () => void;
}) {
  const [email, setEmail] = useState(pending.email);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Finishing waits for a click, so a mail scanner that opens the link
  // cannot spend the one-time code.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await finishSignInLink(pending.link, email.trim());
    } catch (failure) {
      setError(signInLinkError(failure));
      setBusy(false);
    }
  }
  return (
    <form className="card narrow" onSubmit={submit}>
      <h2>Finish signing in</h2>
      <p>Confirm the email address this sign-in link was sent to.</p>
      <Field label="Email" required>
        <Input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(_, row) => setEmail(row.value)}
        />
      </Field>
      {error && <MessageBar intent="error">{error}</MessageBar>}
      <div className="toolbar">
        <Button type="submit" appearance="primary" disabled={busy}>
          Finish signing in
        </Button>
        <Button disabled={busy} onClick={done}>
          Request a new link
        </Button>
      </div>
    </form>
  );
}

export function AccountSettings() {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await changeSignInEmail(email);
      setNotice(
        `A confirmation link was sent to ${email}. Your sign-in email changes only after you open it.`,
      );
    } catch (failure) {
      setError(portalError(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card narrow" onSubmit={submit}>
      <h2>My sign-in email</h2>
      <p>
        You sign in with {auth.currentUser?.email || "your account email"}. This
        is separate from the contact email the church keeps for you.
      </p>
      <Field label="New sign-in email" required>
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      {error && <MessageBar intent="error">{error}</MessageBar>}
      {notice && <MessageBar intent="success">{notice}</MessageBar>}
      <Button type="submit" appearance="primary" disabled={busy}>
        Send confirmation link
      </Button>
    </form>
  );
}
