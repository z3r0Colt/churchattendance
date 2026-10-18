# Phase 9 care workflows and diaconal ministry

Phase 9 adds care workflows, important dates and a separate Mercy ministry workspace for deacons. It is being built in slices. This file records what each slice implements and its limits. Scope and acceptance criteria are in [Expanded feature requirements](FEATURE_EXPANSION.md).

| Slice | Scope | Status |
|---|---|---|
| 1 | Mercy ministry: deacon chairs, household assignments, practical-help requests and triage, encrypted mercy notes and tasks, explicit sharing | Implemented |
| 2 | Joint deacon visits and the daily deacon digest | Implemented |
| 3 | Important dates, recurring reminders and bereavement care | Planned |
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

## Verification

Unit tests cover the read and triage rules, forward-only request status and the request, triage and resolution schemas. Rules tests confirm every role, including Session and deacons, is denied direct access to all five mercy collections. Emulator tests confirm sealed storage; triage by a chair and refusal for an ordinary deacon; that the assigned deacon reads the details, writes a note and a task, and moves the request forward; that another deacon sees nothing, the chair and an elder see only triage fields and the Pastor sees everything; that an Admin is denied and a deacon cannot read Session care notes; that a household transfer removes the former deacon's access to an earlier note; that the Session reads a note only after a deacon shares it, and cannot share it themselves; that mercy history is Pastor-only and free of note text; and that a declined request keeps its reason sealed and cannot be reopened. A desktop test signs in as the assigned deacon, reads the request and writes a mercy note. Visit tests confirm sealed purposes, refusal for an unassigned deacon or a deacon who does not serve the household, logistics only for the invited elder, no visit for an uninvited elder, one-time completion with a linked note and refusal to complete a future visit. Digest unit tests cover the church-local hour and counts-only text. An emulator test confirms nothing before the hour, one email and one text across repeated ticks, households and kinds of help without details, notes or task titles, a waiting summary skipped once the recipient is no longer a deacon, and no new summary for them.

## Live checks and limits

- All data is fictional. No real messages are sent.
- The workspace reads all mercy records in one call and filters them on the server. That suits a congregation of this size but would need paging for a much larger church.
- Member-submitted practical-help requests arrive in Phase 10. Staff raise requests on a member's behalf until then.
