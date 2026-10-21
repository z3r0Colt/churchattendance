# Managed church PWA development plan

Approved direction on October 20, 2026. This is a development plan, not a claim that the service is implemented or ready for customers. `PLAN.md` remains the product scope and implemented data-model authority. This document defines the next work in Phases 13 through 18.

## Outcome

Colt manages the service. A church supplies its initial information, receives a configured church-branded app, and uses it through a browser or installed PWA. The church does not need to manage a server or Firebase console. One maintained codebase serves separate church deployments.

The service should cover its operating costs. Any surplus can support ministry scholarships. Pricing remains provisional until pilot usage and support costs are measured. This plan does not promise a price or lifetime scholarship availability.

## Approved decisions

| Area | Decision |
|---|---|
| Product | Foldkeeper, with church branding and a fixed Powered by Foldkeeper credit |
| Delivery | Online PWA for staff and members on Firebase Hosting |
| Backend | Keep Firebase Auth, Firestore, Storage, Functions and Secret Manager |
| Isolation | Separate Firebase project, accounts, records, secrets and keys for each church |
| Source | One repository and release version, with configuration rather than customer forks |
| Domains | Service-owned church subdomain by default, optional church-owned subdomain |
| Windows | Retain existing Electron source temporarily, remove it from the launch and ongoing customer release requirements |
| Kiosk | Not part of the service launch |
| Offline | No offline attendance or persistent church-record storage |
| Church practice | Keep the existing Presbyterian roles and membership model |
| Payments | Manual subscription and scholarship administration initially |
| Giving/accounting | Deferred and excluded from this implementation |
| Messaging | Keep existing provider interfaces, with church-specific configuration and separate usage costs |

An installed PWA still needs internet for church work. Cached application files may display a connection-required page, but do not provide an offline church workspace. Firebase does not replace Twilio or Microsoft 365.

## Existing foundation and limits

The staff web already shares the React screens, schemas, data hooks and server contracts used by Electron. Hosting serves the member portal at `/` and staff at `/staff/`. Browser sign-in supports MFA and passkeys. Private reads use audited callables. Staff records are currently held in memory, and sign-in is scoped to the browser tab.

The current source is still tailored to Sycamore, has no completed PWA packaging, and has no repeatable production church provisioning. Current browser attendance permits temporary offline marks and loses pending work on closure or reload. Backups, live authentication/recovery and provider acceptance remain release work. Passing emulator tests does not complete these gates.

Build from the reviewed repair branch, including its fixes. Do not silently start from an older main branch that lacks them. `REVIEW_FIXES.md` remains the record of unresolved review findings, dependency exceptions and evidence. Existing-person duplicate merging remains deferred.

## Phase order and status

| Phase | Deliverable | Depends on | Status |
|---|---|---|---|
| 13 | Church configuration and branding | Repaired application baseline | Implemented; automated acceptance passed, see [Phase 13](PHASE_13.md) |
| 14 | PWA packaging and online-only workflows | 13 | Implemented; automated workflow checks passed, device/install staging pending |
| 15 | Repeatable Firebase church provisioning | 13 and 14 | Operator tooling implemented; emulator/staging gates tracked in the runbook |
| 16 | Backups and verified recovery | 15 | Backup job and fictional recovery drill implemented; cloud recovery staging pending |
| 17 | Operator tools and controlled releases | 15 and 16 | Registry/release CLI implemented; live release/rollback staging pending |
| 18 | Pilot and paid-service acceptance | 13 through 17 | Planned |

Implement one phase at a time in focused commits. Mark a phase complete only after its acceptance checks have evidence. Do not create live projects, change DNS, send real messages or enable billing merely to implement local tooling. Live staging work is a separate explicitly authorized rollout step.

## Phase 13. Church configuration and branding

### Work

- Inventory customer-facing Sycamore references across staff screens, portal, titles, exports, emails, templates, filenames and default links. Internal workspace names can remain until renaming serves a practical purpose.
- Add shared validated branding/configuration contracts. Extend the settings UI and server validation together. Update `PLAN.md` with actual collection paths, field contracts and permission rules when implemented. Do not treat the proposed fields here as an already-deployed schema.
- Separate an allowlisted public branding payload from authenticated operational settings and server-only secrets. Public branding may include church/app names, an optional subtitle, logo references, approved colors, website/contact information and explicitly public schedules. Never expose administrator emails, households, private settings or provider status by making the existing settings document public.
- Keep project selection and approved domains in trusted deployment configuration. A church name, query parameter or browser-entered project ID must not redirect an authenticated app to arbitrary Firebase resources.
- Apply the same branding to staff, members and generated reports. Use a clear missing-configuration error rather than falling back to another church's identity or demo Firebase project in production.
- Validate logo size/type and color contrast. Keep the existing Fluent UI system and confidentiality labels. Logos must not introduce arbitrary script, HTML or remote resource loading.
- Store no private church content in build inputs. Public deployment configuration may be versioned separately from credentials, with fictional examples in the repository.

### Primary code areas

`packages/shared/src/domain.ts`, administration/settings contracts, `apps/desktop/renderer/communications/Settings.tsx`, the app shell and theme, portal screens, report builders, and Functions that generate messages.

### Acceptance

- [ ] Two fictional church configurations render distinct branding without source edits or separate source branches.
- [ ] Anonymous visitors receive only the reviewed public branding fields. Existing role boundaries still pass allow/deny tests.
- [ ] Invalid configuration fails clearly. Legacy church settings have an explicit migration/default path that does not overwrite records.
- [ ] Both themes, phone layouts and PDF/report headers display the correct church identity.

## Phase 14. PWA and online-only workflows

### Work

- Make the staff web and portal the default product build, development and CI paths. Preserve existing command names with documented migration where practical. Keep Electron outside the required release path before considering source removal. Avoid an unrelated wholesale renderer refactor.
- Add a manifest with stable application identity, church-specific name and icons, and a deliberate start URL. Use one installation identity per church origin initially, covering member and staff routes. Launch to an accessible entry page that respects the signed-in audience. Installation never grants permissions.
- Add narrowly scoped service-worker caching for versioned application files and approved public branding assets only. Bypass Auth, callables, Firestore, Storage downloads of church records/photos, calendar subscription responses and other authenticated/dynamic responses. Do not cache private PDF exports, tokens or API errors.
- Replace the blanket static-file cache policy where necessary with explicit rules for hashed assets, fresh HTML, manifest/configuration and service-worker updates. Preserve security headers and prevent one church's build/configuration from being reused at another origin.
- Keep church records memory-only and staff authentication tab/session-scoped by default. Do not add persistent sign-in or record storage merely because the PWA is installed. Verify browser session restoration behavior rather than promising closure always destroys sign-in.
- Disable new mutation actions when disconnection is known, for staff and portal workflows. Use server-confirmed readiness where a valid current connection matters. `navigator.onLine` alone is insufficient proof of Firebase availability.
- Track in-flight operations and server acknowledgments. Optimistic marks are pending until confirmed, never presented as Saved solely because the local SDK accepted them. A connection dropping during a write must produce an honest unresolved/error state. Preserve field-level attendance updates and existing concurrency safeguards.
- Explain that closure may lose unconfirmed work. Best-effort leave-page warnings are not guaranteed on mobile. Do not promise zero loss during shutdown, browser termination or security lock. Security lock and revocation must still clear private data even when operations are pending.
- Where retries could duplicate visitors, requests, messages or other side effects, use existing idempotency contracts or add reviewed ones. Reconcile uncertain results before retrying. Do not implement an offline work queue.
- Defer service-worker activation/reload until operations are resolved. Provide an update notice and a safe user-controlled restart. Never silently refresh over pending edits.
- Replace required native PDF behavior with a tested browser download/generation path or a clearly documented print-to-PDF fallback. Preserve CSV/XLSX exports, bulletin preview and explicit directions opening.
- Remove kiosk entry points and provisioning from the supported service. Review and disable obsolete kiosk and desktop-handoff server capabilities for PWA deployments rather than merely hiding buttons. Preserve historical attribution without inventing new kiosk records.

### Primary code areas

`package.json`, `.github/workflows/checks.yml`, scripts, Vite configs, `firebase.json`, `renderer/platform.ts`, `renderer/data/firebase.ts`, authentication and attendance hooks, save/print adapters, and portal entry points.

### Acceptance

- [ ] Staff and portal install/launch correctly on supported desktop and phone browsers, with a usable browser fallback where installation is unavailable.
- [ ] Permission-appropriate screens, exports, reports and reauthentication work without Electron.
- [ ] Disconnection before and during saving never produces false saved status. Reconnection and rejected writes resolve clearly without duplicate effects.
- [ ] Service-worker updates wait for pending work. Sign-out, revocation and account changes clear private memory and retain existing server checks.
- [ ] Storage/cache inspection finds no private records, photos, exports, auth responses or provider credentials in application caches.
- [ ] Replace obsolete offline/kiosk acceptance requirements with online-only regressions as an intentional scope change. Do not drop unrelated coverage or disable tests to hide failures.

## Phase 15. Firebase church provisioning

### Work

- Define a validated church deployment descriptor and a command-line setup tool with plan/dry-run, apply, verify and resumable status. Start by supporting explicitly identified projects. Add automated project creation/billing linkage only as a deliberate operator action with the required account authority.
- Use an explicit project allowlist, stable church/project association and environment designation. Reject demo/live mixups, default-project deployments and project reuse by another church. Check project-creation quotas and resource availability before promising onboarding capacity.
- Provision or verify Auth/Identity Platform requirements, database and storage region, Hosting target, rules, indexes, Functions and App Check. Region is an intentional setup choice, not a setting casually changed after records exist.
- Configure each church's primary domain, redirects/aliases, Firebase authorized domains, callable origins, passkey relying-party identity, email-link returns, calendar URLs and provider callbacks. Domain changes need a tested passkey/account migration plan. Use pending-DNS status instead of falsely declaring provisioning complete.
- Generate separate server secrets and private-record key rings per church. Use least-privilege deployment identities and managed credentials, not committed service-account keys. Keep secrets out of command output and setup reports.
- Bootstrap the church's chosen administrator through a trusted server process with explicit approved roles. A general Admin must not become Session by default. Verify email and complete real MFA/passkey assurance before church records become accessible. No public self-grant endpoint or shared default password.
- Begin empty, with delivery disabled. Create settings and explicitly selected service templates only. Never run the emulator seed against a live project or copy another church's records, consent or encryption keys.
- Document assisted church-owned Twilio account setup and payment, number ownership, verification/registration steps, signed callbacks, opt-outs and usage limits. Do not make SMS mandatory for onboarding.
- Keep Microsoft Graph configuration per church. A church without Microsoft 365 can use non-email features, but outgoing email and email-dependent automation must remain unavailable with a clear explanation. Select another email provider in a separate scoped phase if needed. Firebase Auth email is not a bulk-messaging substitute.

### Acceptance

- [ ] Two isolated fictional emulator project environments are provisioned from the same release and separate descriptors.
- [ ] Each church's users are denied the other project's records, callables and private files. Custom claims or matching role names alone do not bridge projects.
- [ ] Dry-run displays intended actions without mutations or secrets. Applying setup twice preserves users, settings, keys and records.
- [ ] Interrupted setup resumes safely. Failed domain/provider setup remains visible and cannot silently enable delivery.
- [ ] Staging acceptance later verifies actual domains, App Check, MFA, passkeys and bootstrap recovery. Emulator substitutes are not counted as live verification.

## Phase 16. Backups and recovery

### Work

- Provision daily Firestore backups with the existing 30-day retention goal. Define recovery for Storage files, Auth identities/links, settings, security rules, indexes and the server-side encryption key ring as well. A Firestore backup alone is not a complete service backup.
- Document what can be restored, exclusions, dependencies and operator access. Protect backup and key access separately from normal application access.
- Restore into an isolated recovery project first, with real delivery and automation disabled. Check document-path encryption binding and restored project/domain/authentication configuration. Never blindly resume old message queues or webhook side effects.
- Verify membership/attendance history, photos, authorized private-record decryption and account links. Record achieved recovery time and data-loss window instead of promising unmeasured service guarantees.
- Define church export/offboarding, access revocation and retention/deletion handling. Existing paged XLSX exports remain an inspection/export tool, not an atomic restore format.

### Acceptance

- [ ] A documented recovery drill restores a fictional church with usable files and keys, not merely a database snapshot.
- [ ] Restored permissions still deny non-Session administrators and unrelated deacons as required.
- [ ] Recovery sends no messages and exposes no records through public endpoints.
- [ ] Failures in backups and recovery checks are visible to the operator.

## Phase 17. Operator tools and controlled releases

### Work

- Begin with a private operational registry and CLI. Record church ID, Firebase project, environment, domain, deployed commit/version, setup checkpoints, provider readiness and last backup verification. Build a dashboard only after these operations work reliably.
- If a browser operator dashboard is built, place it behind separate operator authentication and MFA. Church administrators cannot reach it. Its APIs must enforce authorization, not rely on a hidden URL.
- Keep subscription/scholarship administration outside congregation collections. Initially it may be a separate operator record with status and review date. Do not add giving or donor-accounting features to church databases.
- Separate operator provisioning credentials from ordinary church identities. A provider can hold powerful infrastructure access, so do not claim application roles prevent the infrastructure owner from all possible data access. Define explicit, logged support access and avoid routine inspection of care records.
- Deploy the same versioned source with church-specific public configuration. Pin the project and release in each deployment job. Check staging, upgrade one pilot, then roll out deliberately to selected churches.
- Define compatibility and migration ordering. Rollback includes Functions/configuration and schema compatibility, not just Hosting files. Take required backups before irreversible migrations.
- Monitor uptime, failed saves/jobs, backup failures and usage with private content redacted. Set billing alerts and application resource limits. Measure actual all-in per-church costs, including scheduled jobs, secrets, storage and backups. Do not assume Firebase's free allowance makes every project free or that a budget alert stops spending.

### Acceptance

- [ ] Operator can inspect deployment readiness and installed versions without opening congregation records.
- [ ] A church administrator cannot operate another church or the service registry.
- [ ] Release to church A leaves church B unchanged. A tested rollback restores a compatible working version.
- [ ] Support logs contain no private narratives, tokens or secrets. Failed/partial operations remain visible and recoverable.

## Phase 18. Pilot and service launch

### Intake and onboarding

Collect church name, public contact information, logo/colors, time zone, service templates, authorized administrator and intended roles, desired domain, optional provider readiness, and import needs. Do not collect account passwords or provider secrets in a public form. Use secure assisted setup for credentials.

Start with one consenting pilot church. Import real records only after backup, permissions and security acceptance, using the existing preview/consent-aware import workflow. Confirm contact and message consent independently. Configure optional providers only when verified.

Provide brief staff guidance for installation, sign-in, attendance save status, internet loss, support and exports. Record observed support time and usage before fixing public prices or expanding scholarships. Scholarships use the normal permission and backup protections.

### Release gates

- [ ] All required lint, type, unit, rules, browser and bundle checks pass for the new product paths.
- [ ] Two-church isolation and wrong-project deployment checks pass.
- [ ] Actual staff MFA/passkey enrollment, sign-in, revocation and recovery pass on staging. Member email links and role-specific workflows pass on supported devices.
- [ ] Real email/SMS providers, when offered, pass authorized staging delivery and opt-out checks. Unconfigured integrations remain visibly disabled.
- [ ] PWA install/update, PDF/export and connection-loss behavior pass on desktop Chrome/Edge, Android Chrome and iPhone Safari/browser fallback as applicable.
- [ ] Restore drill, monitoring, support access, church export and offboarding are documented and exercised.
- [ ] Open review findings and dependency exceptions are resolved or explicitly assessed with current expiry/status. No obsolete Windows-signing gate blocks the PWA launch.
- [ ] Pilot church confirms the ordinary weekly workflows are usable. Customer launch is a separate operational decision, not implied by a code commit.

## First implementation slice

Phase 13 completed the branding inventory and validated public/protected configuration split; two fictional churches render from the same commit, with passing automated acceptance documented in `PHASE_13.md`. Next complete Phase 14 and Phase 15 until both run as independently configured PWAs in isolated test environments.

This first slice does not include subscriptions, a large operator dashboard, giving/accounting, denomination configuration, kiosk features or offline record persistence. Do not expand it into a wholesale rewrite of the working church screens.

## Changes to earlier requirements

Phases 1 through 12 and their setup documents remain evidence of the existing implementation. Their Windows packaging, native handoff, kiosk and offline acceptance requirements are superseded for this service. Security, privacy, consent, historical report correctness and non-native live release checks remain mandatory.

Update the earlier workflow documentation as each affected behavior actually changes. This planning commit does not delete working code, change security rules or introduce the proposed configuration model into production.

## Current implementation branch

Phases 14–17 implementation is on `codex/pwa-service`; automated checks passed in [run 39531708880](https://github.com/z3r0Colt/churchattendance/actions/runs/39531708880). No acceptance checkbox is complete merely because tooling exists. See [Phase 14 evidence](PHASE_14.md) and [operator runbook](OPERATOR_RUNBOOK.md). The runbook separates automated fictional checks from real infrastructure, recovery, provider and installation gates.
