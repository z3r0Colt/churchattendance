import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Field,
  Input,
  MessageBar,
  Select,
  Subtitle2,
  Title3,
} from "@fluentui/react-components";
import {
  roles as allRoles,
  SESSION_ROLES,
  hasRole,
  accountCreateSchema,
  accountActionSchema,
  rolesInputSchema,
  migrationPageSchema,
  encryptedCollections,
  securityLogSchema,
  type Role,
  type StaffAccount,
  type SecurityEvent,
} from "@sycamore/shared";
import { securityCall, browserStaffSignIn } from "../data/security";
import { RecordEditor, Records, friendlyError } from "../chms/Common";
export function Security({ roles }: { roles: Role[] }) {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]),
    [events, setEvents] = useState<SecurityEvent[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [setupLink, setSetupLink] = useState(""),
    [cursor, setCursor] = useState(""),
    [scope, setScope] = useState<"security" | "session">("security"),
    [editing, setEditing] = useState<StaffAccount | "new" | null>(null),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<StaffAccount | null>(null),
    [backup, setBackup] = useState(false),
    [migration, setMigration] =
      useState<(typeof encryptedCollections)[number]>("careNotes");
  const admin = roles.includes("admin"),
    session = hasRole(roles, SESSION_ROLES);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function loadAccounts() {
    if (!admin) return;
    const rows: StaffAccount[] = [];
    let after = "";
    do {
      const page = await securityCall<{
        accounts: StaffAccount[];
        next: string;
      }>("listStaffAccounts", { after });
      rows.push(...page.accounts);
      after = page.next;
    } while (after);
    setAccounts(rows);
  }
  async function loadEvents(after = "") {
    const page = await securityCall<{ events: SecurityEvent[]; next: string }>(
      "getSecurityEvents",
      securityLogSchema.parse({ scope, after }),
    );
    setEvents((previous) =>
      after ? [...previous, ...page.events] : page.events,
    );
    setCursor(page.next);
  }
  useEffect(() => {
    if (admin || session)
      void run(async () => {
        await loadAccounts();
        await loadEvents();
      });
  }, [scope]); // The authenticated workspace remounts on role changes.
  return (
    <>
      <div className="page-heading">
        <Title3 as="h1">Account security</Title3>
      </div>
      <p>
        Staff records require a verified account and completed MFA or passkey
        sign-in. Security changes require a sign-in within five minutes.
      </p>
      <Button
        disabled={busy}
        onClick={() => void run(() => browserStaffSignIn(setNotice))}
      >
        Open browser sign-in and passkeys
      </Button>
      {error && <MessageBar intent="error">{error}</MessageBar>}
      {notice && <MessageBar intent="info">{notice}</MessageBar>}
      {setupLink && (
        <section className="surface communication-panel">
          <p>
            Give this password setup link only to the person whose identity you
            verified. No email was sent.
          </p>
          <Field label="Account setup link">
            <Input value={setupLink} readOnly />
          </Field>
          <Button onClick={() => setSetupLink("")}>Hide setup link</Button>
        </section>
      )}
      {admin && (
        <section className="surface communication-panel">
          <Subtitle2>Staff accounts</Subtitle2>
          <Button disabled={busy} onClick={() => setEditing("new")}>
            Add staff account
          </Button>
          <Button disabled={busy} onClick={() => void run(loadAccounts)}>
            Refresh accounts
          </Button>
          <Records
            rows={accounts.map((account) => ({
              id: account.uid,
              Name: account.displayName || account.email,
              Email: account.email,
              Roles: account.roles.join(", "),
              Status: account.disabled ? "Disabled" : "Enabled",
              "Email verified": account.emailVerified ? "Yes" : "No",
              Authenticators: account.factors,
            }))}
            choose={(index) => setSelected(accounts[index])}
          />
          <p>
            An enrolled factor is not proof of a completed MFA sign-in. Passkeys
            are managed by their owner on the browser security page.
          </p>
        </section>
      )}
      {(admin || session) && (
        <section className="surface communication-panel">
          <Subtitle2>Access history</Subtitle2>
          {events.some((row) => row.scope === "session") && (
            <MessageBar intent="info">
              Session only access history. Keep these records within the
              Session.
            </MessageBar>
          )}
          <p>
            Server-audited private reads and account actions appear here. Direct
            database denials and cloud-console activity require the platform's
            own audit logs. Record bodies and credential secrets are never shown
            here.
          </p>
          <Field label="Log scope">
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
            >
              <option value="security">Account security</option>
              {session && (
                <option value="session">Session only record access</option>
              )}
            </Select>
          </Field>
          <Button disabled={busy} onClick={() => void run(() => loadEvents())}>
            Refresh access history
          </Button>
          <Records
            rows={events.map((row) => ({
              id: row.id,
              Time: row.at,
              Actor: row.actorUid,
              Action: row.action,
              Outcome: row.outcome,
              Record: row.target,
              Visibility:
                row.scope === "session" ? "Session only" : "Account security",
            }))}
          />
          {cursor && (
            <Button
              disabled={busy}
              onClick={() => void run(() => loadEvents(cursor))}
            >
              Load more history
            </Button>
          )}
        </section>
      )}
      {admin && session && (
        <section className="surface communication-panel session-panel">
          <Subtitle2>Session only encryption maintenance</Subtitle2>
          <p>
            Back up and verify recovery before migrating or rotating keys.
            Process one page at a time. Keep the previous key until all pages
            and backups have been checked.
          </p>
          <Field label="Private collection">
            <Select
              value={migration}
              onChange={(e) => setMigration(e.target.value as typeof migration)}
            >
              {encryptedCollections.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </Select>
          </Field>
          <Checkbox
            label="A backup and its recovery have been verified"
            checked={backup}
            onChange={(_, data) => setBackup(data.checked === true)}
          />
          <Button
            disabled={busy || !backup}
            onClick={() =>
              void run(async () => {
                let after = "",
                  migrated = 0;
                do {
                  const page = await securityCall<{
                    next: string;
                    migrated: number;
                  }>(
                    "migratePrivateRecords",
                    migrationPageSchema.parse({
                      collection: migration,
                      after,
                      backupConfirmed: true,
                    }),
                  );
                  migrated += page.migrated;
                  after = page.next;
                  setNotice(
                    `Migrated ${migrated} records. ${after ? "Continuing to the next page." : "This collection is complete."}`,
                  );
                } while (after);
              })
            }
          >
            Migrate or rotate this collection
          </Button>
        </section>
      )}
      {editing && (
        <RecordEditor
          title={
            editing === "new" ? "Add staff account" : "Manage staff account"
          }
          initial={
            editing === "new"
              ? { email: "", displayName: "", roles: [] }
              : { uid: editing.uid, roles: editing.roles }
          }
          fields={[
            ...(editing === "new"
              ? [
                  { key: "email", label: "Sign-in email", required: true },
                  { key: "displayName", label: "Display name", required: true },
                ]
              : []),
            {
              key: "roles",
              label: "Church roles",
              kind: "multi",
              options: allRoles.map((role) => ({ id: role, name: role })),
            },
          ]}
          save={async (value) => {
            if (editing === "new") {
              const result = await securityCall<{ setupLink: string }>(
                "createStaffAccount",
                accountCreateSchema.parse(value),
              );
              setSetupLink(result.setupLink);
            } else
              await securityCall("setUserRoles", rolesInputSchema.parse(value));
            await loadAccounts();
          }}
          close={() => setEditing(null)}
        />
      )}
      {selected && (
        <section className="surface communication-panel">
          <p>
            Managing {selected.displayName || selected.email}. Recovery removes
            every authenticator and passkey and closes existing staff access.
            Verify the person's identity first.
          </p>
          <Button disabled={busy} onClick={() => setEditing(selected)}>
            Edit church roles
          </Button>
          {(["disable", "enable", "revoke", "recover"] as const).map(
            (action) => (
              <Button
                key={action}
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `${action === "recover" ? "Reset all factors and revoke access for" : action} ${selected.email}?`,
                    )
                  )
                    void run(async () => {
                      await securityCall(
                        "manageStaffAccount",
                        accountActionSchema.parse({
                          uid: selected.uid,
                          action,
                        }),
                      );
                      setSelected(null);
                      await loadAccounts();
                    });
                }}
              >
                {action === "recover"
                  ? "Reset lost factors"
                  : action === "revoke"
                    ? "Revoke sign-ins"
                    : action === "disable"
                      ? "Disable account"
                      : "Enable account"}
              </Button>
            ),
          )}
        </section>
      )}
    </>
  );
}
