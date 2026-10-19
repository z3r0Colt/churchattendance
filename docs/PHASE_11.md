# Phase 11 church records and data tools

Phase 11 adds officer records, quorum reports, communion records, online worship attendance, family relationships and reviewed imports. It is built in slices. This file records what each slice implements and its limits. Scope and acceptance criteria are in [Expanded feature requirements](FEATURE_EXPANSION.md).

| Slice | Scope | Status |
|---|---|---|
| 1 | Officer terms, ordination and installation history, rotation and term reviews, eligibility lists | Implemented |
| 2 | Quorum rules, meetings and historical quorum reports | Implemented |
| 3 | Communion approval, named communion participation, in-person and online worship | Planned |
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

## Checks

Unit tests cover office validation, states on a date, overlap and death flags, term reviews, eligibility with missing history and the initial-entry rule, Feb 29 ages, rule changes over time, historical officer and member electorates, dated discipline and undecidable results. Rules tests deny direct access to the new Session collections for every role and keep office history read-only. The `records` end-to-end spec covers role denials, overlap refusal, sealed decision notes and the officer and quorum screens.
