# Church Attendance & Management (Windows) Plan

A Windows desktop program for Sycamore Reformed Presbyterian Church (sycamorerpc.org). It tracks attendance for members, non-residents, adherents and visitors, exports to CSV and Excel, and copies the useful parts of Tithely ChMS (people, households, groups, events, check-in, email and text messaging). Giving and tithing are left out on purpose.

## 1. Goals

1. Fast attendance entry on the Lord's Day, under two minutes for a whole service.
2. Clear membership categories that fit Reformed Presbyterian practice.
3. Reports the Session and Clerk actually use, exported to CSV or XLSX.
4. Email and SMS to the whole congregation or any filtered group.
5. Several PCs share the same live data (sound booth PC, pastor's PC, and others later), from church or from home.
6. The sound booth PC keeps working on the Lord's Day even if the internet drops.
7. Simple enough for a volunteer to run without training.

Not in scope: giving, pledges, accounting, online donation pages.

## 2. People Categories

Each person has one **membership status** and can also carry flags.

| Status | Meaning |
|---|---|
| Communicant Member | Professed faith, admitted to the Lord's Table |
| Baptized (Non-communicant) Member | Covenant children and others baptized but not yet professing |
| Non-resident Member | Member whose residence is away from the congregation |
| Adherent | Regular attender who has not joined |
| Visitor | First time or occasional guest |
| Former | Transferred, removed, deceased (kept for history, hidden by default) |

Extra fields that matter for RP churches
* Date received, how received (profession, transfer, reaffirmation), received from (congregation)
* Baptism date and place, profession date
* Transfer out date and destination
* Elder district / shepherding elder assignment
* Officer role (Pastor, Elder, Deacon) with ordination and installation dates
* Under discipline flag (Session only, hidden from normal users)
* Deceased date

Status changes are logged with date and reason so the Clerk has a full membership history.

## 3. Feature List (Tithely ChMS parity minus giving)

### 3.1 People & Households
* Person record with photo, contact info, birthday, anniversary, custom fields
* Households with head, spouse, children, shared address
* Search, filter, saved lists ("All adherents who missed 4 weeks")
* Merge duplicates
* Fast entry form for adding a whole household at once (there is no existing data to import)
* CSV/XLSX import kept as a later nice to have
* Timeline per person showing attendance, messages sent, notes, status changes

### 3.2 Attendance
* Service types set up by the church, such as Lord's Day Morning, Lord's Day Evening, Midweek Prayer, Sabbath School classes, Communion Season
* **Quick roll call screen** with a checklist of all active people grouped by household, one click marks the whole family
* Every service is taken name by name. There is no headcount only mode
* Children are marked on the same roll with their household. No separate children's check-in and no labels
* Visitor quick add right on the attendance screen, so visitors are counted by name too
* Optional **self check-in kiosk mode** (tablet or second monitor, search by last name or phone)
* Absence alerts, for example "flag anyone absent 3 Lord's Days in a row" sent to their shepherding elder

### 3.3 Groups
* Small groups, Sabbath School classes, choir, committees, Diaconate, Session
* Group leaders, meeting schedule, group attendance
* Message a whole group in one step

### 3.4 Events & Calendar
* Church calendar with recurring events
* Event registration and RSVP list
* Volunteer / serving schedule (nursery, ushers, psalm leaders, meal teams) with reminder texts

### 3.5 Communication (email and text)
* Compose to a person, household, group, status, or saved list
* Merge fields like `{FirstName}` and `{ServiceTime}`
* Templates, signatures, attachments for email
* Schedule a message for later
* Two-way SMS inbox (replies show up on the person's timeline)
* Opt-out handling (STOP / UNSUBSCRIBE honored automatically)
* Delivery log with sent, delivered, failed
* Prayer chain and emergency broadcast list
* **Automatic weekly bulletin email** every Saturday (see 4.8)

### 3.6 Pastoral Care
* Pastoral notes, visit log, and discipline records are visible to the **Session only** (Pastor, Clerk, and Elders). No one else can open them, including Deacons and Admins who are not on Session
* Follow-up tasks assigned to an elder
* Diaconal task list (meals, rides, help with a move). The Session creates a task with only what the deacon needs to know, and deacons see their own tasks without any Session notes

### 3.7 Reports & Exports
Every report follows the same layout so it is easy to read. The XLSX file opens to a **Summary** sheet with the totals and a chart, then a **Detail** sheet, then a **Data** sheet with the raw rows for anyone who wants to sort and filter. Every report also exports to CSV and prints as a one page PDF for the Session meeting packet.

**Weekly Attendance Summary**
One row per service for the week. Columns show communicant members, baptized members, non-resident members, adherents, visitors, and the total. It also shows the 4 week average and the same week last year so the trend is plain at a glance.

**Attendance Matrix**
People down the side grouped by household, Lord's Days across the top, a check for each service attended, and an attendance percent per person. It can be filtered by status, elder district, or date range.

**Shepherding Report (one per elder district)**
Each family in the district with the last date attended, attendance percent for the last 3 months, and any open follow-ups. Anyone absent 3 or more Lord's Days in a row is highlighted at the top. This is the report elders will use most.

**Visitor Follow-up**
First time and returning visitors with the dates they came, how many times, contact info, and whether someone has followed up.

**Membership Roll**
The Clerk's roll in the usual sections of communicant members, baptized members, and non-resident members, with date received, how received, baptism and profession dates, and address. A second sheet lists everyone received and removed during the chosen period.

**Annual Statistical Report**
The numbers presbytery and synod usually ask for. That means communicant and baptized members at the start and end of the year, received by profession, by transfer, and by baptism, removed by transfer, death, discipline, or erasure, infant and adult baptisms, and average Lord's Day attendance. The Clerk can adjust labels to match the presbytery's form.

**Congregational Meeting Summary**
A yearly overview with average attendance per service by month, a 12 month trend chart, membership changes, and visitor count. It is meant to be printed and handed out.

**Birthdays & Anniversaries** and the **Photo Directory** (PDF) are included as well.

### 3.8 Users & Security
* Logins with roles: Admin, Pastor, Clerk of Session, Elder, Deacon, Attendance Volunteer, Read Only. Pastor, Clerk, and Elder together make up the **Session** group
* Sensitive data (discipline, pastoral notes) kept in separate locked records that only the right roles can open
* Each person logs in with their own account on any PC. The sound booth PC can stay logged in as an Attendance Volunteer account that only sees the roll call screen, while the pastor logs in with full access from the office or home
* All traffic encrypted, passwords handled by Firebase Authentication, auto lock after idle
* Audit log of who changed what
* Automatic daily backup kept 30 days, plus an Export Everything button for a local copy

### 3.9 Optional later
* Member portal / phone app for directory and RSVP (phase 4, can reuse the same Firebase project)
* Online forms (visitor card, event sign up)

## 4. Technical Design

The app is a Windows desktop program built with Electron, backed by Google Firebase. Firebase handles sign in, the shared database, live updates between PCs, offline use, and the server code for texting and email. There is no server for the church to run or patch.

### 4.1 Stack
| Part | Choice | Why |
|---|---|---|
| Desktop app | Electron with React and TypeScript, built with Vite | Installs like any Windows program, and Firebase's best SDK (JavaScript) runs in it |
| UI look | Fluent UI React v9 | Matches Windows 10 and 11 |
| Sign in | Firebase Authentication (email and password, optional two step for Admin and Pastor), roles stored as custom claims | Each person has their own login on any PC |
| Database | Cloud Firestore | Shared live data, real time updates to every PC |
| Offline | Firestore persistent local cache (IndexedDB) | Booth PC keeps working with no internet and syncs on its own |
| Access control | Firestore Security Rules checked against the user's role | Locks data down on Google's side, not just in the app |
| Server code | Cloud Functions for Firebase (2nd gen, Node 22, TypeScript) | Sends texts and email, receives Twilio replies, runs scheduled jobs, writes the audit log |
| Secrets | Google Secret Manager (through Functions) | Twilio and email passwords never sit on a church PC |
| Photos | Cloud Storage for Firebase | Person and directory photos |
| Grids | TanStack Table | Fast sorting, filtering, and export of what is on screen |
| Excel export | ExcelJS | Real .xlsx with formatting, no Excel install needed |
| CSV | Papa Parse | Export (and import later if wanted) |
| PDF / printing | HTML report templates printed with Electron's printToPDF and silent print | Reports, directory |
| Charts | Chart.js | Attendance trends |
| SMS | Twilio (behind a provider interface so another carrier can be swapped in) | Reliable, two-way, cheap |
| Email | Nodemailer over SMTP with the church's Google or Microsoft account, optional SendGrid for bulk | Church keeps its own address |
| Installer | electron-builder (NSIS) with electron-updater auto update from GitHub Releases | One click install, updates itself |
| Tests | Vitest for logic, Firebase Emulator Suite with rules-unit-testing for security rules, Playwright for app screens | Rules are tested before anything ships |

### 4.2 Project layout
```
apps/
  desktop/
    main/              Electron main process (windows, printing, auto update, file save)
    preload/           Safe bridge between main and the UI
    renderer/          React app (screens, components, Firestore hooks)
functions/             Cloud Functions (messaging, Twilio webhook, schedulers, audit, roles)
packages/
  shared/              Types, validation schemas, membership rules, report math
firestore.rules        Security rules
firestore.indexes.json
storage.rules
firebase.json
tests/
  rules/               Security rule tests against the emulator
  e2e/                 Playwright tests for the desktop app
```

### 4.3 Firestore data model
Firestore stores documents in collections. Locking happens per document, not per field, so sensitive data lives in its own documents that only the right roles can read.

```
people/{personId}
  firstName, lastName, preferredName, gender, birthDate, email, mobilePhone, homePhone,
  photoPath, householdId, membershipStatus, elderDistrictId, smsOptIn, emailOptIn,
  isDeceased, customFields{}, updatedAt, updatedBy
  membershipEvents/{id}   date, fromStatus, toStatus, method, otherChurch, reason
  sacraments/{id}         type (baptism | profession), date, place, officiant
  offices/{id}            role (pastor | elder | deacon), ordainedOn, installedOn, endedOn

sessionPrivate/{personId}    disciplineFlag, disciplineHistory[]     (Session only)
careNotes/{noteId}           personId, authorUid, body, createdAt    (Session only)
followUps/{taskId}           personId, assignedToUid, dueDate, done  (Session only)
diaconalTasks/{taskId}       title, personId, assignedToUid, dueDate, done   (Session and assigned deacon)

households/{householdId}     name, address, homePhone
elderDistricts/{id}          name, elderPersonId
serviceTypes/{id}            name, dayOfWeek, defaultTime, isActive

services/{serviceId}
  serviceTypeId, date, notes
  present { personId: { at, method (roll | kiosk), byUid } }

groups/{groupId}             name, type, leaderPersonId, memberIds[]
  meetings/{meetingId}       date, present{}
events/{eventId}             title, start, end, recurrence, location
  rsvps/{personId}           status
serving/{scheduleId}         role, date, personId

messages/{messageId}         channel (email | sms), subject, body, audience, scheduledFor,
                             status, sentAt, createdByUid
  recipients/{personId}      address, status, providerId, error
smsInbox/{id}                fromNumber, personId, body, receivedAt, read

users/{uid}                  personId, displayName, role
auditLog/{id}                uid, collection, docId, action, before, after, at   (written only by Functions)
settings/church              name, address, service defaults, message footer
```

Attendance for a service is one document with a `present` map. A full year of three services a week is only about 150 documents, so reports are fast and cheap. The booth and a kiosk can check people in at the same moment without clashing, because each check mark updates its own field.

### 4.4 Roles and security rules
* Roles are Admin, Pastor, Clerk, Elder, Deacon, Attendance Volunteer, and Read Only. They are set by an Admin through a Cloud Function that writes a custom claim on the user's login.
* An Attendance Volunteer can read names and households and write check marks, and nothing else.
* `sessionPrivate`, `careNotes`, and `followUps` can be read and written only by users with the Pastor, Clerk, or Elder role. An Admin who is not on Session cannot open them either.
* Deacons can read and complete only the `diaconalTasks` assigned to them.
* The audit log is written by a Cloud Function every time a person, membership, or note changes. Users cannot write or edit it.
* Every rule has an automated test run against the Firebase emulator before release.
* Electron is locked down with context isolation on and Node access off in the UI.

### 4.5 Text messaging details
* **Sending** works when someone composes a message and the app saves it to `messages`. A Cloud Function picks it up, fills in merge fields, and sends through Twilio in throttled batches so a large blast is not blocked.
* **Receiving replies** works through a Cloud Function web address that Twilio calls. It checks Twilio's signature, matches the phone number to a person, and saves the reply to `smsInbox`. It shows up on every signed in PC right away.
* **Scheduled messages and reminders** run from a scheduled Cloud Function every few minutes, so they go out even when every church PC is off.
* **STOP, START, and HELP** are handled automatically. Opt-outs are saved on the person and always respected.
* **US carrier rules** require A2P 10DLC registration for the church number (brand plus campaign). Nonprofits get reduced fees. Plan a week or two for approval.

### 4.6 Multiple PCs and offline use
* Every PC runs the same app and signs in with that person's own account.
* The booth PC keeps the people list and recent services in its local cache. If the internet is down on the Lord's Day, check marks save locally and upload by themselves once the connection returns.
* Edits only send the fields that changed, so if the pastor fixes a phone number while the booth fixes an address, both changes stick. If two people change the very same field, the later save wins, and the audit log keeps the old value so it can be restored.
* Adding another PC later just means installing the app and signing in.

### 4.7 Email details (Microsoft 365)
The church has Microsoft 365 but no email set up yet, so setup is part of Phase 2.
1. Add **sycamorerpc.org** to Microsoft 365 (skip if it is already added). Sending from the free onmicrosoft.com address is heavily limited by Microsoft and tends to land in spam.
2. Turn on SPF, DKIM, and DMARC for the domain so messages reach inboxes.
3. Create a **shared mailbox** such as office@sycamorerpc.org. Shared mailboxes need no paid license. Give the pastor and the Clerk access so replies can be read in Outlook.
4. Register an app in Microsoft Entra with the Mail.Send permission (plus read access to the Bulletin folder only), and limit it to that one shared mailbox so it cannot send as anyone else.
5. A Cloud Function sends through the **Microsoft Graph API** using that app. Microsoft has retired basic SMTP passwords for Exchange Online, so Graph is the supported way.

Other details
* Sends are throttled to stay under Exchange Online limits (about 30 messages a minute and 10,000 recipients a day per mailbox), which is plenty for this church.
* Unsubscribe footer and per person email opt-out.
* Replies go to the shared mailbox and are read in Outlook.

### 4.8 Weekly bulletin email
* Settings hold the send day and time (default Saturday 10:00 AM, church time zone), the subject line pattern ("Sycamore RPC Bulletin, Lord's Day {Date}"), a short standard message, and who gets it (default everyone with an email who has not opted out).
* The bulletin PDF can arrive two ways. Someone uploads it in the app's Bulletin screen, or saves it to a "Bulletin" folder in the church's Microsoft 365 OneDrive or SharePoint. The app picks up the newest file from that folder through Microsoft Graph, so whoever makes the bulletin does not have to open the app at all.
* Friday evening a preview copy goes to the Pastor. If no new bulletin has shown up by then, the Pastor gets a reminder instead.
* Saturday at the set time a scheduled Cloud Function sends it from office@sycamorerpc.org. Each person gets their own copy (no long To or CC list, so no reply-all), with the PDF attached and their name in the greeting. Files over 3 MB are sent with Graph's large attachment upload.
* If the bulletin still is not there on Saturday, nothing is sent and the Pastor is notified. The same week's bulletin is never sent twice.
* An optional text goes out at the same time with a short link to the PDF for people who prefer texts.
* Each send shows in the message log with delivered and failed counts, and a Send Now button covers weeks when plans change.

### 4.9 Export details
* Every grid gets an Export button (CSV or XLSX) that exports exactly what is filtered on screen, saved through a normal Windows save dialog.
* XLSX exports include a header row, frozen panes, column widths, date formatting, and a "Summary" sheet when the report has totals.
* Attendance matrix export with people down the side, dates across the top, check marks, and per person totals.

### 4.10 Backups
* Firestore scheduled backups run daily and are kept 30 days.
* An Admin "Export Everything" button saves the whole database to an XLSX workbook on the PC.

## 5. Screens

1. **Dashboard** with this week's attendance, trend chart, birthdays, follow-ups due, absent-alert list
2. **People** list and person detail (tabs for Info, Household, Membership, Attendance, Groups, Messages, Notes)
3. **Households**
4. **Take Attendance** roll call screen
5. **Kiosk** check-in (full screen)
6. **Groups**
7. **Calendar & Events**
8. **Serving Schedule**
9. **Messages** (compose, scheduled, sent log, SMS inbox)
10. **Reports**
11. **Settings** (church info, service types, statuses, custom fields, users, email/SMS setup, backup)

## 6. Phased Roadmap

**Phase 1, Attendance core (MVP, about 5 to 7 weeks)**
* Firebase project, Electron app setup, logins and roles, security rules with tests
* Offline cache turned on and tested for the booth PC
* People, households, membership statuses and history
* Service types, name by name roll call, visitor quick add
* Attendance reports with CSV and XLSX export
* Fast household entry form for loading the congregation by hand
* Daily backups, desktop installer with auto update

**Phase 2, Communication (about 3 to 4 weeks)**
* Microsoft 365 email setup (domain, shared mailbox, app registration)
* Email through Microsoft Graph with templates and merge fields
* SMS through Twilio with opt-out handling and a live reply inbox
* Message log on each person, scheduled sends
* Automatic Saturday bulletin email with OneDrive folder pickup
* Absence alerts to shepherding elders

**Phase 3, ChMS extras (about 4 to 6 weeks)**
* Groups with group attendance
* Calendar, events, RSVPs
* Serving schedule with reminder texts
* Session only pastoral notes and follow-ups, diaconal task list
* Optional self check-in kiosk
* Annual statistical report, congregational meeting summary, photo directory PDF

**Later, if wanted**
* CSV/XLSX import

**Phase 4, Optional online pieces**
* Member portal or phone app for directory and RSVP
* Online forms (visitor card, event sign up)

## 7. Running Costs (estimate for a 150 person church)
| Item | Cost |
|---|---|
| Software | Free (built in house) |
| Firebase (Blaze pay as you go plan, needed for Cloud Functions) | likely $0 to $3 per month at this size, since the free daily allowance covers most use. A budget alert is set at $10 |
| Twilio number | about $1.15 per month |
| Texts | about $0.008 to $0.01 each, so a weekly 150 person text is about $6 per month |
| 10DLC registration | one time about $4 to $45 depending on brand type, small monthly campaign fee |
| Email | Free through the existing Microsoft 365 (shared mailbox needs no license) |
| Church domain name | already owned (sycamorerpc.org), normal renewal only |
| Code signing certificate (optional, stops Windows warnings) | about $100 to $300 per year, or about $10 per month through Azure Trusted Signing |

## 8. Decisions
1. Several PCs (sound booth and pastor to start), shared through Firebase.
2. Children are marked on the roll with their household. No labels.
3. Every service is taken name by name.
4. Pastoral notes and discipline are visible to the Session only.
5. No existing data to import. People are entered by hand.
6. Email goes through the church's Microsoft 365, which still needs a mailbox set up.
7. Reports follow the layout in section 3.7.

## 8a. Starting Users
| Person | Office | App roles |
|---|---|---|
| Shawn Anderson | Pastor | Pastor, Admin (first admin) |
| Brentt Vansickle | Elder | Elder |
| Dr. Robert McKissick | Elder | Elder |
| Tom Dinkledine | Elder | Elder |

These four make up the Session group, so they are the only ones who can see pastoral notes and discipline records. The Pastor sets up other logins (Clerk role, deacons, sound booth volunteer) from Settings after launch.

## 8b. Later
1. Clerk of Session is not known yet. The Pastor can give any user the Clerk role from Settings at any time.

## 9. Next Step
Approve this plan (with any changes), and Phase 1 development starts with the Firebase project, the Electron app scaffold, security rules, and the roll call screen.
