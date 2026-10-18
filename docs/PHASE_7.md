# Phase 7 security and account administration

Phase 7 implements staff assurance checks, account administration, authenticator enrollment/sign-in, passkeys, a browser-to-desktop sign-in exchange, encrypted private records and scoped access history. It does not provision Identity Platform, deploy a church project, send invitations, migrate real records or verify a signed Windows release.

## Staff access

All staff roles, including Attendance Volunteer and Read Only, require verified email and completed MFA or a verified passkey session. The kiosk remains a separate expiring identity with its existing limited callable API. Members keep their existing portal permissions and do not acquire staff access.

An enrolled factor alone is insufficient. Functions check the live Auth account, current roles, token revocation cutoff and server-owned staff access record. Firestore and Storage require the staff access record and signed MFA claims or a matching, unexpired server session. Clients cannot write those records or invent assurance with a submitted boolean. No production endpoint issues the synthetic assurance used by local fixtures.

Native authenticator MFA uses Firebase's TOTP flow. New users verify email, add an authenticator with the displayed setup key, and sign out. Their next sign-in must complete the authenticator challenge before staff data opens. Existing phone-MFA proof is recognized by server policy, but this UI enrolls and challenges TOTP authenticators; an account limited to a phone factor needs an administrator-assisted transition or an already registered passkey.

The desktop still offers the explicit Keep this PC signed in choice. Session persistence is the default. Idle sign-out remains 30 minutes. Browser security also signs out after 30 minutes without interaction. Security changes require authentication within the preceding five minutes. Refreshing an ID token does not count as authenticating again.

### Passkeys and desktop approval

The member portal build includes `/staff-security`, a separate staff authentication page. Passkeys use SimpleWebAuthn verification with a one-time challenge, expected HTTPS origin, relying-party ID and required user verification. Discoverable credentials are required. Challenges expire after two minutes, and failed verification consumes a challenge. Sign-in requests are rate limited. Credential counters are checked and updated transactionally.

Register passkeys only after an assured, recent staff sign-in. Credential IDs and public keys remain server-only; owners can list their own passkeys without obtaining private key material. Removing a passkey revokes current staff sign-ins. Lost-factor replacement is administrator-assisted through Reset lost factors. Preserve another working authenticator or passkey when replacing a device.

Browser/passkey assurance lasts at most eight hours and is bound to the user's current revocation cutoff. It is a separate server policy, not a claim that a Firebase custom token itself proves native MFA. The desktop checks its known expiry locally as well as rechecking access while connected.

Desktop browser sign-in generates a random request ID and verifier. Only the verifier's SHA-256 challenge enters the browser URL fragment. The user compares the displayed request code with their own PC and explicitly approves. Approval expires after one minute and can be consumed only once with the verifier. Account revocation or a changed cutoff invalidates outstanding approval. The Electron main process opens only the compiled, configured security origin through a named preload method. It never loads remote authentication content in its privileged window.

## Account administration

Account security is available from the staff navigation. Only administrators can list or create staff accounts. Creation generates a random initial password and returns a password setup link for the administrator to give to the verified recipient. It sends no email. A new account remains unable to read staff data until email verification and assurance are complete.

An administrator cannot change their own roles, disable themselves or reset their own factors through account administration. A Session administrator is required to grant/remove Session roles or reset a Session account. Ordinary administrators never receive pastoral access merely by managing accounts.

Role changes and account actions first close access and acquire a transactional pending lock, then update Auth. Overlapping changes are rejected. Disabled accounts stay locked. Enabling, revoking or recovering an account requires a fresh assured sign-in before access opens again. Reset lost factors removes all authenticators and passkeys and revokes existing access. The operator must verify the person's identity before recovery; email similarity is not identity proof.

Auth and Firestore cannot share a transaction. If an external Auth operation fails, the pending lock deliberately stays closed. A trusted project operator must inspect Auth and `staffAccess`, reconcile the intended roles/factors/disabled state and revoke existing tokens before clearing `pending`. Do not clear a lock automatically or restore access from the renderer. Retry from the staff screen after reconciliation and obtain fresh assurance.

Use the app's account actions for immediate revocation. An out-of-band Auth console change alone cannot instantly invalidate already-issued tokens in Firestore/Storage. A project operator changing Auth directly must also close the corresponding `staffAccess` record first. Functions independently inspect the live account. Browser/desktop checks clear their workspace when they observe loss of access; information already viewed, exported or copied cannot be retracted.

## Private records and audit

Direct client reads and writes are now denied for `careNotes`, `followUps`, `sessionPrivate`, `diaconalTasks` and `auditLog`, including for the Session. Audited callable APIs return permitted records in pages. Session retains pastoral access. Deacons receive only their assigned practical tasks. An administrator outside Session is denied private records and private exports.

Private APIs keep data in component memory, never the persistent attendance cache. Reports request only visit/follow-up metadata, excluding note bodies and task titles. A successful read is recorded before records leave the server. Read failures clear the private view. Private data refreshes after saves and while a connected view remains open. An initial one-time cache upgrade clears records retained by the old direct subscriptions. Close other app windows if that upgrade cannot obtain the cache lock.

AES-256-GCM encrypts note bodies, task titles and discipline flag/history fields. Audit before/after values are encrypted too. Every envelope has a key version, random 96-bit IV and authentication tag, and authenticates its document path. Copying an envelope to another document or altering ciphertext fails verification. Keys remain server-side. This is additional application encryption over the provider's storage encryption, not end-to-end or zero-knowledge encryption.

The server-owned Security history lists account actions and record changes. Session record reads/changes use a separate Session scope. Non-Session administrators cannot request that scope. The dashboard contains permitted metadata, not record bodies, keys, password setup links or authenticators' setup secrets.

This log covers app authentication activation/passkey sign-in, app security actions and audited private API access. It is not a replacement for Identity Platform authentication logs or Google Cloud audit logging. Failed password attempts made directly against Firebase Auth, denied direct database requests, cloud-console activity and support/operator access require those platform logs. Trigger-generated change entries can arrive later than a write; duplicate delivery may produce repeated metadata entries, while the encrypted change audit uses the event ID for idempotency.

### Migration and key rotation

Existing plaintext records remain readable only through the authorized private APIs during migration. No direct-read fallback remains. New private writes remove plaintext protected fields. Migration reads and verifies a bounded page transactionally, preserves record revisions and can safely resume or rerun. A current-key record without legacy protected fields is skipped.

Before migration, obtain and verify a managed backup and its recovery, plus access to all required key versions. The Session administrator's security screen requires that confirmation. Migrate each private collection, including `auditLog`; the screen processes pages and reports progress. A failed request can be restarted because each committed record is self-describing. The document archive remains distinct from a managed backup or supported restore protocol.

For rotation, distribute a key ring containing the old and new keys to every encryption consumer, deploy, then select the new active key and migrate. Finish deployment before scanning, avoid concurrent maintenance/writes, and rescan until all relevant records are on the intended version. Keep previous keys for older backups and historical audit snapshots, which may contain nested older ciphertext. Do not delete a key merely because one migration page or one collection finished. Verify recovery and retention before retiring any key.

## Live setup

1. Upgrade the church-owned Firebase Authentication project to Identity Platform, enable the supported password provider and verified email, and enable TOTP using the official Firebase MFA setup. Check enrollment/challenge support on a staging account. Custom-token passkey sessions use the separate assurance checks above.
2. Create the initial Pastor/Admin through the trusted bootstrap process. No account can bootstrap its own roles from this app. Keep a second, independently verified Session administrator with a working factor for recovery.
3. Put a random 256-bit key ring in Secret Manager as `PRIVATE_RECORD_KEYS`. Use a different key per deployment, retain recovery copies under the church's control and restrict secret IAM. There is no production fallback key. The example below is a structure, not usable key material.
4. Set Functions parameters `STAFF_AUTH_ORIGIN` to the exact HTTPS portal origin and `STAFF_AUTH_RP_ID` to its hostname. Set public build variable `VITE_STAFF_AUTH_ORIGIN` to that same origin before building the Windows app. RP changes affect existing passkeys; use a stable church-controlled domain.
5. Retain the Phase 4 authorized-domain, Hosting/App Check and portal-origin setup. `/staff-security` is hosted by the portal rewrite. Register the actual Auth domain and verify response security headers. Native staff callables use authentication/assurance rather than pretending the desktop has portal App Check attestation.
6. Deploy the matching Functions, rules and portal build together after staging checks. Deploying these rules before staff assurance/enrollment is ready intentionally closes existing staff access. Do not weaken the rules to bypass rollout problems.
7. Optionally configure Firestore TTL on `expiresAt` for `securityChallenges`, `desktopHandoffs`, `staffSessions` and `securityBudgets`. Expiry is enforced by code/rules even when TTL deletion has not run. Define retention and protected access for `securityEvents` and platform audit logs.

Key ring structure

```json
{
  "active": "v1",
  "keys": {
    "v1": "REPLACE_WITH_A_RANDOM_256_BIT_BASE64_KEY"
  }
}
```

The emulator uses a deterministic fictional-data key and synthetic staff sessions created only by the guarded seed/test helpers. An ignored `functions/.secret.local` can contain `PRIVATE_RECORD_KEYS=emulator-only` to prevent the CLI from attempting a real secret lookup. Never use emulator grants, keys or seed identities in production. Local staff browser security uses `http://localhost:5174/staff-security` with relying-party ID `localhost`; ordinary member portal tests continue to use `127.0.0.1`.

## Verification and limits

The automated checks include assurance forgery/revocation, database and Storage denial, private API role boundaries, encrypted writes and migration, account recovery/locking and handoff replay. A browser test registers a virtual authenticator and verifies a real WebAuthn assertion using the library, rather than bypassing signature verification. Existing attendance, communications, reports and member workflows remain regression checks.

Validation passed with lint, type checking and production builds, plus 88 unit tests, 34 database/Storage rule tests and all 58 browser/emulator workflows. The final eight security workflows were rerun after the access-history export labeling change. This is 180 distinct automated tests, not evidence of live-provider or signed-native verification.

Firebase's emulator does not establish that live Identity Platform TOTP enrollment/challenge/recovery works. Validate that flow, real Windows Hello/device passkeys and the packaged system-browser handoff on staging. Also verify production-origin rejection, secret IAM, key rotation/restore, platform audit coverage and immediate account revocation through the app. Previous managed-backup, signed installer, native PDF/export, disconnected restart and update publication checks remain required. No live rollout or real records are changed by this implementation.

Official references

- https://firebase.google.com/docs/auth/web/totp-mfa
- https://firebase.google.com/docs/auth/admin/manage-sessions
- https://firebase.google.com/docs/auth/admin/manage-mfa-users
- https://simplewebauthn.dev/docs/packages/server
- https://simplewebauthn.dev/docs/packages/browser
- https://firebase.google.com/docs/firestore/ttl
