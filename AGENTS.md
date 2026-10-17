# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Copilot, and others) working in this repository. Read this file, `PLAN.md`, and `DESIGN.md` before making changes.

## Project

Windows desktop church management app for **Sycamore Reformed Presbyterian Church** (sycamorerpc.org). It tracks name by name attendance for members, non-residents, adherents and visitors, and handles people, households, groups, events, email, text messaging, the Saturday bulletin email, and reports with CSV/XLSX export. It is a Tithely ChMS style app **without giving or tithing**. Do not add any giving, pledge, donation or money tracking feature.

* `PLAN.md` is the product plan and the source of truth for scope and the data model.
* `DESIGN.md` is the UI design system and screen specs.

## Stack

* Desktop app built with Electron, React, TypeScript and Vite, with Fluent UI React v9
* Firebase for Authentication (roles in custom claims), Cloud Firestore (with persistent offline cache), Cloud Storage, and Cloud Functions 2nd gen on Node 22
* Email through Microsoft Graph from the shared mailbox office@sycamorerpc.org
* SMS through Twilio, behind a provider interface
* ExcelJS for XLSX, Papa Parse for CSV, Chart.js for charts, Electron printToPDF for PDF
* electron-builder (NSIS) with electron-updater for packaging
* Vitest, `@firebase/rules-unit-testing` with the Firebase Emulator Suite, and Playwright for tests

## Repository layout

```
apps/desktop/main/        Electron main process
apps/desktop/preload/     contextBridge API exposed to the renderer
apps/desktop/renderer/    React UI
functions/                Cloud Functions
packages/shared/          Shared types, zod schemas, membership rules, report math
firestore.rules           Security rules
firestore.indexes.json
storage.rules
firebase.json
tests/rules/              Security rule tests
tests/e2e/                Playwright tests
```

npm workspaces tie the packages together. Shared types and validation live in `packages/shared` and are imported by both the renderer and functions. Never duplicate them.

## Commands

These are created in Phase 1. Keep the names stable.

| Command | What it does |
|---|---|
| `npm install` | Install all workspaces |
| `npm run dev` | Start Firebase emulators and the Electron app against them |
| `npm run lint` | ESLint across all workspaces |
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm test` | Vitest unit tests |
| `npm run test:rules` | Security rule tests inside `firebase emulators:exec` |
| `npm run test:e2e` | Playwright tests against the emulators |
| `npm run build` | Build renderer, main, preload and functions |
| `npm run dist` | Build the Windows installer |

Before every commit run `npm run lint`, `npm run typecheck` and `npm test`. If you touched `firestore.rules`, `storage.rules`, roles, or anything under `sessionPrivate`, `careNotes`, `followUps` or `diaconalTasks`, also run `npm run test:rules`.

## Security and privacy rules (never break these)

1. **Session only data.** `sessionPrivate`, `careNotes` and `followUps` may be read or written only by users whose role is Pastor, Clerk or Elder. An Admin who is not on Session cannot read them. Deacons may only read and complete `diaconalTasks` assigned to them. Every rule change needs a passing test proving both the allow and the deny cases.
2. **Locking is per document.** Firestore rules cannot hide a single field, so never put sensitive data on `people/{id}`. Put it in a Session only collection.
3. **No secrets on the client.** Twilio, Microsoft Graph and any other credentials live only in Secret Manager and are used only by Cloud Functions. The Firebase web config is public by design and may ship in the app.
4. **Electron hardening.** Keep `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. The renderer talks to the OS only through named functions in `preload`. Never expose `ipcRenderer` or `require` directly. Do not load remote content into app windows.
5. **Audit log.** `auditLog` is written only by Cloud Functions triggers. Clients must not be able to write it.
6. **No real people in code.** Tests, fixtures, seed data and screenshots use made up names only. Never commit an export of real church data.
7. **Opt-outs are absolute.** Never send an email or text to a person whose `emailOptIn` or `smsOptIn` is false, including the bulletin. STOP replies must flip `smsOptIn` to false.
8. **Twilio webhooks** must verify the `X-Twilio-Signature` header before doing anything.

## Domain terms

Use these words in code, UI text and docs.

* **Lord's Day**, not Sunday, in all UI text. Code may use `lordsDay`.
* **Session** means the governing elders (Pastor, Clerk, Elders). It is not a login session. In code call the role group `SESSION_ROLES` and call login sessions `authSession`.
* Membership statuses in code are `communicant`, `baptized`, `nonResident`, `adherent`, `visitor` and `former`. In the UI they read Communicant Member, Baptized Member, Non-resident Member, Adherent, Visitor and Former.
* **Elder district** is the group of households a shepherding elder cares for.
* **Service** is one meeting on a date, such as Lord's Day Morning on 2026-11-01. **Service type** is the recurring template.
* Children are ordinary people on the roll in their household. There is no separate children's check-in.
* All attendance is name by name. There is no headcount only mode.

## Data model notes

* The full model is in `PLAN.md` section 4.3. Update `PLAN.md` in the same commit if you change it.
* Attendance lives on `services/{serviceId}.present.{personId}`. Mark present with `updateDoc` on that one field path and unmark with `deleteField()`. Never rewrite the whole `present` map, because that breaks offline merging between the booth and the kiosk.
* Edits to people send only the changed fields with `updateDoc`. Never `setDoc` a whole person from a form.
* Store dates as ISO `YYYY-MM-DD` strings for calendar dates (birthdays, service dates) and Firestore `Timestamp` for moments (check-in time, sent time). The church time zone setting (`settings/church.timeZone`) decides what "Saturday 6:00 PM" means. Never use the PC's local zone in Functions.
* Membership status changes always create a `membershipEvents` document in the same batch.

## Code conventions

* TypeScript `strict`, no `any` unless commented why.
* Validate every write with the zod schema from `packages/shared` before it leaves the client, and again in Functions.
* React function components and hooks. Firestore access goes through hooks in `renderer/data/` and never sits directly inside components.
* Follow `DESIGN.md` for layout, tokens and components. Do not add another UI library.
* Keep UI text short, plain and kind. No exclamation marks in system messages.
* Every grid that shows data gets the shared Export button (CSV and XLSX) that exports what is filtered on screen.
* Reports follow the Summary, Detail, Data sheet layout in `PLAN.md` section 3.7.

## Testing

* Pure logic (report math, membership counts, statistical report, merge fields, bulletin scheduling) gets Vitest unit tests in `packages/shared`.
* Every Firestore and Storage rule gets allow and deny tests in `tests/rules/`, including Admin without Session denied from Session data.
* Functions are tested against the emulators with Twilio and Graph faked behind their provider interfaces. Tests never call real Twilio or Microsoft.
* Offline behavior for roll call (mark while offline, reconnect, data syncs) has a Playwright test.
* Never skip, disable or delete a failing test to get green. Fix the cause.

## Git

* Small focused commits with clear messages in the imperative mood.
* Do not commit `.env` files, service account keys, `firebase-debug.log` or build output.
* Do not create pull requests unless asked.
