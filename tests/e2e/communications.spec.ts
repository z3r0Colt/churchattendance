import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import twilio from "twilio";
import { communicationSettingsSchema } from "@sycamore/shared";

if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Communication tests require local emulators");
if (!getApps().length)
  initializeApp({
    projectId: "demo-sycamore",
    storageBucket: "demo-sycamore.appspot.com",
  });
const db = getFirestore();
const base = "http://127.0.0.1:5001/demo-sycamore/us-central1";
const pdf = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
);
let token = "";
async function call(
  request: APIRequestContext,
  name: string,
  data: unknown,
  expectedStatus = 200,
) {
  const response = await request.post(`${base}/${name}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { data },
  });
  const result = await response.json();
  expect(response.status(), JSON.stringify(result)).toBe(expectedStatus);
  return result.result;
}
const message = (overrides: Record<string, unknown> = {}) => ({
  requestId: crypto.randomUUID(),
  channel: "email",
  subject: "Church notice",
  body: "Dear {FirstName}, a note from {ChurchName}.",
  audience: { kind: "people", ids: ["james", "ruth", "eli"] },
  ...overrides,
});
const tick = (
  request: APIRequestContext,
  now = new Date(Date.now() + 60000).toISOString(),
) => call(request, "runLocalCommunicationTick", { now });
async function webhook(
  request: APIRequestContext,
  handler: "twilioInbound" | "twilioStatus",
  body: Record<string, string>,
  query = "",
  valid = true,
) {
  const url = `${base}/${handler}${query}`;
  const form = { AccountSid: `AC${"0".repeat(32)}`, ...body };
  const signature = twilio.getExpectedTwilioSignature(
    "local-emulator-twilio-token",
    url,
    form,
  );
  return request.post(url, {
    form,
    headers: { "X-Twilio-Signature": valid ? signature : "invalid" },
  });
}
async function contacts() {
  for (const [id, email, phone] of [
    ["james", "pastor@example.test", "+12025550101"],
    ["ruth", "ruth@example.test", "+12025550102"],
  ])
    await db.doc(`people/${id}`).update({
      email,
      mobilePhone: phone,
      emailOptIn: true,
      smsOptIn: true,
      elderDistrictId: "",
    });
}
test.beforeEach(async ({ request }) => {
  for (const collection of [
    "messages",
    "bulletins",
    "smsInbox",
    "communicationSuppressions",
    "communicationBudgets",
    "emulatorDeliveries",
    "emulatorDriveFiles",
    "bulletinLinks",
    "messageTemplates",
    "savedAudiences",
  ])
    await db.recursiveDelete(db.collection(collection));
  await contacts();
  await db.doc("communicationSettings/church").set(
    communicationSettingsSchema.parse({
      emailEnabled: true,
      smsEnabled: true,
      previewPersonId: "james",
      reminderPersonId: "ruth",
    }),
  );
  const signed = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    {
      data: {
        email: "pastor@example.test",
        password: "LocalDemo123!",
        returnSecureToken: true,
      },
    },
  );
  token = (await signed.json()).idToken;
  expect(token).toBeTruthy();
});
test("queues idempotently and sends each consented email and text only once under concurrent workers", async ({
  request,
}) => {
  const input = message({ channel: "both" });
  await Promise.all([
    call(request, "createMessage", input),
    call(request, "createMessage", input),
  ]);
  const now = new Date(Date.now() + 60000).toISOString();
  await Promise.all([tick(request, now), tick(request, now)]);
  const deliveries = await db.collection("emulatorDeliveries").get();
  expect(deliveries.size).toBe(4);
  expect(
    deliveries.docs
      .filter((row) => row.get("channel") === "email")
      .every(
        (row) =>
          row.get("body").includes("Unsubscribe") &&
          !row.get("body").includes("{FirstName}"),
      ),
  ).toBe(true);
  await tick(request, now);
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(4);
  expect(
    (await db.doc(`messages/${input.requestId}`).get()).get("totals"),
  ).toMatchObject({ simulated: 4, skipped: 2 });
});
test("rejects unsigned SMS webhooks, honors STOP before delivery, and makes command replays harmless", async ({
  request,
}) => {
  const input = message({
    channel: "sms",
    subject: "",
    audience: { kind: "people", ids: ["ruth"] },
  });
  await call(request, "createMessage", input);
  const body = {
    MessageSid: `SM${"1".repeat(32)}`,
    From: "+12025550102",
    To: "+15555550100",
    Body: "STOP",
  };
  expect(
    (await webhook(request, "twilioInbound", body, "", false)).status(),
  ).toBe(403);
  expect((await db.collection("smsInbox").get()).empty).toBe(true);
  expect((await webhook(request, "twilioInbound", body)).status()).toBe(200);
  expect((await db.doc("people/ruth").get()).get("smsOptIn")).toBe(false);
  await tick(request);
  expect((await db.collection("emulatorDeliveries").get()).empty).toBe(true);
  await webhook(request, "twilioInbound", { ...body, Body: "START" });
  expect((await db.doc("people/ruth").get()).get("smsOptIn")).toBe(false);
  await webhook(request, "twilioInbound", {
    ...body,
    MessageSid: `SM${"2".repeat(32)}`,
    Body: "START",
  });
  expect((await db.doc("people/ruth").get()).get("smsOptIn")).toBe(true);
  expect((await db.collection("smsInbox").get()).size).toBe(2);
  // A shared address suppressed through another contact must also suppress automatic HELP replies.
  await call(request, "recordContactConsent", {
    personId: "james",
    email: "pastor@example.test",
    mobilePhone: "+12025550102",
    emailOptIn: true,
    smsOptIn: false,
    expected: {
      email: "pastor@example.test",
      mobilePhone: "+12025550101",
      emailOptIn: true,
      smsOptIn: true,
    },
    evidence: "Shared number asked to stop texts",
  });
  const help = await webhook(request, "twilioInbound", {
    ...body,
    MessageSid: `SM${"4".repeat(32)}`,
    Body: "HELP",
  });
  expect(await help.text()).not.toContain("<Message>");
});
test("email unsubscribe requires a signed token and a POST, and cancels a previously queued delivery", async ({
  request,
}) => {
  await call(
    request,
    "createMessage",
    message({ audience: { kind: "people", ids: ["james"] } }),
  );
  await tick(request);
  const delivered = (await db.collection("emulatorDeliveries").get()).docs[0];
  const link = String(delivered.get("body"))
    .split("\n")
    .find((line) => line.startsWith(`${base}/emailUnsubscribe`))!;
  expect(link).toBeTruthy();
  expect((await request.get(link)).status()).toBe(200);
  expect((await db.doc("people/james").get()).get("emailOptIn")).toBe(true);
  const queued = message({ audience: { kind: "people", ids: ["james"] } });
  await call(request, "createMessage", queued);
  expect((await request.post(`${link}broken`)).status()).toBe(400);
  expect((await request.post(link)).status()).toBe(200);
  expect((await db.doc("people/james").get()).get("emailOptIn")).toBe(false);
  await tick(request);
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(1);
  expect(
    (await db.doc(`messages/${queued.requestId}`).get()).get("totals.skipped"),
  ).toBe(1);
});
test("scheduled delivery waits for its server time and interrupted sends are never automatically retried", async ({
  request,
}) => {
  const future = new Date(Date.now() + 3600000);
  const input = message({
    audience: { kind: "people", ids: ["james"] },
    scheduledFor: future.toISOString(),
  });
  await call(request, "createMessage", input);
  await tick(request);
  expect((await db.collection("emulatorDeliveries").get()).empty).toBe(true);
  await tick(request, new Date(future.getTime() + 60000).toISOString());
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(1);
  const interrupted = message({ audience: { kind: "people", ids: ["ruth"] } });
  await call(request, "createMessage", interrupted);
  await db
    .doc(`messages/${interrupted.requestId}/recipients/ruth_email`)
    .update({
      status: "sending",
      startedAt: Timestamp.fromMillis(Date.now() - 20 * 60000),
      attemptKey: "interrupted",
    });
  await tick(request);
  expect(
    (
      await db
        .doc(`messages/${interrupted.requestId}/recipients/ruth_email`)
        .get()
    ).get("status"),
  ).toBe("unknown");
  await call(request, "retryFailedMessage", { id: interrupted.requestId }, 400);
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(1);
});
test("validates delivery callbacks and prevents old or stale-attempt statuses from reversing delivery", async ({
  request,
}) => {
  const input = message({
    channel: "sms",
    subject: "",
    audience: { kind: "people", ids: ["james"] },
  });
  await call(request, "createMessage", input);
  const ref = db.doc(`messages/${input.requestId}/recipients/james_sms`);
  await ref.update({
    status: "sending",
    attemptKey: "active-attempt",
    providerId: "",
  });
  const query = `?messageId=${input.requestId}&recipientId=james_sms&attempt=active-attempt`;
  const body = {
    MessageSid: `SM${"3".repeat(32)}`,
    MessageStatus: "delivered",
  };
  expect(
    (await webhook(request, "twilioStatus", body, query, false)).status(),
  ).toBe(403);
  expect((await webhook(request, "twilioStatus", body, query)).status()).toBe(
    204,
  );
  expect((await ref.get()).get("status")).toBe("delivered");
  await webhook(
    request,
    "twilioStatus",
    { ...body, MessageStatus: "sent" },
    query,
  );
  await webhook(
    request,
    "twilioStatus",
    { ...body, MessageStatus: "failed" },
    query.replace("active-attempt", "old-attempt"),
  );
  expect((await ref.get()).get("status")).toBe("delivered");
});
test("sends one bulletin reminder and preview, then one weekly bulletin with an immutable attachment", async ({
  request,
}) => {
  await db
    .doc("communicationSettings/church")
    .update({ bulletinEnabled: true });
  await tick(request, "2027-03-20T20:00:00Z");
  await tick(request, "2027-03-20T20:01:00Z");
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(1);
  const path = "bulletins/2027-03-21/test.pdf";
  await getStorage()
    .bucket()
    .file(path)
    .save(pdf, { contentType: "application/pdf" });
  await call(request, "registerBulletinFile", {
    week: "2027-03-21",
    path,
    name: "Bulletin.pdf",
  });
  await tick(request, "2027-03-20T20:02:00Z");
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(2);
  await tick(request, "2027-03-20T22:00:00Z");
  await tick(request, "2027-03-20T22:01:00Z");
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(4);
  const bulletin = await db.doc("bulletins/2027-03-21").get();
  expect(bulletin.get("messageId")).toBe("bulletin_2027-03-21");
  await call(
    request,
    "registerBulletinFile",
    { week: "2027-03-21", path, name: "Changed.pdf" },
    400,
  );
  expect(
    (await db.doc("messages/bulletin_2027-03-21").get()).get(
      "totals.simulated",
    ),
  ).toBe(2);
});
test("picks up the newest Microsoft-folder PDF through the fake provider and respects the late cutoff", async ({
  request,
}) => {
  await db.doc("communicationSettings/church").update({
    bulletinEnabled: true,
    driveId: "demo-drive",
    folderId: "bulletin-folder",
  });
  await getStorage()
    .bucket()
    .file("emulator-drive/new.pdf")
    .save(pdf, { contentType: "application/pdf" });
  await db.doc("emulatorDriveFiles/new").set({
    driveId: "demo-drive",
    folderId: "bulletin-folder",
    name: "Newest.pdf",
    path: "emulator-drive/new.pdf",
    modifiedAt: Timestamp.fromDate(new Date("2027-04-17T23:00:00Z")),
  });
  await tick(request, "2027-04-18T03:01:00Z");
  const bulletin = await db.doc("bulletins/2027-04-18").get();
  expect(bulletin.get("file.source")).toBe("onedrive");
  expect(bulletin.get("file.name")).toBe("Newest.pdf");
  expect(bulletin.get("messageId")).toBeUndefined();
  await call(request, "bulletinAction", {
    week: "2027-04-18",
    action: "send",
    confirmedRecipientCount: 2,
  });
  await tick(request, "2027-04-18T13:00:00Z");
  expect(
    (await db.doc("messages/bulletin_2027-04-18").get()).get(
      "totals.simulated",
    ),
  ).toBe(2);
});
test("records contact consent without overwriting a simultaneous edit", async ({
  request,
}) => {
  const before = (await db.doc("people/ruth").get()).data()!;
  const expected = {
    email: before.email,
    mobilePhone: before.mobilePhone,
    emailOptIn: before.emailOptIn,
    smsOptIn: before.smsOptIn,
  };
  await db.doc("people/ruth").update({ email: "new-ruth@example.test" });
  await call(
    request,
    "recordContactConsent",
    {
      personId: "ruth",
      ...expected,
      expected,
      evidence: "Verbal permission recorded today",
    },
    409,
  );
  expect((await db.doc("people/ruth").get()).get("email")).toBe(
    "new-ruth@example.test",
  );
});
test("expires only the remaining bulletin recipients at cutoff and resumes them explicitly without duplicates", async ({
  request,
}) => {
  await db
    .doc("communicationSettings/church")
    .update({ bulletinEnabled: true });
  const path = "bulletins/2027-05-09/cutoff.pdf";
  await getStorage()
    .bucket()
    .file(path)
    .save(pdf, { contentType: "application/pdf" });
  await call(request, "registerBulletinFile", {
    week: "2027-05-09",
    path,
    name: "Cutoff.pdf",
  });
  // Leave one email slot for the Pastor preview. The weekly message stays pending behind the minute budget.
  await db.doc("communicationBudgets/202705082200_email").set({ count: 19 });
  await tick(request, "2027-05-08T22:00:00Z");
  const ref = db.doc("messages/bulletin_2027-05-09");
  expect((await ref.get()).get("totals.pending")).toBe(2);
  await tick(request, "2027-05-09T03:01:00Z");
  expect((await ref.get()).get("totals.expired")).toBe(2);
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(1);
  await call(request, "bulletinAction", {
    week: "2027-05-09",
    action: "send",
    confirmedRecipientCount: 2,
  });
  await tick(request, "2027-05-09T13:00:00Z");
  await tick(request, "2027-05-09T13:01:00Z");
  expect((await ref.get()).get("totals.simulated")).toBe(2);
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(3);
});
test("exposes only explicitly enabled bulletin links and revokes old links when sharing is disabled", async ({
  request,
}) => {
  await db
    .doc("communicationSettings/church")
    .update({ bulletinSms: true, shareBulletinLink: true });
  const path = "bulletins/2027-05-16/shared.pdf";
  await getStorage()
    .bucket()
    .file(path)
    .save(pdf, { contentType: "application/pdf" });
  await call(request, "registerBulletinFile", {
    week: "2027-05-16",
    path,
    name: "Shared.pdf",
  });
  await call(request, "bulletinAction", {
    week: "2027-05-16",
    action: "send",
    confirmedRecipientCount: 2,
  });
  const url = (await db.doc("bulletins/2027-05-16").get()).get(
    "publicUrl",
  ) as string;
  const download = await request.get(url);
  expect(download.status()).toBe(200);
  expect(await download.body()).toEqual(pdf);
  expect(
    (
      await request.get(`${base}/bulletinDownload?token=${"0".repeat(48)}`)
    ).status(),
  ).toBe(404);
  await db
    .doc("communicationSettings/church")
    .update({ shareBulletinLink: false });
  expect((await request.get(url)).status()).toBe(404);
});
test("sends the weekly digest only to a linked Session elder after three recorded missed Lord's Days", async ({
  request,
}) => {
  await db
    .doc("communicationSettings/church")
    .update({ absenceEnabled: true, absenceServiceTypeId: "am" });
  await db.doc("people/ruth").update({ elderDistrictId: "north" });
  await db
    .doc("elderDistricts/north")
    .set({ name: "North", elderPersonId: "james" });
  for (const date of ["2027-03-21", "2027-03-14", "2027-03-07"])
    await db.doc(`services/am_${date}`).set({
      serviceTypeId: "am",
      date,
      notes: "",
      present: {},
      lastAttendancePersonId: "",
    });
  await tick(request, "2027-03-22T14:00:00Z");
  const messages = await db
    .collection("messages")
    .where("source", "==", "shepherding-digest")
    .get();
  expect(messages.size).toBe(1);
  expect(messages.docs[0].id).toBe("digest_2027-03-22_north_email");
  expect(messages.docs[0].get("sessionOnly")).toBe(true);
  expect(messages.docs[0].get("body")).toContain(
    "Absent the last 3 recorded Lord's Days (1)\nRuth Calder",
  );
  expect(messages.docs[0].get("totals.simulated")).toBe(1);
  await db.doc("elderDistricts/north").update({ archived: true });
  await tick(request, "2027-03-29T14:00:00Z");
  expect(
    (
      await db
        .collection("messages")
        .where("source", "==", "shepherding-digest")
        .get()
    ).size,
  ).toBe(1);
});
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("pastor@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance" }),
  ).toBeVisible();
}
test("composes, previews and processes a message from the desktop UI", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: /^Messages/ }).click();
  await page
    .getByLabel("Subject", { exact: false })
    .fill("Congregational notice");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Dear {FirstName}, please read this church notice.");
  await page
    .getByRole("button", { name: "Preview recipients", exact: true })
    .click();
  await expect(
    page.getByText("2 deliveries ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send now", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Congregational notice", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Process local queue", exact: true })
    .click();
  await page.getByRole("tab", { name: "Delivery log", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Congregational notice", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/messages.png",
    fullPage: true,
    animations: "disabled",
  });
});
test("uploads a bulletin and records consent using the desktop forms", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Bulletin", exact: true }).click();
  await page.getByLabel("Lord's Day date").fill("2027-05-02");
  await page.getByLabel("Upload bulletin PDF", { exact: true }).setInputFiles({
    name: "Church-bulletin.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(
    page.getByText("Church-bulletin.pdf", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/bulletin.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: /^Messages/ }).click();
  await page
    .getByRole("tab", { name: "Contacts & consent", exact: true })
    .click();
  await page.getByRole("button", { name: "Ruth Calder", exact: true }).click();
  await page.getByLabel("Has agreed to receive church texts").uncheck();
  await page
    .getByLabel("Consent or opt-out record")
    .fill("Ruth asked to stop church texts today.");
  await page
    .getByRole("button", { name: "Save contact and consent", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await db.doc("people/ruth").get()).get("smsOptIn")).toBe(false);
});
