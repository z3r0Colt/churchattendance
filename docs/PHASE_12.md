# Phase 12 staff mobile access and release

Phase 12 gives staff the permitted desktop jobs in a browser, starting with attendance on a phone, and closes the release gates. It is built in parts. Scope and acceptance criteria are in [Expanded feature requirements](FEATURE_EXPANSION.md).

| Part | Scope | Status |
|---|---|---|
| 1 | Separate staff web build, in-page MFA or passkey sign-in, no private data in browser storage, phone menu and phone attendance | Implemented |
| 2 | A narrow-screen path for every other permitted workflow, reauthentication for sensitive actions, keyboard, screen reader and theme checks | Planned |
| 3 | Release gates: live provider and security checks, managed backup and restore verification, signed Windows packaging and update publishing | Planned |

Decisions made before implementation: the staff web lives on the portal's Hosting site and origin under `/staff/`, as its own build. Phone attendance keeps offline marks in memory only. A staff web sign-in lasts only for the browser tab.

## The staff web build

The staff web is the desktop renderer built a second time for browsers (`apps/desktop/vite.web.config.ts`, `npm run build:web -w @sycamore/desktop`). The build constant `__STAFF_WEB__` decides the differences, and they all live in `renderer/platform.ts`, `renderer/data/firebase.ts`, `renderer/data/auth.ts` and the shell in `App.tsx`. Screens, data hooks, shared zod schemas, report calculations and callables are the same code on both, so the server's role checks and rules apply unchanged.

* **No desktop bridge.** Every call to a named preload function goes through `native` in `platform.ts`, which is `undefined` in the web build. Saving CSV/XLSX downloads the file, PDF reports open the printable page in a new tab, the bulletin PDF preview opens in a tab and directions open Google Maps in a new tab. The web bundle carries no preload, `ipcRenderer` or native function names, and an end-to-end test checks the built files.
* **Hosting.** The build writes to `apps/portal/dist/staff/` after the portal build, and `firebase.json` rewrites `/staff` and `/staff/**` to `/staff/index.html`. Portal visitors never load the staff bundle. The site's existing CSP, `no-store` caching and frame denial apply to it.
* **Kiosk.** The household kiosk needs the locked-down desktop window, so the web build hides the kiosk settings, and a kiosk sign-in in a browser shows "The kiosk runs on the church PC" with only Sign out.

## Sign-in and assurance

* The web sign-in offers email, password and authenticator code (the existing TOTP flow) and **Sign in with passkey** in the page. Passkeys verify against the church security origin, which is the same origin in production. Locally the emulator also accepts `http://localhost:5175` with the same `localhost` relying party. The desktop's browser handoff is not used on the web.
* Staff assurance is unchanged: `staffSecurityStatus` and `activateStaffAccess` gate the workspace, the one-minute recheck signs out on revocation, and the 30-minute idle lock applies.
* Auth uses session persistence, so closing the tab signs out and a second tab is not signed in. The "Keep this PC signed in" choice is hidden on the web.
* Passkeys and authenticators are added on the church security page (**Account security, Manage passkeys and authenticators**). It uses the portal's own Firebase app, so it asks for its own sign-in.

## Records in the browser

* Firestore uses a memory cache in the web build. Nothing from the church records is written to IndexedDB or localStorage; localStorage holds only the theme choice.
* Any sign-out or change of account reloads the tab, which drops every listener and cached document before the next person signs in. This covers Lock now, the idle lock, revocation and a passkey sign-in over another account.

## Phone attendance and offline

* Below 760px the sidebar becomes a labelled **Menu** (with `aria-expanded`) that opens over the page. Choosing a destination closes it, Escape closes it and returns focus to Menu, and the signed-in name and roles move into it. Session lock labels stay on menu items.
* The top bar stays in view with the sync state. The roll footer names the service and date. Tiles go two across, name chips are at least 56px tall, and household buttons and tabs at least 48px. Wide content scrolls inside the page rather than widening it.
* **What works offline:** with the roll already open, marking and unmarking names, Mark all and Undo. Marks stay in this tab and reach the church records when the connection returns. Other PCs and phones keep their own marks, because each mark is still one `present.{personId}` field.
* **What does not:** opening a new service or a different date, adding visitors and every other screen need a connection, as on the desktop. Closing or reloading the tab before marks are saved loses them. The sync badge reads "Offline, keep this tab open", the browser asks before leaving while marks are unsaved, and Lock now warns with **Lock anyway** or **Keep working**. The 30-minute idle lock still locks.

## Local use

`npm run dev:staff` builds, starts the emulators with seed data and serves the portal on 5174 and the staff web on http://localhost:5175/staff/. Sign in as `pastor@example.test` or `volunteer@example.test` with `LocalDemo123!`.

## Tests

`tests/e2e/staff-web.spec.ts` runs at a 390 by 844 touch viewport:

* a phone and the desktop mark different names at the same moment and both see both; the phone goes offline, marks a name while the desktop clears another, reconnects, and both changes survive; touch target, no horizontal scroll, light and dark screenshots;
* no Firestore IndexedDB, nothing but the theme in localStorage, no desktop bridge, a second tab not signed in, the menu opened and closed by mouse and Escape, no kiosk, and Lock now followed by a volunteer sign-in in the same tab shows none of the Pastor's name or Session menu;
* passkey sign-in to the staff web with a virtual authenticator and a real WebAuthn assertion;
* the built staff web bundle contains no desktop bridge names.

## Part 1 limits

* Other screens work in the browser but have not yet had their narrow-screen pass; wide grids scroll sideways. Part 2 covers each workflow.
* Reauthentication for sensitive actions still uses the existing five-minute recent sign-in checks on the server; Part 2 adds the in-page prompt.
* Before production use, add the staff web URL to the release checks: the Hosting rewrite and CSP on the live site, passkey sign-in on the live origin, and a real phone on the church network.
