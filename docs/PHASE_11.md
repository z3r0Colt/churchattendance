# Phase 11 church records and data tools

Phase 11 adds officer records, quorum reports, communion records, online worship attendance, family relationships and reviewed imports. It is built in slices. This file records what each slice implements and its limits. Scope and acceptance criteria are in [Expanded feature requirements](FEATURE_EXPANSION.md).

| Slice | Scope | Status |
|---|---|---|
| 1 | Officer terms, ordination and installation history, rotation and term reviews, eligibility lists | Implemented |
| 2 | Quorum rules, meetings and historical quorum reports | Implemented |
| 3 | Communion approval, named communion participation, in-person and online worship | Implemented |
| 4 | Family relationships, family tree and anniversary records | Planned |
| 5 | Previewed CSV/XLSX imports with duplicate review and auditable batches | Planned |

Decisions made before implementation: the communion-approved list and named communion participation are Session only. Online worshippers appear as a separate column, each person counted once per service, and the statistical report's average Lord's Day attendance stays in-person unless the Clerk chooses combined. Admin and Session may import. Term reviews show in the app and as a count-only line in the consented daily officer summary.

## Officer records

**Offices** stay at `people/{personId}/offices/{id}`, one record per period of active service in this congregation: office (Pastor, Ruling elder, Deacon), ordination date, installation date, the date the term ends (if the office has terms), the date active service ended with a reason (term ended, rotated off, resigned, retired, moved, removed, died, other) and an emeritus date. Staff readers can see office history; only the Session writes it, through `saveOffice` and `removeOffice`.

**Validation.** A record needs an ordination or installation date. Installation cannot precede ordination, a term must end after it begins, an end date needs a reason (and a reason needs an end date), and emeritus status follows the end of active service. The server refuses a period that overlaps another period in the same office for the same person; a new period may begin on the day the earlier one ended. The **Office records** grid flags existing problems in a Check column: overlapping periods, a missing installation date, or a person who has died while the record shows no end date.

**State on a date.** Active service runs from installation up to, but not including, the end date. A record without an installation date reads "Installation not recorded" rather than serving.

**Term reviews.** A serving officer whose term ends within 60 days, or whose term has passed without an end date, appears on **Officers, Term reviews** and as a count on the dashboard's Session strip. The daily officer summary (Phase 8, consented and rechecked at dispatch) gains a section "Officer term reviews within 60 days" that lists the office and date only, never the officer's name. **Terms ending by year** helps plan rotation.

## Eligibility

The Session adopts criteria per office (`officerPolicies/elder`, `officerPolicies/deacon`): qualifying membership statuses, an optional minimum age, an optional minimum number of years as a member, whether people under discipline are left out, and where the criteria come from. Until adopted, the list uses Communicant Member only and says so.

For an as-of date the list shows each living, non-former person with the result of each criterion:

* **Membership** comes from recorded history on that date. A person whose history cannot say is "Needs review".
* **Age** needs a recorded birth date. A Feb 29 birthday counts from Feb 28.
* **Years as a member** counts from the last time the person entered a qualifying status. An "initial" history entry is when the record was made, not when the person was received, so it is "Needs review" rather than a guess.
* **Discipline** reads the dated discipline entries for that date. A flag with no dated entries is "Needs review".

The result is "Meets recorded criteria", "Does not meet" or "Needs review". The app never infers a call to office, character or gifts, and gender is not recorded on people, so any qualification the records do not hold belongs in a Session decision. **Session decisions** (`officerDecisions`: approved by the Session, not approved, deferred, with a date and a sealed note) are shown beside the facts; the latest decision per person and office is shown. A decision never changes membership or office records.

Policies and decisions are Session only, read through the audited private-records API. Decision notes are sealed with the private record key ring and bound to the document path.

## Quorum

The app supplies no denominational rule. The Session records each rule it follows (`quorumPolicies`): meeting type (Session, congregational, diaconate, other), the date it takes effect, the electorate and the requirement, with a required source. A later rule for the same meeting type replaces the earlier one from its effective date, so past meetings keep the rule that applied.

* **Officer electorate:** chosen offices serving on the meeting date, optionally including emeritus officers.
* **Member electorate:** chosen statuses on the meeting date from membership history, with an optional minimum age and an optional exclusion of people under discipline on that date.
* **Requirement:** at least a number present, a percentage of the electorate rounded up, or both (the larger applies).

A **meeting** (`quorumMeetings`) records its type, date, name and the people present. The report lists every person considered with Counted, Not counted or Needs review and the reason, shows who was present from outside the electorate, and states the calculation, for example "At least 2 and 50% of 4 rounded up is 2. Required: 2. Present from the electorate: 2." People with incomplete records (no membership history, no installation date, no birth date where age matters, a death not in history, or a discipline flag without dated entries) are not counted. If they could change the outcome the result reads "Depends on records to review" instead of met or not met. A meeting with no rule in effect says so.

Rules and meetings are Session only, written through `saveQuorumPolicy` and `saveQuorumMeeting` and read through the audited private-records API.

## In-person and online worship

A roll-call mark now carries a `mode`, `inPerson` or `online`, on the same `present.{personId}` field, so marking stays one field per person and offline merging between PCs is unchanged. The roll call has a **Marking online worshippers** switch. While it is on, new marks (single names, Enter in search, Mark all and Undo) are online; the chip keeps the present colours with a dashed edge and reads "Online · status", and the Present tile adds "· N online". To change how someone worshipped, clear the mark and mark again with the switch set. Kiosk check-ins are always in person, and the rules refuse an online kiosk mark or any other mode.

Each person counts once per service whatever the mode. Marks made before online tracking have no mode and count as in person; data exports call them "In person (not recorded)".

* **Weekly summary** adds In person and Online columns beside the status columns and Total, which counts everyone once.
* **Statistical report** keeps "Average recorded Lord's Day attendance" in person by default. An editor can choose **Average counts in person and online** on the Annual reports page (`reportSettings/statisticalOptions`). A separate "Average recorded Lord's Day online attendance" row is always shown.
* **Shepherding, absence, contact and the matrix** treat an online mark as attendance, as before.
* **Person profile** shows In person or Online for each attended service.

## Communion

Communion approval and participation are Session only (Pastor, Clerk, Elders) and are read through the audited private-records API. Admins without a Session role, deacons and volunteers are denied.

**Approval** is a dated Session decision in `communionDecisions`: approved for the Lord's Table or not approved, as a member of this congregation or as a visiting communicant, an effective date, a last day for a visiting approval, and a sealed note. Decisions are never rewritten; the server refuses a second write to the same ID, and a correction is a new, later decision. A person's standing on a date is the latest decision on or before it (same-day decisions in the order recorded); a visiting approval lapses after its last day. Approval is separate from membership status and from presence: no status change, import or attendance mark adds anyone.

The **Approved list** shows everyone on the roll and anyone the Session has decided about, as of any date. **Approve communicant members with no decision** is an explicit Session action, confirmed in a dialog that names each person. It records one decision per living communicant member who has none, with IDs derived from a batch ID so a retry adds nothing, and leaves anyone with an earlier decision, including not approved, alone. The server refuses the whole request if any person is not a living communicant member.

**Participation** (`communionRecords/{serviceId}`) is recorded by the Session after the service, separately from attendance. The checklist lists present people first and labels each as present, online or not approved. Before saving, the screen asks the Session to check anyone not approved on that date, not marked present, or marked online; the record is still the Session's to keep. Saves check the record revision.

**History** lists each recorded communion service with how many partook, how many were approved on that date, how many were present in person and how many entries need checking, plus every Session decision.

Flock health's **Communion** indicator now reads "Partook at N of M recorded communion services in the last 12 months", and stays unknown when none are recorded.

## Checks

Unit tests cover communion standing over time, lapsing visiting approvals, same-day corrections, participation flags, the 12-month indicator, once-per-person mode counts, the kiosk mode rule and both statistical averages. Unit tests also cover office validation, states on a date, overlap and death flags, term reviews, eligibility with missing history and the initial-entry rule, Feb 29 ages, rule changes over time, historical officer and member electorates, dated discipline and undecidable results. Rules tests deny direct access to the new Session collections for every role and keep office history read-only. Rules tests also accept in-person and online marks and refuse unknown modes and online kiosk marks. The `records` end-to-end spec covers role denials, overlap refusal, sealed decision and communion notes, immutable decisions, the bulk approval retry, the officer and quorum screens, online marking on the roll call and recording participation.
