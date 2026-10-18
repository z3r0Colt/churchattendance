# Phase 8 shepherding workspace

Phase 8 adds a Session-only Shepherding workspace. It is being built in four slices. This file records what each slice implements and its limits. Scope and acceptance criteria are in [Expanded feature requirements](FEATURE_EXPANSION.md).

| Slice | Scope | Status |
|---|---|---|
| 1 | Household visits, rounds, officer workload, joint-visit logistics, visit reminders | Implemented |
| 2 | Contact timeline and contact-gap thresholds | Implemented |
| 3 | Configurable absence alerts and consented shepherding digests | Planned |
| 4 | Household locations, routes and flock health indicators | Planned |

Decisions made before implementation: geocoding uses the US Census geocoder only on an explicit staff action, directions open in the system browser after a preview, and flock assessment labels are a Session-maintained list.

## Visits and workload

Pastor, Clerk and Elder plan a visit to a household with a church-local date and time, length, place, one to four Session officers and up to four invited deacons. A plan can belong to a visit round. Each save checks the record revision. Officers and deacons must be enabled accounts that currently hold the required role, and a person cannot be both. Every chosen person must belong to the household.

A plan is not contact. Planned visits are Upcoming until their scheduled hour has passed, then Overdue until someone completes or cancels them. Cancelling needs a short reason. Completion is a separate action, available only after the start time and only once. Completion can write a new Session visit record for one active household member, link an existing visit record for someone in the household, or record no note. A new record is dated by the church-local visit date. A completed visit cannot be rescheduled.

Workload lists each officer's upcoming and overdue visits, plus completed and cancelled visits within the chosen church-local dates. Each count opens the matching visits. Visit rounds cover households with at least one member or adherent who is not deceased. Coverage uses only visits explicitly placed in the round, never visits that happen to fall within its dates.

## Privacy

`pastoralVisits` and `visitRounds` are denied to every direct client read and write, including Session. The audited private-records API serves them to Session only and logs each record read. The visit purpose and cancellation reason are sealed with the private record key ring and bound to the document path, and they are included in key migration. Change audit entries for both collections use the Session scope.

An invited deacon calls `getVisitLogistics` and receives only the time, length, place, status, household name and address, and officer names for their own invitations from the past 30 days onward. The purpose, round, linked note and other visits are never returned. An Admin outside Session is denied all visit endpoints.

## Reminders

When a reminder period is set, the minute scheduler queues one message to the officers and one to the invited deacons, using their linked person records. The message says only that a visit is scheduled at a church-local time and asks them to open the app. It names no household or purpose. The officers' copy is marked Session only. Message IDs include the visit revision, so repeated ticks queue one reminder per plan version. At dispatch the queue rechecks that the plan still exists, is still planned at that revision, and that the recipient is still assigned with a live role. Rescheduling or cancelling therefore suppresses any reminder still waiting. Normal consent and suppression checks still apply. Email is used when enabled, otherwise text.

## Contact gaps

Contact is recorded, not inferred. These count as contact with a person:

- A completed visit. It counts for the listed people, or for everyone currently in the household when no one is listed. Planned, overdue and cancelled visits never count.
- A Session record of kind visit, phone call or conversation. A pastoral note is not contact.
- A text reply from the person, other than STOP, START, HELP and similar keywords.
- When the policy allows it, a personal message composed by someone who currently holds a Session role, sent to three or fewer named people. A text counts once the carrier reports it delivered. An email counts once Microsoft accepts it, which is the strongest signal available and is labelled that way. Pending, sending, failed, undelivered, skipped and unknown outcomes never count. Bulletins, reminders, alerts and group, status, district or saved-list messages never count.

The Session sets the contact policy: the date from which contact records are complete, a church threshold in days, optional district thresholds and which membership statuses are tracked (Communicant and Adherent by default; visitors and former people cannot be tracked). Each person is measured from their last contact on or before today. Without one, they are measured from the later of the records start and their first membership history date. If that threshold has not yet passed, the person shows Unknown (records too recent to judge) or Not yet due (joined after records began) instead of a gap. Each row shows the last contact and its source, the rule applied and why the state was reached. The timeline lists every contact event for the person, and Record contact adds a Session call, conversation or visit record.

`getContactHistory` is Session only and records a Session-scope security event. It returns policy, dated contact events with their source and reference ID, and first roll dates. It returns no note bodies, message text, reply text or visit purpose. `shepherdingSettings` is server-owned and denied to every direct client read and write. Contact gaps are separate from the Phase 6 absence calculations, which are unchanged.

## Verification

Unit tests cover plan validation, visit states, workload date ranges in the church time zone, round coverage and the reminder window. Rules tests confirm that Session, an invited deacon and every other role are denied direct access to both collections. Browser and emulator tests cover deacon logistics isolation, Admin denial, encrypted storage, one-time completion with a new visit record, refusal to complete a future visit, and reminder suppression after a reschedule and a cancellation. A desktop workflow test plans a round visit, opens it from workload and completes it. Contact tests seed delivered, failed, queued, bulletin, broadcast and non-Session messages, replies including a HELP keyword, a note and a call, and confirm only qualifying contact is returned with no private text. Admin and Deacon accounts are denied contact history and policy changes. A desktop test shows Unknown before records cover the rule, a known gap with its rule after the policy changes, and Current after recording a call. All data is fictional and no real messages are sent.
