# Phase 4 member portal and online forms

Phase 4 adds a responsive web portal in apps/portal and a Portal & online requests screen in the staff desktop. The portal shares the Firebase project and the existing event/RSVP model. It contains no giving or financial features. No live site, account, DNS record or public event was created by this change.

## Local demo

Run npm install, then npm run dev:portal. This builds the workspaces, starts the local Firebase emulators, seeds fictional records and serves http://127.0.0.1:5174. Sign in as member@example.test with LocalDemo123!. Its verified emulator account is linked to the fictional James Calder record. Directory sharing still starts off. Public events also start hidden.

When emulators are already running, npm run dev:portal:ui starts only the portal server. The staff renderer uses http://127.0.0.1:5173 and can run separately with npm run dev:ui. Do not start a second emulator suite on the same ports. The seed and portal demo scripts refuse to run without emulator endpoints.

## Member identity and access

Create a separate email/password account in the church-owned Firebase Authentication project using the trusted administration process. The account holder must verify their email. In the staff desktop, open Online access, Member access and Link member account. An Admin or Pastor supplies the Auth account UID and selects the correct person. Confirm the identity directly; matching an email address alone is not identity proof. Eligible people are active communicant, baptized, non-resident or adherent people. The portal does not offer public self-enrollment.

An enabled mapping grants no staff role. The portal checks the actual enabled Auth account, verified email, current access mapping and current person status on each request. Disabling the mapping stops later requests even when an old login token is still valid. A kiosk identity cannot become a member account. Each member can RSVP only as the one linked person. Household proxy RSVPs and guardian delegation are not implemented.

Members sign in for that browser session. Sign out on a shared device. The portal keeps directory results in memory and does not initialize a Firestore offline cache. It refreshes member data every minute and has a manual refresh. Revoking sharing prevents future directory responses from returning the details; it cannot retract information another member already read or copied.

## Sharing and events

My sharing choices starts with name, email, phone and address sharing all off. Choosing to list a name does not automatically share other fields. Directory responses contain only explicitly shared fields from eligible active people. They omit birthdays, membership status, attendance and all private care data. Sharing choices govern the online directory. They are separate from communication opt-ins and the staff-generated PDF directory. Portal photos and member profile editing are not included.

Staff Editors can open Online access, Online events, choose an existing event series and explicitly enable member visibility or the public request form. Review the title, location and online description before publishing a public form. No event is published by default. The portal lists upcoming occurrences in the next 90 days using the configured church time zone. Members see their own responses and can select Attending, Maybe or Not attending. Capacity checks serialize with other member and staff registrations.

## Visitor and event forms

Plan a visit and published event forms collect name, email, optional phone and an optional message. The form tells visitors to keep private pastoral matters out of it. A submission creates a pending request only. It does not create a login, add someone to the roll, subscribe anyone to messages or reserve an event place. The confirmation states that church staff must review the request.

Editors review Incoming requests in the desktop. Check for an existing person, then link that person or explicitly create a new Visitor. New visitors receive a household, names-only roster entry and initial membership history in the same transaction. Email and text consent remain off. Event approval checks that the event is still open and that capacity remains before creating the RSVP. Full events leave the request pending. Decline is available for closed or unwanted requests. Repeating approval is harmless.

The server validates schemas, ignores the hidden honeypot, deduplicates request IDs and limits new submissions to eight per hour from the same network. These controls reduce abuse; production monitoring and staff review are still needed. Rate buckets use an HMAC of the network address and store no raw address. Configure a TTL policy for portalBudgets.expiresAt so old buckets are removed.

## Production hosting and App Check

Register the portal web app in the church Firebase project. Set the public Firebase web config in .env and set VITE_USE_EMULATORS=false before building. Register a score-based reCAPTCHA Enterprise key for the actual portal hostname, add that app/key in Firebase App Check, and set VITE_PORTAL_APP_CHECK_SITE_KEY to the public site key. Portal callables enforce App Check in production. Staff desktop callables retain their own role checks; do not turn on global Firestore/Storage enforcement without first adding App Check support to the desktop.

Set the Functions parameter PORTAL_ORIGIN to the exact HTTPS origin, for example https://members.example.org, with no path or trailing slash. Its default is an unusable placeholder. Member/public callables reject browser requests from another origin. Origin checking complements App Check and authentication; an Origin header is not an identity credential.

Generate a random secret of at least 32 characters in a trusted terminal and store it in Secret Manager as PORTAL_RATE_LIMIT_KEY. Do not put it in a VITE_ variable or committed file. Firebase prompts for the parameter/secret setup during deployment, or use its explicit secret command.

```powershell
firebase functions:secrets:set PORTAL_RATE_LIMIT_KEY --project YOUR_PROJECT
npm run build
firebase target:apply hosting portal YOUR_HOSTING_SITE --project YOUR_PROJECT
firebase deploy --project YOUR_PROJECT --only firestore,storage,functions,hosting:portal
```

Create and verify the Hosting site/domain and add the domain to Firebase Auth's authorized domains before enabling member logins. The hosting target serves only apps/portal/dist. The desktop bundle and private server files are not published. Hosting config includes a content security policy, frame protection, no-referrer and no-store headers. Check those headers on the real hostname after deployment. Allow Firestore indexes, including the member RSVP collection-group index, to finish building.

No live deployment has been performed. The automated suite uses fake accounts and emulators, with production App Check/origin checks deliberately bypassed only inside the Functions emulator. Verify real App Check attestation, authorized origins, email verification, rate-limit behavior and domain configuration with the church project before opening forms publicly.

## Validation and boundaries

Run the repository lint, typecheck, unit, rules, build and browser/emulator commands. Tests cover linked-account verification/revocation, sharing projections, attempts to use another person's identity, event publication/capacity, public request deduplication/rate limits, approval idempotency, mobile member workflows and staff review. The full desktop attendance, communication and Phase 3 workflows remain in the same regression suite.

Earlier live Microsoft/Twilio setup, native Electron PDF/kiosk release checks, installer signing and remaining Phase 1 tasks are still separate. This portal is a mobile-friendly web app, not a native iOS or Android app. No push notifications, guardian delegation or self-service staff privileges are included.

Official setup references

* https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
* https://firebase.google.com/docs/app-check/cloud-functions
* https://firebase.google.com/docs/hosting/full-config
* https://firebase.google.com/docs/auth/web/manage-users
