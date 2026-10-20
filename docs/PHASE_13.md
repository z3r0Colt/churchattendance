# Phase 13: church configuration and branding

Status: implemented; automated acceptance passed on October 20, 2026. Built from `plan/pwa-managed-churches`, which includes the reviewed repairs. Phases 14–18 are not marked complete. No cloud resources, DNS, billing or real delivery have been changed.

## Public and protected configuration

`publicBranding/church` is server-owned. `getPublicBranding` is callable without authentication and returns only `churchId`, `projectId`, `churchName`, `appName`, `subtitle`, `palette`, `website`, `contactEmail`, `contactPhone` and `logo`. The projection validates stored data and rejects missing/mismatched identity. Document metadata and unexpected fields never reach callers. Firestore rules continue to deny raw reads and writes for everyone.

Only assured Admin/Pastor accounts use `getBrandingSettings` and `savePublicBranding`; writes compare the revision within a transaction. Set the server parameter `CHURCH_ID` through trusted deployment configuration. This identity and the runtime Firebase project are not editable branding fields. Operational settings and communication credentials retain their existing boundaries. No schedule is published by this phase.

The palettes Forest, Navy and Plum have reviewed text colors for both themes. Status and Session confidentiality colors retain their meanings. Logos are re-encoded PNGs, with shared type/size validation and server-side signature, dimensions and decoded-size checks. Remote images, SVG and HTML are rejected. Public website links require HTTPS without embedded credentials.

## Branding inventory

| Surface | Result |
|---|---|
| Staff sign-in, shell and opening label | Published app name, subtitle and optional inline logo; neutral setup error before configuration |
| Portal and staff security page | Same public payload and Fluent palette; public website/office contacts in the portal footer |
| Browser title and initial HTML | Published app name after load; generic initial HTML, no customer identity fallback |
| CSV/XLSX filenames and report workbooks | Published app/church name; filtered data and confidentiality labels preserved |
| PDF/print report headers and charts | Published church name, optional inline logo and chart accent |
| Message merge fields and SMS identification | Published church name; existing consent checks retained |
| Bulletin defaults and custom templates | Generic `{ChurchName}` default; stored templates/footers preserved for explicit review |
| Calendar display name and new UID namespaces | Published church name; project hostname namespace by default |
| WebAuthn account labels | Published church name; trusted relying-party/origin validation unchanged |
| Native installer, IPC archive filename, workspace IDs and historical test samples | Retained legacy internals; native release retirement belongs to Phase 14 |
| Demo project names and historical service timestamps | Retained emulator identity/history; never production fallbacks |

## Migration and deployment

1. Configure the public Firebase web values, matching `VITE_DEPLOYMENT_PROJECT_ID`, `VITE_CHURCH_ID` and the exact HTTPS `VITE_CHURCH_ORIGIN`. Configure matching server `CHURCH_ID`. These values contain no server credentials.
2. For an existing calendar deployment, set `CALENDAR_UID_DOMAIN` to its existing UID domain before releasing, so existing subscriptions retain their identifiers. New installations default to the Firebase project hostname.
3. Sign in as an assured administrator or Pastor. In Settings, review the legacy name and publish Public church branding. This explicitly creates the new document without changing membership, contacts, consent, keys, protected settings or templates.
4. Review existing custom message footers/bulletin templates before enabling delivery. Reload other tabs to pick up the new identity.

An absent public document reports a setup error. Staff sign-in remains available so an authorized administrator can publish branding; identity-dependent exports refuse to run. A mismatched deployed client fails before account data loads. A mismatched server identity requires operator repair. Invalid configuration never silently switches projects.

`config/examples/cedar-branding.json` and `harbor-branding.json` are fictional public fixtures for the same emulator deployment. They demonstrate two identities from the same source, not two-project isolation (Phase 15). The guarded seed publishes Cedar only when the public document is absent.

## Verification

Added shared schema/projection, unsafe-logo, contrast and production-binding tests; callable boundary/revision/missing-config tests; rule tests for raw branding/protected-setting denial; and browser fixtures for two identities on portal/staff phone layouts. Existing calendar expectations now use the fictional seed identity and project namespace.

The workspace proxy prevented local dependency installation, so verification ran on GitHub Actions for application commit `cfb83882cd66759bc620f78e644f05851230db35`: [successful verification run](https://github.com/z3r0Colt/churchattendance/actions/runs/39513208897).

- Lint, TypeScript, the dependency audit gate and all builds passed.
- 245 unit tests, 64 Firestore/Storage rule tests and 151 browser tests passed.
- Browser coverage includes both fictional identities, phone/booth layouts, keyboard use, accessibility, themes, role boundaries and existing church workflows. Workbook and standalone print-header tests verify both church identities.
- Startup JavaScript gzip sizes were about 482 KB desktop, 450 KB staff web and 248 KB portal, all within the existing limits. The budget gate includes required configuration bootstrap chunks.
- The initial validation found and corrected a plain-text lint error, an ExcelJS test-buffer type mismatch, emulator parameter materialization and the logo input's accessible label. No test was disabled.

These are automated development checks, not live deployment or Phase 18 pilot acceptance. Production requires the explicit configuration/migration steps above. The existing time-limited dependency exception in `REVIEW_FIXES.md` remains; passing its audit gate is not a clean dependency audit.

- [x] Both fictional configurations pass browser checks without source edits.
- [x] Anonymous projection and protected role/rule boundaries pass.
- [x] Invalid deployment and explicit legacy migration tests pass.
- [x] Both themes, phone layouts and generated report headers pass review.

Phase 14 is the next implementation milestone. PWA packaging, online-only workflows, provisioning, recovery, operator tooling and pilot acceptance remain separate phases.
