# DESIGN.md

The UI design system and screen specs for the Sycamore RPC church management app. Agents and developers follow this file for every screen. Product scope lives in `PLAN.md`.

## 1. Principles

1. **Plain and reverent.** The app serves a Reformed congregation. Keep it quiet, orderly and uncluttered. No playful illustrations, confetti, emoji or bright marketing colors.
2. **Built for the sound booth.** Roll call happens in a dim booth during the minutes before worship, often by a volunteer. Big targets, high contrast, keyboard friendly, and nothing that needs a second click when one will do.
3. **One job per screen.** Each screen answers one question, such as "who is here today" or "who has the elder not seen lately".
4. **Show what is private.** Session only data always carries a lock icon and the words "Session only", so no one is surprised about who can see it.
5. **Never lose a check mark.** Offline and sync state is always visible, and saved work is never thrown away.

## 2. Foundations

Built on **Fluent UI React v9**. Use its components and tokens. Do not hand roll a control Fluent already has.

### 2.1 Brand color
The brand color is a deep sycamore green. Generate the Fluent `BrandVariants` ramp from `#2F6B4F` with the Fluent theme designer and store it in `renderer/theme/brand.ts`.

| Token | Light | Dark | Use |
|---|---|---|---|
| brand primary | `#2F6B4F` | `#6FB592` | Primary buttons, selected nav, links |
| background | `#FAFAF8` | `#1B1D1C` | App background |
| surface | `#FFFFFF` | `#242726` | Cards, panels, dialogs |
| text primary | `#1F2321` | `#ECEEEC` | Body text |
| text secondary | `#5B625E` | `#A9B0AC` | Labels, hints |
| border | `#DADFDC` | `#3A3F3D` | Dividers, inputs |
| present | `#2F6B4F` | `#6FB592` | Present check marks and counts |
| warning | `#9A6200` | `#E0A84A` | Absence alerts, pending sync |
| danger | `#B3261E` | `#F2B8B5` | Errors, failed sends, destructive actions |
| session lock | `#5A4A8A` | `#B9A8E8` | Session only badges and borders |

All text and icon pairs must meet WCAG AA contrast (4.5 to 1 for text, 3 to 1 for large text and icons). Check both themes.

### 2.2 Themes
* Light, Dark, and Match Windows. The setting is per PC, so the sound booth PC can stay in Dark while the Pastor's office PC stays in Light.
* The Kiosk always uses the light theme with extra large type.

### 2.3 Type
* Font is **Segoe UI Variable** (Windows default) through Fluent tokens. No web fonts.
* Base size 14px. Roll call names are 16px semibold. Kiosk names are 24px.
* Page titles use Fluent `Title3`. Section headings use `Subtitle2`.
* Numbers in tables and stat tiles use tabular figures.

### 2.4 Spacing, size and shape
* 4px grid. Common gaps are 8, 12, 16 and 24.
* Corner radius uses Fluent `borderRadiusMedium` (4px) for controls and `borderRadiusLarge` (8px) for cards.
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

* Left nav is 220px and collapses to icons below 1200px wide.
* `#` marks Session only sections. They show the lock icon and are hidden entirely for users without a Session role.
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
| Settings | yes | yes | limited | no | no | no | no |

An Admin who is not on Session never sees Pastoral, even though Admin can do everything else.

## 5. Screens

### 5.1 Sign in
Centered card with the church name, email, password, and a "Keep this PC signed in" checkbox (meant for the booth PC). Errors read plainly, such as "That email and password do not match."

### 5.2 Take Attendance (most important screen)

```
+--------------------------------------------------------------------------------+
|  Lord's Day Morning  [v]     Nov 1, 2026  [<] [>]          Present  87 of 142 |
|  -------------------------------------------------------------------------------|
|  [ Search name or family...                        ]   [+ Add visitor]         |
|  Show: (All) (Members) (Adherents) (Visitors)   Sort: Last name  [v]           |
|  -------------------------------------------------------------------------------|
|  CALDER                                                    [Mark all 5]        |
|   [x] James  Pastor  Communicant                                               |
|   [x] Ruth           Communicant                                               |
|   [x] Caleb          Baptized                                                  |
|   [ ] Grace          Baptized                                                  |
|   [x] Hannah         Baptized                                                  |
|  -------------------------------------------------------------------------------|
|  BAKER                                                     [Mark all 2]        |
|   [ ] John           Adherent                                                  |
|   [ ] Mary           Adherent                                                  |
|  -------------------------------------------------------------------------------|
|  ...                                                                           |
+--------------------------------------------------------------------------------+
|  Members 71   Adherents 9   Visitors 7   Children counted in families          |
+--------------------------------------------------------------------------------+
```

* Opens to today's service automatically when a service type matches the day and time, otherwise to the next upcoming one.
* Households are cards in last name order. Each row is a 48px tall toggle. Clicking anywhere on the row toggles it.
* "Mark all" marks every active person in the household. Clicking again clears them.
* Present rows get a green check, a light green fill, and bold names. Changes save instantly. There is no Save button.
* The search box filters as you type and matches first, last, or preferred name. Pressing Enter toggles the first match and clears the search, so a volunteer can type "bak", Enter, "mck", Enter quickly.
* Keyboard support uses arrow keys to move, Space to toggle, Ctrl+F to search, and Ctrl+N to add a visitor.
* Add visitor opens a small side panel with first name, last name, phone, email, "first time here" (checked by default), and an optional "with household". Saving creates the person as Visitor and marks them present.
* The sticky footer shows live counts by category.
* Former and deceased people never appear. People away (non-resident) appear in a collapsed "Non-resident" section at the bottom.

### 5.3 Dashboard

```
+-------------------+-------------------+-------------------+-------------------+
| Last Lord's Day   | 4 week average    | Visitors this     | Absent 3+ weeks   |
| AM 121  PM 88     | AM 118  PM 84     | month  9          | 6 people          |
+-------------------+-------------------+-------------------+-------------------+
| Attendance, last 12 months (line chart, AM and PM)                            |
+---------------------------------------+---------------------------------------+
| Needs attention                       | This week                             |
|  6 absent 3+ Lord's Days   [View]     |  Birthdays and anniversaries          |
|  3 visitors not followed up [View]    |  Serving schedule gaps                |
|  2 follow-ups due  # Session only     |  Bulletin status: waiting for file    |
+---------------------------------------+---------------------------------------+
```

* Stat tiles are clickable and open the matching report already filtered.
* Session only items show only for Session roles.

### 5.4 People list
Data grid with columns for Name, Status, Household, Elder district, Mobile, Email, and Last attended. Filters for Status, Elder district, Group, and "absent X weeks" sit above the grid. Saved lists appear as chips. Toolbar holds Add person, Add household, Export (CSV / XLSX), and Message these people.

### 5.5 Person detail
Header with photo, name, status badge, officer badge, household link, and quick actions (Email, Text, Mark status change). Tabs below.

* **Info** for contact, birthday, anniversary, and custom fields
* **Membership** for the status history timeline, sacraments, offices, received and removed details
* **Attendance** for a 12 month calendar heat strip plus a list
* **Groups and Serving**
* **Messages** for the email and text history, including replies
* **Pastoral** (Session only, purple left border and lock icon) for notes, visits, follow-ups, and the discipline record

Status changes always open a dialog asking for date, method, other church, and reason, so the membership history is never skipped.

### 5.6 Messages
* Compose panel with channel (Email, Text, or Both), audience picker (person, household, group, status, elder district, or saved list), a live recipient count with opted out people listed separately, a template picker, merge field chips such as `{FirstName}`, Send now or Schedule, and Send a test to me.
* Text messages show a character and segment counter.
* Tabs for Scheduled, Sent (with delivered and failed counts), and Text inbox. Unread replies show a badge on the nav item.

### 5.7 Bulletin
* Card for this week showing file name, where it came from (OneDrive folder or upload), preview thumbnail, scheduled send time ("Saturday 6:00 PM"), and status.
* Status steps read Waiting for file, Preview sent to Pastor, Scheduled, Sending, and Sent to 134 (2 failed).
* Buttons for Upload PDF, Open in OneDrive, Send test to me, Send now, and Skip this week.
* History list of past bulletins below.

### 5.8 Reports
Left list of the seven reports from `PLAN.md` section 3.7. The right side holds filters (date range, service types, status, elder district), an on screen preview, and Export XLSX, Export CSV, and Print / PDF buttons. Print layouts use letter size, the church name at top, the report name and date range, and page numbers.

### 5.9 Kiosk (optional)
Full screen, light theme, no nav. Big search box reading "Type your last name or phone number". Results show household cards with every member as a 64px toggle and a large "Check in" button. Shows "Welcome, Baker family" for 3 seconds, then resets. Exiting requires an Admin or Pastor PIN.

### 5.10 Settings
Sections for Church (name, address, time zone), Service types, Elder districts, Users and roles, Email (Microsoft 365 connection status), Text (Twilio status and number), Bulletin (day, time, reminder person, OneDrive folder, subject, standard message), Custom fields, Backups, and Theme for this PC.

## 6. Patterns

* **Empty states** give one sentence and one button, such as "No services yet. Add your Lord's Day services to start taking attendance. [Add service type]".
* **Confirmations** are only for destructive or wide actions, such as deleting, merging people, or sending to more than 20 people. The confirm button names the action ("Send to 134 people"), never just "OK".
* **Undo** shows a toast with Undo for 8 seconds after unmarking a household, archiving a person, or removing from a group.
* **Errors** say what happened and what to do next in one or two plain sentences, with no codes on the face of the message.
* **Loading** uses skeleton rows for grids and never blocks the roll call screen once its cached data is there.
* **Dates** read "Lord's Day, Nov 1, 2026" on attendance screens and "Nov 1, 2026" elsewhere. Times are 12 hour with AM and PM.

## 7. Accessibility
* Full keyboard use on every screen, with a visible focus ring from Fluent tokens.
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

Phase 7 security screens are implemented as described in `docs/PHASE_7.md`; their live deployment checks remain open. Phase 8 Shepherding is in progress: the Visits, Workload, Visit rounds and Contact gaps tabs and the Settings digest controls are implemented (see `docs/PHASE_8.md`). The remaining Phase 8 through Phase 12 screens below remain future requirements. Scope and acceptance criteria live in [Expanded feature requirements](docs/FEATURE_EXPANSION.md).

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

Native save/print actions have browser equivalents. Unsupported offline actions are identified before editing. Signing out or switching accounts clears private in-memory content and prevents the next account from seeing the previous user's cached records. Phone and desktop permission checks use the same server contracts.
