# DESIGN.md

The visual direction was chosen in October 2026 from mockups of the attendance, dashboard, person profile and portal screens: a warm, quiet ground, a grouped sidebar, Cambria display headings, number tiles and household name chips on the roll.

The UI design system and screen specs for the church management app, originally developed for Sycamore RPC. Agents and developers follow this file for every screen. Product scope lives in `PLAN.md`.

## 0. Approved PWA service design

The October 20, 2026 direction in [Managed church PWA development plan](docs/PWA_SERVICE_PLAN.md) governs the next implementation. This section describes planned behavior. Existing screenshots and native/offline specs below are historical where they conflict with it.

- The October 21 multi-tenant decision in [Multi-tenant plan](docs/MULTITENANT_PLAN.md) supersedes the per-church-origin default. Start with a central application origin and explicit church routes/selection. Show the active church throughout sign-in and work; clear private state and reauthenticate on a church change. Initially use one platform PWA identity, with church branding after selection. Optional church domains and distinct installations require separate Auth/passkey/device acceptance. Installation never grants access.
- Foldkeeper is the product name. Keep church identity primary and show a quiet, readable **Powered by Foldkeeper** credit in the shared wordmark on sign-in, staff/member screens and launch/account-security pages. Keep the credit visible on phones and in light/dark themes. Browser titles and full PWA installation names include Foldkeeper; compact installation names and icons retain church branding.
- Use validated church branding in the sign-in screen, shell, installation name/icons and exports. Retain Fluent components, readable typography, theme support, WCAG AA contrast and fixed confidentiality labels. Public branding never includes protected settings or member records.
- Replace Windows-specific wording with browser/device wording. Sign-in remains session-scoped by default. Do not add persistent staff sign-in or private record caching for installation convenience.
- Kiosk screens and Windows installer/update prompts are excluded from supported PWA navigation.
- Connection states distinguish Connected, Saving, Saved, Connection required and failed/unconfirmed writes. A local optimistic mark is not a saved mark. Known disconnection disables new write actions. Losing connectivity during saving must show that the result is not yet confirmed.
- Do not claim changes are saved on the device or promise offline recovery. Warn about pending work before navigation/update where supported. Revocation, idle lock and sign-out still clear private content and do not wait indefinitely for pending writes.
- A PWA update notice never forces a reload over edits or unconfirmed operations. Cached files may show a connection-required page, not an offline church workspace.
- Keep phone and desktop access to the same permitted workflows. Test browser exports and PDFs, including a clear print-to-PDF fallback where needed.

The existing role matrix and all Session/deacon privacy boundaries remain unchanged. The product roadmap and acceptance checks live in `PLAN.md` and the linked service plan.

## 1. Principles

1. **Plain and reverent.** The app serves a Reformed congregation. Keep it quiet, orderly and uncluttered. No playful illustrations, confetti, emoji or bright marketing colors.
2. **Built for the sound booth.** Roll call happens in a dim booth during the minutes before worship, often by a volunteer. Big targets, high contrast, keyboard friendly, and nothing that needs a second click when one will do.
3. **One job per screen.** Each screen answers one question, such as "who is here today" or "who has the elder not seen lately".
4. **Show what is private.** Session only data always carries a lock icon and the words "Session only", so no one is surprised about who can see it.
5. **Tell the truth about saved work.** Connection and save status are always visible. Only server-confirmed changes count as saved. Never imply unconfirmed work will survive closing the app.

## 2. Foundations

Built on **Fluent UI React v9**. Use its components and tokens. Do not hand roll a control Fluent already has.

### 2.1 Brand color
The brand color is a deep sycamore green. Generate the Fluent `BrandVariants` ramp from `#2F6B4F` with the Fluent theme designer and store it in `renderer/theme/brand.ts`.

| Token | Light | Dark | Use |
|---|---|---|---|
| brand primary | `#2F6B4F` | `#6FB592` | Primary buttons, selected nav, links |
| background | `#F6F4EE` | `#181B1A` | App background, top bar and sidebar (a warm, quiet ground) |
| surface | `#FFFFFF` | `#222624` | Cards, panels, dialogs |
| surface subtle | `#EFECE4` | `#2A2F2C` | Hover, date badges, empty bars |
| text primary | `#1F2321` | `#ECEEEC` | Body text |
| text secondary | `#5B625E` | `#A9B0AC` | Labels, hints |
| border | `#E2DED5` | `#383E3B` | Panel edges, inputs |
| divider | `#EEEBE4` | `#2E3331` | Rows inside a panel |
| present fill | `#EEF6F1` | `#20372B` | Present rows and chips, the selected nav item |
| present | `#2F6B4F` | `#6FB592` | Present check marks and counts |
| warning | `#9A6200` | `#E0A84A` | Absence alerts, pending sync |
| danger | `#B3261E` | `#F2B8B5` | Errors, failed sends, destructive actions |
| session lock | `#4A3C78` on `#EFEBF8`, outline `#D8D1EA` | `#D6CCF2` on `#2C2640`, outline `#4A4168` | Session only badges, outlines and nav locks |

All text and icon pairs must meet WCAG AA contrast (4.5 to 1 for text, 3 to 1 for large text and icons). Check both themes.

### 2.2 Themes
* Light, Dark, and Match Windows. The setting is per PC, so the sound booth PC can stay in Dark while the Pastor's office PC stays in Light.
* The Kiosk always uses the light theme with extra large type.

### 2.3 Type
* Body font is **Segoe UI Variable** (Windows default) through Fluent tokens. No web fonts.
* Display font is **Cambria** (falling back to Georgia), which ships with Windows. It is used, at regular weight, for page titles (32px), section and panel headings (20px), household names on the roll, the wordmark and large numbers in tiles. Never use it for body text, labels, buttons or tables.
* Base size 14px. Roll call names are 16px semibold. Kiosk names are 24px.
* Page titles use Fluent `Title3` restyled with the display font. Section headings use `Subtitle2`, also in the display font.
* Numbers in tables and stat tiles use tabular figures.

### 2.4 Spacing, size and shape
* 4px grid. Common gaps are 8, 12, 16 and 24.
* Corner radius is 6px for controls and nav items, 8px for chips and 10px for panels and tiles.
* Minimum click target is 40px tall on regular screens, 48px on Take Attendance, and 64px on the Kiosk.
* Minimum window size is 1024 by 680. Layouts must work at 1366 by 768, which is typical for an older booth PC.

### 2.5 Icons
Fluent UI System Icons only, regular style, filled style for the selected state. Every icon button has a tooltip and an `aria-label`.

## 3. Membership status badges

Status always shows as a text badge. Color is never the only signal.

| Status | Badge text | Badge style |
|---|---|---|
| communicant | Communicant | brand, filled |
| baptized | Baptized | brand, outline |
| nonResident | Non-resident | neutral, filled |
| adherent | Adherent | informative, outline |
| visitor | Visitor | warning, outline |
| former | Former | neutral, outline, dimmed row |

Officer roles (Pastor, Elder, Deacon) show as a second small badge after the name.

## 4. App shell

```
+--------------------------------------------------------------------------------+
| [Sycamore RPC]                        (o) Online   James Calder, Pastor    [v] |
+--------------+-----------------------------------------------------------------+
|  Dashboard   |  Page title                                    [Primary action] |
|  Attendance  |  ---------------------------------------------------------------|
|  People      |                                                                 |
|  Households  |  Page content                                                   |
|  Groups      |                                                                 |
|  Calendar    |                                                                 |
|  Serving     |                                                                 |
|  Messages    |                                                                 |
|  Bulletin    |                                                                 |
|  Reports     |                                                                 |
|  Pastoral  # |                                                                 |
|              |                                                                 |
|  Settings    |                                                                 |
+--------------+-----------------------------------------------------------------+
```

* The top bar and sidebar share the warm background. The wordmark reads "Sycamore" in the display font with "REFORMED PRESBYTERIAN" in small capitals beneath.
* The left nav is 220px and grouped under small labels: **Worship** (Dashboard, Attendance, Calendar, Serving), **Congregation** (People & households, Groups, Messages, Bulletin, Online access), **Care · Session only** (Pastoral care, Shepherding, Care workflows), **Ministry** (Deacon tasks, Mercy ministry, Important dates) and **Records** (Reports, Annual reports, Settings, Account security). A group appears only when the role can open at least one of its items.
* The current page is marked with the present fill and semibold text, and `aria-current="page"`.
* Session only items show a lock icon, and their accessible name ends with "· Session only". They are hidden entirely for users without a Session role.
* Top right shows the connection pill and the signed in user with role. The menu holds Theme, Lock now, and Sign out.

### 4.1 Connection pill
| State | Pill | Extra |
|---|---|---|
| Online, all saved | green dot, "Online" | none |
| Saving | spinner, "Saving" | none |
| Offline | amber dot, "Offline, changes saved on this PC" | thin amber bar across the top of the page |
| Back online, syncing | spinner, "Syncing 12 changes" | bar turns green, then fades after 3 seconds |
| Sync error | red dot, "Some changes did not save" | click opens details with a Retry button |

### 4.2 Navigation by role
| Section | Admin | Pastor | Clerk | Elder | Deacon | Attendance Volunteer | Read Only |
|---|---|---|---|---|---|---|---|
| Dashboard | yes | yes | yes | yes | yes | no | yes |
| Attendance | yes | yes | yes | yes | yes | yes (only screen) | view |
| People, Households | yes | yes | yes | yes | view | names only | view |
| Groups, Calendar, Serving | yes | yes | yes | yes | yes | no | view |
| Messages, Bulletin | yes | yes | yes | yes | no | no | no |
| Reports | yes | yes | yes | yes | attendance only | no | yes |
| Pastoral (Session only) | no | yes | yes | yes | no | no | no |
| Deacon Tasks | yes | yes | yes | yes | own tasks | no | no |
| Mercy ministry | no | all records | triage | triage | assigned households and requests (chairs also triage) | no | no |
| Important dates | anniversaries | anniversaries and bereavement | anniversaries and bereavement | anniversaries and bereavement | no | no | no |
| Care workflows (Session only) | no | yes | yes | yes | no | no | no |
| Settings | yes | yes | limited | no | no | no | no |

An Admin who is not on Session never sees Pastoral, even though Admin can do everything else.

## 5. Screens

### 5.1 Sign in
Centered card with the church name, email, password, and a "Keep this PC signed in" checkbox (meant for the booth PC). The checkbox starts unticked and applies to both the password sign-in and Sign in with browser or passkey. Errors read plainly, such as "That email and password do not match."

### 5.2 Take Attendance (most important screen)

```
+--------------------------------------------------------------------------------+
|  Lord's Day, November 1, 2026                                    [Add visitor] |
|  Take attendance                                                               |
|  Lord's Day Morning · Children are counted with their families.               |
|  Service [Lord's Day Morning v]   Date [<] [11/01/2026] [>]                     |
|  +----------+ +---------+ +-----------+ +----------+ +-----------+              |
|  | Present  | | Members | | Adherents | | Visitors | | Last time |              |
|  | 3 of 10  | | 2       | | 1         | | 0        | | 4  Oct 25 |              |
|  +----------+ +---------+ +-----------+ +----------+ +-----------+              |
|  Find a name or family [ Type a name             ]   All Members Adherents ... |
|  +----------------------------------------------------------------------------+ |
|  | Baker      [o John  ] [o Mary  ]                                Mark all 2 | |
|  | 1 of 2     Adherent   Adherent                                             | |
|  | Calder     [o Grace ] [v James ] [v Ruth  ]                     Mark all 3 | |
|  | 2 of 3     Baptized   Communicant Communicant                              | |
|  +----------------------------------------------------------------------------+ |
+--------------------------------------------------------------------------------+
|  Members 71   Adherents 9   Visitors 7              Children counted in families |
+--------------------------------------------------------------------------------+
```

* Opens to today's service automatically when a service type matches the day and time, otherwise to the next upcoming one. The arrows beside the date move a week at a time.
* Tiles across the top show Present (the lead tile, filled green, with "of N on the active roll"), Members, Adherents, Visitors and Last time (the previous service of the same type).
* The roll is one panel. Each household is a row: the family name in the display font with "2 of 3 here", then one name chip per person, then "Mark all N" or "Clear household".
* A chip shows a check circle, the first (or preferred) name and the membership status in small text. Its accessible name is the full name and "present" or "absent". Chips are at least 52px tall. Clicking anywhere on the chip toggles it.
* "Mark all" marks every active person in the household. Clicking again clears them.
* Present chips get a green check, a 2px green outline, the present fill and bold names. Changes save instantly. There is no Save button.
* The search box filters as you type and matches first, last, or preferred name. Pressing Enter toggles the first match and clears the search, so a volunteer can type "bak", Enter, "mck", Enter quickly.
* Keyboard support uses arrow keys to move between chips, Space to toggle, Ctrl+F to search, and Ctrl+N to add a visitor.
* Add visitor opens a small side panel with first name, last name, phone, email, "first time here" (checked by default), and an optional "with household". Saving creates the person as Visitor and marks them present.
* The sticky footer shows live counts by category.
* Former and deceased people never appear. People away (non-resident) appear in a collapsed "Non-resident members" section at the bottom.

### 5.3 Dashboard

```
+--------------------------------------------------------------------------------+
|  Monday, October 19, 2026                 Dashboard service type [v] [Refresh] |
|  The week ahead                                                                |
+-------------------+-------------------+-------------------+-------------------+
| Last recorded     | Prior 4 week      | Visitors this     | Absent 3+         |
| Lord's Day  4     | average  3.5      | month  1          | Lord's Days  1    |
+-------------------+-------------------+-------------------+-------------------+
| Lord's Day attendance (last 12 bars)      | This week                         |
|  ▂ ▃ ▃ ▅ ▃ ▆ ▃ ▅ ▂ ▃ ▅ █                   |  [Wed 21] Midweek prayer          |
|                                           |  [Thu 22] Ruth Calder's birthday  |
|                                           |  [Lord's Day 25] Usher needed     |
+-------------------------------------------+-----------------------------------+
| [lock Session only]  1 follow-up is due today or earlier.  [Open pastoral care] |
+--------------------------------------------------------------------------------+
```

* The title is "The week ahead" with the full date above it.
* Tiles are clickable and open the matching report already filtered. The first tile is the lead tile.
* The bar chart shows people present on the last twelve recorded Lord's Days of the selected service type, newest bar in brand green. Its accessible name lists every date and count.
* This week merges calendar occurrences, birthdays and unfilled serving slots into one list ordered by date and time, each with a date badge. An empty week says so in one sentence.
* The Session strip shows only for Session roles. It gives counts only, never names or note text.

### 5.4 People list
A search box and Status and District filters sit in one row above the table. The table lists Name, Status, Household, District, Mobile, Email, Last attended and Deceased; choosing a name opens that person's page in place of the list. A Households tab lists households for editing. Toolbar holds Add person and Add household. Saved lists, a Group filter and "Message these people" remain future additions.

### 5.5 Person page
A "‹ People & households" link returns to the list.

* **Header:** the photo (or initials in a soft green circle), the name in the display font, tags for membership status (filled), household and elder district, and for editors "Edit contact and consent" and "Edit profile or status".
* **Overview tab:**
  * Lord's Days: one square per Lord's Day for the last 26 weeks, green when present, plain when not marked, hatched when no service was recorded, with "21 of 26 recorded" beside the heading. A Lord's Day without a recorded service never counts as an absence. The strip's accessible name states the count and the dates not marked.
  * Membership: the latest four status changes as a short timeline with the reason, and a link to the full history.
  * Contact: email, mobile, household address, and church email and text consent shown as On or Off.
  * At a glance: birthday and last attended.
  * For Session roles only, a Session only panel pointing to Pastoral care. It reads no private records itself.
* **Attendance tab:** every recorded service the person attended, with the service name and whether it came from roll call or the kiosk.
* **Membership history tab:** the full status history table.

Status changes always open a dialog asking for date, method, other church, and reason, so the membership history is never skipped. Groups and serving, message history and a Session Care tab are future additions.

### 5.6 Messages
* Compose panel with channel (Email, Text, or Both), audience picker (person, household, group, status, elder district, or saved list), a live recipient count with opted out people listed separately, a template picker, merge field chips such as `{FirstName}`, Send now or Schedule, and Send a test to me.
* Text messages show a character and segment counter.
* Tabs for Scheduled, Delivery log, Text inbox, Contacts & consent and Person history. Unread replies show a count on the nav item.
* The delivery log reads in plain words: Email, Text or Email and text; Waiting to send, Sending, Finished or Cancelled; and times like "Oct 19, 2026 12:34 AM" in the church time zone. Each message has a small bar of sent (green), waiting (amber), skipped (grey) and failed (red) with the same counts in words. Acceptance by Microsoft or Twilio counts as sent, which does not mean the person read it.

### 5.7 Bulletin
* Card for this week showing file name, where it came from (OneDrive folder or upload), preview thumbnail, scheduled send time ("Saturday 6:00 PM"), and status.
* A status chip reads Waiting for file, Preparing, Ready to send, Skipped this week or Sent. Three steps sit below it: File received, Pastor preview and Sent to the congregation, each marked done (green), current (amber) or not yet, with a delivery bar once sending starts. Times read "6:00 PM", never 24-hour.
* Buttons for Upload PDF, Open in OneDrive, Send test to me, Send now, and Skip this week.
* History list of past bulletins below.

### 5.8 Reports
Each report's title has a one-line description of what it answers under it, and Session-enriched reports carry the purple Session only badge.
Left list of the seven reports from `PLAN.md` section 3.7. The right side holds filters (date range, service types, status, elder district), an on screen preview, and Export XLSX, Export CSV, and Print / PDF buttons. Print layouts use letter size, the church name at top, the report name and date range, and page numbers.

### 5.9 Kiosk (optional)
Full screen, light theme on the warm background, no nav. The heading and household names use the display font; the date reads "Lord's Day, March 14, 2027". A big search box reads "Type your last name or full phone number". Results show each household with every member as a large check-in card (a real checkbox with a 22px name, at least 72px tall), and full-width 64px "Find household" and "Check in" buttons. After check-in it says "Welcome, Calder household. You are checked in." Exiting requires an Admin or Pastor PIN.

### 5.10 Settings
Jump links at the top (This PC; Church, services and districts; Communication; Kiosk) scroll to each section, which stay on one page with a shared 960px width. Times show as "6:30 PM".
Sections for Church (name, address, time zone), Service types, Elder districts, Users and roles, Email (Microsoft 365 connection status), Text (Twilio status and number), Bulletin (day, time, reminder person, OneDrive folder, subject, standard message), Custom fields, Backups, and Theme for this PC.

### 5.11 Member portal
The portal uses the same warm background, white cards with 12px corners, and the display font for the wordmark, greetings and card headings.

* After sign-in a member lands on **Home**: the date, "Welcome, {first name}", a green card with this Lord's Day's active service times, the next three member gatherings with one-tap Attending, Maybe and Not attending buttons, and two large links to Send a request and Directory.
* The member sections are **Home, Events, Directory, Requests and Me**. Me holds My details, My sharing choices, Calendar links and Account as a second row of tabs.
* On phones (600px and narrower) the section tabs become a fixed bottom bar with an icon above each label, and the page leaves room for it.
* Sunday reads as the Lord's Day in dates and date badges.

### 5.12 Calendar
Month is the default view, with List beside it for a date range and export.

* The month grid starts each week on the Lord's Day, shows the month name in the display font with previous, next and This month controls, and dims days outside the month. Today's date is marked in green.
* Each occurrence is a small green button with its time and title. A cancelled date stays in place, struck through. A moved date appears on the day it now meets. The button's accessible name gives the title, date, time and any change.
* Choosing an occurrence opens the Selected date panel below: its date line and title, Change, Cancel or Restore this date, Edit event series, registrations and RSVPs, and the series reminders.
* My calendar link sits at the bottom.

## 6. Patterns

* **Panels** are white with a 1px border and 10px corners on the warm background. Do not put a panel inside another panel; group related content with headings and dividers instead.
* **Tables** use plain column names ("Public calendar", never `PublicCalendar`) and show calendar dates as "Oct 11, 2026". Exports keep ISO dates. Export sits in the panel heading and is hidden when there is nothing to export.
* **Session only** content carries a purple "Session only" badge with a lock and a soft purple outline. Never mark it with a coloured left edge alone.
* **Status words** in tables (Status and State columns) show as small labels: green for done or current, amber for waiting or overdue, red for failed or declined, grey otherwise. The word is always visible, so colour never carries meaning alone.
* **Tiles** show one key number in the display font with a short label. The lead tile may be filled with the brand green.

* **Empty states** never say "0 records". They give one kind sentence and, where useful, one button, such as "No services yet. Add your Lord's Day services to start taking attendance. [Add service type]".
* **Confirmations** are only for destructive or wide actions, such as deleting, merging people, or sending to more than 20 people. The confirm button names the action ("Send to 134 people"), never just "OK".
* **Undo** shows a toast with Undo for 8 seconds after unmarking a household, archiving a person, or removing from a group.
* **Errors** say what happened and what to do next in one or two plain sentences, with no codes on the face of the message.
* **Loading** uses skeleton rows for grids and never blocks the roll call screen once its cached data is there.
* **Dates** read "Lord's Day, Nov 1, 2026" on attendance screens and "Nov 1, 2026" elsewhere. Times are 12 hour with AM and PM.

## 7. Accessibility
* Full keyboard use on every screen, with a visible focus ring from Fluent tokens.
* A table that scrolls sideways is a region named for the table. It takes keyboard focus, shows the focus ring inside its edge and scrolls with the arrow keys.
* Screen reader labels on every control, with live region announcements for roll call counts and sync state.
* Respect Windows text scaling up to 150% without clipping.
* Honor "reduce motion" by turning off chart and toast animations.

## 8. Copy style
* Short, plain, warm. Write "Saved" instead of "Your changes have been saved successfully!"
* Say Lord's Day, Session, elder, adherent, and visitor. Never say "guest", "member ID", or "customer".
* No exclamation marks, emoji, or jokes in system text.

## Phase 6 report workspace

Reports provides a report selector and shared date, service type, historical membership and current district filters. Detail, source and review grids each export their visible rows. Main report workbooks include Summary, Detail and Data sheets with a chart. Historical unknowns display explicit review text. Session-enriched shepherding and visitor reports carry a lock badge in the screen and a Session only title in exports. Matrix PDFs repeat names across sections of at most six meeting columns. Dashboard tiles open the corresponding filtered report, while the initial staff screen remains Attendance.

## Approved Phase 7 through Phase 12 screens

Phase 7 security screens are implemented as described in `docs/PHASE_7.md`; their live deployment checks remain open. Phase 8 Shepherding screens are implemented: the Visits, Workload, Visit rounds, Contact gaps, Locations and routes and Flock health tabs, deacon joint visits and the Settings digest controls (see `docs/PHASE_8.md`). Phase 9 screens are implemented (see `docs/PHASE_9.md`): the Mercy ministry workspace is implemented with Requests, Households, Mercy notes, Tasks, Visits and Deacon chairs tabs, and Settings has the daily deacon summary controls. Important dates is implemented with Anniversaries and Bereavement care · Session only tabs, a live preview of the effect on waiting reminders, and Settings controls for date reminders. Care workflows · Session only has Workflows and Runs tabs, with the step list and keyboard-usable diagram side by side, a required preview before activation and run history. Phase 10 and 11 screens and Phase 12 parts 1 and 2 are implemented. Phase 12 part 3 remains pending. See the [implementation status](docs/FEATURE_EXPANSION.md#implementation-status). Scope and acceptance criteria live in [Expanded feature requirements](docs/FEATURE_EXPANSION.md).

### Security and accounts

Account security is available to every staff role for their own sign-in/passkeys. Staff account management is administrator-only. History is administrator/Session-only and the Session scope remains hidden from non-Session administrators. The volunteer gains only their own account-security controls alongside the names-only attendance screen. Authentication setup is shown before the staff workspace mounts.

Sign-in supports authenticator enrollment/challenges and passkeys, with a clear recovery path. Enrollment is completed before staff data is loaded. The existing booth account stays limited to names and attendance. Account setup shows granted roles and the effect of disabling an account. Role changes cannot grant the acting administrator access to Session records.

Settings adds Security, Accounts and Recovery. Security shows login activity, denied actions and permitted record-access events. A non-Session administrator sees security metadata, never care-note bodies, discipline details or the existing Session-only before/after audit values. Session viewers can inspect their permitted record history. Empty or delayed log coverage is stated plainly. No screen calls an account protected merely because a factor is enrolled.

### Shepherding

The Session workspace adds Contact gaps, Visits and Flock health tabs. Contact gaps show the last recorded qualifying contact, the source and the applicable threshold. Unknown history is shown as unknown. Visits can be scheduled by household, assigned to officers and marked complete without creating a visit note before the visit occurred. Workload totals link to the underlying appointments.

The map has an equivalent household list. Addresses without verified coordinates appear in a review list. Directions and routes require an explicit action before sending locations to an external service. No private care text appears in a map marker or a directions link.

Health indicators show the recorded facts and any Session-entered assessment separately. Status never relies on color alone. Assessments show the author and review date and cannot be treated as an automatic spiritual judgment.

### Workflows and important dates

A workflow has a readable step list alongside its visual editor. Triggers, waits, approvals and actions can be edited with a keyboard. A preview names the affected people and proposed messages before activation. Runs show what happened, what is due and any blocked step. Pausing stops future actions and clearly identifies already dispatched work.

Important dates distinguish ordinary household anniversaries from private bereavement reminders. Bereavement details remain Session only. Editing a date shows the effect on outstanding reminders. Reminder messages contain no private narrative by default.

### Diaconal care

Deacons receive a separate Mercy ministry workspace showing their assigned households, requests and encrypted notes. The workspace carries its own confidentiality label. Existing Session pastoral tabs remain unavailable to deacons. Joint visit views show only shared scheduling details; Session and deacon notes remain separate. Any authorized sharing action identifies its audience before saving.

### Member self-service

My details adds contact editing and photo management. Directory sharing remains a separate choice with all new fields private by default. Saving a new address does not subscribe the member to messages. Authentication email changes require verified account handling rather than silently changing the sign-in identity.

Request care explains who receives the request before submission. Prayer/pastoral requests and practical-help requests have distinct destinations. Members can view their own request state without seeing officer notes. Email-link completion gives a plain retry path for expired or already-used links.

### Calendar

The public calendar shows only explicitly published occurrences. A member or staff subscription screen describes its exact audience and has a Revoke link action. Private subscriptions never contain care appointments. Reminder setup shows recipients, channels and send times in the church time zone, with opt-outs visible in the preview.

### Officers, communion and data tools

Person Membership adds officer history with ordination, installation and term dates. Officer and quorum reports show their calculation date, policy and included/excluded people. Communion approval changes are Session actions. Participation entry distinguishes admission from attendance and keeps in-person and online marks distinct.

Households adds relationship editing and an accessible family list alongside the family tree. Private/deceased relationships have explicit visibility choices. Import uses Upload, Map columns, Review and Commit steps. The review distinguishes new records, proposed changes, duplicates and errors. No import writes occur before Commit, and results show each row's outcome.

### Staff web layout

The staff web app provides the same permitted jobs on narrow screens. Navigation uses a labeled menu, grids have readable card or horizontally scrollable alternatives, and touch targets are at least 48px on attendance. A phone attendance view keeps service selection and sync state visible. Session confidentiality labels stay visible in mobile layouts.

Below 760px the sidebar becomes a Menu button in the top bar that opens the same grouped navigation over the page, with the signed-in name and roles at its top; Escape or choosing a destination closes it. The top bar stays in view with the sync badge, the attendance footer names the service and date, tiles go two across and name chips fill half the row at 56px tall. The staff web's offline badge reads "Offline, keep this tab open", and Lock now with unsaved marks opens a Marks still saving dialog that locks by itself once they save, with Lock anyway or Keep working; if a mark is refused meanwhile it stays open as Some marks did not save, showing the error. On phones the shared grids show one card per record: the first field as the title, other fields labelled with their column names, empty fields left out. Tab rows, toolbars and filters wrap. A sensitive account change that needs a fresh sign-in opens Confirm it is you, naming the account, with password, passkey (web) or browser (desktop) confirmation and a Cancel that changes nothing. Native save/print actions have browser equivalents. Unsupported offline actions are identified before editing. Signing out or switching accounts clears private in-memory content and prevents the next account from seeing the previous user's cached records. Phone and desktop permission checks use the same server contracts.
