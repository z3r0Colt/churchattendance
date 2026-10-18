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
  throw new Error("Shepherding tests require emulators");
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
  account = "p8-elder",
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
  for (const [uid, roles, name] of [
    ["p8-elder", ["elder"], "Elder Hollis"],
    ["p8-admin", ["admin"], "Office Admin"],
    ["p8-deacon", ["deacon"], "Deacon Fenn"],
    ["p8-deacon-two", ["deacon"], "Deacon Marsh"],
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
    await db.doc(`users/${uid}`).set({
      displayName: name,
      roles: [...roles],
      personId: uid === "p8-elder" ? "ruth" : "",
    });
    tokens[uid] = await loginToken(request, `${uid}@example.test`);
  }
});
test.beforeEach(async () => {
  for (const name of [
    "pastoralVisits",
    "visitRounds",
    "careNotes",
    "messages",
    "emulatorDeliveries",
    "communicationBudgets",
    "communicationSuppressions",
    "shepherdingSettings",
    "smsInbox",
  ])
    await db.recursiveDelete(db.collection(name));
  await db
    .doc("people/ruth")
    .update({ emailOptIn: true, email: "ruth@example.test" });
  await db.doc("communicationSettings/church").update({
    emailEnabled: true,
    smsEnabled: true,
    bulletinEnabled: false,
    absenceEnabled: false,
  });
});
// Two days ago at 22:00 UTC, the same evening in the church time zone.
const past = DateTime.utc()
  .minus({ days: 2 })
  .set({ hour: 22, minute: 0, second: 0, millisecond: 0 });
const visit = {
  id: "p8-visit",
  expectedRevision: 0,
  householdId: "calder",
  start: past.toISO(),
  durationMinutes: 60,
  location: "Calder home",
  officerUids: ["p8-elder"],
  deaconUids: ["p8-deacon"],
  purpose: "Fictional purpose that only the Session may read",
  reminderHours: 0,
};

test("shares only logistics with an invited deacon and keeps the plan Session only", async ({
  request,
}) => {
  await call(request, "saveVisit", visit);
  const stored = (await db.doc("pastoralVisits/p8-visit").get()).data()!;
  expect(stored.purpose).toBeUndefined();
  expect(JSON.stringify(stored)).not.toContain("Fictional purpose");
  const session = await call(request, "getPrivateRecords", {
    collection: "pastoralVisits",
  });
  expect(session.rows[0]).toMatchObject({
    purpose: visit.purpose,
    status: "planned",
    start: visit.start,
  });
  const invited = await call(
    request,
    "getVisitLogistics",
    {},
    200,
    "p8-deacon",
  );
  expect(invited.visits).toHaveLength(1);
  expect(invited.visits[0]).toMatchObject({
    householdName: "Calder",
    location: "Calder home",
    officerNames: ["Elder Hollis"],
  });
  expect(JSON.stringify(invited)).not.toContain("Fictional purpose");
  expect(invited.visits[0].roundId).toBeUndefined();
  expect(
    (await call(request, "getVisitLogistics", {}, 200, "p8-deacon-two")).visits,
  ).toHaveLength(0);
  for (const account of ["p8-admin", "p8-deacon"]) {
    await call(request, "saveVisit", visit, 403, account);
    await call(
      request,
      "getPrivateRecords",
      { collection: "pastoralVisits" },
      403,
      account,
    );
    await call(
      request,
      "getPrivateRecords",
      { collection: "visitRounds" },
      403,
      account,
    );
  }
  await call(request, "getVisitLogistics", {}, 403, "p8-admin");
  // A deacon cannot be assigned as an officer, nor an Admin outside Session.
  await call(
    request,
    "saveVisit",
    { ...visit, id: "p8-bad", officerUids: ["p8-admin"], deaconUids: [] },
    400,
  );
  await call(
    request,
    "saveVisit",
    { ...visit, id: "p8-bad", deaconUids: ["p8-elder-missing"] },
    400,
  );
});

test("completes a past visit once with a new Session visit record and refuses future or repeated completion", async ({
  request,
}) => {
  await call(request, "saveVisit", visit);
  await call(request, "saveVisit", {
    ...visit,
    id: "p8-future",
    start: "2099-01-01T15:00:00.000Z",
  });
  await call(
    request,
    "completeVisit",
    { id: "p8-future", expectedRevision: 1, record: { kind: "none" } },
    400,
  );
  await call(
    request,
    "completeVisit",
    {
      id: "p8-visit",
      expectedRevision: 1,
      record: {
        kind: "create",
        noteId: "p8-note-bad",
        personId: "john",
        body: "Wrong household",
      },
    },
    400,
  );
  await call(request, "completeVisit", {
    id: "p8-visit",
    expectedRevision: 1,
    record: {
      kind: "create",
      noteId: "p8-note",
      personId: "ruth",
      body: "Fictional visit record",
    },
  });
  const note = (await db.doc("careNotes/p8-note").get()).data()!;
  expect(note).toMatchObject({
    personId: "ruth",
    kind: "visit",
    visitId: "p8-visit",
    date: past.setZone("America/Indiana/Indianapolis").toISODate(),
  });
  expect(note.body).toBeUndefined();
  const completed = (
    await call(request, "getPrivateRecords", { collection: "pastoralVisits" })
  ).rows.find((row: { id: string }) => row.id === "p8-visit");
  expect(completed).toMatchObject({
    status: "completed",
    careNoteId: "p8-note",
    completedBy: "p8-elder",
    purpose: visit.purpose,
  });
  await call(
    request,
    "completeVisit",
    { id: "p8-visit", expectedRevision: 2, record: { kind: "none" } },
    400,
  );
  await call(request, "saveVisit", { ...visit, expectedRevision: 2 }, 400);
  await call(
    request,
    "completeVisit",
    { id: "p8-visit", expectedRevision: 1, record: { kind: "none" } },
    409,
  );
});

test("sends one content-free reminder and suppresses it after a reschedule or cancellation", async ({
  request,
}) => {
  const plan = {
    ...visit,
    id: "p8-remind",
    start: "2027-03-07T15:30:00.000Z",
    reminderHours: 24,
  };
  await call(request, "saveVisit", plan);
  // Hold delivery so the first reminder is queued but not yet sent.
  await db.doc("communicationBudgets/202703061600_email").set({ count: 20 });
  await call(
    request,
    "runLocalCommunicationTick",
    { now: "2027-03-06T16:00:00Z" },
    200,
    "pastor",
  );
  const first = await db.doc("messages/visit_p8-remind_1_officers").get();
  expect(first.get("sessionOnly")).toBe(true);
  expect(first.get("body")).not.toContain("Calder");
  expect(first.get("body")).not.toContain("Fictional purpose");
  await call(request, "saveVisit", {
    ...plan,
    expectedRevision: 1,
    start: "2027-03-08T00:00:00.000Z",
  });
  await call(
    request,
    "runLocalCommunicationTick",
    { now: "2027-03-06T16:01:00Z" },
    200,
    "pastor",
  );
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(0);
  expect(
    (await db.doc("messages/visit_p8-remind_1_officers").get()).get(
      "totals.skipped",
    ),
  ).toBe(1);
  for (const now of ["2027-03-07T00:05:00Z", "2027-03-07T00:06:00Z"])
    await call(request, "runLocalCommunicationTick", { now }, 200, "pastor");
  const deliveries = await db.collection("emulatorDeliveries").get();
  expect(deliveries.size).toBe(1);
  expect(deliveries.docs[0].get("to")).toBe("ruth@example.test");
  await call(request, "saveVisit", {
    ...plan,
    expectedRevision: 2,
    start: "2027-03-08T00:00:00.000Z",
    status: "cancelled",
    cancelReason: "Family travelling",
  });
  await call(
    request,
    "runLocalCommunicationTick",
    { now: "2027-03-07T00:10:00Z" },
    200,
    "pastor",
  );
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(1);
});

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("p8-elder@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance", exact: true }),
  ).toBeVisible();
}
test("plans a household visit in a round, shows workload and completes it from the desktop", async ({
  page,
  request,
}) => {
  await call(request, "saveVisitRound", {
    id: "p8-round",
    expectedRevision: 0,
    name: "Fictional autumn visits",
    startDate: "2026-09-01",
    endDate: "2026-12-31",
  });
  await call(request, "saveVisit", { ...visit, roundId: "p8-round" });
  await login(page);
  await page
    .getByRole("button", { name: "Shepherding · Session only", exact: true })
    .click();
  await expect(page.getByText("Session only. Invited deacons")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Overdue" })).toBeVisible();
  await page.getByRole("tab", { name: "Workload" }).click();
  await page
    .getByRole("button", { name: "Overdue visits for Elder Hollis" })
    .click();
  await expect(page.getByRole("cell", { name: "Calder" })).toBeVisible();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await page.getByLabel("Person").selectOption("ruth");
  await page
    .getByLabel("Visit record · Session only")
    .fill("Fictional desktop visit record");
  await page.getByRole("button", { name: "Complete visit" }).click();
  await expect(page.getByText("No visits match this view.")).toBeVisible();
  await page.getByLabel("Visit state").selectOption("");
  await expect(page.getByRole("cell", { name: "Linked" })).toBeVisible();
  await page.getByRole("tab", { name: "Visit rounds" }).click();
  await page.getByLabel("Visit round").selectOption("p8-round");
  await expect(page.getByText(/Visited 1 of \d+ households/)).toBeVisible();
  await page.screenshot({
    path: "test-results/phase8-visit-round.png",
    fullPage: true,
    animations: "disabled",
  });
});

const daysAgo = (days: number) =>
  DateTime.now()
    .setZone("America/Indiana/Indianapolis")
    .minus({ days })
    .toISODate()!;
async function seedMessage(
  id: string,
  message: Record<string, unknown>,
  recipients: Record<string, Record<string, unknown>>,
) {
  await db.doc(`messages/${id}`).set({
    source: "compose",
    audience: { kind: "people", ids: [] },
    createdByUid: "p8-elder",
    sessionOnly: false,
    ...message,
  });
  for (const [recipient, row] of Object.entries(recipients))
    await db.doc(`messages/${id}/recipients/${recipient}`).set({
      updatedAt: Timestamp.fromMillis(Date.now() - 2 * 86_400_000),
      ...row,
    });
}
test("counts only personal contact and returns no message or note text", async ({
  request,
}) => {
  expect((await call(request, "getContactHistory", {})).policy).toBeNull();
  await call(request, "saveContactPolicy", {
    historyStart: daysAgo(10),
    defaultContactDays: 30,
  });
  const text = (personIds: string[]) => ({
    selectedPersonIds: personIds,
    audience: { kind: "people", ids: personIds },
  });
  await seedMessage("p8-personal", text(["ruth"]), {
    ruth_sms: { personId: "ruth", channel: "sms", status: "delivered" },
  });
  await seedMessage("p8-failed", text(["john"]), {
    john_sms: { personId: "john", channel: "sms", status: "failed" },
  });
  await seedMessage("p8-queued", text(["john"]), {
    john_email: { personId: "john", channel: "email", status: "pending" },
  });
  await seedMessage(
    "p8-bulletin",
    { ...text(["john"]), source: "bulletin", audience: { kind: "all" } },
    { john_email: { personId: "john", channel: "email", status: "accepted" } },
  );
  await seedMessage(
    "p8-broadcast",
    {
      selectedPersonIds: ["john", "mary", "eli", "grace"],
      audience: { kind: "status", ids: ["adherent"] },
    },
    { john_sms: { personId: "john", channel: "sms", status: "delivered" } },
  );
  await seedMessage(
    "p8-admin-note",
    { ...text(["mary"]), createdByUid: "p8-admin" },
    { mary_sms: { personId: "mary", channel: "sms", status: "delivered" } },
  );
  await db.doc("smsInbox/SMp8reply").set({
    personIds: ["mary"],
    body: "Fictional reply, thank you",
    receivedAt: Timestamp.now(),
    consentCommand: false,
  });
  await db.doc("smsInbox/SMp8help").set({
    personIds: ["john"],
    body: "HELP",
    receivedAt: Timestamp.now(),
    consentCommand: false,
  });
  await call(request, "saveCareNote", {
    id: "p8-note-only",
    expectedRevision: 0,
    personId: "john",
    kind: "note",
    date: daysAgo(1),
    body: "Fictional private observation",
  });
  await call(request, "saveCareNote", {
    id: "p8-call",
    expectedRevision: 0,
    personId: "james",
    kind: "call",
    date: daysAgo(3),
    body: "Fictional phone call",
  });
  await call(request, "saveVisit", visit);
  await call(request, "completeVisit", {
    id: "p8-visit",
    expectedRevision: 1,
    record: { kind: "none" },
  });
  const history = await call(request, "getContactHistory", {});
  const sources = (personId: string) =>
    history.events
      .filter((row: { personId: string }) => row.personId === personId)
      .map((row: { source: string }) => row.source)
      .sort();
  expect(sources("ruth")).toEqual(["personalText", "visit"]);
  expect(sources("mary")).toEqual(["textReply"]);
  expect(sources("john")).toEqual([]);
  expect(sources("james")).toEqual(["call", "visit"]);
  expect(sources("grace")).toEqual(["visit"]);
  const body = JSON.stringify(history);
  for (const secret of [
    "Fictional reply",
    "Fictional private observation",
    "Fictional phone call",
    "Fictional purpose",
  ])
    expect(body).not.toContain(secret);
  for (const account of ["p8-admin", "p8-deacon"]) {
    await call(request, "getContactHistory", {}, 403, account);
    await call(
      request,
      "saveContactPolicy",
      { historyStart: daysAgo(10) },
      403,
      account,
    );
  }
  await call(request, "saveContactPolicy", { historyStart: daysAgo(10) }, 409);
  await call(
    request,
    "saveContactPolicy",
    {
      expectedRevision: 1,
      historyStart: daysAgo(10),
      districtContactDays: { "no-such-district": 30 },
    },
    400,
  );
});
test("shows unknown history until records cover the rule, then a known gap with its rule", async ({
  page,
  request,
}) => {
  await call(request, "saveContactPolicy", {
    historyStart: daysAgo(10),
    defaultContactDays: 30,
  });
  await call(request, "saveCareNote", {
    id: "p8-recent-call",
    expectedRevision: 0,
    personId: "mary",
    kind: "conversation",
    date: daysAgo(2),
    body: "Fictional conversation",
  });
  await login(page);
  await page
    .getByRole("button", { name: "Shepherding · Session only", exact: true })
    .click();
  await page.getByRole("tab", { name: "Contact gaps" }).click();
  const john = page.getByRole("row", { name: /John Baker/ });
  await expect(john).toContainText("Unknown");
  await expect(john).toContainText("Records begin");
  await expect(page.getByRole("row", { name: /Mary Baker/ })).toContainText(
    "Conversation",
  );
  await expect(page.getByRole("row", { name: /Mary Baker/ })).toContainText(
    "Current",
  );
  await page.getByRole("button", { name: "Contact policy" }).click();
  await page.getByLabel("Contact records are complete from").fill(daysAgo(45));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(john).toContainText("Contact gap");
  await expect(john).toContainText("Church policy: 30 days");
  await expect(john).toContainText("15 days past due");
  await page.getByRole("button", { name: "John Baker" }).click();
  await expect(page.getByText(/measured from/)).toBeVisible();
  await page.getByRole("button", { name: "Record contact" }).click();
  await page.getByLabel("Session only record").fill("Fictional call");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(john).toContainText("Current");
  await page.screenshot({
    path: "test-results/phase8-contact-gaps.png",
    fullPage: true,
    animations: "disabled",
  });
});

async function tick(request: APIRequestContext, now: string) {
  await call(request, "runLocalCommunicationTick", { now }, 200, "pastor");
}
const digests = async () =>
  (
    await db
      .collection("messages")
      .where("source", "==", "shepherding-digest")
      .get()
  ).docs;
test("sends one weekly digest per district elder with names by email, counts by text, and live eligibility", async ({
  request,
}) => {
  await db.doc("communicationSettings/church").update({
    absenceEnabled: true,
    absenceServiceTypeId: "am",
    absenceWeeks: 2,
    digestChannel: "both",
    digestWeekday: 1,
    digestHour: 9,
    dailySummaryEnabled: false,
  });
  await db
    .doc("people/ruth")
    .update({ smsOptIn: true, mobilePhone: "+12025550102" });
  await db.doc("people/john").update({ elderDistrictId: "p8-north" });
  await db
    .doc("elderDistricts/p8-north")
    .set({ name: "Fictional North", elderPersonId: "ruth" });
  for (const date of ["2027-03-21", "2027-03-14"])
    await db.doc(`services/am_${date}`).set({
      serviceTypeId: "am",
      date,
      notes: "",
      present: {},
      lastAttendancePersonId: "",
    });
  await call(request, "saveContactPolicy", {
    historyStart: "2026-10-01",
    defaultContactDays: 30,
  });
  await call(request, "saveVisit", {
    ...visit,
    start: "2027-03-20T22:00:00.000Z",
  });
  try {
    // 10:00 AM on Monday in the church time zone, twice.
    await tick(request, "2027-03-22T14:00:00Z");
    await tick(request, "2027-03-22T14:01:00Z");
    const sent = await digests();
    expect(sent.map((row) => row.id).sort()).toEqual([
      "digest_2027-03-22_p8-north_email",
      "digest_2027-03-22_p8-north_sms",
    ]);
    const email = sent.find((row) => row.id.endsWith("_email"))!;
    const text = sent.find((row) => row.id.endsWith("_sms"))!;
    expect(email.get("sessionOnly")).toBe(true);
    expect(email.get("body")).toContain(
      "Absent the last 2 recorded Lord's Days (1)\nJohn Baker",
    );
    expect(email.get("body")).toContain("Contact gaps");
    expect(email.get("body")).toContain("Your overdue visits (1)\nCalder");
    expect(email.get("body")).not.toContain("Fictional purpose");
    expect(text.get("body")).toContain(
      "Absent the last 2 recorded Lord's Days 1",
    );
    expect(text.get("body")).not.toContain("John");
    expect(text.get("body")).not.toContain("Calder");
    expect((await db.collection("emulatorDeliveries").get()).size).toBe(2);
    // Opt-outs are absolute: next week the email is skipped and the text still goes.
    await db.doc("people/ruth").update({ emailOptIn: false });
    await db.doc("services/am_2027-03-28").set({
      serviceTypeId: "am",
      date: "2027-03-28",
      notes: "",
      present: {},
      lastAttendancePersonId: "",
    });
    await tick(request, "2027-03-29T14:00:00Z");
    expect(
      (await db.doc("messages/digest_2027-03-29_p8-north_email").get()).get(
        "totals.skipped",
      ),
    ).toBe(1);
    expect((await db.collection("emulatorDeliveries").get()).size).toBe(3);
    // An elder whose account no longer links to a Session role receives nothing.
    await db.doc("users/p8-elder").update({ personId: "" });
    await db.doc("services/am_2027-04-04").set({
      serviceTypeId: "am",
      date: "2027-04-04",
      notes: "",
      present: {},
      lastAttendancePersonId: "",
    });
    await tick(request, "2027-04-05T14:00:00Z");
    expect(
      (await digests()).filter((row) => row.id.includes("2027-04-05")),
    ).toHaveLength(0);
  } finally {
    await db.doc("users/p8-elder").update({ personId: "ruth" });
    await db.doc("people/john").update({ elderDistrictId: "" });
    await db.doc("elderDistricts/p8-north").delete();
    for (const date of ["2027-03-21", "2027-03-14", "2027-03-28", "2027-04-04"])
      await db.doc(`services/am_${date}`).delete();
  }
});
test("sends a daily summary of the officer's own visits and follow-ups without private titles", async ({
  request,
}) => {
  await db.doc("communicationSettings/church").update({
    absenceEnabled: false,
    digestChannel: "email",
    dailySummaryEnabled: true,
    dailySummaryHour: 7,
  });
  await db.recursiveDelete(db.collection("followUps"));
  await call(request, "saveVisit", {
    ...visit,
    start: "2027-03-23T22:00:00.000Z",
  });
  await call(request, "saveFollowUp", {
    id: "p8-follow",
    expectedRevision: 0,
    personId: "mary",
    title: "Fictional private follow-up title",
    assignedToUid: "p8-elder",
    dueDate: "2027-03-22",
  });
  // 6:59 AM is before the summary hour, then 8:00 AM twice.
  await tick(request, "2027-03-23T10:59:00Z");
  expect(await digests()).toHaveLength(0);
  await tick(request, "2027-03-23T12:00:00Z");
  await tick(request, "2027-03-23T12:01:00Z");
  const sent = await digests();
  expect(sent.map((row) => row.id)).toEqual(["daily_2027-03-23_ruth_email"]);
  const body = sent[0].get("body");
  expect(body).toContain("Visits today (1)\n6:00 PM · Calder");
  expect(body).toContain("Follow-ups due (1)\nMary Baker");
  expect(body).not.toContain("Fictional private follow-up title");
  expect(body).not.toContain("Fictional purpose");
});
test("saves the digest schedule and channel from Settings", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("pastor@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Send digests by").selectOption("sms");
  await page.getByLabel("Digest day").selectOption("2");
  await page
    .getByLabel("Absent this many recorded Lord's Days in a row")
    .fill("4");
  await page
    .getByRole("button", { name: "Save communication settings" })
    .click();
  await expect
    .poll(async () =>
      (await db.doc("communicationSettings/church").get()).data(),
    )
    .toMatchObject({ digestChannel: "sms", digestWeekday: 2, absenceWeeks: 4 });
});
