# Phase 8 shepherding workspace

Phase 8 adds a Session-only Shepherding workspace. It was built in four slices and is implemented in code. Live checks are listed at the end. This file records what each slice implements and its limits. Scope and acceptance criteria are in [Expanded feature requirements](FEATURE_EXPANSION.md).

| Slice | Scope | Status |
|---|---|---|
| 1 | Household visits, rounds, officer workload, joint-visit logistics, visit reminders | Implemented |
| 2 | Contact timeline and contact-gap thresholds | Implemented |
| 3 | Configurable absence alerts and consented shepherding digests | Implemented |
| 4a | Household locations and visit routes | Implemented |
| 4b | Flock health indicators and Session assessments | Implemented |

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

## Digests

Communication settings replace the fixed Monday absence email with a weekly shepherding digest and an optional daily summary. Administrators and Pastors can change the schedule; the content is decided by the rules below, not by the person configuring it.

- **Weekly digest.** On the chosen weekday at or after the chosen hour, church time, each active district whose elder is linked to an account currently holding a Session role receives one digest. It lists people in the district absent from the configured number of recorded Lord's Days (two to twelve, default three; every one of those Lord's Days must have a recorded service), people in the district with a contact gap when a contact policy exists, the elder's overdue visits and the elder's visits in the next seven days.
- **Daily summary.** At or after the chosen hour each day, each person linked to a live Session account receives their visits today, their overdue visits and the people whose follow-ups assigned to them are due. Follow-up titles are private and never included.
- **Channels.** Email lists names. Text carries counts only and asks the officer to open the app. Email and text can both be chosen. A channel is used only when it is enabled in delivery settings.

Nothing is sent when every section is empty. Message IDs are `digest_<church date>_<district>_<channel>` and `daily_<church date>_<person>_<channel>`, so repeated scheduler ticks queue each notice once. Every digest is Session only: the normal queue applies consent and suppression, and dispatch rechecks that the recipient still holds a Session role. Names are stripped of braces so they cannot be read as merge fields. No digest contains note bodies, visit purposes, cancellation reasons, follow-up titles or discipline details.

## Locations and routes

Address lookups are off until a Session officer turns them on. When on, Look up sends only that household's address to the US Census Bureau geocoder. Nothing is looked up automatically. A lookup is stored as found but not confirmed, with the address it matched, until a Session officer confirms it. Staff can instead enter coordinates by hand, which counts as confirmed. Every location remembers a fingerprint of the address it belongs to. If the household address changes, the location is marked as changed and returns to review. Households with no address, no coordinates, an unconfirmed lookup or a changed address appear in Locations to review.

Only confirmed locations are plotted. The plot is an offline sketch drawn in the app with no map tiles or other remote content, and it never places a household at an invented location. The confirmed list beside it carries the same information with its source. Markers show the household name only.

A route holds two to ten confirmed households. Stops can be added by hand or from your own planned visits on a date, reordered with Earlier and Later, or ordered by a simple nearest-next suggestion from the first stop. Preview directions lists exactly the addresses that will leave the app, in order. On confirmation the desktop calls the named `openDirections` preload method with the addresses only. The main process validates them, builds the Google Maps directions link itself and opens it in the system browser, so the renderer cannot ask it to open any other address. No household name, note or visit detail is part of the link.

`householdLocations` and `shepherdingSettings/geography` are server-owned and denied to every direct client. The location callables are Session only and record Session-scope security events, with the household path and never the address. Under the emulators a deterministic fictional geocoder is used, so tests never call the Census Bureau.

## Flock health

Flock health lists everyone on the roll who is not a visitor, former or deceased. Each enabled indicator reads Within policy, Below policy, Recorded (information only) or Unknown, with the recorded facts that produced it. Status is always written in words.

- **Attendance** uses the Phase 6 shepherding calculation over the configured number of weeks (default 12) and every recorded service type. Missing or inconsistent membership history, or no recorded services, is Unknown. The policy is a minimum percentage (default 50).
- **Involvement** shows active group memberships and serving assignments in the last 90 days, as information. It is Unknown while no groups or serving schedule exist.
- **Contact** follows the contact gaps rules above. A person not covered by the contact policy is Unknown.
- **Household visit** uses the latest completed visit to the person's household against a policy in days (default 365). Without one, it is Below policy only after visit records have covered the whole policy period, and Unknown before that.
- **Communion** and **Relationships** stay Unknown until Phase 11 records them.

The Session chooses which indicators to show and the thresholds. Indicators restate recorded facts for pastoral review. They do not describe anyone's spiritual condition, and nothing on this screen changes membership, starts discipline or sends a message.

A Session officer can record a dated assessment for a person, with reasons, a review date and an optional label. Labels come only from the Session's own list, which starts empty. Adopt suggested labels adds Healthy, Weak, Stray and Lost in one explicit step, and the Session can rename or remove any label. Existing labels keep their IDs so past assessments still read correctly. Assessments show their author and dates separately from the indicators. The reasons are sealed with the private key ring like note bodies and are included in key migration. `flockAssessments` and `shepherdingSettings/health` are server-owned. Assessments are read through the audited private-records API, Session only.

## Verification

Unit tests cover plan validation, visit states, workload date ranges in the church time zone, round coverage and the reminder window. Rules tests confirm that Session, an invited deacon and every other role are denied direct access to both collections. Browser and emulator tests cover deacon logistics isolation, Admin denial, encrypted storage, one-time completion with a new visit record, refusal to complete a future visit, and reminder suppression after a reschedule and a cancellation. A desktop workflow test plans a round visit, opens it from workload and completes it. Contact tests seed delivered, failed, queued, bulletin, broadcast and non-Session messages, replies including a HELP keyword, a note and a call, and confirm only qualifying contact is returned with no private text. Admin and Deacon accounts are denied contact history and policy changes. A desktop test shows Unknown before records cover the rule, a known gap with its rule after the policy changes, and Current after recording a call. Digest unit tests cover church-local scheduling across the UTC date boundary, configurable absence runs, setting bounds, merge-field safety and counts-only text. Emulator tests confirm one weekly email and text per district across repeated ticks, names only in email, an email opt-out that still allows the text, no digest once the elder's account no longer links to a Session role, and a daily summary that excludes the follow-up title and visit purpose. A desktop test saves the digest settings. Location unit tests cover review states, address comparison, coordinate bounds, route ordering, directions links built from addresses alone and plot bounds. Emulator tests confirm Admin and Deacon denial, no lookup while lookups are off, failure for a missing address or no match, confirmation, a changed address returning to review and refusing confirmation, manual entry and address-free security events. A desktop test plots only confirmed households, reorders a route, previews the exact addresses and opens a link containing no household names. Health unit tests cover each indicator against policy, unknown inputs, a missing visit before and after records cover the period, enabled indicators, label uniqueness and assessment dates. Emulator tests confirm Admin and Deacon denial, labels limited to the Session's list, encrypted reasons, no change to the person record, revision checks and no reasons in the contact history response. A desktop test shows the review disclaimer and indicator states, adopts the suggested labels and records a dated assessment.

## Live checks and limits

- Digests and visit reminders use the existing Microsoft Graph and Twilio delivery. Verify a digest and a reminder reach a staging officer, and that opt-outs suppress them, before relying on them.
- If the Session turns on address lookups, check a few known church addresses against the live Census geocoder on staging. It covers US addresses only, and a lookup can fail or match imprecisely, which is why every lookup waits for confirmation.
- Directions open Google Maps in the system browser. Check that the packaged Windows app opens the browser and never an app window.
- The plot is a sketch, not a street map, and does not replace navigation.
- Contact history is read in full on each request. That is fine for a congregation of this size but would need paging for a much larger church.
- Communion and relationship indicators stay Unknown until Phase 11. All data is fictional and no real messages are sent.
