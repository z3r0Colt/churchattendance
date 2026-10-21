# Church attendance and management

Attendance, communication and shepherding with staff and member web access. Product scope lives in `PLAN.md` and UI rules in `DESIGN.md`.

## Next development milestone

The approved direction is an online PWA service on Firebase, with church branding and a separate Firebase project for each church. Read [Managed church PWA development plan](docs/PWA_SERVICE_PLAN.md) for Phases 13 through 18, implementation order and release gates. Phase 13 branding is verified. Phases 14–17 now have implementation and automated checks; live staging acceptance remains separate.

The supported product path is staff/member web. See [PWA verification](docs/PHASE_14.md) and the [operator runbook](docs/OPERATOR_RUNBOOK.md) for the current code, evidence and staging gates. Earlier phase notes below describe their historical baselines. Native Windows releases, signing, kiosk and offline persistence are no longer PWA launch requirements. Provisioning, security/provider acceptance, backups and recovery remain required. Giving/accounting and denomination configuration are deferred.

## Approved expansion

All ten feature areas from the October 18 TendFlock comparison are in scope. [Expanded feature requirements](docs/FEATURE_EXPANSION.md) maps them to Phases 7 through 12. Phase 7 implements staff MFA/passkey access, encrypted private records and account/security administration. Read [Phase 7 setup](docs/PHASE_7.md) before staging or deployment. Phase 8 implements the Session shepherding workspace. Phases 9 through 11 and Phase 12 parts 1 and 2 are implemented. Phase 12 part 3 remains pending. See the [implementation status](docs/FEATURE_EXPANSION.md#implementation-status). Live configuration and release checks below still apply.

## Run locally

Install Node 22 and Java 21 or newer. From the repository root run `npm install`, then `npm run dev`. Firebase emulators start locally, fictional people are seeded, and the staff/member web development servers start. Staff opens at http://localhost:5175/staff/ and the portal at http://localhost:5174. The seed script refuses to run without emulator endpoints.

Local accounts, both using password `LocalDemo123!`

| Account | Roles |
| --- | --- |
| pastor@example.test | Pastor and Admin |
| volunteer@example.test | Attendance Volunteer |

`npm run dev:ui` serves the staff web at `/staff/` without starting emulators. `npm run dev:legacy` is the optional Electron development path. It still needs running Firebase emulators. `npm run seed` can populate emulators that are already running when the Auth and Firestore emulator environment variables are set.

## Implemented in this milestone

* Staff/member web with an install manifest, controlled updates, sign-in, live role/assurance checks, 30-minute idle sign-out and light/dark/system themes. The hardened Electron source remains optional.
* Names-only attendance roster, household roll call, search, Enter/Space/arrow shortcuts, live totals, household clear with Undo, collapsed non-resident list.
* Memory-only records and field-level attendance updates. A connection is required; unconfirmed writes stay pending and disconnected users cannot start changes. Closing the app may lose unconfirmed work.
* Visitor quick add and household entry through validated Functions. Consent defaults off. Atomic membership history on household creation and membership changes. The person update API takes only changed fields.
* Historical attendance reports with date, service type, membership and district filters. Reports include a summary, matrix, shepherding, visitor follow-up and membership roll. XLSX files use Summary, Detail and Data sheets, and PDF templates support readable multi-page reports. Missing history is flagged.
* Default-deny Firestore and Storage rules, Session isolation, assigned Deacon task completion, a server-owned audit trail, emulator tests and browser workflow tests.

Private records cannot be read or written directly by clients, even by Session. Audited callable APIs serve the pastoral screens and assigned deacon tasks. Protected fields and audit before/after values are encrypted server-side. Private data remains in component memory and is excluded from the attendance cache. Audit content remains Session-only.

## Checks

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:rules`, and `npm run test:e2e`. Install the Playwright browser once with `npx playwright install chromium`. Rules tests need Java 21 and use local emulators. End-to-end tests exercise the supported web renderer in Chromium, including connection loss, server acknowledgments, concurrent field updates, security lock and the existing privacy workflows. CI also provisions two fictional emulator churches and restores a fictional church into an isolated recovery project.

## Connecting a live church project

No live Firebase project is created or deployed by this milestone. Create the church-owned project with Firestore, email/password Authentication and Storage, and enable billing before deploying Functions. Copy `.env.example` to `.env`, set `VITE_USE_EMULATORS=false`, and fill the public Firebase web config. Never place service-account keys or provider secrets in the renderer.

The chosen administrator is bootstrapped through the trusted operator process with explicitly approved roles, starting with Admin. Session is never automatic. Email verification and real MFA/passkey enrollment remain required before record access. No account may grant itself roles. Only a Session administrator can grant or remove Session roles. After bootstrap, Account security can create other staff accounts and manage roles without sending an invitation email. An Admin or Pastor can configure church settings, service types and elder districts in Settings. The church settings include an IANA `timeZone`. The emulator seed is not a production provisioning tool.

Functions bundle shared schemas into their output so deployment does not depend on a private npm registry. Build before deployment, then deploy using an explicit project ID. This foundation has not been reviewed for production use with real church records.

## Remaining Phase 1 work

Historical native release work (signed installers, offline restart recovery and native update publishing) is outside the supported PWA launch path. Managed backup/recovery and live staging acceptance are covered by Phases 15–18. Phase 7 adds staff account/role setup and security screens; live Identity Platform, origin, key and recovery configuration still require staging verification. Phase 5 adds person editing, membership history, elder districts, church/service setup and a scoped document archive. The archive has explicit exclusions and does not replace managed backups. `npm run dist` defines NSIS packaging and GitHub update metadata, but does not publish or sign a release.

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

## Phase 6 attendance reports and dashboard

Reports now reconstructs categories from dated membership history and flags unclassified marks. The dashboard links attendance tiles to filtered reports and keeps private follow-up information within the Session. Read [Phase 6 workflows](docs/PHASE_6.md) for report definitions, export layouts and limits.

## Phase 7 security and accounts

Staff access now requires verified email and completed MFA or a server-verified passkey session. Account security provides staff setup, role changes, revocation/recovery, scoped access history and Session-administrator encryption migration. The separate portal security page supports passkey registration/sign-in and a one-time browser approval for the desktop. The local seed uses guarded synthetic assurance for fictional accounts; it is not a live MFA demonstration. Read [Phase 7 setup and limits](docs/PHASE_7.md) for staging and rollout requirements.

## Phase 8 shepherding workspace

The Session-only Shepherding page plans household visits with invited deacons, tracks officer workload and visit rounds, and shows explainable contact gaps. Communication settings configure the weekly district digest and the daily officer summary. Locations and routes keep confirmed household coordinates and preview directions before anything leaves the app, and Flock health shows recorded-fact indicators beside dated Session assessments. Read [Phase 8 workflows and limits](docs/PHASE_8.md). Address lookups are off until the Session turns them on, and live delivery checks still apply.


## Managed PWA implementation

The approved next work is on the PWA service plan in `docs/PWA_SERVICE_PLAN.md`. Phase 13 branding implementation passed automated acceptance; see `docs/PHASE_13.md` for the public/protected split, required deployment binding, explicit legacy migration and verification evidence. Phases 14–18 remain planned. Existing native/offline behavior is not yet replaced.

## Managed PWA implementation

The current `codex/pwa-service` work makes `npm run build` and `npm run dev` target the staff/member web apps. Optional native output uses `npm run build:legacy`; `npm run dist` is outside the PWA release path. Phase 13 has verified acceptance; Phases 14–17 are in implementation/verification and retain separate live staging gates. See [PWA verification](docs/PHASE_14.md), [operator runbook](docs/OPERATOR_RUNBOOK.md), and [service plan](docs/PWA_SERVICE_PLAN.md). No live infrastructure or real provider sends are performed by the local examples/drills.
