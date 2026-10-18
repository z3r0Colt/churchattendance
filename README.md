# Sycamore RPC attendance

Attendance and communication for the Windows desktop app described in `PLAN.md` and `DESIGN.md`.

## Run locally

Install Node 22 and Java 21 or newer. From the repository root run `npm install`, then `npm run dev`. Firebase emulators start locally, fictional people are seeded, and Electron opens. The seed script refuses to run without emulator endpoints.

Local accounts, both using password `LocalDemo123!`

| Account | Roles |
| --- | --- |
| pastor@example.test | Pastor and Admin |
| volunteer@example.test | Attendance Volunteer |

`npm run dev:ui` opens only the renderer development server for browser testing. It still needs running Firebase emulators. `npm run seed` can populate emulators that are already running when the Auth and Firestore emulator environment variables are set.

## Implemented in this milestone

* Hardened Electron shell, named preload methods, sign-in, custom-claim roles, 30-minute idle sign-out, light/dark/system themes.
* Names-only attendance roster, household roll call, search, Enter/Space/arrow shortcuts, live totals, household clear with Undo, collapsed non-resident list.
* Firestore IndexedDB persistence and field-level roll-call updates. Starting a service requires a connection; marking a cached service works offline.
* Visitor quick add and household entry through validated Functions. Consent defaults off. Atomic membership history on household creation and membership changes. The person update API takes only changed fields.
* A basic service attendance summary with date filters, CSV/XLSX export and desktop PDF output. Workbooks have Summary, Detail and Data sheets. Categories use current membership status. Historical category reconstruction and full report layouts are still pending.
* Default-deny Firestore and Storage rules, Session isolation, assigned Deacon task completion, a server-owned audit trail, emulator tests and browser workflow tests.

Private Session documents cannot be written directly by clients. Validated care-editing Functions serve the Phase 3 pastoral screens. Audit logs are Session-only because before/after values can contain private records.

## Checks

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:rules`, and `npm run test:e2e`. Install the Playwright browser once with `npx playwright install chromium`. Rules tests need Java 21 and use local emulators. End-to-end tests exercise the same Firebase renderer code in Chromium, including marking offline and checking synchronization in a second browser context. They do not yet test an Electron restart while disconnected.

## Connecting a live church project

No live Firebase project is created or deployed by this milestone. Create the church-owned project with Firestore, email/password Authentication and Storage, and enable billing before deploying Functions. Copy `.env.example` to `.env`, set `VITE_USE_EMULATORS=false`, and fill the public Firebase web config. Never place service-account keys or provider secrets in the renderer.

The first administrator must be bootstrapped through a trusted Admin SDK environment with `roles: ['pastor', 'admin']` in custom claims. No account may grant itself roles. Only a Session administrator can grant or remove Session roles. Other accounts are provisioned in Firebase Authentication before roles are assigned through `setUserRoles`. An Admin or Pastor can now configure church settings, service types and elder districts in Settings. The church settings include an IANA `timeZone`. The emulator seed is not a production provisioning tool.

Functions bundle shared schemas into their output so deployment does not depend on a private npm registry. Build before deployment, then deploy using an explicit project ID. This foundation has not been reviewed for production use with real church records.

## Remaining Phase 1 work

Staff account/role setup screens, full attendance reports with charts and historical membership categories, managed backup provisioning, signed installer/release testing, offline restart recovery, and update publishing remain. Phase 5 adds person editing, membership history, elder districts, church/service setup and a scoped document archive. The archive has explicit exclusions and does not replace managed backups. `npm run dist` defines NSIS packaging and GitHub update metadata, but does not publish or sign a release.

## Phase 2 communication

Messages now supports email and text, recipient previews, reusable templates and lists, consent records, scheduled delivery, a reply inbox and per-person history. Bulletin supports app uploads, Microsoft folder pickup, Pastor previews, Saturday reminders and a weekly send. Elder absence alerts use three recorded Lord's Days and go only to linked Session recipients with consent.

Microsoft Graph and Twilio adapters are implemented behind provider interfaces. Local emulators always use fakes. Provider credentials remain in Secret Manager, and the app receives no credentials. Live delivery remains disabled until the church accounts and server settings are configured.

Read [Communication setup](docs/COMMUNICATIONS_SETUP.md) for the Microsoft, Twilio and Firebase steps, delivery limits and verification requirements. No live accounts or DNS records were changed by this implementation. Remaining Phase 1 work listed above is still separate. Pastoral editing is implemented in Phase 3. There is no giving or financial tracking.

## Phase 3 ChMS extras

Groups now includes membership, meeting schedules and named attendance. Calendar supports recurring events and per-occurrence RSVPs. Serving includes conflict checks, gaps and consented text reminders. Session care includes notes, visits, follow-ups and discipline history; assigned Deacons receive a separate practical task list. The optional kiosk uses an expiring identity with no direct database access. Annual reports adds historical statistics, monthly meeting summaries and a photo directory, with charted XLSX and isolated PDF templates.

Read [Phase 3 workflows](docs/PHASE_3.md) for roles, recurrence rules, kiosk provisioning and release checks. Live church provisioning and native Windows release verification remain necessary. The earlier Phase 1 remaining-work list still applies.

## Phase 4 member portal

The separate mobile-friendly portal provides verified member access, an opt-in contact directory, personal RSVPs, visitor forms and published event request forms. Staff review requests and manage account links/publication through Online access. Public forms do not subscribe people to messages or reserve event places before review. Members receive no staff privileges or direct database access.

Use npm run dev:portal for the fictional local demo, or read [Phase 4 setup](docs/PHASE_4.md) for hosting, App Check, origin/secret configuration and church account provisioning. No live portal has been deployed.

## Phase 5 staff administration

People now includes editable profiles, membership timelines, person attendance, household editing and adding people to existing households. Settings adds church, service type and elder district setup. Administrative exports use paginated, allowlisted data with Session records restricted to Session administrators.

Read [Phase 5 workflows](docs/PHASE_5.md) for permissions, stale-edit checks, archive format and exclusions, and remaining production/release work.
