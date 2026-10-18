# Phase 3 ChMS workflows

Phase 3 adds Groups, Calendar, Serving, Pastoral care, assigned Deacon tasks, an optional household kiosk, annual statistics, the meeting summary and a photo directory. It builds on the Phase 1 attendance foundation and Phase 2 message queue. It contains no giving or financial records.

## Groups, events and serving

Editors and Deacons can maintain groups and their named attendance. Ordinary congregation readers can view them. Choose a group, set the meeting date and mark people individually. Concurrent marks preserve each other. Message this group opens the existing composer with the group selected. Group membership and schedule edits reject stale forms.

Calendar supports single events and weekly/monthly series with an interval and a final date, up to two years. Church time governs recurrence across daylight-saving changes. A monthly date that does not exist in a shorter month is skipped. Each dated occurrence has its own RSVP list. A registration limit of zero means unlimited. Capacity is checked transactionally, including simultaneous registrations. Editing a series preserves previously recorded RSVP dates; review those registrations after changing a series. Cancelled series remain in the series list.

Serving entries can have an assigned person or remain an unfilled gap. The server prevents a person from being assigned to two roles at the same date and time. The existing minute scheduler queues reminders when they become due. Every reminder honors text consent and suppression, and the worker checks the current assignment revision before calling Twilio. Reassigning, changing or cancelling an entry stops its old pending reminder. A new revision may receive a new reminder. No reminder is sent after the serving time. Reminder delivery needs the Phase 2 live provider setup; emulators always simulate it.

## Session care and practical Deacon tasks

Pastoral care is available only to Pastor, Clerk and Elder roles. Admin without Session cannot use the care APIs or read their documents. Notes and visits carry a person, date and body. Follow-ups have an enabled Session account as assignee. Discipline changes append to the private history with a flag, date and explanation; they never place a discipline flag on the public person record.

Only Session creates or edits diaconal tasks. Include only the practical information the assigned Deacon needs. Deacons see only their own tasks and can complete them. They cannot change the assignee, reopen tasks, or read pastoral notes. Completing a task increments its revision so a stale Session form cannot overwrite completion. Root and subcollection audit triggers retain before/after values in the Session-only audit collection.

Church Auth users must have the correct roles and corresponding users documents. The assignee list checks actual enabled Auth accounts. The emulator tests create fictional accounts; production account provisioning remains an administrator task.

## Optional household kiosk

Kiosk is off until an Admin or Pastor enables it in Settings with a 6 to 12 digit exit PIN. Start a service in Attendance, close other app windows on that PC, then start the kiosk for that service. Starting signs out the staff account, clears local Firestore persistence, and signs in a separate kiosk identity. If another tab prevents cache clearing, restart the app and close the other tab before retrying.

The kiosk has no direct access to any congregation collection or to Storage. Its callable search accepts an exact surname, at least three characters, or a full phone number. It returns only names and checked-in state, never addresses, contact fields, birthdays or membership status. Up to five matching households can appear. Search results expire on screen after one minute; check-in capabilities expire after two minutes and are single use. Check-in only adds the chosen marks and cannot clear booth marks. Former and deceased people are excluded.

Device logins expire after four hours. Searches/check-ins share a per-device limit of 15 requests per minute. PIN hashes and search capabilities are server-only. Five wrong PIN attempts lock exit for that device. An administrator can disable kiosks from another signed-in PC; restart the kiosk app to return to staff sign-in. The PIN never grants staff privileges. A staff account must sign in again after kiosk exit. Kiosk mode needs a connection; offline attendance remains available through the staff roll-call screen.

The deployed Functions service account needs permission to sign Firebase custom tokens. Verify this with the church project's IAM configuration and Firebase setup. Configure Firestore TTL policies for kioskSearches.expiresAt and kioskDevices.expiresAt to remove expired records. Arrange periodic removal of expired kiosk Auth users through the trusted administration process. Expiry is checked on every server request even before TTL cleanup runs.

## Reports and photo directory

Annual reports is available to Editors and Read Only accounts. Deacons retain the basic attendance report. Choose a year and review the Summary, membership-change Detail and source records. Statistical membership uses membershipEvents, not today's status. Same-day changes follow their from/to chain. Missing and inconsistent histories, and baptisms without an infant/adult classification, appear as review counts. Complete the source history for the reporting period before submitting figures. An initial roll entry is the beginning of known history, not proof about years before records were kept.

Record baptism or profession adds a dated sacrament entry. A baptism requires infant/adult classification. This does not silently change membership status; membership changes still use the atomic person/history workflow. Adjust report labels saves the presbytery labels without changing the underlying measures. Refresh history reloads those source records after a change.

The meeting summary shows monthly averages and distinct visitors per service type, with twelve months per type, membership changes and an attendance chart. Only recorded services contribute to the average. A missing record is not a zero-attendance service. Retired service types remain available in historical figures.

XLSX exports contain Summary, Detail and Data sheets, frozen headers, column widths and an embedded attendance chart. CSV exports the chosen summary or directory. Grid Export buttons export their visible rows. The report PDF has a letter-size summary and separate membership-change detail pages as needed, with page numbers in Electron. In the browser, Print / PDF opens a print-ready report window; use the browser's Print command to save a PDF.

The directory includes active communicant, baptized, non-resident and adherent households. Former, deceased and visitor people are omitted. Editors can upload a JPEG, PNG or WebP photo under 4 MB. Images are resized and embedded when making the directory PDF. Unavailable stored photos stop the export so an incomplete directory is not silently delivered. Keep the directory within the congregation and review all contacts before distribution.

## Verification and deployment

Run the existing lint, typecheck, unit, rules, build and browser/emulator commands. All provider tests stay simulated. Deploy Functions, Firestore rules/indexes and Storage rules together only after configuring the actual church project. Existing Microsoft/Twilio account setup and live delivery checks in COMMUNICATIONS_SETUP.md still apply.

Verify Electron kiosk fullscreen, PIN exit, PDF rendering/printing, installer signing and updates on the Windows release machine before distributing the build. Browser/emulator tests do not replace a native packaged-desktop release test. The remaining Phase 1 profile/setup/report/backup and release tasks documented in README.md remain separate.
