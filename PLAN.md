# Church Attendance & Management Plan

A church attendance, administration and shepherding application, originally built for Sycamore Reformed Presbyterian Church. The approved next product is an online PWA managed for separate churches on Firebase. Giving and accounting remain excluded.

Scope extension approved on October 18, 2026. All ten feature areas from the TendFlock comparison are included in Phases 7 through 12. [Expanded feature requirements](docs/FEATURE_EXPANSION.md) records coverage and acceptance criteria. Phase 7 security/account and Phase 8 shepherding implementations are now included; their live setup and staging checks are separate. Phases 9 through 11 and Phase 12 parts 1 and 2 are implemented. Phase 12 part 3 remains pending. See the [implementation status](docs/FEATURE_EXPANSION.md#implementation-status). Earlier milestone notes describe their implemented baseline, subject to the Phase 7 security changes.

## 0. Approved PWA service direction

Approved October 20, 2026. [Managed church PWA development plan](docs/PWA_SERVICE_PLAN.md) defines Phases 13 through 18 and their acceptance checks. Phase 13 is implemented with passing automated acceptance; Phases 14 through 17 have implementation and passing automated workflow checks; live staging gates remain. Phase 18 remains planned. See `docs/OPERATOR_RUNBOOK.md` for implementation limits and staging gates.

- Deliver staff and member access through an online PWA on Firebase Hosting. Retain the existing Firebase backend and privacy boundaries.
- Maintain one codebase with separate Firebase projects, identities, records, secrets and encryption keys for each church. Colt manages setup and releases. Start with a service-owned subdomain, with a church-owned subdomain optional.
- Replace customer-specific source edits with validated branding and deployment configuration. The existing Presbyterian membership/governance model remains unchanged for now.
- Retire native Windows releases, code signing, kiosk support and offline record persistence as launch requirements. Existing source remains temporarily while web replacements are verified.
- Require server-acknowledged saves, honest connection/error states, safe PWA updates and memory-only church records. No offline workspace is promised.
- Complete repeatable provisioning, secure administrator enrollment, backups/recovery, operator tooling and pilot acceptance before paid rollout. Keep manual subscription/scholarship administration separate from church records. Pricing is not fixed by this plan.

These decisions supersede conflicting Windows, kiosk, offline and single-customer requirements below and in earlier phase documents. Earlier milestones and implementation notes describe the existing source, not the completed PWA service. Section 4.3 continues to describe the implemented data model until a later implementation commit updates it. Giving/accounting, denomination configuration and existing-person duplicate merging are not added to this milestone.

## 1. Goals

1. Fast attendance entry on the Lord's Day, under two minutes for a whole service.
2. Clear membership categories that fit Reformed Presbyterian practice.
3. Reports the Session and Clerk actually use, exported to CSV or XLSX.
4. Email and SMS to the whole congregation or any filtered group.
5. Several PCs share the same live data (sound booth PC, pastor's PC, and others later), from church or from home.
6. Staff can see whether work is confirmed saved. An internet connection is required, and no offline attendance is promised.
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
* Merge duplicates is pending a reviewed, resumable reference-reconciliation design. Existing-record merging is not implemented; import matching is a separate workflow.
* Fast entry form for adding a whole household at once
* CSV/XLSX import with column mapping, preview, duplicate review and validation before committing a batch (Phase 11)
* Family relationship links beyond shared households, with privacy controls (Phase 11)
* Timeline per person showing attendance, messages sent, notes, status changes

### 3.2 Attendance
* Service types set up by the church, such as Lord's Day Morning, Lord's Day Evening, Midweek Prayer, Sabbath School classes, Communion Season
* **Quick roll call screen** with a checklist of all active people grouped by household, one click marks the whole family
* Every service is taken name by name. There is no headcount only mode
* Children are marked on the same roll with their household. No separate children's check-in and no labels
* Visitor quick add right on the attendance screen, so visitors are counted by name too
* Self check-in kiosk is retired from the PWA service scope. Existing native implementation is historical.
* Absence alerts, for example "flag anyone absent 3 Lord's Days in a row" sent to their shepherding elder
* Configurable absence thresholds, consented email/SMS elder digests and contact-gap detection (Phase 8)
* Separate named communion participation and in-person/online worship attendance, with historical reports (Phase 11)

### 3.3 Groups
* Small groups, Sabbath School classes, choir, committees, Diaconate, Session
* Group leaders, meeting schedule, group attendance
* Message a whole group in one step

### 3.4 Events & Calendar
* Church calendar with recurring events
* Event registration and RSVP list
* Volunteer / serving schedule (nursery, ushers, psalm leaders, meal teams) with reminder texts
* Explicitly public calendar listings, revocable calendar subscriptions and configurable event reminders (Phase 10)

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
* Household visit planning, officer assignments, visit workload, congregation maps and route planning (Phase 8)
* Configurable flock health indicators and Session-entered assessments, with reasons and review dates (Phase 8)
* Visual workflows for visitor follow-up, member onboarding and care, including anniversary and bereavement reminders (Phase 9)
* Separate deacon mercy notes, household assignments, joint visits, practical-help requests and consented daily digests (Phase 9). These require a new privacy boundary and do not grant access to Session records
* Member care/prayer requests with an explicit confidential destination (Phase 10)

### 3.7 Reports & Exports
Every report follows the same layout so it is easy to read. The XLSX file opens to a **Summary** sheet with the totals and a chart, then a **Detail** sheet, then a **Data** sheet with the raw rows for anyone who wants to sort and filter. Every report also exports to CSV and prints as a Letter PDF with a summary and legible detail pages for the Session meeting packet. Large matrices span multiple pages.

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
* Required staff MFA, passkey sign-in and account recovery, with server-enforced access checks (Phase 7)
* Additional encryption for private note bodies and discipline details, with key rotation and migration (Phase 7)
* Security dashboard with privacy-scoped login, access and change history, plus staff account/role administration (Phase 7)

### 3.9 Member and staff web access
* Member directory and personal RSVP, plus visitor/event forms (implemented in Phase 4)
* Passwordless member email links, self-service contact/photo editing and care requests (Phase 10)
* Responsive staff attendance and all permitted management workflows on phones (Phase 12)
* Online-only PWA delivery replaces native/offline release requirements under Phases 13 through 18. Existing source behavior is documented in Phase 12 until changed.

### 3.10 Officer administration
* Officer ordination, installation, terms, rotation and end-of-service records (Phase 11)
* Quorum reports with explicit meeting rules and an inspectable historical electorate (Phase 11)
* Officer-eligibility and communion-approved lists based on recorded facts and Session decisions (Phase 11)
* No automatic admission to office or the Lord's Table

## 4. Technical Design

The implemented baseline includes Electron and responsive web builds backed by Firebase. The approved target is Firebase-hosted staff/member PWA delivery with a separate Firebase project per church. Firebase handles authentication, records, file storage and backend jobs. Twilio and Microsoft Graph remain external providers. The stack and layout tables below describe the existing source until the PWA phases replace the native delivery path.

### 4.1 Stack
| Part | Choice | Why |
|---|---|---|
| Desktop app | Electron with React and TypeScript, built with Vite | Installs like any Windows program, and Firebase's best SDK (JavaScript) runs in it |
| UI look | Fluent UI React v9 | Matches Windows 10 and 11 |
| Sign in | Firebase Authentication with required staff assurance and passkey/browser sign-in; member email links remain Phase 10 | See Phase 7 for native MFA, separate passkey assurance and live setup |
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
| Email | Microsoft Graph application OAuth from the church shared mailbox | Church keeps its own address and credentials stay on the server |
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
  photoPath, photoVersion (monotonic integer; legacy = 0), householdId, membershipStatus, elderDistrictId, smsOptIn, emailOptIn,
  isDeceased, customFields{}, updatedAt, updatedBy, firstVisitDate (optional, visitor quick add), importBatchId (when imported)
  membershipEvents/{id}   date, fromStatus, toStatus, method, otherChurch, reason
  sacraments/{id}         type (baptism | profession), date, category (infant | adult for baptism), place, officiant, revision
  offices/{id}            role (pastor | elder | deacon), ordainedOn, installedOn, termEndsOn, endedOn,
                          endReason, emeritusOn, revision   (one record per period of service; Session writes)

sessionPrivate/{personId}    encrypted{disciplineFlag, disciplineHistory[]}, revision, updatedAt, updatedBy     (Session API only)
attendanceRoster/{personId}  id, firstName, lastName, preferredName, householdId,
                             householdName, membershipStatus, isDeceased
                             (server-maintained names-only roll for attendance volunteers)
careNotes/{noteId}           personId, authorUid, kind (note | visit | call | conversation), visitId, date, encrypted{body}, createdAt, revision, updatedAt, updatedBy    (Session API only)
followUps/{taskId}           personId, encrypted{title}, assignedToUid, dueDate, done, revision, updatedAt, updatedBy  (Session API only)
diaconalTasks/{taskId}       encrypted{title}, personId, assignedToUid, dueDate, done, revision, updatedAt, updatedBy   (Session and assigned deacon API)
pastoralVisits/{visitId}     householdId, personIds[], roundId, followUpId, start (Timestamp), durationMinutes, location,
                             officerUids[], deaconUids[], status (planned | completed | cancelled), reminderHours,
                             encrypted{purpose, cancelReason}, completedAt, completedBy, careNoteId, reminderMessageId,
                             revision, createdAt, authorUid, updatedAt, updatedBy   (Session API; invited deacons get logistics only)
visitRounds/{roundId}        name, startDate, endDate, archived, revision, createdAt, updatedAt, updatedBy   (Session API only)
shepherdingSettings/church   historyStart, defaultContactDays, districtContactDays{}, trackedStatuses[],
                             countPersonalMessages, revision, updatedAt, updatedBy   (Session API only)
shepherdingSettings/geography geocoder (none | census), revision, updatedAt, updatedBy   (Session API only)
shepherdingSettings/health   indicators[], attendanceWeeks, attendanceBelowPercent, visitWithinDays,
                             labels[{id, name}], revision, updatedAt, updatedBy   (Session API only)
flockAssessments/{id}        personId, labelId, encrypted{reasons}, assessedOn, reviewOn, authorUid,
                             revision, createdAt, updatedAt, updatedBy   (Session API only)
householdLocations/{householdId} lat, lng, provenance (census | manual), matchedAddress, addressHash, verified,
                             verifiedBy, verifiedAt, revision, updatedAt, updatedBy   (Session API only)
mercySettings/church         chairUids[], revision, updatedAt, updatedBy   (mercy API; Session edits)
mercyAssignments/{householdId} householdId, deaconUids[], revision, updatedAt, updatedBy   (mercy API; Session and chairs edit)
mercyRequests/{id}           householdId, personId, category, urgent, neededBy, status (new | approved | inProgress |
                             resolved | declined), deaconUids[], encrypted{details, outcome, declineReason}, approvedBy,
                             approvedAt, resolvedBy, resolvedAt, createdAt, createdBy, source (member, when a member asked
                             through the portal), revision, updatedAt, updatedBy
                             (mercy API; content for assigned deacons and the Pastor, triage fields for Session and chairs)
mercyNotes/{id}              householdId, requestId, date, encrypted{body}, authorUid, sharedWithSession, sharedBy, sharedAt,
                             createdAt, revision, updatedAt, updatedBy   (mercy API; assigned deacons and the Pastor, Session once shared)
mercyTasks/{id}              requestId, householdId, encrypted{title}, assignedToUid, dueDate, done, authorUid, createdAt,
                             revision, updatedAt, updatedBy   (mercy API; assigned deacons and the Pastor)
importantDates/{id}          personId, kind (weddingAnniversary | baptismAnniversary | membershipAnniversary | other), label,
                             date, endKind (never | year | count), endYear, endCount, remindDaysBefore, remindUid,
                             createdAt, revision, updatedAt, updatedBy   (staff readers; editors write through the API)
bereavementDates/{id}        personId, relatedPersonId, kind (deathAnniversary | lateSpouseBirthday | lateWeddingAnniversary |
                             other), date, encrypted{note}, endKind, endYear, endCount, remindDaysBefore, remindUid,
                             createdAt, revision, updatedAt, updatedBy   (Session API only)
memberRequests/{id}          personId, kind (prayer | pastoral), encrypted{body}, status (received | acknowledged | closed),
                             createdAt, createdBy (member uid), revision, updatedAt, updatedBy   (Session API only; the
                             member sees kind, date and progress through the portal)
workflows/{id}               name, description, trigger, steps[], status (draft | active | paused | archived), publishedVersion,
                             createdAt, revision, updatedAt, updatedBy   (Session API only; the draft)
workflowVersions/{id_vN}     workflowId, version, name, trigger, steps[], publishedAt, publishedBy   (Session API only; immutable)
officerPolicies/{elder|deacon} statuses[], minimumAge, minimumMemberYears, excludeUnderDiscipline, source,
                             revision, updatedAt, updatedBy   (Session API only)
officerDecisions/{id}        personId, role, decision (approved | notApproved | deferred), decidedOn, encrypted{note},
                             authorUid, createdAt, revision, updatedAt, updatedBy   (Session API only)
quorumPolicies/{id}          meetingType (session | congregational | diaconate | other), effectiveFrom, electorate
                             (officers | members), offices[], includeEmeritus, statuses[], minimumAge,
                             excludeUnderDiscipline, minimumCount, percent, source, revision   (Session API only)
quorumMeetings/{id}          meetingType, date, title, presentPersonIds[], revision, updatedAt, updatedBy   (Session API only)
workflowRuns/{workflowId_subject} workflowId, version, subject{personId, householdId, requestId, dateId, occurrence}, status
                             (active | waiting | paused | blocked | cancelled | completed), stepIndex, nextAt, startedAt,
                             startedBy, waitingFor, pausedFrom, error, history[], lease, revision, updatedAt   (Session API only)
mercyVisits/{id}             householdId, requestId, start (Timestamp), durationMinutes, location, deaconUids[], officerUids[],
                             status (planned | completed | cancelled), encrypted{purpose, cancelReason}, completedAt,
                             completedBy, noteId, authorUid, createdAt, revision, updatedAt, updatedBy
                             (mercy API; invited Session officers get logistics only)

households/{householdId}     name, address, homePhone, revision, updatedAt, updatedBy, importBatchId (when imported)
relationships/{id}           personId, relatedPersonId, kind (spouse | parent | guardian | sibling | other), label,
                             startDate (wedding date for a spouse), endDate, revision, updatedAt, updatedBy
                             (staff readers; editors write through the API; parent/guardian read personId → relatedPersonId)
importBatches/{batchId}      payloadHash, state (initializing | ready), fileName, createdBy, createdAt, consentReviewed, consentSource, total, pending, created,
                             updated, skipped, conflict, failed   (editors read; Functions write)
  rows/{row}                 row, value{}, decision (skip | create | update with expected values), outcome, personId, message
elderDistricts/{id}          name, elderPersonId, archived, revision, updatedAt, updatedBy
serviceTypes/{id}            name, dayOfWeek, defaultTime, isActive, revision, updatedAt, updatedBy

services/{serviceId}
  serviceTypeId, date, notes, lastAttendancePersonId
  present { personId: { at, method (roll | kiosk), byUid, mode (inPerson | online; absent on older marks = in person) } }
communionRecords/{serviceId} serviceId, serviceTypeId, date, personIds[], revision, updatedAt, updatedBy   (Session API only)
communionDecisions/{id}      personId, approved, kind (member | visiting), effectiveOn, until (visiting only), encrypted{note},
                             authorUid, createdAt   (Session API only; create only, a correction is a later decision)

groups/{groupId}             name, type, leaderPersonId, memberIds[], schedule, archived, revision, updatedAt, updatedBy
  meetings/{meetingId}       date, present{}, updatedAt, updatedBy
events/{eventId}             title, start/end (Timestamp), recurrence (none | weekly | monthly), interval, until,
                             location, capacity, cancelled, revision, rsvpVersion, updatedAt, updatedBy,
                             exceptions{date: {cancelled} | {start, end (Timestamp), location}},
                             reminders[{id, minutesBefore, channel, audience (attending | responded | group), groupId}]
  rsvps/{date_personId}      eventId, date, personId, status (yes | maybe | no), updatedAt, updatedBy
serving/{scheduleId}         role, date, time, personId, location, reminderHours, cancelled, revision,
                             reminderMessageId, updatedAt, updatedBy
servingSlots/{person_date_time} assignmentId (server-only concurrency lock)
reportSettings/statistical   labels{}
reportSettings/statisticalOptions attendanceMode (inPerson | combined)
kioskConfiguration/church    enabled, salt, hash (server only)
kioskDevices/{uid}           serviceId, createdBy, expiresAt, requests, minute, exitFailures, ended (server only)
kioskSearches/{token}        uid, serviceId, personIds[], expiresAt (server only)

messages/{messageId}         channel (email | sms | both), subject, body, audience, scheduledFor,
                             status, createdAt, createdByUid, selectedPersonIds[], sessionOnly,
                             attachments[], activeCount, totals{}, source, dateLabel, serviceTime, expiresAt, servingAssignment { id, revision },
                             eventReminder { eventId, date, reminderId, version }, deaconDigestVersion
                             (private messages and recipients are served only through audited message APIs)
  recipients/{personId_channel} personId, channel, address, status, providerId, error,
                               attemptKey, startedAt, updatedAt
messageTemplates/{id}       name, channel, subject, body, updatedBy, updatedAt
savedAudiences/{id}          name, audience { kind, ids[] }, updatedBy, updatedAt
smsInbox/{messageSid}        fromNumber, personIds[], body, receivedAt, read, consentCommand
communicationSettings/church delivery flags, churchName, footer, bulletin time/recipient/folder settings,
                             weekly digest settings (absenceEnabled, absenceServiceTypeId, absenceWeeks,
                             digestChannel, digestWeekday, digestHour), dailySummaryEnabled, dailySummaryHour,
                             deaconDigestEnabled, deaconDigestHour, deaconDigestChannel, dateRemindersEnabled,
                             dateReminderHour
                             (no credentials)
communicationSuppressions/{addressHash} channel, blocked, source, updatedAt (server only)
communicationBudgets/{bucket} count, at (server only)
consentEvents/{id}           personId, channel, optedIn, source, actor, at
bulletins/{lordsDayDate}     week, file { path, name, generation, size, source, sourceModifiedAt, sourceKey },
                             status, messageId, previewMessageId, publicUrl, preparingAt, updatedAt
bulletinLinks/{token}        path, generation, week, createdAt (server only)
automationStatus/church     bulletinError, absenceError, servingError, visitError, deaconError, datesError,
                             workflowError, eventsError, queueError, checkedAt

portalAccess/{uid}           personId, enabled, revision, updatedAt, updatedBy (Admin/Pastor read)
directoryPreferences/{personId} listed, shareEmail, sharePhone, shareAddress, sharePhoto, revision, updatedAt, updatedBy
                             (server-only, member accesses own preferences through validated APIs)
eventPublications/{eventId}  portalVisible, publicRegistration, publicCalendar, description, revision, updatedAt, updatedBy
onlineSubmissions/{requestId} kind, firstName, lastName, email, mobilePhone, message, eventId, date,
                             status (pending | approved | declined), approvedPersonId, createdAt, reviewedAt, reviewedBy
portalBudgets/{hashedIp_hour} count, expiresAt (server only; also member_{personId}_{date} request counters)
photoCleanup/{sha256(path)}  personId, path, createdAt (server-only retry queue for superseded photos)

calendarFeeds/{sha256(token)} uid, scope (member | staff), personId, label, createdAt, expiresAt, lastUsedAt (server only)

users/{uid}                  personId, displayName, roles[]
auditLog/{id}                uid, collection, docId, action, encrypted{before, after}, at   (server-owned, Session API only)
staffAccess/{uid}            enabled, locked, pending, roles[], validAfter (Auth epoch-second cutoff)
staffSessions/{nonce}        uid, validAfter, verifiedAt, expiresAt (server-owned assurance)
staffCredentials/{id}        uid, publicKey, counter, transports[], createdAt, lastUsedAt
securityChallenges/{id}      uid, kind, challenge, used, expiresAt
desktopHandoffs/{id}         uid, challenge, authTime, validAfter, used, expiresAt
securityBudgets/{id}         count, expiresAt
securityEvents/{id}          actorUid, action, outcome, scope (security | session), target, at
deploymentIdentity/church     churchId, projectId, environment, createdAt (operator-only immutable project reservation)
backupStatus/daily            status, timestamps, snapshot time, counts, objectPrefix, fixed failure code (operator-only; no private bodies)

creationReceipts/{sha256}    uid, kind, inputHash, result{id}, createdAt (server-only atomic creation retry receipts; no request body)

publicBranding/church        churchId, projectId (operator-bound), churchName, appName, subtitle,
                             palette (forest | navy | plum), website (HTTPS or empty), contactEmail,
                             contactPhone, logo (inline PNG or empty), revision, updatedAt, updatedBy
                             (server-only document; anonymous getPublicBranding returns only reviewed identity fields)
settings/church              name, address, timeZone, revision, updatedAt, updatedBy
```

Attendance for a service is one document with a `present` map. A full year of three services a week is only about 150 documents, so reports are fast and cheap. The booth and a kiosk can check people in at the same moment without clashing, because each check mark updates its own field.

Implementation clarification, Phase 1 foundation: volunteers read `attendanceRoster`, never `people` or the full household records. People and household writes run through validated callable Functions, which update the roster in the same transaction or batch. Client roll-call writes change one person's field per write; household marking issues separate field updates. Creating a service uses a transaction while online, and an existing cached service works offline. Membership changes and their history entries are atomic. Roles use an array custom claim, `roles`, so a Pastor can also be an Admin. Only a Session administrator can grant or remove Session roles, and administrators cannot change their own roles. Audit records are Session-only because their before/after values may contain sensitive information. Pastoral clients use validated Session-only care Functions. Direct private-document writes remain disabled.

Each roll-call update also writes `lastAttendancePersonId`. Rules constrain the changed map keys to that one ID and validate its entry. This is a validation hint, not an attendance record or a lock. Firestore Rules sets cannot be indexed, so this hint allows strict entry validation without replacing the `present` map. Simultaneous PCs still update independent person fields.

### 4.4 Roles and security rules
* Roles are Admin, Pastor, Clerk, Elder, Deacon, Attendance Volunteer, and Read Only. They are set by an Admin through a Cloud Function that writes a custom claim on the user's login.
* An Attendance Volunteer can read names and households and write check marks, and nothing else.
* `sessionPrivate`, `careNotes`, and `followUps` are accessed only through audited callable APIs by Pastor, Clerk or Elder. Direct client reads/writes are denied even for Session. An Admin who is not on Session cannot open them either.
* Deacons can read and complete only their assigned `diaconalTasks` through the audited API.
* Care workflows, their versions and runs are Session only through audited callables. Approval steps refuse the person who started the run unless the step allows it.
* Mercy ministry is its own boundary. Deacons currently assigned to a household or request, and the Pastor, read its private content through audited mercy APIs. Session officers and Session-named deacon chairs triage requests and assign households without reading notes. A note reaches the Session only through an explicit, logged share. No mercy record holds money or donation data.
* Every staff role requires verified email and completed assurance. Server-owned access and session records enforce revocation in rules and callables. Account updates close access before Auth changes and preserve a pending lock on partial failure.
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
* Edits only send the fields that changed, so if the pastor fixes a phone number while the booth fixes an address, both changes stick. The Phase 5 profile form also sends the original values of changed fields and rejects a stale edit to the same field. Older API integrations without expectations retain last-write behavior. The audit log keeps before/after values for review.
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
* Settings hold the send day and time (default Saturday 6:00 PM, church time zone, since the Pastor builds the sermon on Saturday and the bulletin is often finished that day), the subject line pattern ("Sycamore RPC Bulletin, Lord's Day {Date}"), a short standard message, and who gets it (default everyone with an email who has not opted out).
* The bulletin PDF can arrive two ways. Someone uploads it in the app's Bulletin screen, or saves it to a "Bulletin" folder in the church's Microsoft 365 OneDrive or SharePoint. The app picks up the newest file from that folder through Microsoft Graph, so whoever makes the bulletin does not have to open the app at all.
* As soon as a new bulletin file shows up, a preview copy goes to the Pastor so there is time to fix anything before it sends.
* If nothing has shown up by 4:00 PM Saturday, one short reminder goes out. It goes to whoever is set as the bulletin maker (default the Pastor), so it can be pointed at a secretary or volunteer instead.
* Saturday at the set time a scheduled Cloud Function sends it from office@sycamorerpc.org. Each person gets their own copy (no long To or CC list, so no reply-all), with the PDF attached and their name in the greeting. Files over 3 MB are sent with Graph's large attachment upload.
* If the bulletin is late, the app keeps watching and sends it as soon as it shows up, up until 11:00 PM Saturday. After that nothing is sent automatically and the Pastor can use Send Now on Lord's Day morning if wanted. The same week's bulletin is never sent twice.
* An optional text goes out at the same time with a short link to the PDF for people who prefer texts.
* Each send shows in the message log with delivered and failed counts, and a Send Now button covers weeks when plans change.

### 4.9 Export details
* Every grid gets an Export button (CSV or XLSX) that exports exactly what is filtered on screen, saved through a normal Windows save dialog.
* XLSX exports include a header row, frozen panes, column widths, date formatting, and a "Summary" sheet when the report has totals.
* Attendance matrix export with people down the side, dates across the top, check marks, and per person totals.

### 4.10 Backups
* Firestore scheduled backups run daily and are kept 30 days.
* An Admin "Export permitted records" button saves an inspectable XLSX document archive on the PC. Session records require a Session administrator. Storage files, delivery queues, bulletin records and operational secrets/capabilities are excluded. This live, paged archive is not an atomic backup or a supported restore format. Managed backups remain required and must be provisioned separately.

### 4.11 Phase 2 implementation details
Messages and recipients are created through validated callable Functions. All communication documents are client-read-only, apart from new immutable PDF uploads to the permitted Storage paths. Admin, Pastor, Clerk and Elder may use Messages and Bulletin. Generated elder alerts carry `sessionOnly: true`; their bodies and recipient logs are denied to an Admin without a Session role. Server-only suppression records, budgets and bulletin link tokens cannot be read by any client.

Cloud Scheduler runs the queue and automation every minute. Recipient claims and rate budgets are transactional. Email attempts are capped at 20 per minute and 9,000 per UTC day. A queue entry can contain up to 400 email/text recipient records. The server rechecks consent, suppression, contact identity and active membership immediately before sending. Unknown results and interrupted attempts require provider review instead of automatic retries. Twilio callbacks are signed and tied to a specific attempt. Microsoft acceptance is shown separately from confirmed SMS delivery.

The bulletin uses one deterministic message ID per Lord's Day. New PDF versions receive distinct preview IDs. Storage generation pinning prevents a changed file from replacing a queued attachment. Shareable bulletin download links are off by default and are issued only when explicitly enabled for bulletin texting. An email unsubscribe GET shows a confirmation page; only a signed-token POST changes consent. The setup guide documents real Microsoft/Twilio configuration, large-attachment mailbox limitations and live checks that cannot be replaced by emulators.

### 4.12 Phase 3 implementation details
Groups, event series, serving assignments and care forms use revision checks to reject stale forms. Group attendance changes one person's map field per write. RSVPs belong to a dated occurrence. Capacity checks serialize on the event document, and serving conflicts use server-only slot locks. Event instants are Firestore Timestamps; recurrence is evaluated in the church time zone. Weekly and monthly series have an inclusive final date no more than two years after the start. A monthly meeting on the 31st skips shorter months.

The existing scheduler queues consented serving reminders once per assignment revision. A changed or cancelled assignment invalidates its old pending reminder, and reminder delivery expires at the serving time. Pastoral notes, visits, follow-ups and discipline records remain Session-only, including against an Admin without Session. Only Session may create diaconal tasks. An assigned Deacon may complete their task, with a revision increment, and sees no private care records. Audit triggers record root care changes, group meeting changes, event responses and sacrament records in the Session-only audit collection.

The optional kiosk uses a separate custom-token identity with no direct Firestore or Storage access. An Admin or Pastor opens it for one existing service. Starting signs out staff and clears local Firestore persistence. Exact surname or full-phone lookup returns only household names and checked-in state, with a two-minute single-use capability for those people. Device sessions expire after four hours, requests are throttled, and five wrong exit PIN attempts lock that device. Exiting returns to staff sign-in and does not grant staff access. PINs are salted and hashed on the server. Kiosk search needs a connection; the existing staff roll call retains offline support.

Annual statistics reconstruct membership from recorded history, count explicit infant/adult baptisms, and flag missing or inconsistent records. The meeting summary contains twelve months per service type. Missing service records do not become zero-attendance services. The directory includes active member and adherent households, and photos are embedded in the PDF rather than published. Report XLSX files have Summary, Detail and Data sheets and an attendance chart. PDF templates are isolated from the staff app; Windows release verification remains a separate deployment check.

### 4.13 Phase 4 implementation details
The member portal is a separate responsive web app in apps/portal. It uses Firebase Auth with session persistence and callable Functions, and does not initialize Firestore persistence. Portal access is linked by Admin or Pastor to one eligible active person. Verified email, an enabled Auth account, the live access mapping and active membership are checked on every member request. Linking a portal account grants no staff role. Members can manage only their own sharing preferences and RSVPs.

Online directory sharing defaults off. Only explicitly shared contact fields are returned. Birthdays, membership status, attendance, care records and other staff data are never included. Public events require explicit publication. Public visitor and event forms create pending requests, with no messaging subscription and no capacity reservation. Staff approval atomically links an existing person or creates a Visitor, and checks event capacity before confirming a registration. Repeated approval cannot create another visitor.

Production portal callables enforce App Check and the configured PORTAL_ORIGIN. Form submissions additionally use a honeypot, idempotent request IDs and an eight-request-per-hour network budget keyed with a Secret Manager HMAC secret. Raw network addresses are not stored in rate buckets. Hosting serves only the portal build with restrictive headers. No site, DNS record, public event or real member account is provisioned automatically by development.

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

Phases 1 through 12 describe the earlier implementation. Their native Windows, kiosk and offline launch requirements are superseded by section 0. Phase 13 church configuration and branding is implemented. The next work is [Phases 14 through 18](docs/PWA_SERVICE_PLAN.md), beginning with PWA packaging and online-only workflows.

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

**Phase 4, Optional online pieces**
* Member portal or phone app for directory and RSVP
* Online forms (visitor card, event sign up)

**Phase 5, Staff administration (implementation extension)**
* Editable person profiles, membership timelines and person attendance
* Add a person to an existing household, household editing and atomic roster renames
* Church/time zone, service type and elder district setup with revision checks
* Permission-aware administrative archive with explicit exclusions
* Live provisioning, managed backups and native Windows release checks remain separate

**Phase 6, Attendance reports and dashboard**
* Historical attendance categories with explicit review records
* Attendance matrix, shepherding, visitor follow-up and membership roll
* Charted report workbooks and readable matrix PDF sections
* Dashboard attendance links, birthdays and serving gaps, with private Session follow-ups

**Phase 7, Security and account administration (implemented; live staging checks required)**
* Required staff MFA and passkeys, enrollment, recovery, revocation and secure desktop sign-in
* Staff account and role setup without self-escalation or access to Session records by non-Session administrators
* Private-record encryption, legacy migration and key rotation
* Security dashboard with scoped authentication, read-access and change history

**Phase 8, Shepherding workspace (implemented; live checks required, see docs/PHASE_8.md)**
* Household visit scheduling, assignments, completion and officer workload
* Congregation map, directions and ordered visit routes
* Contact-gap detection, configurable absence alerts and consented shepherding digests
* Explainable flock health indicators and Session-reviewed assessments

**Phase 9, Care workflows and diaconal ministry (implemented; live checks required, see docs/PHASE_9.md)**
* Versioned visual workflows with triggers, delays, tasks, approvals and consented messages
* Visitor follow-up and member onboarding templates
* Important dates, recurring anniversary reminders and bereavement care
* Separate deacon notes, household assignments, joint visits and practical-help request processing
* Privacy-scoped daily care digests

**Phase 10, Member self-service and calendar (implemented; live checks required, see docs/PHASE_10.md)**
* Passwordless email-link access without granting staff permissions
* Member contact/photo editing with existing privacy and consent boundaries
* Confidential prayer/care requests and practical-help requests routed to permitted officers
* Public calendar, private revocable calendar subscriptions and automatic event reminders

**Phase 11, Church records and data tools (implemented; see docs/PHASE_11.md)**
* Officer terms, ordination/installation history, rotation and eligibility lists
* Historical quorum reports and Session-maintained communion-approved lists
* Named communion participation and separate in-person/online worship attendance
* Family relationship links and anniversary records
* Previewed CSV/XLSX imports with duplicate review and auditable batches

**Phase 12, Staff mobile access and release (parts 1 and 2 implemented, see docs/PHASE_12.md; part 3 planned)**
* Full permitted staff workflows in a responsive web app, including phone attendance
* Shared validation and report logic without exposing native Electron APIs to the web
* Live MFA/passkey, provider and calendar delivery checks, managed backup/restore verification and signed Windows release checks

See [Expanded feature requirements](docs/FEATURE_EXPANSION.md) for the ten-area coverage table and the release criteria for each phase. For Phases 7 through 12, one church per Firebase project remains the deployment boundary. Phases 13 through 18 add managed deployments for multiple churches using separate projects. Financial features remain excluded.

## 7. Service costs and sustainability

The service aims to cover operating costs, with available surplus supporting ministry scholarships. Subscription prices and scholarship capacity remain provisional until pilot costs and support time are measured.

Track Firebase/Google Cloud usage per church, including Functions, schedulers, Secret Manager, Storage, backups, authentication and Hosting. Free allowances are not a guarantee of zero cost. Track domain costs, operational recovery and support time as well. Configure billing alerts and appropriate application limits without describing alerts as a guaranteed spending cap.

Twilio numbers, registration and message usage are separate church costs. Email depends on the configured church provider and account. Verify current provider prices at onboarding. Windows signing/installer expenses are not part of the approved PWA launch.

## 8. Decisions
1. Several PCs (sound booth and pastor to start), shared through Firebase.
2. Children are marked on the roll with their household. No labels.
3. Every service is taken name by name.
4. Pastoral notes and discipline are visible to the Session only.
5. People can be entered by hand. Validated CSV/XLSX import is also approved for Phase 11.
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

Phase 13 passed automated acceptance; see `docs/PHASE_13.md`. Implement Phase 14 in [Managed church PWA development plan](docs/PWA_SERVICE_PLAN.md): PWA packaging and online-only, server-confirmed workflows. Then implement repeatable Firebase provisioning in Phase 15. Do not deploy live projects or send real messages as part of local implementation.

Existing security/provider acceptance, managed backups and recovery remain release gates. Windows signing, native handoff and offline restart acceptance are retired from the PWA service. The implementation notes below describe existing behavior until the relevant phase changes it.

### Phase 12 implementation details

See `docs/PHASE_12.md`. The staff web is the desktop renderer built a second time with `__STAFF_WEB__`; it has no preload, and every native save, print or open call falls back to a browser download or tab. It is served from `apps/portal/dist/staff` by a Hosting rewrite, so passkeys verify against the same church security origin. Firestore uses a memory cache and Auth uses session persistence; any sign-out or change of account reloads the tab. Offline marks are kept in the tab until they sync, with a sync badge, a leave-page prompt and a Lock now warning. Below 760px the sidebar becomes a labelled menu and attendance uses 48px or larger targets. Server contracts, rules and the data model are unchanged. Part 2 adds a `recent-sign-in` reason to the server's five-minute refusal so the app can show Confirm it is you and retry once, renders the shared grids as labelled cards on phones and checks every role's destinations at 360, 390 and 1024 pixels.

### Phase 7 implementation details

See `docs/PHASE_7.md`. Staff functions check live Auth identities, role intersections, revocation and completed assurance. Rules use server-owned access and signed MFA or bounded assurance sessions. Account operations close access and serialize cross-service changes with pending locks. TOTP uses the provider enrollment/challenge flow; passkeys use verified WebAuthn assertions and a one-time system-browser desktop exchange. Direct private-document access is removed. Audited APIs decrypt application-encrypted fields only for the proper role and keep private content out of persistent attendance storage. Reports request only private visit/follow-up metadata. A one-time cache upgrade clears old private subscriptions. `sessionPrivate` now stores an envelope containing discipline flag/history rather than plaintext fields. The envelope has a version, key ID, IV, authentication tag and ciphertext bound to the document path. Security expiry moments use Timestamps; Auth cutoff fields are protocol epoch seconds. Account, read and change history is scoped, while platform Auth/console audit remains separate. Migration and rotation are resumable and require verified backup/recovery. This phase does not deploy or migrate a live church project.

### Phase 8 implementation details

See `docs/PHASE_8.md`. Visit plans and rounds are Session-only documents served by audited callables, with the visit purpose and cancellation reason sealed like note bodies. A plan is never contact; only completion counts, and completion is a separate one-time action allowed after the start time. It can create or link a Session visit record. Invited deacons receive only time, place, household and officer names. Visit reminders carry no household or purpose, use a revision-bound message ID and are rechecked at dispatch against the current plan, status and the recipient's live role. Contact gaps combine completed visits, recorded visits, calls and conversations, text replies and, by policy, personal messages from a Session officer to three or fewer people that were delivered (text) or accepted (email). Notes, plans, bulletins, group messages and failed or waiting messages are not contact. A person without contact stays unknown until complete records cover their threshold. The contact API returns dates and sources only. The fixed Monday absence email is replaced by a configurable weekly district digest (absence, contact gaps and the elder's visits) and an optional daily officer summary (visits and follow-ups due). Both use church-local schedules, deterministic per-date message IDs, the existing consent checks and Session-only dispatch rechecks. Texts carry counts only and no digest carries note text, purposes or follow-up titles. Household coordinates come from a Census lookup on an explicit click (only when the Session has turned lookups on, sending only the address) or manual entry. Lookups wait for confirmation, and a changed address marks the location for review. Only confirmed locations are plotted, on an offline sketch with an equivalent list. Directions open in the system browser through a named preload method after a preview; the main process builds the Google Maps link from addresses alone. Flock health indicators restate recorded facts (Phase 6 attendance, involvement, contact and household visits; communion and relationships stay unknown until Phase 11) against Session thresholds, with missing inputs unknown. Session assessments use a Session-maintained label list, carry encrypted reasons and a review date, and never change membership or start discipline.

### Phase 9 implementation details

See `docs/PHASE_9.md`. Mercy ministry is a separate boundary: request details, outcomes, notes, tasks and visit purposes are sealed and readable only by the deacons currently assigned to the household or request and by the Pastor; the Session and Session-named deacon chairs triage and assign without reading them, and a note reaches the Session only through an explicit, logged share. Invited Session officers see deacon visits as logistics only. A daily deacon summary lists households, kinds of help, due dates and visit times, never details or titles, and is rechecked against a live deacon role at dispatch. Important dates keep ordinary anniversaries apart from Session-only bereavement dates with sealed notes; reminders go out only on their church-local day, never late, name the person and day only, and are rechecked against the current record at dispatch. A Feb 29 date falls on Feb 28 in other years. Care workflows are Session only: triggers (visitor recorded, membership received, request approved, important date) start deterministic runs; steps wait, check conditions, assign tasks with live-role checks, ask for approval without self-approval by default, and send consented messages limited to greeting merge fields. Published versions are immutable, running people keep their version unless moved, leased transactions and step-based IDs keep each side effect single, and pausing stops further steps. The builder is an accessible step list with a keyboard-usable diagram, a required preview before activation, and run history with pause, cancel, retry and migration.

### Phase 10 implementation details

See `docs/PHASE_10.md`. Members sign in with Firebase email links (or their password); a blocking function refuses every client-created account with an email, links return only to allowlisted portal tabs, and access still requires the administrator-made mapping. Members edit only their own contact fields, photo and, as an adult with a recorded birth date, their household address, with stale-field checks. A new mobile number turns texts off; no member edit turns consent on. Photos are validated and served only through a sharing check. Prayer and pastoral requests are sealed in the Session-only `memberRequests` collection and read through the audited private-records API; practical help becomes a member-sourced mercy request in deacon triage. Members see only kind, date and progress. Organizers cancel, move or restore one date of a series under `exceptions`. Editors list member-visible events on a public calendar. Members and staff create revocable, expiring private iCalendar feeds stored only as token hashes and rechecked against live access; feeds never include RSVPs, rosters or care visits. Editors set up to three reminders per series; each date gets one message per reminder and details version, rechecked at delivery against cancellation, changes, the current audience and consent.

### Phase 5 implementation details

See `docs/PHASE_5.md` for workflows and archive semantics. Setup forms use document revisions; profile forms compare original values only for changed fields. Household renames update the names-only roster atomically. Membership and deceased-flag changes require matching history, and a death records Former and Deceased together. Setup writes are validated callable Functions and are audited. Initial legacy records without revisions are treated as revision zero. District archival preserves existing person assignments. The archive API checks live Auth administrator/Session roles on every page and never exposes arbitrary collections. No backup, hosting deployment or installer publication is performed by this milestone.

### Phase 6 implementation details

See `docs/PHASE_6.md` for exact report definitions. Attendance reports use membership status at each service date, preserve unclassified marks, and never use current status to fill missing history. Matrix eligibility follows recorded roll entry/removal. Percentages and averages use recorded meetings only. Absence streaks use distinct recorded Lord's Day dates. The prior average covers 28 preceding days and the year comparison preserves weekday at 52 weeks. Districts and contact details are current. Only Session receives current follow-up counts and dated visit information, with private exports labelled. The dashboard uses the same report math and links its attendance tiles to filtered reports. This phase adds no document collections and no new client writes.

### Review correction contracts

Household portal writes increment the shared household revision. Form drafts retain their base revision until save or explicit reload. Completed visits snapshot covered person IDs; legacy visits without recorded participants do not infer contact from today's household membership.

Imports claim an immutable payload hash before row creation, create missing rows transactionally without resetting outcomes, and expose processing only after the ready barrier. Retrying the same batch ID with different content is rejected.

Private message bodies and recipients use audited APIs and memory-only UI state. Desktop cache version 8 purges previously persisted private messages. Deacon digests carry a metadata fingerprint of their source and access records; changed or missing fingerprints suppress stale queued delivery. Old fingerprints are not regenerated after a change, so that day's summary may be skipped. Consent remains checked at dispatch.

Roll-call startup listens to a six-week window around the selected date. People/history and report workspaces load historical records when opened. Pending-write tracking spans date navigation. Message and workflow lists load all actionable work independently from cursor-paged completed history.


### Phase 13 implementation and verification

The implementation branch adds a separately published `publicBranding/church` document. Anonymous users receive an explicit field projection through `getPublicBranding`; direct database reads and all client writes remain denied. `getBrandingSettings` and revision-checked `savePublicBranding` require assured Admin or Pastor access through the existing live-role guard. The existing protected `settings/church` and `communicationSettings/church` are not made public.

Public identity fields are listed in section 4.3. There are no administrator identifiers, provider states, households, schedules or secrets in the anonymous payload. Logos are inline PNG only, at most 64 KB and 512 pixels; the editor re-encodes an uploaded PNG at up to 256 pixels. Approved palettes are checked for contrast. The Functions `CHURCH_ID` parameter and runtime project ID bind the document to the deployment; identity fields cannot be changed in the branding form.

Production clients require complete Firebase web configuration, a matching `VITE_DEPLOYMENT_PROJECT_ID`, `VITE_CHURCH_ID` and exact HTTPS `VITE_CHURCH_ORIGIN`. Missing/mismatched configuration shows a configuration-required page before authentication or data workspaces mount. Emulator defaults are selected only in development/emulator mode. Editable names and URL parameters never select Firebase resources.

Legacy migration is explicit: publish branding from Settings after reviewing the protected church name. No reads backfill or overwrite records. An absent public document shows a setup error and leaves staff sign-in/Settings available for an authorized administrator; reports refuse export until identity is available. Existing email footers and custom bulletin templates are preserved for explicit review. Sender merge fields and opt-out identification use the published church name. Existing calendar deployments must retain their prior UID namespace via `CALENDAR_UID_DOMAIN`; new installations use their project hostname so editable names never change UIDs.

See `docs/PHASE_13.md` for the inventory, migration and verification status. Phase 13 passed automated acceptance (245 unit, 64 rules and 151 browser tests, plus lint, type checking, builds and startup budgets); Phases 14–18 remain planned. No PWA installation, online-only mutation behavior, provisioning, recovery or live rollout is claimed by this implementation.
