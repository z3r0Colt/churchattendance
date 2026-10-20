# Phase 12 staff mobile access and release

Phase 12 gives staff the permitted desktop jobs in a browser, starting with attendance on a phone, and closes the release gates. It is built in parts. Scope and acceptance criteria are in [Expanded feature requirements](FEATURE_EXPANSION.md).

| Part | Scope | Status |
|---|---|---|
| 1 | Separate staff web build, in-page MFA or passkey sign-in, no private data in browser storage, phone menu and phone attendance | Implemented |
| 2 | A narrow-screen path for every other permitted workflow, reauthentication for sensitive actions, keyboard, screen reader and theme checks | Implemented |
| 3 | Release gates: live provider and security checks, managed backup and restore verification, signed Windows packaging and update publishing | Planned |

Decisions made before implementation: the staff web lives on the portal's Hosting site and origin under `/staff/`, as its own build. Phone attendance keeps offline marks in memory only. A staff web sign-in lasts only for the browser tab.

## The staff web build

The staff web is the desktop renderer built a second time for browsers (`apps/desktop/vite.web.config.ts`, `npm run build:web -w @sycamore/desktop`). The build constant `__STAFF_WEB__` decides the differences, and they all live in `renderer/platform.ts`, `renderer/data/firebase.ts`, `renderer/data/auth.ts` and the shell in `App.tsx`. Screens, data hooks, shared zod schemas, report calculations and callables are the same code on both, so the server's role checks and rules apply unchanged.

* **No desktop bridge.** Every call to a named preload function goes through `native` in `platform.ts`, which is `undefined` in the web build. Saving CSV/XLSX downloads the file, PDF reports open the printable page in a new tab, the bulletin PDF preview opens in a tab and directions open Google Maps in a new tab. The web bundle carries no preload, `ipcRenderer` or native function names, and an end-to-end test checks the built files.
* **Hosting.** The build writes to `apps/portal/dist/staff/` after the portal build, because the portal build empties `apps/portal/dist`. The Hosting `predeploy` in `firebase.json` builds the shared package, the portal and then the staff web, so every Hosting deploy ships both, and a unit test checks that order. `firebase.json` rewrites `/staff` and `/staff/**` to `/staff/index.html`. Portal visitors never load the staff bundle. The site's existing CSP, `no-store` caching and frame denial apply to it. Its `connect-src` has no `blob:`, so the bulletin preview opens the downloaded PDF in memory and never fetches its own `blob:` URL.
* **Kiosk.** The household kiosk needs the locked-down desktop window, so the web build hides the kiosk settings, and a kiosk sign-in in a browser shows "The kiosk runs on the church PC" with only Sign out.

## Sign-in and assurance

* The web sign-in offers email, password and authenticator code (the existing TOTP flow) and **Sign in with passkey** in the page. Passkeys verify against the church security origin, which is the same origin in production. Locally the emulator also accepts `http://localhost:5175` with the same `localhost` relying party. The desktop's browser handoff is not used on the web.
* Staff assurance is unchanged: `staffSecurityStatus` and `activateStaffAccess` gate the workspace, the one-minute recheck signs out on revocation, and the 30-minute idle lock applies.
* Auth uses session persistence, so closing the tab signs out and a second tab is not signed in. The "Keep this PC signed in" choice is hidden on the web.
* Passkeys and authenticators are added on the church security page (**Account security, Manage passkeys and authenticators**). It uses the portal's own Firebase app, so it asks for its own sign-in.
* Every in-page passkey sign-in, on the staff web and on the church security page, goes through one helper (`security/passkey.ts`) that sets session persistence before it signs in. A passkey sign-in on the church security page on a borrowed browser therefore also ends when the tab closes. The desktop's browser handoff does not use it.
* On the desktop sign-in screen, "Keep this PC signed in" applies to both **Sign in** and **Sign in with browser or passkey**. It starts unticked, and while it is unticked either sign-in ends when the app closes. **Confirm in browser** and **Open browser sign-in and passkeys** keep the current sign-in's choice.

## Records in the browser

* Firestore uses a memory cache in the web build. Nothing from the church records is written to IndexedDB or localStorage; localStorage holds only the theme choice.
* Any sign-out or change of account reloads the tab, which drops every listener and cached document before the next person signs in. This covers Lock now, the idle lock, revocation and a passkey sign-in over another account. The records leave the screen before the reload starts, and the leave-page question is asked only while someone is signed in, so it never holds back the reload after a lock; a reload that is cancelled or blocked shows no records.

## Phone attendance and offline

* Below 760px the sidebar becomes a labelled **Menu** (with `aria-expanded`) that opens over the page. Choosing a destination closes it, Escape closes it and returns focus to Menu, and the signed-in name and roles move into it. Session lock labels stay on menu items.
* The top bar stays in view with the sync state. The roll footer names the service and date. Tiles go two across, name chips are at least 56px tall, and household buttons and tabs at least 48px. Wide content scrolls inside the page rather than widening it.
* **What works offline:** with the roll already open, marking and unmarking names, Mark all and Undo. Marks stay in this tab and reach the church records when the connection returns. Other PCs and phones keep their own marks, because each mark is still one `present.{personId}` field.
* **What does not:** opening a new service or a different date, adding visitors and every other screen need a connection, as on the desktop. Closing or reloading the tab before marks are saved loses them. The sync badge reads "Offline, keep this tab open", and the browser asks before leaving while marks are unsaved.
* **Lock now with unsaved marks** opens a **Marks still saving** dialog, which stays in view however far down the roll the page is scrolled. It locks by itself as soon as the marks reach the church records. If the church records refuse a mark while it waits (for example the person was set to Former meanwhile), it stays open as **Some marks did not save** with the error and "Check the roll before you lock.", because the lock's reload would wipe the error. **Lock anyway** locks at once and loses them; **Keep working** (or Escape) closes the dialog and cancels the lock, so the person stays signed in after the marks save.
* **The idle lock discards unsaved marks.** The 30-minute idle lock still locks, and marks that have not reached the church records are lost when it does. This is deliberate: a shared phone left alone locks rather than staying signed in to keep them.
* **iPhones do not ask before leaving.** iPhone and iPad browsers never show the leave-page question, so there the only protection for unsaved marks is keeping the tab open until the badge reads "Online".

## Local use

`npm run dev:staff` builds, starts the emulators with seed data and serves the portal on 5174 and the staff web on http://localhost:5175/staff/. Sign in as `pastor@example.test` or `volunteer@example.test` with `LocalDemo123!`.

## Tests

`tests/e2e/staff-web.spec.ts` runs at a 390 by 844 touch viewport:

* a phone and the desktop mark different names at the same moment and both see both; the phone goes offline, marks a name while the desktop clears another, reconnects, and both changes survive; touch target, no horizontal scroll, light and dark screenshots;
* no Firestore IndexedDB, nothing but the theme in localStorage, no desktop bridge, a second tab not signed in, the menu opened and closed by mouse and Escape, no kiosk, and Lock now followed by a volunteer sign-in in the same tab shows none of the Pastor's name or Session menu;
* with a mark unsaved, closing the tab asks before leaving, while Lock anyway and the idle lock (run on Playwright's clock) both reach the sign-in page without the question and leave no names on screen, and the idle lock's mark never reaches the records;
* with a mark unsaved and the page scrolled to the bottom of the roll, Lock now shows its warning dialog in view; when the connection returns the dialog closes, the tab reaches the sign-in page with no names on screen and the mark is in the records, while Keep working closes the dialog and the person is still signed in after the marks save;
* with Lock now waiting on a mark for a person set to Former while the phone was offline, the refused mark turns the dialog into Some marks did not save, the person is still signed in a few seconds later, and Lock anyway then reaches the sign-in page;
* passkey sign-in to the staff web with a virtual authenticator and a real WebAuthn assertion;
* the built staff web bundle contains no desktop bridge names.

`tests/e2e/staff-web-csp.spec.ts` serves the staff web page with the live site's `connect-src`, read from `firebase.json` and widened only to the local emulators and Vite, and checks that a Pastor's bulletin **Preview PDF** opens a tab with no error and nothing refused. It applies only `connect-src`, because Vite's dev page uses inline scripts, and it grants local network access because a page served by the test has no local address. Headless Chromium has no PDF viewer, so it checks that the tab opens, not how the PDF looks.

`tests/e2e/security.spec.ts` checks that a passkey sign-in on the church security page stores no account in IndexedDB or localStorage, is not shared with a second tab and survives a reload of the same tab. `apps/desktop/renderer/security/passkey.test.ts` checks that the helper sets session persistence before signing in and that a passkey for another account signs nobody in.

`tests/e2e/security.spec.ts` also checks that a desktop confirmation in the browser refuses another account's approval (no token and no sign-in made), refuses it with no one signed in, accepts the same account, and that the sign-in screen's handoff still accepts any account. `apps/desktop/renderer/data/security.test.ts` checks that the desktop asks the server for the same account and stops before signing in when the returned sign-in is for another account, and that cancelling stops the checks at once, clears the wait between them and signs nobody in.

`tests/e2e/security.spec.ts` also signs in on the desktop sign-in screen through the church security page. With "Keep this PC signed in" unticked, the account is kept only in sessionStorage (none in IndexedDB or localStorage) and a newly opened app page shows the sign-in screen; ticked, the account is kept and a newly opened page is signed in. `apps/desktop/renderer/data/security.test.ts` checks that the sign-in screen's choice sets the matching persistence before signing in, that a cancelled sign-in changes nothing, and that Confirm in browser and Open browser sign-in and passkeys never change persistence.

## Every screen on a phone (part 2)

Part 2 is a layout and confirmation pass. Screens, rules, callables and the data model are unchanged, so each role reaches exactly the jobs it reaches on the desktop.

* **Grids.** The shared grids (`Records` and `ActionTable`, used for most lists) show one card per record below 760px. The first field is the card's title, each other field carries its column name, and empty fields are left out. Explicit table, row and cell roles keep the table structure for screen readers. The few custom tables (reports detail, delivery logs, contact gaps, maps lists and similar) keep a sideways scroller inside the page, as DESIGN.md allows.
* **Tabs, buttons and fields.** Tab rows wrap onto a second line, button rows and filter bars wrap, fields and dropdowns shrink to the screen and long button labels wrap. Nothing on any screen reaches past the edge of a 360 or 390px phone, and wide content never widens the page.
* **Calendar.** The month heading wraps, and the month grid stays readable at phone width; the list view remains available.
* **Maps and workflows.** Locations keep their household list beside the offline plot, and workflows keep their step list beside the diagram, so neither picture is the only way to finish a job.
* **Offline wording.** On the staff web, a page other than attendance says "Only attendance marks work offline in the browser. Changes on this page need a connection." before anyone starts editing.

### Confirm it is you

Account changes that the server already limits to a sign-in within the last five minutes now ask in the page instead of failing: adding a staff account, changing roles, disabling, enabling, revoking or recovering an account, and moving private records to new encryption. Passkey changes and desktop approval stay on the church security page, which already asks for a fresh sign-in.

* The server's refusal carries the reason `recent-sign-in` (`RECENT_SIGN_IN_REASON` in `packages/shared`). `securityCall` sees it, opens **Confirm it is you** and runs the action once more after a successful confirmation.
* The dialog names the signed-in account and offers its password (and authenticator code when the account has one), **Confirm with passkey** in the staff web, or **Confirm in browser** on the desktop. It confirms the same account only; it never switches accounts, and a passkey for another account stops before signing in.
* **Confirm in browser** asks the server to check that the account approving on the church security page is the one signed in on this PC. An approval from any other account is used up and refused with "Approve with the account signed in on this PC.", which the dialog shows, and no sign-in is made for it. The desktop also checks the account in the returned sign-in before using it. The desktop sign-in screen and **Open browser sign-in and passkeys** still accept whichever account approves.
* **Cancel** changes nothing and says "Confirmation cancelled. Nothing was changed." It stays available while **Confirm in browser** waits for the browser. Cancel or Escape stops the desktop checking for the approval, so approving in the browser afterwards signs nothing in, and the next confirmation opens with every button ready. A late answer from an earlier confirmation never settles or closes a newer one.
* Changes that ask at the same time share one **Confirm it is you**. Confirm runs each of them once more, and Cancel stops them all with the same message. If the dialog closes with its form, its request is cancelled, so no change is left waiting on **Saving**. On **Account security**, **Log scope** waits while an action runs, like the buttons, so one finishing load never re-enables them while another still runs.
* When the account has an authenticator, the code field that replaces the password starts empty; the typed password never carries into it. The sign-in form (desktop, staff web and the church security page) works the same way, and its **Start again** returns to an empty password.
* A confirm dialog opened from a form nests inside that form's dialog, which Fluent's modal handling needs; a sibling dialog left the form unreachable after it closed.

### Accessibility, themes and the booth display

* Every destination each role can open, and every tab on it, is checked at phone width; Pastor screens in light and dark, deacon screens at 360px, and the volunteer's two destinations.
* axe (`@axe-core/playwright` 4.13.0, WCAG 2 A and AA) finds no serious or critical problems on any Pastor or deacon destination in either theme or on the booth display in dark. Fluent's hidden focus sentinels (`data-tabster-dummy`) are excluded because they are focusable placeholders by design.
* The phone menu opens, moves through destinations and closes from the keyboard alone. The menu becomes visible immediately so focus moves into it.
* Every table that can scroll sideways (the shared grids and the custom tables) sits in `TableScroll` from `chms/Common.tsx`: a region named for the table (its heading or purpose, such as "Access history") that Tab reaches, with the focus ring inside its edge, so the arrow keys scroll it. Before this, a table made wide by long entries, such as Access history at 1024px, could not be scrolled from the keyboard.
* Every Pastor destination fits the 1024 by 768 booth display in both themes.

### Tests

`tests/e2e/staff-web-screens.spec.ts`:

* every Pastor destination and tab at 390px in light (with axe) and every destination in dark (with axe);
* every Pastor destination at 1024 by 768 in light and dark (axe in dark);
* Account security at 1024 by 768 in dark with long fictional Access history entries (removed afterwards): the table is wider than its panel, axe finds nothing serious, every table scroller has `tabindex="0"` and a name, and Tab reaches Access history, shows a 2px focus ring and the arrow keys scroll it;
* a deacon at 360px reaches Deacon tasks and Mercy ministry and every tab, sees no Session-only destinations and no Messages, with axe on each;
* a volunteer sees only Attendance and Account security;
* the phone menu by keyboard alone;
* a sensitive account change answered as stale: Cancel creates nothing and leaves the form usable; Confirm with the password creates the account;
* Confirm with passkey, with a virtual authenticator, creates the account without reloading the tab or changing account;
* on the desktop, Cancel stays available while Confirm in browser waits, stops the checks for a browser approval once pressed, and the next confirmation opens with every button ready and creates the account with the password;
* the confirm dialog asking for an authenticator code shows an empty code field and the password nowhere on the page;
* the sign-in authenticator step shows an empty code field, and Start again returns to an empty password field;
* the statistical report's figures in the browser equal the desktop's.

`apps/desktop/renderer/data/reauth.test.ts` checks that two overlapping changes open one confirmation, that Confirm runs each once more and Cancel rejects both with the same message, that a later change asks afresh, and that any other error passes through without asking.

## Remaining limits

* The confirm test simulates the server's "sign-in too old" answer for the first call, because a fresh test sign-in is always recent. The server's five-minute rule itself has unit tests.
* The authenticator step tests answer the Auth emulator's password sign-in the way Firebase answers an account with an authenticator, because the emulator cannot issue authenticator codes. They check the form only, not a real code.
* Custom tables scroll sideways rather than becoming cards.
* Before production use, add the staff web URL to the release checks: the Hosting rewrite and CSP on the live site, passkey sign-in and confirmation on the live origin, and a real phone on the church network. Part 3 covers these.
