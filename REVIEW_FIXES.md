# Review fixes

Base commit: `ea6a56db26a0fa795e2728c35997e871a48df967`.

These changes address the attached October 20, 2026 review. “Implemented” below means the correction is in source. Browser acceptance and live release acceptance are separate and are not implied by that label.

## Changes by finding

| Finding | Result |
|---|---|
| SEC-01 | Implemented. Household creation rejects initial email/text opt-ins before creating any records. |
| SEC-02 | Implemented. Due tasks require a current household/request assignment. Queued deacon summaries carry a metadata fingerprint; assignment, source or access changes suppress stale delivery. Legacy summaries without that fingerprint are also suppressed. |
| SEC-03 | Implemented. Private message and recipient reads use audited APIs and component memory. Direct private message reads are denied even to Session. Desktop cache version 8 clears previously persisted private message data before opening staff records. |
| DATA-01 | Implemented. Portal household changes increment the revision checked by the staff editor. |
| DATA-02 | Implemented. Imports claim an immutable reviewed payload, create only missing rows in transactions and wait for a ready barrier before processing. Duplicate starts cannot reset applied outcomes or counters. Different content cannot reuse an existing batch ID. |
| DATA-03 | Implemented. Reminder/workflow drafts retain their original revision until save or explicit reload. Remote changes produce a warning. |
| DATA-04 | Implemented. Photos compare a monotonic version as well as presence. Post-commit cleanup cannot remove the committed replacement. Old-object cleanup has a durable, server-only retry queue and hourly worker. Staff photo-path changes also advance the version. |
| BUG-01 | Implemented. Existing-role edits submit the selected account UID explicitly. Added a real UI regression case. |
| BUG-02 | Implemented. Calendar/reminder/feed windows select effective dates while preserving original occurrence identities for RSVPs and single-occurrence operations. Added cross-window and invalid-series-date cases. |
| BUG-03 | Implemented. Undo belongs to its service and snapshots individual worship modes, expires with navigation and does not overwrite marks already present. Added a mixed-mode/navigation UI regression. |
| BUG-04 | Implemented. Living visitors appear in the decision table before their first communion decision. Bulk member approval remains restricted to communicant members. |
| BUG-05 | Implemented. Household visits snapshot participants at completion. Legacy visits without recorded participants no longer infer contact from today's household composition. |
| BUG-06 | Implemented. Pause/cancel retains an in-flight lease for completion accounting. Resume/migrate/retry cannot replace a live lease. Completion preserves the stopped state and records dispatched work, including the state to resume after a paused step finishes. |
| BUG-07 | Implemented. The scheduler and Settings share an exhaustive automation-job contract covering all nine status fields. |
| BUG-08 | Implemented. Initial token acquisition failures end loading with a sign-out/sign-in recovery message, with generation checks against stale callbacks. |
| UX-01 | Implemented. Photo previews reload on version changes and expose a retryable load error. |
| UX-02 | Implemented. The affected weekday descriptions use a shared Lord's Day formatter. |
| UX-03 | Implemented. Workflow definitions have CSV/XLSX export including open-run counts. |
| FEAT-01 | Still unimplemented. The authoritative plan now explicitly identifies existing-person merging as pending design and implementation. Import matching is not represented as a merge. A safe merge must reconcile historical attendance, encrypted records and assignment-scoped access; no destructive consolidation was added in this repair. |
| FEAT-02 | Implemented. Staff-readable office history is available on person profiles through the existing ordinary read permission. Private officer decisions and quorum remain Session-only. |
| PERF-01 | Startup corrected. Roll call listens to a bounded six-week range around its selected date and retains global pending-write tracking across navigation. Full historical data loads only when People/report workspaces open. Shared records/action grids render 100-row pages and preserve original row-action indices. Further historical query optimization and device-scale measurement remain open. |
| PERF-02 | Implemented for staff screens. Feature screens load lazily. Initial entry gzip budgets now run after builds. The portal entry is unchanged apart from the functional corrections. |
| PERF-03 | Implemented. All queued/sending/failed messages and all open workflow runs are fetched independently of historical page limits. Older history has stable cursors and load-more controls. |
| BUILD-01 | Reduced and gated, not eliminated. Vitest/Tinypool critical findings were removed, compatible dependency repairs were applied and gRPC is overridden to a patched 1.x version. Audit findings fell from 33 to 23: 20 moderate, 3 high, 0 critical. The three high entries roll up one unpatched `braces` development-watcher advisory. Its documented exception expires November 20, 2026. CI rejects unreviewed high/critical advisories. |
| TEST-01 | Improved, still awaiting a complete browser result. CI runs all E2E cases across three independent emulator shards and retains traces/results even on failure. New regression tests cover the reviewed boundary failures. The local full run could not complete successfully under this environment's browser/socket and resource restrictions. |
| DOC-01 | Implemented. README, PLAN and DESIGN agree on implemented phases and link one implementation-status table. Live release acceptance stays pending. |
| MAINT-01 | Partly addressed through explicit identity/revision/Undo contracts, smaller initial imports and shared status formatting. Broad decomposition of the remaining large screen files is still a maintenance task. |

## Browser follow-up

The first browser run passed 103 tests across the first two completed shards, including all 51 tests in shard 2. Shard 1 exposed a service-query readiness race in two attendance cases. The UI offered Start roll call on an initial cache miss before the existing service arrived, then detached that button. The follow-up correction waits for the server to establish that a meeting is absent before offering creation, while allowing cached meetings to open offline. The same attendance and Undo regressions verify this transition.

## Validation

- Lint and TypeScript checks passed.
- Unit tests passed: 29 files, 231 tests. New tests exercise committed-photo cleanup failure, concurrent existing-photo replacement, pause/cancel completion accounting and moved occurrence windows.
- Firestore/Storage rule tests passed: 62 tests, including denial of private messages to Session clients and denial of every client role from photo-cleanup jobs.
- Targeted emulator integration tests passed: 7 tests. These exercise staff-versus-portal household conflicts, photo versions/privacy, directory/form behavior, concurrent multi-chunk import starts/retries, consent rejection and private-message authorization/pagination with old queued work.
- All application and Functions builds and entry-size budgets passed. Approximate initial gzip sizes are 480 KB desktop, 447 KB staff web and 245 KB member portal. This measures bundles, not device startup latency.
- The dependency audit gate passed with the explicit time-limited exception above; this is not a clean audit.
- Browser UI regressions are committed for GitHub CI. Local Chrome aborts before opening a page because the execution environment denies Unix sockets. No browser failure is presented as a confirmed product defect or a passing UI test.

Local emulator integration used Java 21, Node 24 and a loopback-TCP adaptation of the installed Firebase emulator runtime because its default Unix transport is unavailable here. That adaptation, downloaded runtimes, dummy emulator secrets and generated test/build output are not repository changes. CI uses unmodified dependencies with Node 22 and Java 21.

No installer, deployment, real delivery or live release acceptance was performed. Native Windows, real MFA/provider/calendar delivery, recovery and backup/restore checks remain required before release.
