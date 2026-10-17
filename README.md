# Sycamore RPC attendance

Phase 1 foundation for the Windows desktop app described in `PLAN.md` and `DESIGN.md`.

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

Private Session documents cannot be written directly by clients. Validated care-editing Functions will be added with the Phase 3 pastoral screens. Audit logs are Session-only because before/after values can contain private records.

## Checks

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:rules`, and `npm run test:e2e`. Install the Playwright browser once with `npx playwright install chromium`. Rules tests need Java 21 and use local emulators. End-to-end tests exercise the same Firebase renderer code in Chromium, including marking offline and checking synchronization in a second browser context. They do not yet test an Electron restart while disconnected.

## Connecting a live church project

No live Firebase project is created or deployed by this milestone. Create the church-owned project with Firestore, email/password Authentication and Storage, and enable billing before deploying Functions. Copy `.env.example` to `.env`, set `VITE_USE_EMULATORS=false`, and fill the public Firebase web config. Never place service-account keys or provider secrets in the renderer.

The first administrator must be bootstrapped through a trusted Admin SDK environment with `roles: ['pastor', 'admin']` in custom claims. No account may grant itself roles. Only a Session administrator can grant or remove Session roles. Other accounts are provisioned in Firebase Authentication before roles are assigned through `setUserRoles`. Initial church settings must include an IANA `timeZone`, and service types must be created by a trusted setup process. The emulator seed is not a production provisioning tool.

Functions bundle shared schemas into their output so deployment does not depend on a private npm registry. Build before deployment, then deploy using an explicit project ID. This foundation has not been reviewed for production use with real church records.

## Remaining Phase 1 work

Person editing and membership history screens, contact details, elder districts, user/service-type setup screens, full attendance reports with charts and historical membership categories, backup provisioning and Export Everything, signed installer/release testing, offline restart recovery, and update publishing remain. `npm run dist` defines NSIS packaging and GitHub update metadata, but does not publish or sign a release.

Messages, Microsoft Graph, Twilio, bulletin automation and pastoral editing are later phases. There is no giving or financial tracking.
