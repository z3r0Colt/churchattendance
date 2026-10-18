# Phase 5 staff administration

The original roadmap ended at Phase 4. This milestone fills staff workflow gaps in the attendance foundation. It does not deploy a church project or publish an installer.

## People and households

People now includes the entire roll, including former and deceased people, with name, status and district filters. Exports contain the visible rows. Choose a person's name to open their profile, membership timeline and recorded attendance. Missing history is flagged rather than invented. Contact information and consent use the existing consent dialog and its evidence record.

Editors (Admin, Pastor, Clerk and Elder) may add a person to an existing household, edit profile fields, move a person between households and edit household information. New people start with communication consent off. Household renames update the names-only attendance roster in the same transaction. A household with more than 100 people requires administrator review before renaming.

Profile forms submit only changed fields and their original values. Independent field changes can merge. A changed field that was edited elsewhere rejects the stale form. Contact edits have their own expected-value checks. Existing integrations may still call the original profile API without expectations; those retain the previous last-write behavior.

Membership status and deceased-flag changes require a date, method and reason. They create a history document atomically with the person and roster changes. A death must use Former, Deceased and the Death method together. Changes earlier than the latest recorded membership event require Clerk review rather than silently rewriting history. Initial entries record the supplied roll date. These screens do not provide a history-repair or record-deletion tool.

History, contact and attendance data have the existing reader permissions. Private care stays in Pastoral care with its Session-only permissions. Person custom fields, anniversary fields, office editing, duplicate merging, saved people lists and a full person dashboard remain outside this milestone.

## Church setup

Admin and Pastor can edit the church name, address and IANA time zone in Settings. The time zone drives church calendar dates and automation. Changing it does not move existing event instants or already queued messages. Communication names and message footers remain separately configurable in communication settings.

Service types can be added, edited and made inactive. Their IDs remain stable, and earlier attendance remains available. Elder districts can be added, edited and archived. Choose a living communicant or non-resident member as the elder's directory identity, then assign districts on person profiles. This selection does not grant a role. Absence delivery separately checks the linked account's Session role and consent. Archiving a district preserves existing assignments and prevents new profile assignments to it.

Setup forms use revision checks. Reopen a form after another PC changes the same setup record. Person and household changes, church settings, service types and districts feed the server-owned, Session-only audit log.

Firebase Authentication accounts and staff roles still use the trusted setup process described in the README. The first Pastor/Admin must be provisioned outside the app. This milestone does not add account creation or a staff role editor.

## Administrative archive

An Admin can choose **Export permitted records** in Settings. An Admin without a Session role receives administrative records. An Admin who is also Pastor, Clerk or Elder also receives Session records, assigned task data and the audit log. The server checks the current Auth account and roles on each page, including account disablement. A stale client token cannot retain export privileges after those roles are removed.

The workbook contains a Summary manifest and one worksheet per included collection. Rows hold a document path, a part number and JSON. Large documents are split into ordered chunks of at most 30,000 UTF-16 characters without breaking surrogate pairs. Concatenate a document's parts in numeric order to inspect its JSON. Timestamps retain seconds and nanoseconds. The archive has a format version, UTC start/end times, document counts and explicit exclusions.

The server uses an explicit collection allowlist and restricts nested history, sacrament, office, group-meeting and RSVP exports to their known roots. Pages contain at most 25 documents and 4 MB of serialized data. Oversized individual documents require a managed export. The client stops above approximately 80 MB of uncompressed JSON or 10 MB of workbook output. Failures produce no partial download. A cancelled Windows save dialog produces no success message.

This is a live, paged document archive, not an atomic snapshot or a supported restore format. Pause editing during export. It excludes Storage files, messages and their recipient delivery queue, bulletin records and download tokens, suppression records, provider configuration, kiosk hashes and capabilities, rate budgets and other operational collections. Queue state cannot be restored safely through a workbook. These exclusions also avoid exposing live capabilities and secrets.

Managed Firestore backups and a separate Storage recovery policy are still required for recovery. Provision the planned daily Firestore schedule with 30-day retention in the church-owned project, restrict restore permissions, and complete a restore drill to an isolated database before using real records. Backups are not provisioned or running as a result of this commit. Do not label the workbook "Export Everything" or a full backup.

## Validation and release work

The emulator suite covers profile concurrency, consent isolation, atomic history, chronological changes, household roster consistency, setup roles/revisions, export pagination, timestamp preservation and private/operational export denial. Browser workflows exercise person editing, membership history, service setup and workbook download. Tests use fictional records only and never contact Graph or Twilio.

Run the standard lint, typecheck, unit, build, rules and browser suites before release. Browser tests do not verify native Windows dialogs. On Windows, verify the archive filename/save cancellation, large workbook handling, PDF preview and print, kiosk fullscreen/exit, disconnected restart with queued attendance, signed NSIS installation and updates. Installer signing, update publishing, live hosting, provider configuration and backup provisioning remain manual release work.
