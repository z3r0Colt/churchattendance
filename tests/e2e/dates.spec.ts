import { grantTestStaff } from "./staff-fixture";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { DateTime } from "luxon";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Important date tests require emulators");
if (!getApps().length) initializeApp({ projectId: "demo-sycamore" });
const db = getFirestore(),
  auth = getAuth(),
  base = "http://127.0.0.1:5001/demo-sycamore/us-central1";
const tokens: Record<string, string> = {};
async function loginToken(request: APIRequestContext, email: string) {
  const response = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    { data: { email, password: "LocalDemo123!", returnSecureToken: true } },
  );
  return (await response.json()).idToken as string;
}
async function call(
  request: APIRequestContext,
  name: string,
  data: unknown,
  status = 200,
  account = "d9-elder",
) {
  const response = await request.post(`${base}/${name}`, {
    headers: { Authorization: `Bearer ${tokens[account]}` },
    data: { data },
  });
  const json = await response.json();
  expect(response.status(), JSON.stringify(json)).toBe(status);
  return json.result;
}
test.beforeAll(async ({ request }) => {
  tokens.pastor = await loginToken(request, "pastor@example.test");
  for (const [uid, roles, name, personId] of [
    ["d9-elder", ["elder"], "Elder Hollis", "james"],
    ["d9-office", ["admin"], "Office Admin", "james"],
    ["d9-deacon", ["deacon"], "Deacon Fenn", ""],
  ] as const) {
    await auth.getUser(uid).catch(() =>
      auth.createUser({
        uid,
        email: `${uid}@example.test`,
        password: "LocalDemo123!",
        displayName: name,
      }),
    );
    await grantTestStaff(uid, roles);
    await db
      .doc(`users/${uid}`)
      .set({ displayName: name, roles: [...roles], personId });
    tokens[uid] = await loginToken(request, `${uid}@example.test`);
  }
  // A fictional late husband, kept as a link without becoming a recipient.
  await db.doc("people/d9-late").set({
    firstName: "Walter",
    lastName: "Calder",
    preferredName: "",
    householdId: "calder",
    membershipStatus: "former",
    email: "walter@example.test",
    mobilePhone: "",
    birthDate: "",
    emailOptIn: true,
    smsOptIn: false,
    isDeceased: true,
    elderDistrictId: "",
  });
});
test.beforeEach(async () => {
  for (const name of ["importantDates", "bereavementDates"])
    await db.recursiveDelete(db.collection(name));
});
test.afterAll(async () => {
  for (const name of ["importantDates", "bereavementDates"])
    await db.recursiveDelete(db.collection(name));
  await db.doc("people/d9-late").delete();
  await db.doc("attendanceRoster/d9-late").delete();
});
const anniversary = {
  id: "d9-wedding",
  expectedRevision: 0,
  personId: "ruth",
  kind: "weddingAnniversary",
  date: "2001-03-12",
  remindDaysBefore: 3,
  remindUid: "d9-elder",
};
const grief = {
  id: "d9-grief",
  expectedRevision: 0,
  personId: "ruth",
  relatedPersonId: "d9-late",
  kind: "deathAnniversary",
  date: "2026-03-12",
  note: "Fictional private note about the funeral",
  remindDaysBefore: 3,
  remindUid: "d9-elder",
};

test("keeps bereavement dates Session only and sealed, and ordinary dates with editors", async ({
  request,
}) => {
  await call(request, "saveImportantDate", anniversary, 200, "d9-office");
  await call(
    request,
    "saveImportantDate",
    { ...anniversary, id: "d9-other" },
    403,
    "d9-deacon",
  );
  await call(request, "saveBereavementDate", grief, 403, "d9-office");
  // Bereavement reminders go only to a Session officer, about a living person.
  await call(
    request,
    "saveBereavementDate",
    { ...grief, remindUid: "d9-office" },
    400,
  );
  await call(
    request,
    "saveBereavementDate",
    { ...grief, personId: "d9-late", relatedPersonId: "" },
    400,
  );
  await call(request, "saveBereavementDate", grief);
  expect(
    JSON.stringify((await db.doc("bereavementDates/d9-grief").get()).data()),
  ).not.toContain("funeral");
  const session = await call(request, "getPrivateRecords", {
    collection: "bereavementDates",
  });
  expect(session.rows[0]).toMatchObject({
    note: grief.note,
    relatedPersonId: "d9-late",
  });
  for (const account of ["d9-office", "d9-deacon"])
    await call(
      request,
      "getPrivateRecords",
      { collection: "bereavementDates" },
      403,
      account,
    );
  // A stale edit is refused.
  await call(request, "saveImportantDate", anniversary, 409, "d9-office");
});

test("queues one reminder on its day, never late, and drops it after the date changes", async ({
  request,
}) => {
  const tick = (now: string) =>
    call(request, "runLocalCommunicationTick", { now }, 200, "pastor");
  const reminders = async () =>
    (
      await db
        .collection("messages")
        .where("source", "==", "date-reminder")
        .get()
    ).docs;
  await db.doc("people/james").update({
    email: "pastor@example.test",
    emailOptIn: true,
  });
  await db.doc("communicationSettings/church").update({
    emailEnabled: true,
    smsEnabled: true,
    bulletinEnabled: false,
    absenceEnabled: false,
    dailySummaryEnabled: false,
    deaconDigestEnabled: false,
    dateRemindersEnabled: true,
    dateReminderHour: 8,
  });
  try {
    await call(request, "saveImportantDate", anniversary, 200, "d9-office");
    await call(request, "saveBereavementDate", grief);
    // Its reminder day (Mar 7) is already past when the scheduler next runs.
    await call(
      request,
      "saveImportantDate",
      {
        ...anniversary,
        id: "d9-missed",
        date: "2001-03-08",
        remindDaysBefore: 1,
      },
      200,
      "d9-office",
    );
    // 7:59 AM on Mar 9 church time is too early. 9:00 AM, twice, queues each once.
    await tick("2027-03-09T12:59:00Z");
    expect(await reminders()).toHaveLength(0);
    await tick("2027-03-09T14:00:00Z");
    await tick("2027-03-09T14:05:00Z");
    const sent = await reminders();
    expect(sent.map((row) => row.id).sort()).toEqual([
      "date_d9-grief_2027-03-12",
      "date_d9-wedding_2027-03-12",
    ]);
    for (const row of sent) {
      expect(row.get("body")).toBe(
        "Reminder for {FirstName}: an important date for Ruth Calder is on Mar 12. Open the church app for details.",
      );
      expect(row.get("subject")).toBe("Important date reminder");
    }
    expect(
      sent
        .find((row) => row.id.startsWith("date_d9-grief"))!
        .get("sessionOnly"),
    ).toBe(true);
    expect(
      sent
        .find((row) => row.id.startsWith("date_d9-wedding"))!
        .get("sessionOnly"),
    ).toBe(false);
    expect(
      (
        await db
          .doc("messages/date_d9-grief_2027-03-12/recipients/james_email")
          .get()
      ).get("status"),
    ).not.toBe("skipped");
    // The next day nothing new is queued, and the missed date never catches up.
    await tick("2027-03-10T14:00:00Z");
    expect(await reminders()).toHaveLength(2);
    // A reminder still waiting for the old date is dropped once the date changes.
    await call(
      request,
      "saveImportantDate",
      { ...anniversary, expectedRevision: 1, date: "2001-04-20" },
      200,
      "d9-office",
    );
    await db.doc("messages/d9-stale-reminder").set({
      channel: "email",
      subject: "Important date reminder",
      body: "Reminder for {FirstName}",
      audience: { kind: "people", ids: ["james"] },
      scheduledFor: Timestamp.fromMillis(Date.now() - 60_000),
      status: "queued",
      createdByUid: "automation",
      selectedPersonIds: ["james"],
      sessionOnly: false,
      importantDate: {
        collection: "importantDates",
        id: "d9-wedding",
        occurrence: "2027-03-12",
        remindUid: "d9-elder",
      },
      attachments: [],
      activeCount: 0,
      source: "date-reminder",
      serviceTime: "",
      dateLabel: "",
      expiresAt: null,
      totals: { pending: 1 },
    });
    await db.doc("messages/d9-stale-reminder/recipients/james_email").set({
      personId: "james",
      channel: "email",
      address: "pastor@example.test",
      status: "pending",
      providerId: "",
      attemptKey: "",
    });
    await tick("2027-03-10T15:00:00Z");
    expect(
      (
        await db.doc("messages/d9-stale-reminder/recipients/james_email").get()
      ).get("status"),
    ).toBe("skipped");
  } finally {
    await db
      .doc("communicationSettings/church")
      .update({ dateRemindersEnabled: false });
    await db.recursiveDelete(db.doc("messages/d9-stale-reminder"));
  }
});

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("d9-elder@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance", exact: true }),
  ).toBeVisible();
}
test("adds a Session-only bereavement date and previews its next reminder", async ({
  page,
}) => {
  const today = DateTime.now().setZone("America/Indiana/Indianapolis");
  const original = today.plus({ days: 10 }).minus({ years: 1 });
  await login(page);
  await page
    .getByRole("button", { name: "Important dates", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Bereavement care · Session only" })
    .click();
  await page.getByRole("button", { name: "Add bereavement date" }).click();
  await page.getByLabel("Person to care for").selectOption("ruth");
  await page
    .getByLabel("Related person (may be deceased)")
    .selectOption("d9-late");
  await page.getByLabel("Original date").fill(original.toISODate()!);
  await expect(
    page.getByText(
      `The next reminder will be on ${today.plus({ days: 7 }).toISODate()} for ${today.plus({ days: 10 }).toISODate()}.`,
    ),
  ).toBeVisible();
  await page.getByLabel("Remind this Session officer").selectOption("d9-elder");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Ruth Calder" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Anniversary of a death" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/phase9-important-dates.png",
    fullPage: true,
    animations: "disabled",
  });
});
