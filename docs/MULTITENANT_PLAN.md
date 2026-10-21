# Foldkeeper multi-tenant architecture and implementation plan

Approved product direction: October 21, 2026. This is a design and migration plan, not an implemented security boundary or a live deployment. It supersedes the separate-project-per-church target in the October 20 PWA service plan. Existing code still assumes one church per project and must not host multiple real churches until the acceptance gates below pass.

## Product decision

Run Foldkeeper as one maintained service with many church tenants in a shared production Firebase/Google Cloud backend. Use a separate staging project and fictional tenants. Additional Firebase client app registrations do not isolate churches. Do not create one Hosting site, Firebase client app, database or project per church as the default onboarding mechanism.

Each church keeps its name, logo, palette, public contact information, membership/governance model, private records, provider configuration and encryption keys. The fixed Powered by Foldkeeper credit remains. Congregation giving/accounting remains excluded. Operator subscription/scholarship records stay separate from congregation data.

The objective is to do the tenancy refactor before onboarding real churches, so adding a church becomes a configuration and provisioning operation. This is not a promise of unlimited scale, zero future migrations or zero operational changes. Shared-project quotas, infrastructure access and failure domains still apply.

## Target architecture

| Layer | Initial design | Expansion boundary |
| --- | --- | --- |
| Environments | Separate shared production and staging projects; emulator fixtures locally | Explicit recovery targets and additional backend partitions when justified |
| Church identity | Immutable internal tenant ID; separately editable public slug and branding | Tenant registry maps identity to a backend partition and authentication tenant |
| Sign-in | Identity Platform authentication tenant per church, subject to compatibility acceptance | Resolve authentication project and tenant through the registry rather than church-specific client code |
| Church data | Firestore collections under `churches/{tenantId}/...` | Central server/client data adapters select the approved backend and tenant root |
| Files | Storage objects under `churches/{tenantId}/...` | Tenant-scoped object references resolved through the same routing contract |
| Private encryption | Separate church key rings; tenant and canonical record path bound into authenticated encryption | Versioned key references and a tested tenant-move procedure |
| Application | Shared staff/member build and centrally managed releases | Backend compatibility, tenant feature flags and controlled rollout by partition |
| Work | Tenant-scoped queued jobs, bounded dispatch and fair scheduling | Scale workers/queues or move a busy tenant without changing feature screens |
| Operations | Server-only tenant registry, operator identity and explicit tenant-scoped commands | Audited pause, export, recovery, offboarding and partition migration |

A backend partition is a group of infrastructure resources that can serve many churches. Initially there is one production partition. A stable tenant identity must not contain a Firebase project ID. Project IDs, bucket names, provider secret references and authentication tenant IDs belong in server-controlled routing/configuration, not scattered through feature code or editable church settings.

## Required boundaries

### 1. Resolve the church before authentication

Start with a canonical Foldkeeper application origin and a church route such as `/c/{churchSlug}`; the final service domain has not been chosen. This avoids requiring a Hosting site or custom domain for every new church. Public lookup returns an allowlisted public identity and approved client authentication configuration only. Unknown, suspended or mismatched routes fail closed. A slug, hostname or request parameter can select a public sign-in destination; it cannot grant record access.

Church subdomains and church-owned aliases remain a supported design goal, with a domain-to-tenant resolver contract from the start. Verify DNS/TLS, hosting domain quotas, Auth authorized-domain limits, App Check and passkey behavior before promising these domains at scale. Firebase Hosting client app registration is not a wildcard-domain solution. Do not add a Hosting site per church to bypass this design decision.

A central application origin means one platform PWA installation initially, opening the last explicitly selected church or the church selector. Church names and logos appear after selection; do not promise separate church-branded home-screen installations on the same origin. Per-church installation identities/custom origins require separate device and security acceptance before offering them.

### 2. Bind authentication and authorization to a tenant

Use Identity Platform tenants to separate church account namespaces, subject to MT1 validation. An email address may exist in multiple churches; those accounts, roles, consent and security enrollment are independent. Identify users by `(tenantId, uid)`, never UID or email alone. Do not automatically grant access because the same email exists elsewhere.

Verify the signed Firebase/Identity Platform authentication tenant and expected project against the server registry. Match it to the selected church and use tenant-aware Admin Auth operations. Root-project tokens, foreign-tenant tokens and mismatched audience/project tokens must be denied. Client-supplied tenant IDs, role claims alone, origins and App Check alone do not establish church authorization.

All staff-access, passkey sessions/challenges/credentials, account links, security logs, role changes and revocation checks are tenant-scoped. Live roles, verified email and real MFA/passkey assurance remain mandatory. Passkey challenge and session binding includes tenant ID, UID, RP ID and origin. Define discoverable passkey account selection on the central RP without disclosing other churches or accounts. Root project administration is reserved for trusted infrastructure operations.

Before committing implementation, verify tenant support for the current TOTP/MFA flows, blocking functions, custom-token/passkey exchange, email links, account recovery, Auth imports and required providers in staging. Record pricing, tenant quotas and quota-increase procedures. If an essential capability fails, revise the architecture explicitly before MT2; never weaken assurance to preserve the schedule. Multi-church single sign-on and account linking are deferred, not silently inferred from shared email.

### 3. Scope all records and references

Proposed Firestore layout: `churches/{tenantId}/{collection}/{documentId}`, retaining existing feature collection names and nested history structures inside that root. Proposed Storage layout: `churches/{tenantId}/{feature}/{...}`. These are target paths; PLAN.md section 4.3 continues to document the actual schema until migration code lands.

Centralize validated `TenantContext`, tenant-aware database/file references, Auth selection and callable transport in shared adapters. On the server, create context only after trusted registry/authentication validation; public resolution and background work use separate narrowly scoped context factories. Async requests, triggers and jobs carry context explicitly. Never use a process-global current church, unscoped mutable cache or a generic fallback tenant.

Migrate every collection, subcollection, document reference, cursor, receipt, rate-limit key, export, calendar token, upload path and cleanup job. Cross-record references must resolve within the same tenant. Every idempotency/lease/deduplication key includes tenant identity, including webhooks and scheduled side effects. Platform registry/operational collections are separately protected and contain no private ministry content.

Firestore and Storage rules compare the signed authentication tenant to the target church and load live access state from that same church. Existing Session/mercy restrictions remain nested inside this boundary. Unscoped legacy paths deny access after migration; there is no permissive wildcard or root-project fallback. Admin SDK code bypasses rules, so Functions and background workers need their own explicit tenant checks and adversarial tests.

Field-level attendance writes, atomic membership history, opt-outs, revision checks, memory-only records and online-only save/update protections remain intact. The tenancy refactor must not replace these safeguards.

### 4. Preserve private ministry isolation

An Admin without Session access still cannot read Session-only content. Session officers still do not inherit deacon-private mercy access. Church A's Pastor cannot read Church B's ordinary or private data. Platform operator status must not automatically grant ordinary app access to private ministry records.

Maintain separate versioned encryption key rings and provider secret references for each church, with tenant-aware secret lookup and bounded caches keyed by tenant and key version. Bind encrypted content to tenant identity and canonical record path; a copied ciphertext or reference must fail at another church. Never put provider credentials or key material in public configuration, client tokens or the tenant registry's public projection.

Shared backend service identities may technically access multiple churches. Application isolation and per-church keys do not reproduce project-level infrastructure isolation. Limit IAM by service, protect recovery access separately, audit operator actions, and keep raw private content out of shared logs. Evaluate separate partitions for contractual, residency or higher-isolation needs.

### 5. Make jobs and providers tenant-aware

Carry validated tenant context through triggers, tasks, schedules, retries, imports, exports, message dispatch, STOP webhooks, calendar feeds, backups and photo cleanup. For inbound provider webhooks, authenticate the provider signature and resolve the church from trusted provider-account mappings before reading records; a body/query tenant ID is insufficient.

Replace unbounded whole-platform scans with indexed due-work queues and paginated dispatch. Bound concurrency per tenant and globally, prevent one busy church from starving others, preserve existing transaction/lease guarantees, and provide operator pause controls. Recheck live access, tenant status and consent immediately before side effects. Provisioning and recovery start with real delivery disabled.

### 6. Clear browser state when the church changes

Keep selected church visible throughout sign-in and staff/member work. Switching church must resolve pending/uncertain work, unsubscribe listeners, clear private in-memory state, sign out the previous tenant context and require the correct church account/assurance. Reject late responses from the previous tenant with a context generation check. A revocation/security clear still takes precedence over leave-page warnings.

Include tenant identity in every cache key and authenticated request context; continue to forbid persistent private records and dynamic/private service-worker caching. Cached public shell/branding must never select the authenticated tenant or show one church's identity as another. Scope service-worker update coordination across the shared application without changing authorization. Review safe callable/Firestore transport compatibility with the chosen central-origin and optional alias strategy.

### 7. Recover and offboard a single church

Use project-wide managed backups as one disaster-recovery layer, not as a claimed one-church restore feature. Also design tenant-specific, integrity-checked manifests covering records, files, authentication identities, account links, settings, historical keys and provider mappings. Auth tenant identity and UID are part of recovery identity.

Prove that one church can be exported and restored into an isolated target while another church's records remain unchanged. A project backup may need restoration into a separate isolated project/database followed by a selected-tenant extraction; never restore the shared live database over other churches to recover one customer. Keep restored accounts disabled and side effects off until explicit validation/cutover. Verify tenant Auth/MFA/passkey import constraints and document any recovery enrollment required.

Retain encryption material for the full backup retention period. Provide separately reviewed suspend, retention/export and permanent deletion procedures, including Auth tenant users, queued jobs, tokens, photos and provider mappings. Shared backups and provider records have their own retention policies; do not promise immediate erasure from all backups. A production recovery target may need additional project quota even though normal onboarding does not create projects.

### 8. Plan releases, capacity and costs

Use one shared application artifact without church-specific source edits or builds. Public tenant resolution supplies approved configuration. Tenant feature flags support controlled exposure, but shared backend code deployment affects its entire partition; flags alone are not separate backend releases. Use additive schemas, explicit versioned contracts and rollback-compatible migrations. Never hot-swap a tenant's backend project while requests are in flight.

Record per-tenant operational usage counters, queue latency, denial/error rates and resource estimates without logging private content. Bound indexed queries/listeners and export size; test realistic attendance concurrency and background loads. Configure project-level budgets and alerts, worker limits and per-tenant usage policies. Budget alerts are not spending caps, and shared-project billing does not automatically provide exact per-church invoices.

Define capacity targets during MT1: pilot church count, concurrent attendance devices, approximate records/files per church, messaging load and acceptable latency. Measure real limits and costs before making sales promises. Backend partition routing must support a supervised tenant move: pause/fence writes and jobs, capture/verify data and keys, migrate/re-enroll Auth as necessary, atomically switch routing generation, invalidate old contexts, verify access, then resume. Rehearse this before broad rollout; an adapter interface alone is not evidence that relocation works.

## Implementation sequence and acceptance

Insert these milestones before Phase 18 pilot acceptance. Existing Phases 13–17 are useful single-church baselines; their provisioning, recovery, security and release evidence does not establish multi-tenant readiness.

| Milestone | Work | Required evidence |
| --- | --- | --- |
| MT1 — Architecture and compatibility | Inventory global assumptions; document tenant/context/path/auth contracts; validate Identity Platform capabilities, domain/PWA choice, quotas and costs | Decision record, account/security staging spike, workload targets and a complete migration inventory |
| MT2 — Tenant foundation | Server-only registry, public resolver, context factories, shared data/Auth adapters and operator tenant lifecycle skeleton | Two fictional tenants, foreign/missing tenant denial and safe church switching; no real onboarding |
| MT3 — Feature and security migration | Move all staff/member data, rules, private APIs, files, roles, sessions, passkeys, references, receipts and provider/job paths | Existing functional/privacy suites plus cross-tenant allow/deny matrix, wrong-tenant ciphertext denial and static checks for remaining unscoped data access |
| MT4 — Operations and recovery | Tenant onboarding, fair queues, provider mapping, separate keys, per-tenant recovery/export/offboarding, partition move procedure | Repeatable interrupted setup, isolated church restore and partition move; other tenant unchanged; no unsolicited messages |
| MT5 — Load and controlled rollout | Shared release compatibility, usage attribution, capacity/abuse limits, monitoring and staging rollback | Measured load/cost evidence, tenant suspension and revocation tests, rollback/migration rehearsal and no known release-blocking failures |
| MT6 — Pilot readiness | Real device/browser acceptance, operator/support onboarding and reviewed live configuration | Explicit pilot acceptance; then resume Phase 18 business/paid-service gates |

Do not enable multi-church production on a partially migrated backend. Implement in focused reviewable changes; keep tests meaningful, never disable them to pass. Update actual schema/permission documentation alongside each implementation change. Provision no live infrastructure, billing or provider delivery merely to write this plan.

## Mandatory cross-tenant acceptance matrix

For two fictional churches, include colliding document IDs, UIDs where supported, receipt IDs, dates and the same email with different church accounts. Verify authorized access within each church and denial across churches for:

- Anonymous public branding/event resolution, private records, direct database queries and Storage objects.
- Every callable family, nested membership history, attendance marks, reports, imports, exports, account-linking and role/security administration.
- Session-only and mercy access for each role, revocation, expired assurance, passkey sessions/challenges and copied ciphertext.
- Calendar tokens, photo URLs, upload completion/cleanup, portal requests and stale requests during church switches.
- Provider callbacks/signatures, opt-outs, queued messages, recurring jobs, task retries and idempotent creation receipts.
- Suspended/deleted tenants, missing/mismatched context, forged route/tenant identifiers and root/foreign project authentication.
- Backup/export/restore/offboarding and tenant moves, with independent verification that the other church was untouched.

Use real Identity Platform staging tests for features the emulator cannot faithfully establish. Passing a mocked tenant claim test does not prove real MFA, tenant token verification, Auth import, DNS/TLS or production recovery.

## Current baseline and open gates

No live church onboarding or production deployment has been performed in this workspace. Verify this assumption before any migration execution; if records exist, prepare an inventory, verified backup, isolated rehearsal, explicit cutover and rollback plan rather than treating the database as empty. Do not silently copy root collections into a shared database or dual-read across tenant roots.

Current code is still single-church. Known global assumptions include `CHURCH_ID`, build-bound church/project/origin configuration, root-level Firestore/Storage paths, UID-only security state, the singleton encryption secret, immutable one-church-per-project operator reservations and project-wide backup/release tooling. All must be inventoried and replaced through MT1–MT4.

The Foldkeeper naming commit `070015d4ca3c32a0179d21b37ac9f81523ac1aac` passed lint, type checking, 245 unit tests, 14 operations tests, 66 rules tests and both browser shards containing public-branding checks. Its full run 39634365364 did not pass: the third browser shard failed the Settings digest-channel save assertion (expected sms, received email). That unresolved failure remains a release gate; do not describe the current complete browser suite as green or treat a tenant migration as a substitute for diagnosing it.
