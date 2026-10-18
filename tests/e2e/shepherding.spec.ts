import { grantTestStaff } from "./staff-fixture";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
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
