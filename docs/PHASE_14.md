# Phase 14 implementation and verification

Implementation is on `codex/pwa-service`. Automated workflow verification and live device/install acceptance are recorded separately.

The default build produces staff/member web plus Functions. `build:legacy` and `dist` retain optional Electron packaging. `dev` starts the staff web and portal emulator servers. Hosting serves one manifest (`id: /`, `start_url: /launch`) for both audiences, named by the server's allowlisted public branding. Icons use the selected church palette and the published PNG logo when present. Installation grants no roles. Reports retain the existing browser print-to-PDF fallback, CSV/XLSX, bulletin preview and explicit directions links.

The generated service worker caches only exact hashed application assets, never API, record/photo, calendar or export responses. HTML, manifests, icons and worker stay fresh; hashed assets have immutable caching. A failed navigation shows a connection-required page. Activation requires each open app tab to freeze without pending operations or dirty controls; a refusal or timeout cancels activation. Restart is explicit and edits require an explicit discard choice. Browser termination and mobile leave warnings cannot guarantee preservation.

Records use memory cache. Staff authentication remains tab/session scoped. Browser session restoration can retain sign-in; users must sign out on shared devices. Sign-out/revocation clears the visible workspace before reload and overrides app leave warnings, even while a write is pending.

A fresh public callable response establishes server reachability before callable actions. Structured server denials establish connection only, without bypassing role/assurance checks. Attendance remains a field-level Firestore update, counted pending until its SDK server acknowledgment. Loss of connection pauses new actions and keeps pending promises unresolved. Unknown outcomes require reconnection and explicit review before restart. There is no application offline queue. New visitor/household/person forms retain a request UUID across retries. Server-only hashed receipts commit in the same transaction as creation; changed payload reuse is rejected. Optional request IDs preserve retained legacy API compatibility; supported PWA forms always provide them. Requests/messages retain their existing idempotency contracts.

Kiosk and desktop-handoff callables reject PWA deployments before doing work. `SERVICE_DELIVERY` defaults to `pwa`; only an explicitly selected retained legacy deployment enables them. Historical kiosk attribution is unchanged. Online-only tests intentionally replace the superseded offline and kiosk product acceptance; Session/mercy/privacy tests remain required.

## Automated evidence

Verified application source commit: `592f350af0f58dd8d06d6657547462234176b14c`. Subsequent changes only record this evidence and correct the fictional PNG fixture checksum; application code is unchanged. The corrected fixture was separately checked for PNG chunk checksums, decompression and image readability. [CI run 39531708880](https://github.com/z3r0Colt/churchattendance/actions/runs/39531708880).

- Lint, type checking and dependency audit gate passed. Existing time-limited dependency exceptions remain; this is not a clean-audit claim.
- 245 unit tests, 14 operation/worker/operator tests and 66 security-rule tests passed.
- All 150 browser tests passed: shards of 59, 49 and 42, including the phone/booth light/dark sweeps and bulletin uploads under the live CSP.
- Staff startup JavaScript: 451,777 gzip bytes against a 480,000-byte budget. Portal: 249,864 against 260,000.
- Two fictional emulator churches passed repeated setup, interrupted administrator bootstrap, separate-key/identity checks and foreign-project token denial. The third-project recovery drill restored history, valid PNG bytes, disabled accounts/account links and key rings; it exercised production path-bound encryption and reviewed role denials, then retained recovery-bucket denial while restoring the test app's Storage policy.

The fictional drill measured roughly 1–2 seconds of recovery execution and a 1-second snapshot-to-drill interval. These are emulator measurements, not production RTO/RPO guarantees. Real desktop/phone installation, browser session restoration, cloud domains/App Check/MFA, provider setup, cloud backup access and full recovery remain staging gates. The [operator runbook](OPERATOR_RUNBOOK.md) records the supported CLI and supervised live procedures.
