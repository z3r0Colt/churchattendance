# Phase 9 care workflows and diaconal ministry

Phase 9 adds care workflows, important dates and a separate Mercy ministry workspace for deacons. It is being built in slices. This file records what each slice implements and its limits. Scope and acceptance criteria are in [Expanded feature requirements](FEATURE_EXPANSION.md).

| Slice | Scope | Status |
|---|---|---|
| 1 | Mercy ministry: deacon chairs, household assignments, practical-help requests and triage, encrypted mercy notes and tasks, explicit sharing | Implemented |
| 2 | Joint deacon visits and the daily deacon digest | Implemented |
| 3 | Important dates, recurring reminders and bereavement care | Implemented |
| 4 | Workflow engine: versions, runs, waits, conditions, tasks, approvals and consented messages | Planned |
| 5 | Workflow builder, templates, preview, pause, cancel and retry | Planned |

Decisions made before implementation: the workflow builder is an accessible step list with a live diagram beside it, not a drag-and-drop canvas. Mercy notes are readable by the deacons currently assigned and by the Pastor. The Session and Session-named deacon chairs triage requests. A Feb 29 important date falls on Feb 28 in other years.

## Mercy ministry

Mercy ministry covers practical help: meals, transport, help at home, errands, household supplies, visits and other practical care. It never records money, donations, benevolence funds or accounts.

**Who sees what.** Private mercy content is request details, outcomes, decline reasons, mercy notes and mercy tasks. It is readable by the deacons currently assigned to the household or to the request, and by the Pastor for oversight. Assignment is read live on every call, so removing a deacon from a household or request ends their access at once, including to notes written before. The Clerk and Elders, and deacons the Session names as chairs, triage: they see the household, person, kind of help, urgency, needed-by date, status and assigned deacons, but not the details or notes. A deacon who raises a request sees its status afterwards, and its details only if assigned. An Admin outside the Session and every other role are denied all mercy endpoints. Session care notes, follow-ups and discipline records remain unavailable to every deacon without a Session role.

**Chairs and assignments.** The Session names up to six deacon chairs. A chair must still hold the deacon role to act. The Session and chairs assign up to four deacons to a household; an empty list removes them all.

**Requests.** Any deacon or Session officer can raise a request for a household, optionally naming a living person in it. Triage approves it with one to four deacons, or declines it with a reason. Open requests can be reassigned. An assigned deacon or the Pastor moves it to In progress and then Resolved with a short outcome. Resolved and declined requests are closed. Every change checks the record revision.

**Notes and tasks.** Assigned deacons and the Pastor write dated mercy notes for a household, optionally linked to one of its requests. Only the author edits a note. Tasks belong to an open request and go to a deacon serving that request or household.

**Sharing.** An assigned deacon or the Pastor can share a note with the Session. The confirmation names the audience (the Pastor, the Clerk and every Elder) before saving. Sharing is logged as `mercy.share` and cannot be undone in the app. Other deacons still cannot read a shared note.

**Storage and audit.** All five mercy collections are denied to every direct client. Details, outcomes, decline reasons, note bodies and task titles are sealed with the private record key ring, bound to the document path, and included in key migration. `getMercyWorkspace` writes a `mercy.read` security event for each private record before returning it. Denied calls write `mercy.access`. Mercy security events use a separate `mercy` scope that only the Pastor can view. Change audit entries record mercy changes with the sealed fields still sealed; the audit trail's metadata (household, dates, status) is Session-scope like the rest of the audit log.

## Deacon visits

Assigned deacons and the Pastor plan visits to a household they serve, optionally linked to one of its requests. A visit has a church-local time, length, place, one to four deacons who serve that household or request, up to four invited Session officers and a private purpose. Cancelling needs a short reason. Planning is not a record of care: completion is a separate one-time action, available only after the start time, that can add a mercy note. The note ID follows the visit, so a retried completion cannot write a second note. A completed visit cannot be rescheduled.

The purpose and cancellation reason are sealed like other mercy content. An invited Session officer receives only the time, length, place, status, household name and address and the deacons' names, through `getVisitLogistics`, and sees them under Mercy ministry, Visits. The Session daily summary lists the deacon visits an officer is invited to that day by time and household. Session-led joint visits from Phase 8 are unchanged: invited deacons still see only their logistics.

## Daily deacon summary

Communication settings add a daily mercy ministry summary with its own hour and channel. Administrators and Pastors can change it. At or after the chosen church-local hour, each person linked to a live deacon account receives one summary listing:

- requests waiting for triage, for deacon chairs only;
- their open requests, by household, kind of help, needed-by date and urgency;
- their tasks due, by household and due date (task titles are private and never included);
- their deacon visits and invited Session visits today, by time and household, and their overdue deacon visits.

Email lists these entries. Text carries counts only. Nothing is sent when every section is empty. Message IDs are `deacon_<church date>_<person>_<channel>`, so repeated ticks queue one notice. The summary is marked Session only in the message log, so an Admin outside the Session cannot read it there. At dispatch the queue rechecks that the recipient still holds a live deacon role, and normal consent and suppression checks apply. No summary includes request details, outcomes, notes, visit purposes or task titles.

## Important dates

Important dates are yearly reminders to reach out to a living person. There are two kinds, kept apart:

- **Ordinary dates**: wedding, baptism and membership anniversaries, or another named date. Administrators and Session officers add them. Staff with ordinary read access can see them.
- **Bereavement dates**: the anniversary of a death, a late spouse's birthday, or a wedding anniversary after a spouse's death, with an optional private note. They are Session only. The collection is denied to every direct client, the note is sealed with the private key ring and included in key migration, and the dates are read through the audited private-records API.

A bereavement date can link to a related person who has died. The link keeps the record meaningful without making that person a recipient, because delivery always skips deceased and former people.

**Recurrence.** Each date repeats every year from the year after the original date. Reminders can continue every year, through a chosen year, or through a chosen anniversary number (for example, the first three anniversaries of a death). A Feb 29 date falls on Feb 28 in years without Feb 29. A reminder is sent zero to thirty days before the date, to one chosen staff member whose account is linked to a person; bereavement reminders go only to a Session officer.

**Scheduling.** Date reminders are off until turned on in Communication settings, with a church-local hour. At or after that hour, the scheduler queues only reminders whose reminder day is today in the church time zone. A reminder day that has passed is never sent late, so a scheduler outage or a newly entered past date produces no backlog. Message IDs are `date_<record>_<occurrence date>`, so repeated ticks queue one reminder.

**Changing a date.** The editor shows, before saving, what the change does: whether the waiting reminder is unchanged, will not be sent, and when the next one will be. At dispatch the queue rechecks that the record still exists, still leads to that occurrence, still names the same recipient account linked to the same person, and that the account still holds a permitted role. Editing, removing or reassigning a date therefore drops a reminder still waiting. Removing a date asks for confirmation.

**Content.** The reminder says only that an important date for the person is on a day, and asks the recipient to open the app. It never names the kind of date, the related person or the note. Bereavement reminders are Session only in the message log and are rechecked against a live Session role at dispatch. Normal consent and suppression checks apply.

## Verification

Unit tests cover the read and triage rules, forward-only request status and the request, triage and resolution schemas. Rules tests confirm every role, including Session and deacons, is denied direct access to all five mercy collections. Emulator tests confirm sealed storage; triage by a chair and refusal for an ordinary deacon; that the assigned deacon reads the details, writes a note and a task, and moves the request forward; that another deacon sees nothing, the chair and an elder see only triage fields and the Pastor sees everything; that an Admin is denied and a deacon cannot read Session care notes; that a household transfer removes the former deacon's access to an earlier note; that the Session reads a note only after a deacon shares it, and cannot share it themselves; that mercy history is Pastor-only and free of note text; and that a declined request keeps its reason sealed and cannot be reopened. A desktop test signs in as the assigned deacon, reads the request and writes a mercy note. Visit tests confirm sealed purposes, refusal for an unassigned deacon or a deacon who does not serve the household, logistics only for the invited elder, no visit for an uninvited elder, one-time completion with a linked note and refusal to complete a future visit. Digest unit tests cover the church-local hour and counts-only text. An emulator test confirms nothing before the hour, one email and one text across repeated ticks, households and kinds of help without details, notes or task titles, a waiting summary skipped once the recipient is no longer a deacon, and no new summary for them. Date unit tests cover Feb 29 on Feb 28, anniversary counting, both end conditions, no late reminders, a reminder crossing the new year, the edit explanation and bereavement validation. Rules tests confirm ordinary dates are readable by staff readers but not volunteers, and bereavement dates are denied to every direct client. Emulator tests confirm editor-only ordinary dates, Session-only sealed bereavement dates, refusal of a non-Session recipient or a deceased person, stale-edit refusal, nothing before the hour, one reminder per date across repeated ticks with no kind or note in the body, nothing late for a missed day, and a waiting reminder dropped after its date changes. A desktop test adds a bereavement date and checks the previewed next reminder.

## Live checks and limits

- All data is fictional. No real messages are sent.
- The workspace reads all mercy records in one call and filters them on the server. That suits a congregation of this size but would need paging for a much larger church.
- Member-submitted practical-help requests arrive in Phase 10. Staff raise requests on a member's behalf until then.
