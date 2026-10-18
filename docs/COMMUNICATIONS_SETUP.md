# Phase 2 communication setup

The code supports Microsoft 365 email, Twilio texting, queued and scheduled messages, the Saturday bulletin and elder attendance alerts. No Microsoft tenant, mailbox, Twilio number or live Firebase deployment has been provisioned by this change. The local app uses simulated providers.

## Local demonstration

Run `npm install` and `npm run dev`. Sign in as `pastor@example.test` with `LocalDemo123!`. Open Messages to compose a message, preview the recipient list and queue it. Use Process local queue to run the local worker. The two fictional people with seeded consent receive simulated deliveries. Other fictional people remain opted out.

Firebase emulators do not run Cloud Scheduler jobs automatically. The local queue button runs the same worker and automation code. This button is restricted to an Admin and refuses to run outside emulators. Provider factories always select fakes inside emulators, even if real credentials happen to exist on the machine. Tests never contact Microsoft or Twilio.

The fake Microsoft folder can be populated by emulator tests through `emulatorDriveFiles`. These records and simulated delivery payloads have no client read or write access.

## Microsoft 365

Use a church-owned tenant. Add and verify the church domain, then configure SPF, DKIM and DMARC with the domain's DNS administrator. Create the shared mailbox `office@sycamorerpc.org` and give the Pastor and Clerk the access needed to read replies in Outlook.

Register a confidential Microsoft Entra application for client-credentials OAuth. The email adapter uses Graph `Mail.Send`. PDFs at or above 3 MB use a draft and a large-attachment upload session. Several smaller PDFs can also require a draft to stay below the combined request limit. Draft attachments require `Mail.ReadWrite`. Restrict these application permissions to the one church mailbox using Exchange application RBAC or an appropriately scoped application access policy. Do not leave an unrestricted Entra application grant alongside a scoped RBAC assignment, because the effective grants can be additive.

For bulletin pickup, put the Bulletin folder in the church's OneDrive or SharePoint library. Use selected-resource permissions, such as `Files.SelectedOperations.Selected`, and explicitly grant this application read access to that folder. Consent to the selected permission alone does not grant access to any folder. Record the drive ID and folder item ID in the app's Communication settings.

The mailbox and folder must be tested with the actual tenant before enabling automatic delivery. Microsoft documents limitations around large attachments and shared or delegated mailboxes. The adapter implements the documented upload-session API, but tenant permissions and that upstream behavior still need a live test. If the large-attachment test fails, keep the bulletin PDF below 3 MB until the mailbox configuration is resolved.

Every recipient gets a separate message. Replies go to the shared mailbox. The app records a Graph request as Accepted after Microsoft accepts it. This is not a delivery receipt. Inspect the shared mailbox and Exchange message trace when investigating a delivery problem.

Official references

* [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail)
* [Large Outlook attachments](https://learn.microsoft.com/en-us/graph/outlook-large-attachments)
* [Exchange application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)
* [Selected OneDrive and SharePoint permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)

## Twilio

Use a church-owned Twilio account and SMS-capable number. Complete the appropriate US messaging registration before sending live traffic. Set the number's incoming-message webhook to the deployed `twilioInbound` function, using HTTP POST. Every outbound message sets its own `twilioStatus` callback with its message, recipient and attempt identifiers.

Both webhook endpoints validate `X-Twilio-Signature` against the configured public function URL, all form fields and the account Auth Token before accessing church records. The Account SID and inbound recipient number are checked as well. Preserve the full URL and query string if a reverse proxy is introduced.

STOP and its supported variants block the whole normalized phone number and clear consent on matching person records. A new, signed START command records renewed permission. Message SID deduplication prevents replayed commands from reversing a later decision. HELP uses provider opt-out handling when present, or a short response for a known, opted-in number. All replies appear in the text inbox, including unknown senders. Never treat receipt of an ordinary reply as consent.

Delivery callbacks can advance a status but cannot downgrade a delivered message or modify a different send attempt. The app never automatically retries an uncertain delivery.

Official reference

* [Twilio webhook validation](https://www.twilio.com/docs/usage/security)

## Store server credentials

Copy `communication-config.example.json` to `communication-config.json` and replace every placeholder. That private filename is ignored by git. Remove the optional `graph` or `twilio` object if that channel will not be used. The public function URL must be the exact deployed base URL without a trailing slash. Use a random unsubscribe secret of at least 32 characters and keep it stable so existing unsubscribe links continue to work.

From a trusted terminal authenticated to the church project, store the configuration in Secret Manager.

```powershell
firebase functions:secrets:set COMMUNICATIONS_CONFIG --project YOUR_PROJECT --data-file communication-config.json
```

Do not put this JSON, Graph credentials or Twilio credentials in a `VITE_` variable, the Firebase web config, a Firestore document or a committed file. The desktop settings screen receives only nonsecret configuration and provider-presence flags. Presence does not mean a connection has been tested.

## Deploy and enable

Build and run the repository checks first. Select the church project explicitly when deploying rules, indexes, Storage rules and Functions. Allow the compound indexes to finish building before enabling delivery. The Firebase project needs billing, Secret Manager and Cloud Scheduler access. The deployment principal needs the permissions required by Firebase for those services.

```powershell
npm run build
firebase deploy --project YOUR_PROJECT --only firestore,storage,functions
```

Cloud Scheduler invokes `scheduledCommunications` every minute. The function evaluates bulletin times in `settings/church.timeZone`, regardless of the server's or PC's local zone. No desktop PC needs to remain open. Inspect the deployed scheduler and its service-account permissions after deployment.

The Pastor's Auth account must have the `pastor` claim and a `users/{uid}.personId` link to the correct person record. Set the person's email address and record consent in Messages, Contacts & consent. The same rule applies to the bulletin maker and elders. Tests and bulletin previews do not bypass consent.

An Admin or Pastor can then open Settings and configure the delivery flags and bulletin recipients. Live channel flags default off. Start with a test to the linked account, then a small, consented list. Enable the Saturday job after that succeeds. A send to more than 20 deliveries requires a current recipient-count confirmation.

## Consent and sending behavior

The contact form records an evidence note. It rejects a stale form if another person has changed the same contact record. It writes only changed fields. Ordinary person editing cannot change communication addresses or consent flags. Suppression records are server-only.

Email includes a signed unsubscribe link. A GET displays a confirmation form so an email link scanner cannot unsubscribe the person. A POST blocks the normalized email address and clears consent on matching records. Changing the flag back requires an explicit, recorded consent action. Treat unsubscribe links as private capabilities and do not copy them into unrelated messages.

Recipients are selected and deduplicated when a message is queued. Consent, suppression, active membership and the current contact address are checked again immediately before the provider is called. A person whose contact changed is skipped rather than silently receiving the message at a new address. Session-only alerts also recheck the recipient's actual Auth roles.

The worker reserves a per-minute budget across concurrent workers. Email is limited to 20 attempts per minute and 9,000 per UTC day. Text is limited to 60 attempts per minute. A message can contain up to 400 email and text delivery records. A larger audience must be divided into smaller lists.

Every recipient is claimed transactionally before sending. If an attempt is interrupted or its result is ambiguous, it becomes Unknown after ten minutes and is not automatically retried. Review Microsoft or Twilio logs before deciding what to do. Retry confirmed failures acts only on definite failed or undelivered records, and creates a fresh attempt identifier. Accepted is not the same as Delivered.

## Bulletin behavior

Choose the Lord's Day date for each bulletin. Uploads must be PDFs no larger than 20 MiB, and their Storage paths cannot be overwritten by clients. The server checks the PDF header and pins the file generation used for delivery. Once queued, that week's attachment cannot be replaced.

The worker polls the configured Microsoft folder for the newest PDF modified during the current church week. A newer app upload takes precedence over an older folder copy. Each new PDF version gets one Pastor preview. The default reminder is Saturday at 4 PM, delivery begins at 6 PM and late pickup stops at 11 PM. Those times can be changed in Settings. The default reminder goes to the configured bulletin maker. The weekly message ID prevents a later scheduler run from queuing the same week's bulletin a second time. Send now is available after the automatic cutoff. Skip this week stops the automatic weekly send.

Pending automatic bulletin deliveries expire at the cutoff, including a late batch that has not finished. Send now can explicitly resume the expired email recipients without sending another copy to people already processed. The worker still checks consent on that resumed delivery.

Small combined payloads use Graph sendMail. Larger combined payloads use a draft with separate small-attachment requests. Individual PDFs at or above 3 MB use an upload session. General messages can include up to three PDF attachments, with a combined 20 MiB limit. Files must be uploaded by the sending account.

Bulletin texting is optional. It requires both text consent and an explicit setting allowing shareable bulletin links. A link permits anyone who has it to read that one PDF. It exposes no directory data. Turning off shareable links makes the download endpoint refuse existing links as well. No bulletin PDF is publicly readable through Storage rules.

## Elder absence alerts

Choose the reference service type and enable alerts in Settings. The job runs on Monday after 9 AM in church time. It requires a recorded service on each of the previous three consecutive Lord's Days. It does not infer absence from a missing record. Visitors, non-resident members, former people and deceased people are excluded.

Set `people.elderDistrictId` and `elderDistricts/{id}.elderPersonId` through the trusted setup process. The assigned elder needs a linked, enabled Auth account with a Session role, a current email address and email consent. One message per district per week is queued. The message body and recipient log are Session-only, including against an Admin who is not on Session.

## Verification still requiring the church accounts

The automated suite covers provider payloads with faked HTTP, opt-outs, signed webhooks, scheduled delivery, interrupted attempts, bulletin cutoff and deduplication, folder pickup and the desktop workflows. It does not prove DNS deliverability, carrier registration, tenant permission scoping or real delivery to a mailbox or phone. Those need the small live tests described above.

The renderer workflows pass in Chromium. Verify the native Electron PDF preview, Windows installer and update flow on the release machine before distribution. The native Electron smoke run in this development environment could not attach to the application, so it is not counted as a passing check.
