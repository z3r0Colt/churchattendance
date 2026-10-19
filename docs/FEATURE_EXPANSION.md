# Approved feature expansion

Approved October 18, 2026, following the comparison with TendFlock. The user requested every feature area identified in that comparison. This document turns that request into implementation scope. It does not claim those features have been built.

The expansion started from Phase 6 on commit `85d52003325083ee907e5e38bada50ad95267262`. Phase 7 security/account implementation is now included; see [Phase 7 setup and limits](PHASE_7.md). Phase 8 shepherding is included; see [Phase 8 workflows and limits](PHASE_8.md). Phase 9 care workflows and diaconal ministry is included; see [Phase 9 workflows and limits](PHASE_9.md). Live MFA/device, delivery and rollout checks remain separate. Phases 10 and 11 are included, see [Phase 10](PHASE_10.md) and [Phase 11](PHASE_11.md). Phase 12 parts 1 and 2 are included, see [Phase 12](PHASE_12.md). Earlier provisioning, managed backups and Windows release checks remain open. `PLAN.md` remains the source of truth for scope and the implemented data model. Update that model and `AGENTS.md` when a phase introduces a new collection or permission boundary.

## Coverage of the requested areas

| ID | Requested area | Existing foundation | Required addition | Phase |
|---|---|---|---|---|
| F01 | Visit planning and congregation maps | Dated visits, follow-ups, elder districts | Household visit rounds, appointments, workload, maps and ordered routes | 8 |
| F02 | Contact gaps and flock health | Historical attendance and absence reports | Cross-source contact history, configurable thresholds/digests, explainable indicators and Session assessments | 8 |
| F03 | Automated pastoral workflows | Bulletin, serving reminders and fixed absence automation | Visual builder, visitor/onboarding sequences, approvals, recurring important dates and bereavement care | 9 |
| F04 | Deacon ministry | Session-created tasks assigned to individual deacons | Separate mercy notes, household assignments, joint visits, practical-help requests and daily digests | 9, 10 |
| F05 | Member self-service | Verified directory access, sharing choices and personal RSVPs | Contact/photo editing, passwordless email links and confidential care/prayer requests | 10 |
| F06 | Officer, quorum and communion administration | Membership history, sacraments and annual reports | Officer lifecycle/eligibility, quorum, communion approval/participation and online worship tracking | 11 |
| F07 | Calendar automation | Recurring events, RSVPs and serving reminders | Public calendar, revocable subscriptions and configurable event reminders | 10 |
| F08 | Imports and family relationships | Household entry, editing and exports | Reviewed CSV/XLSX import, duplicate handling, relationship links and family tree | 11 |
| F09 | Staff phone access | Mobile member portal and desktop staff app | Responsive staff attendance and all other permitted staff workflows | 12 |
| F10 | Security controls | Role rules, hardened Electron, provider encryption and change audit | Required staff MFA/passkeys, recovery, additional private-record encryption, account administration and access-log dashboard | 7 |

## Rules carried into every phase

Giving, tithing, pledges, donation amounts, benevolence fund accounting and other money tracking remain excluded. Mercy ministry covers practical care and private notes, not accounts. Competitor giving features described as coming soon are not part of this request.

The church keeps its own Firebase project. Multi-church sign-up, subscriptions and shared hosting are outside this extension. A separate church deployment uses separate project resources and secrets. There is no need to introduce a shared tenant database to match a hosted competitor.

Pastoral notes, discipline and pastoral follow-ups stay Session only. An administrator without a Session role must never gain access through maps, imports, workflows, search, mobile views, reports or logs. New deacon notes use a separate permission boundary. Assignment to a practical task does not itself grant access to other private records.

Shared Zod schemas validate writes on the client and server. Historical reports continue to flag unknown history. New side effects use the existing consent/suppression checks and recipient queue. STOP and email opt-outs remain absolute. No real messages, cloud changes or public data publication are implied by a local implementation phase.

## Phase 7. Security and account administration

Status is implemented in code, with live staging and release checks still required. See [Phase 7 implementation](PHASE_7.md) for supported flows and limits. This is the prerequisite for releasing the new private care surfaces.

### Account protection

- Require verified staff identities and MFA before staff data access. The names-only booth role is still a staff account. Provide enrollment, challenge, lost-device recovery, factor replacement and session revocation.
- Support passkeys with user verification. Validate WebAuthn challenges, origin and relying-party binding on the server. A passkey must satisfy an explicit assurance policy; a custom token or a client boolean is not proof of MFA.
- Use Firebase's supported authenticator MFA flow where applicable. Firebase documents TOTP as requiring Authentication with Identity Platform. Its native MFA flow does not support custom-auth tokens, so any passkey integration must enforce equivalent assurance separately rather than assuming token exchange supplies MFA.
- Treat desktop browser handoff as a separate integration. Use the trusted system browser with a one-time bound handoff and validated callback. Do not load remote authentication pages into a privileged Electron renderer.
- Add staff account/role setup, disable/re-enable and revocation. Preserve the ban on self-granting roles and require a Session administrator for Session role changes. Scope any configurable capabilities within fixed privacy ceilings.
- Require recent authentication for security changes. Log recovery and factor reset without storing recovery codes, secrets or credential material in the audit payload.

### Encryption and access history

- Add authenticated encryption for pastoral note bodies, discipline details and future mercy-note bodies before database storage. Keys stay server-side with versioned identifiers and managed rotation. Encryption does not replace authorization.
- Migrate legacy private records resumably, with backup and verification before removing plaintext. Inventory audit before/after values, exports, logs and client persistence so they do not retain unprotected copies by accident.
- Serve decrypted content only through audited, authorized APIs. Do not leave the existing direct-read path as an unlogged fallback. Private reads must not silently populate the persistent attendance cache.
- Record successful and denied sensitive access, authentication/security changes and record changes with actor, outcome, time and permitted identifiers. Minimize metadata where even the record type reveals private care.
- Provide a security dashboard for administrators with redacted security metadata. Session-only content and the existing raw before/after audit trail remain Session only. Deacon log views expose only their permitted scope.

### Acceptance

Unenrolled, revoked, disabled and insufficient-assurance staff accounts are denied by server checks and database/storage rules, even when calling endpoints directly. Tests cover non-Session administrators and forged client assurance flags. Recovery cannot bypass the role-grant rules. Private reads produce scoped audit entries and expose no private bodies in ordinary logs.

Encryption tests cover tampering, wrong keys, rotation and interrupted migration. A representative existing record can be migrated and read only by the proper role. Test actual passkey/MFA enrollment, sign-in and recovery on the church's staging project and native Windows app before claiming production support. Local emulator substitutes are not evidence of a working live MFA flow.

## Phase 8. Shepherding workspace

Status is implemented in code, with live delivery and optional geocoder checks still required. Depends on Phase 7 security contracts. See [Phase 8 implementation](PHASE_8.md) for supported workflows and limits.

### Visits and geography

- Plan visits by household and date/time with assigned elder(s), participants, status and a follow-up link. Support annual visit rounds, rescheduling and cancellation. Show each officer's upcoming, overdue and completed visits.
- Completion can link or create a Session visit entry. Scheduling a visit must not count as completed contact. Joint appointments share only necessary logistics with invited deacons.
- Display household locations with a list alternative, coordinate provenance and a missing/unverified-address queue. Obtain geocoding or navigation data only through explicitly configured services and explicit staff actions.
- Let an officer order stops and open directions for the selected route. Private note text never enters map URLs or a third-party request. Give the user a preview of locations leaving the app.

### Contact and health

- Combine dated visits, recorded calls/contact notes and qualifying communication outcomes into an inspectable contact timeline. Do not treat a queued message, failed delivery or mass bulletin as proof of personal contact. Show incomplete history as unknown.
- Configure contact-gap thresholds by district or church policy. Show the qualifying contact and rule behind each flag. Retain the historical attendance calculations from Phase 6.
- Make absence thresholds, notification channel and elder digest schedule configurable. Support consented Monday email/SMS digests and daily shepherding summaries without duplicate notices or private note bodies.
- Provide configurable attendance, involvement, communion, contact, visit and relationship indicators as their data becomes available. Missing inputs stay unknown. Session may record a dated manual assessment, including healthy/weak/stray/lost labels if adopted, with reasons and a review date.
- Indicators support pastoral review. They do not automatically declare a person's spiritual condition, start discipline or change membership.

### Acceptance

An elder can schedule a household visit, include a permitted participant, inspect workload and complete it once. Rescheduling/cancellation updates pending reminders. Missing coordinates do not place a household at an invented location. Unauthorized users cannot enumerate visits or care through map/report endpoints.

Contact flags distinguish unknown history from a known gap. Tests prove failed/queued/broadcast messages are excluded from personal contact. Digests use church-local dates, live officer eligibility, absolute opt-outs and deterministic dispatch identities. Health explanations and manual assessments remain Session only.

## Phase 9. Care workflows and diaconal ministry

Status is implemented in code, with live delivery checks still required. See [Phase 9 implementation](PHASE_9.md) for supported workflows and limits. Depends on Phase 7 and the Phase 8 visit/contact contracts. Member request intake is completed in Phase 10.

### Workflow builder

- Provide a visual builder and accessible step editor for triggers, waits, conditions, assigned tasks, officer approvals and consented email/SMS. Triggers include a newly recorded visitor, membership reception, an approved request and an important date.
- Include editable visitor follow-up, member onboarding and bereavement templates. Important dates cover ordinary anniversaries and confidential spouse birthday, wedding anniversary and death anniversary reminders. Retain links to deceased people without restoring them to active recipient lists.
- Define church-time-zone scheduling, leap-day behavior, recurrence end conditions and what happens after a date changes. Missed past dates must not produce a flood of retroactive messages.
- Version published workflows. Running instances keep their version unless deliberately migrated. Preview affected people/actions before activation. Support pause, cancellation, reviewable failures and safe retries.
- Use deterministic action IDs and transactions for tasks/dispatch. Queueing a message twice or retrying a scheduler must not repeat the side effect. Recheck live permission and consent immediately before acting.
- Default external reminders to plain messages or protected app links. Do not copy grief, discipline or private notes into an SMS, email subject or general task.

### Mercy ministry

- Assign households to deacons with explicit access scope. Provide encrypted mercy notes distinct from Session notes, practical-care request triage and follow-up tasks. No financial ledgers or donation records.
- Define a new deacon-private collection and callable contract. Only assigned authorized deacons can read its private content by default. Joint scheduling does not expose either ministry's notes; any deliberate sharing needs an authorized, audited action.
- Add a consented daily deacon digest of assigned requests and follow-ups with private narratives omitted. Transfer/revoke assignments without leaving the former deacon able to read new content.

### Acceptance

An approved fictional visitor triggers one follow-up sequence, an officer completes its task and later steps respect pause/cancellation. Approval steps cannot be self-approved when policy forbids it. Edits to a published template do not silently rewrite active runs. Tests cover concurrent schedulers, repeated triggers, opt-outs and permission revocation.

A deacon can handle an assigned practical request and private note. Another deacon and an unrelated non-Session administrator are denied. Session notes remain inaccessible to every deacon lacking a separate Session role. Joint visits share logistics without sharing note bodies. Anniversary tests cover the church time zone and leap-day policy.

## Phase 10. Member self-service and calendar

Status is implemented in code, with live checks still required. See [Phase 10 implementation](PHASE_10.md) for supported workflows and limits. Depends on Phase 7 authentication and privacy contracts. Request routing uses Phase 9.

### Member access and requests

- Add passwordless member email links with short-lived, one-time completion, trusted return origins and a clear expired-link flow. Existing verified account links and live eligibility remain required. A link cannot create staff access or claim a person solely by matching an email address.
- Let a linked member edit their own contact fields and upload, replace or remove a profile photo. Validate size/type and use authenticated storage access. Keep directory sharing and messaging consent separate from contact editing.
- Keep authentication email changes in a verified account-change flow. Reject stale edits to the same field. Household address changes need explicit authority or staff review; individual access does not grant authority to edit relatives.
- Let members submit prayer/pastoral requests to Session or practical-help requests to authorized deacons. Explain the audience before submission. Track own request state without returning officer notes. Protect routing, duplicate submissions and attachment access.

### Calendar and reminders

- Add a public calendar containing only explicitly published event occurrences. Never publish attendance, household rosters, private care appointments or member RSVP names through calendar feeds.
- Provide standards-compliant calendar subscriptions with stable occurrence identities, church-time-zone handling, recurring exception/cancellation behavior and token revocation for private feeds. Member and staff feeds enforce their permitted scope. Do not put long-lived authentication credentials in feed URLs.
- Configure per-event reminder timing, audience and email/SMS channels. Include opted-in groups and RSVP-based audiences where authorized. Revalidate cancellation, occurrence revision, current recipient selection and consent at dispatch.

### Acceptance

A member signs in by email link and changes only their own permitted data. A stale or reused link, revoked mapping, malicious return URL and another person's ID are rejected. Sharing remains private by default and editing a phone number does not opt in to SMS. Requests reach only the intended ministry.

Calendar tests cover recurrence across daylight-saving changes, cancelled/rescheduled occurrences and feed revocation. Public feed responses reveal no private fields. Repeated scheduler runs queue one reminder per occurrence/revision/action, and changed or cancelled events invalidate old pending reminders.

## Phase 11. Church records and data tools

Status is implemented in code. See [Phase 11 implementation](PHASE_11.md) for supported workflows and limits. Depends on Phase 7 and provides additional inputs to Phase 8 indicators and Phase 9 important-date workflows.

### Officers, quorum and communion

- Edit officer ordination, installation, terms, rotation, ending and emeritus history. Validate dates and flag conflicting/overlapping records. Remind permitted officers of upcoming term reviews.
- Produce an as-of quorum report with the meeting type, adopted policy, historical electorate, exclusions, required number and actual count. Show the calculation and flag missing eligibility history instead of guessing denominational rules.
- Provide officer-eligibility lists using recorded policy criteria and manual Session decisions. Do not infer a call to office or moral qualifications from an attendance percentage.
- Maintain explicit Session-approved communion eligibility and historical changes, including visiting communicants where appropriate. Approval is distinct from membership classification or presence at a service.
- Record named communion participation separately from worship attendance. Distinguish in-person and online worship by person without silently doubling the total. Preserve historical unclassified marks and define how each mode affects reports.

### Relationships and imports

- Add explicit spouse, parent/child and other family relationships with effective dates where appropriate. Households remain a separate grouping. Validate invalid self-links and cycles in ancestry. Provide an accessible family list as well as a tree.
- Store ordinary anniversaries and confidential bereavement dates under separate privacy scopes. Neither family links nor a directory view may disclose private care facts.
- Import CSV/XLSX through column mapping and a dry-run preview. Validate row limits, formats, contacts, household links, dates, membership history and duplicates. Spreadsheet formulas/macros must not execute.
- Require explicit row decisions before changing an existing person. Keep membership/history writes atomic. New contacts default to opted out unless valid consent evidence is explicitly reviewed. Imports cannot grant Auth roles, edit Session notes or mark people communion-approved.
- Record an auditable batch ID and per-row outcome, support safe retry/resume and provide error exports. Do not promise whole-file atomicity when processing bounded batches. Import is distinct from duplicate merging and database restore.

### Acceptance

Term, quorum and eligibility tests include historical dates, missing history, deceased/former people and policy changes. The report explains every inclusion. Communion approval changes require Session authority. Separate participation/online fields preserve existing roll-call concurrency and report totals.

Import previews write no people. Tests cover duplicate rows, malformed files, partial failures, retries and concurrent edits. A retry does not create a second person or membership event. Formula-like cells export safely. Relationship edits reject ancestry cycles and do not grant directory or care access.

## Phase 12. Staff mobile access and release

Status: part 1 (staff web build, sign-in, browser storage and phone attendance) and part 2 (every other workflow on narrow screens, in-page confirmation and accessibility checks) are implemented; part 3 (release gates) is planned. See [Phase 12 parts and limits](PHASE_12.md). Depends on Phases 7 through 11.

- Provide a separate staff web surface or explicitly separated staff route/build with responsive access to attendance, dashboard, people/households, groups, events, serving, communication, reports, care, workflows and account administration according to role.
- Reuse shared schemas, authorization contracts and report calculations. Give browser save/print/download alternatives to named Electron APIs. Do not expose Node, preload or desktop-only privileges to the web.
- Support phone attendance with clear synchronization state and no private staff data in a shared browser cache. Document what works offline and test recovery rather than promising desktop restart behavior on every browser.
- Require MFA/passkey assurance for staff web access and reauthentication for sensitive actions. Switching accounts must not reveal the previous user's data. Shared device sign-out/revocation behavior must be explicit.
- Verify keyboard and screen-reader use alongside touch. Test representative phone widths and the older Windows booth display in both themes. Do not make maps or a drag-and-drop workflow canvas the only way to complete a job.

### Acceptance and release gates

Role tests cover the mobile app as well as direct server/database access. Attendance entered on a phone appears on a desktop without losing an independent concurrent mark. Browser reports match desktop report calculations. Each permitted feature has a working narrow-screen path.

Run lint, type checking, relevant unit/rules tests, build and end-to-end workflows for implemented changes. Use fictional records and fake communication providers locally. Maintain a feature/acceptance checklist in each phase's implementation notes and mark a phase complete only when its shipped scope passes.

Before production use, verify real MFA/passkeys and recovery, key rotation/restore, managed backups, authorized domains/App Check, provider delivery/opt-outs and private/public calendar responses. Finish signed Windows packaging, native PDF/export checks, disconnected restart recovery and update publishing. Record live setup separately from implementation completion.

## Reference material

These pages informed the scope, not a claim of independently verified competitor behavior. Implement original workflows within our existing architecture.

- [TendFlock features](https://tendflock.app/features)
- [TendFlock security](https://tendflock.app/features/security)
- [Firebase TOTP MFA](https://firebase.google.com/docs/auth/web/totp-mfa)
- [Firebase email-link authentication](https://firebase.google.com/docs/auth/web/email-link-auth)

Provider capabilities and deployment requirements must be rechecked against official documentation during implementation. The plan does not treat native Firebase MFA and custom-token passkey sign-in as interchangeable.
