# Phase 10 member self-service and calendar

Phase 10 extends the member portal from Phase 4 with passwordless sign-in, self-service contact and photo editing, confidential requests, a public calendar, calendar subscriptions and event reminders. It is built in slices. This file records what each slice implements and its limits. Scope and acceptance criteria are in [Expanded feature requirements](FEATURE_EXPANSION.md).

| Slice | Scope | Status |
|---|---|---|
| 1 | Email-link sign-in, safe return targets, sign-in email change | Implemented |
| 2 | Member contact, photo and household address editing | Implemented |
| 3 | Prayer and pastoral requests to the Session, practical-help requests to the deacons | Implemented |
| 4 | Occurrence changes, public calendar and calendar subscriptions | Planned |
| 5 | Per-event reminders | Planned |

Decisions made before implementation: sign-in links are sent by Firebase Authentication's own email sender. Prayer and pastoral requests always go to the whole Session. Members change their own photo, and an adult in a household changes the household address, without staff review.

## Email-link sign-in

The portal sign-in card offers **Email me a link** and **Use my password**. A link request calls Firebase's `sendSignInLinkToEmail`. The confirmation reads the same whether or not the address has an account, so the form does not reveal who is a member.

**Lifetime and one-time use.** Firebase issues the link, sets its lifetime and spends its code on first use. The portal removes the code from the address bar and browser history before anything else runs, and finishes sign-in only after the member confirms the email address and clicks **Finish signing in**, so a mail scanner that opens the link cannot spend it. An expired or spent link says so plainly and offers a new one.

**Return target.** The link always returns to the portal's own origin, which Firebase also checks against the project's authorized domains. The only return value carried in the link is a portal tab, rebuilt from an allowlist (`safeReturnPath`). Any other value, including another origin, `//host`, the staff security page or extra parameters, returns to the portal home.

**No account creation.** Church accounts with an email are created only through the Admin SDK. The `refuseClientAccounts` blocking function (`beforeUserCreated`) refuses every client-created account that carries an email, so a link sent to an unknown address signs no one in and creates nothing. Kiosk identities carry no email and are unaffected.

**Access is unchanged.** Signing in by link verifies the email but grants nothing on its own. Every portal call still checks the enabled Auth account, verified email, the administrator-made `portalAccess` mapping and the person's current status. A link never claims a person by matching an email address, never sets a staff role, and cannot satisfy staff MFA or passkey assurance. Disabling the mapping stops the same token on its next call.

**Sign-in email change.** The member Account tab changes the sign-in email through Firebase's `verifyBeforeUpdateEmail`: the change takes effect only after the member opens a confirmation link sent to the new address. Firebase asks for a recent sign-in first. The sign-in email is separate from the contact email the church keeps on the person record.

### Live setup for sign-in links

Before members use links, in the church Firebase project:

1. Turn on **Email link (passwordless sign-in)** under the Email/Password provider.
2. Add the portal hostname to Authentication's authorized domains.
3. Deploy Functions so the `refuseClientAccounts` blocking function is registered. Blocking functions need Firebase Authentication with Identity Platform, which TOTP MFA from Phase 7 already requires.
4. Optionally set a custom sender name and link domain in the Authentication email templates. Links are sent from Firebase's mail service, not the church mailbox, so they do not appear in the church message log.

Check on staging that a linked member can sign in by link, that a second use of the same link fails, and that an unknown address creates no account.

## Member details

The **My details** tab lets a linked member change their own contact details, photo and, if they are an adult, their household's address and home phone. Every call works only on the person in the caller's own `portalAccess` mapping. No call takes a person or household ID, so a member cannot change a relative's record. The mapping, the person's status and the household are rechecked inside the same transaction as the write.

**Contact details.** A member can change their preferred first name, contact email and mobile phone. Only changed fields are sent, each with the value the form started from; a field that changed since the form opened is refused with a refresh message, and other fields are left alone. Email addresses are stored lower case and phone numbers in E.164 form. A preferred-name change also updates the names-only attendance roster.

**Consent stays separate.** Contact editing cannot send `emailOptIn` or `smsOptIn`, membership status or any other field. Text consent belongs to a number, so changing the mobile number of a member who receives texts turns texts off and records a `consentEvents` entry ("Mobile number changed in the member portal"). The member is told to ask the church office to turn texts on for the new number. Editing a number never turns texts on. Changing the contact email keeps the member's email choice; an address that was previously suppressed stays suppressed. Directory sharing is unaffected by any contact change.

**Photo.** A member adds, replaces or removes their own photo, which takes effect at once with no staff review. The browser scales the image to at most 600 pixels and re-encodes it as JPEG, which also drops camera and location details. The server accepts JPEG, PNG or WebP up to 1 MB, checks the file's leading bytes against its declared type, stores it under `photos/{personId}/` with the Admin SDK and deletes the replaced file. A replacement must say whether a photo existed when the page opened, so two devices cannot silently overwrite each other. Members have no direct Storage access: photos are read through `portalPhoto`, which returns a member's own photo, or another member's photo only while that person is listed in the directory and has chosen **Share my photo with members** (off by default). Staff continue to see photos in the desktop as before.

**Household address.** Any adult in the household can change the household address and home phone directly. An adult is a linked member whose recorded birth date is at least 18 years before today in the church time zone (a Feb 29 birthday counts from Feb 28). A member without a recorded birth date, or under 18, sees the household details read-only and is asked to contact the church office. A changed address marks any confirmed map location for Session review, as in Phase 8. Edits are audited with the member's account as the actor.

## Member requests

The **Requests** tab lets a linked member send a prayer request, a pastoral care request or a request for practical help, and follow its progress.

**Audience first.** Choosing a kind shows who will read it before anything is sent, and the send button names the audience. Prayer and pastoral requests are read by the whole Session (the Pastor, the Clerk and the Elders) and are never shared with the congregation. Practical help is read by the deacons assigned to help and by the Pastor; the Elders and deacon chairs see only that help was asked for and what kind. The server picks the collection from the kind, so a request cannot be sent to another audience.

**Prayer and pastoral requests** are stored in `memberRequests`, a Session-only collection denied to every direct client. The member's words are sealed with the private record key ring, bound to the document path and included in key migration. Session officers read them through the audited private-records API (each read writes a `private.read` Session event) on **Pastoral care, Member requests**, which shows a waiting count. An officer can acknowledge a request and close it; each step checks the record revision and moves forward only. Replies happen in person, and any care given is recorded as an ordinary Session note. Admins outside the Session and deacons are denied.

**Practical help** becomes a mercy request with `source: "member"`, the member's household and person, the kind of help, an optional needed-by date and urgency, and the member's words sealed as the request details. It waits in the deacons' triage queue like any other request and is marked **Member request** there. Phase 9 rules apply unchanged: details are readable only by assigned deacons and the Pastor, and the Session and chairs triage without reading them. Approval can start the Phase 9 "request approved" workflow trigger.

**What the member sees.** **My requests** lists the member's own requests by kind, date and progress: Received, Received by the Session, Deacons assigned, In progress, Completed or Closed. It never returns the request text, officer names, notes, outcomes, decline reasons or assignments. Mercy requests officers raised for the same person are not listed.

**Duplicates and abuse.** Each draft carries a random request ID, so a retried send is stored once. An ID that already exists returns the same confirmation without revealing the other record. A member can send five requests per church-local day; the counter lives in `portalBudgets` with the existing TTL. Requests take no attachments, and the form asks members not to include others' details without their agreement.

**Daily summary.** The Session daily summary from Phase 8 adds **New prayer and pastoral requests**, listing each waiting request by kind and date only ("Prayer request from Mar 20"). It never includes the member's name or words. Because every Session officer may read these requests, the section goes to every officer who receives the daily summary.
