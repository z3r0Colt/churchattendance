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
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Mercy tests require emulators");
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
  account = "m9-elder",
) {
  const response = await request.post(`${base}/${name}`, {
    headers: { Authorization: `Bearer ${tokens[account]}` },
    data: { data },
  });
  const json = await response.json();
  expect(response.status(), JSON.stringify(json)).toBe(status);
  return json.result;
}
const workspace = (request: APIRequestContext, account: string) =>
  call(request, "getMercyWorkspace", {}, 200, account);
test.beforeAll(async ({ request }) => {
  tokens.pastor = await loginToken(request, "pastor@example.test");
  for (const [uid, roles, name] of [
    ["m9-elder", ["elder"], "Elder Hollis"],
    ["m9-admin", ["admin"], "Office Admin"],
    ["m9-deacon", ["deacon"], "Deacon Fenn"],
    ["m9-deacon-two", ["deacon"], "Deacon Marsh"],
    ["m9-chair", ["deacon"], "Deacon Wren"],
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
      personId: "",
    });
    tokens[uid] = await loginToken(request, `${uid}@example.test`);
  }
});
const mercyCollections = [
  "mercySettings",
  "mercyAssignments",
  "mercyRequests",
  "mercyNotes",
  "mercyTasks",
  "mercyVisits",
];
test.beforeEach(async () => {
  for (const name of [...mercyCollections, "careNotes"])
    await db.recursiveDelete(db.collection(name));
});
// Later specs tick the scheduler, so leave no mercy records behind.
test.afterAll(async () => {
  for (const name of mercyCollections)
    await db.recursiveDelete(db.collection(name));
});
const meals = {
  id: "m9-request",
  expectedRevision: 0,
  householdId: "calder",
  personId: "ruth",
  category: "meals",
  urgent: true,
  neededBy: "2026-11-02",
  details: "Fictional meals after a hospital stay",
};
async function chairs(request: APIRequestContext) {
  await call(request, "saveMercySettings", {
    expectedRevision: 0,
    chairUids: ["m9-chair"],
  });
}

test("keeps practical requests, notes and tasks with assigned deacons and the Pastor", async ({
  request,
}) => {
  await chairs(request);
  await call(request, "saveMercyRequest", meals);
  const stored = (await db.doc("mercyRequests/m9-request").get()).data()!;
  expect(stored.status).toBe("new");
  expect(JSON.stringify(stored)).not.toContain("Fictional meals");
  // An ordinary deacon cannot triage. A chair can.
  await call(
    request,
    "triageMercyRequest",
    {
      id: "m9-request",
      expectedRevision: 1,
      action: "approve",
      deaconUids: ["m9-deacon-two"],
    },
    403,
    "m9-deacon-two",
  );
  await call(
    request,
    "triageMercyRequest",
    {
      id: "m9-request",
      expectedRevision: 1,
      action: "approve",
      deaconUids: ["m9-deacon"],
    },
    200,
    "m9-chair",
  );
  const assigned = await workspace(request, "m9-deacon");
  expect(assigned.requests[0]).toMatchObject({
    status: "approved",
    details: meals.details,
    deaconUids: ["m9-deacon"],
  });
  await call(
    request,
    "saveMercyNote",
    {
      id: "m9-note",
      expectedRevision: 0,
      householdId: "calder",
      requestId: "m9-request",
      date: "2026-10-18",
      body: "Fictional mercy note about the meal rota",
    },
    200,
    "m9-deacon",
  );
  await call(
    request,
    "saveMercyTask",
    {
      id: "m9-task",
      expectedRevision: 0,
      requestId: "m9-request",
      title: "Fictional task to collect a casserole dish",
      assignedToUid: "m9-deacon",
      dueDate: "2026-10-20",
    },
    200,
    "m9-deacon",
  );
  // A task cannot go to a deacon who does not serve the request.
  await call(
    request,
    "saveMercyTask",
    {
      id: "m9-task-two",
      expectedRevision: 0,
      requestId: "m9-request",
      title: "Fictional task",
      assignedToUid: "m9-deacon-two",
      dueDate: "2026-10-20",
    },
    400,
    "m9-deacon",
  );
  for (const [path, secret] of [
    ["mercyNotes/m9-note", "meal rota"],
    ["mercyTasks/m9-task", "casserole"],
  ])
    expect(JSON.stringify((await db.doc(path).get()).data())).not.toContain(
      secret,
    );
  await call(
    request,
    "progressMercyRequest",
    { id: "m9-request", expectedRevision: 2, status: "inProgress" },
    200,
    "m9-deacon",
  );

  const own = await workspace(request, "m9-deacon");
  expect(own.notes[0].body).toBe("Fictional mercy note about the meal rota");
  expect(own.tasks[0].title).toBe("Fictional task to collect a casserole dish");
  // Another deacon sees nothing. The chair, an elder and the Session triage without reading.
  const other = await workspace(request, "m9-deacon-two");
  expect(other.requests).toHaveLength(0);
  expect(other.notes).toHaveLength(0);
  expect(other.tasks).toHaveLength(0);
  for (const account of ["m9-chair", "m9-elder"]) {
    const triage = await workspace(request, account);
    expect(triage.requests[0]).toMatchObject({
      status: "inProgress",
      category: "meals",
    });
    expect(triage.notes).toHaveLength(0);
    expect(triage.tasks).toHaveLength(0);
    expect(JSON.stringify(triage)).not.toMatch(
      /Fictional meals|meal rota|casserole/,
    );
  }
  const pastor = await workspace(request, "pastor");
  expect(pastor.requests[0].details).toBe(meals.details);
  expect(pastor.notes[0].body).toBe("Fictional mercy note about the meal rota");
  await call(request, "getMercyWorkspace", {}, 403, "m9-admin");
  await call(
    request,
    "saveMercyNote",
    {
      id: "m9-intrusion",
      expectedRevision: 0,
      householdId: "calder",
      requestId: "m9-request",
      date: "2026-10-18",
      body: "Not assigned",
    },
    403,
    "m9-deacon-two",
  );
  await call(
    request,
    "progressMercyRequest",
    {
      id: "m9-request",
      expectedRevision: 3,
      status: "resolved",
      outcome: "Not assigned",
    },
    403,
    "m9-elder",
  );
  // Session care notes stay out of reach of every deacon.
  await call(
    request,
    "getPrivateRecords",
    { collection: "careNotes" },
    403,
    "m9-deacon",
  );
  const events = await db
    .collection("securityEvents")
    .where("scope", "==", "mercy")
    .get();
  const reads = events.docs.filter(
    (row) =>
      row.get("actorUid") === "m9-deacon" && row.get("action") === "mercy.read",
  );
  expect(reads.map((row) => row.get("target"))).toEqual(
    expect.arrayContaining(["mercyNotes/m9-note", "mercyRequests/m9-request"]),
  );
  expect(JSON.stringify(events.docs.map((row) => row.data()))).not.toMatch(
    /Fictional|meal rota/,
  );
});

test("transfers a household without leaving the former deacon access, and shares a note only on purpose", async ({
  request,
}) => {
  await chairs(request);
  await call(
    request,
    "saveMercyAssignment",
    { householdId: "calder", expectedRevision: 0, deaconUids: ["m9-deacon"] },
    200,
    "m9-chair",
  );
  // An unassigned deacon cannot assign households.
  await call(
    request,
    "saveMercyAssignment",
    { householdId: "baker", expectedRevision: 0, deaconUids: ["m9-deacon"] },
    403,
    "m9-deacon-two",
  );
  await call(
    request,
    "saveMercyNote",
    {
      id: "m9-household-note",
      expectedRevision: 0,
      householdId: "calder",
      date: "2026-10-18",
      body: "Fictional note on a household visit",
    },
    200,
    "m9-deacon",
  );
  await call(
    request,
    "saveMercyAssignment",
    {
      householdId: "calder",
      expectedRevision: 1,
      deaconUids: ["m9-deacon-two"],
    },
    200,
    "m9-elder",
  );
  expect((await workspace(request, "m9-deacon")).notes).toHaveLength(0);
  const marsh = await workspace(request, "m9-deacon-two");
  expect(marsh.notes[0].body).toBe("Fictional note on a household visit");
  expect((await workspace(request, "m9-elder")).notes).toHaveLength(0);
  // The Session is not a reader, so it cannot share the note with itself.
  await call(
    request,
    "shareMercyNote",
    { id: "m9-household-note", expectedRevision: 1, audience: "session" },
    403,
    "m9-elder",
  );
  await call(
    request,
    "shareMercyNote",
    { id: "m9-household-note", expectedRevision: 1, audience: "session" },
    200,
    "m9-deacon-two",
  );
  const shared = await workspace(request, "m9-elder");
  expect(shared.notes[0]).toMatchObject({
    body: "Fictional note on a household visit",
    sharedWithSession: true,
    sharedBy: "m9-deacon-two",
  });
  expect((await workspace(request, "m9-deacon")).notes).toHaveLength(0);
  await call(request, "getSecurityEvents", { scope: "mercy" }, 403, "m9-elder");
  const log = await call(
    request,
    "getSecurityEvents",
    { scope: "mercy" },
    200,
    "pastor",
  );
  expect(log.events.map((row: { action: string }) => row.action)).toContain(
    "mercy.share",
  );
});

test("declines a request with a sealed reason and refuses closed or stale changes", async ({
  request,
}) => {
  await call(request, "saveMercyRequest", meals, 200, "m9-deacon-two");
  // The deacon who raised it sees its state but not the details after triage.
  await call(request, "triageMercyRequest", {
    id: "m9-request",
    expectedRevision: 1,
    action: "decline",
    reason: "Fictional reason: family is helping",
  });
  const raised = await workspace(request, "m9-deacon-two");
  expect(raised.requests[0]).toMatchObject({ status: "declined" });
  expect(raised.requests[0].details).toBeUndefined();
  expect(
    JSON.stringify((await db.doc("mercyRequests/m9-request").get()).data()),
  ).not.toContain("family is helping");
  const pastor = await workspace(request, "pastor");
  expect(pastor.requests[0].declineReason).toBe(
    "Fictional reason: family is helping",
  );
  await call(
    request,
    "triageMercyRequest",
    {
      id: "m9-request",
      expectedRevision: 2,
      action: "approve",
      deaconUids: ["m9-deacon"],
    },
    400,
  );
  await call(
    request,
    "saveMercyRequest",
    { ...meals, expectedRevision: 1 },
    409,
    "pastor",
  );
});

async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance", exact: true }),
  ).toBeVisible();
}
test("lets an assigned deacon read a request and write a mercy note from the desktop", async ({
  page,
  request,
}) => {
  await call(request, "saveMercyRequest", meals);
  await call(request, "triageMercyRequest", {
    id: "m9-request",
    expectedRevision: 1,
    action: "approve",
    deaconUids: ["m9-deacon"],
  });
  await login(page, "m9-deacon@example.test");
  await page
    .getByRole("button", { name: "Mercy ministry", exact: true })
    .click();
  await expect(
    page.getByText("You are viewing as: Assigned deacon."),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Fictional meals after a hospital stay" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page
    .getByLabel("Mercy note · Assigned deacons and the Pastor only")
    .fill("Fictional desktop mercy note");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("tab", { name: "Mercy notes" }).click();
  await expect(
    page.getByRole("cell", { name: "Fictional desktop mercy note" }),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "Not shared" })).toBeVisible();
  await page.screenshot({
    path: "test-results/phase9-mercy.png",
    fullPage: true,
    animations: "disabled",
  });
});

const pastVisit = {
  id: "m9-visit",
  expectedRevision: 0,
  householdId: "calder",
  start: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  durationMinutes: 60,
  location: "Calder home",
  deaconUids: ["m9-deacon"],
  officerUids: ["m9-elder"],
  purpose: "Fictional purpose only the deacons may read",
};
test("plans a deacon visit, gives the invited officer logistics only and completes it once", async ({
  request,
}) => {
  await call(request, "saveMercyAssignment", {
    householdId: "calder",
    expectedRevision: 0,
    deaconUids: ["m9-deacon"],
  });
  await call(request, "saveMercyVisit", pastVisit, 403, "m9-deacon-two");
  await call(
    request,
    "saveMercyVisit",
    { ...pastVisit, deaconUids: ["m9-deacon", "m9-deacon-two"] },
    400,
    "m9-deacon",
  );
  await call(request, "saveMercyVisit", pastVisit, 200, "m9-deacon");
  expect(
    JSON.stringify((await db.doc("mercyVisits/m9-visit").get()).data()),
  ).not.toContain("Fictional purpose");
  const logistics = await call(
    request,
    "getVisitLogistics",
    {},
    200,
    "m9-elder",
  );
  const invited = logistics.visits.find(
    (row: { id: string }) => row.id === "m9-visit",
  );
  expect(invited).toMatchObject({
    ministry: "mercy",
    householdName: "Calder",
    location: "Calder home",
    deaconNames: ["Deacon Fenn"],
  });
  expect(JSON.stringify(logistics)).not.toContain("Fictional purpose");
  expect((await workspace(request, "m9-elder")).visits).toHaveLength(0);
  expect((await workspace(request, "pastor")).visits[0].purpose).toBe(
    pastVisit.purpose,
  );
  await call(
    request,
    "completeMercyVisit",
    { id: "m9-visit", expectedRevision: 1, note: "Fictional visit note" },
    200,
    "m9-deacon",
  );
  await call(
    request,
    "completeMercyVisit",
    { id: "m9-visit", expectedRevision: 2, note: "Again" },
    400,
    "m9-deacon",
  );
  const done = await workspace(request, "m9-deacon");
  expect(done.visits[0]).toMatchObject({
    status: "completed",
    noteId: "visit_m9-visit",
    purpose: pastVisit.purpose,
  });
  expect(done.notes[0].body).toBe("Fictional visit note");
  // A future visit cannot be completed.
  await call(
    request,
    "saveMercyVisit",
    {
      ...pastVisit,
      id: "m9-future",
      start: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    },
    200,
    "m9-deacon",
  );
  await call(
    request,
    "completeMercyVisit",
    { id: "m9-future", expectedRevision: 1 },
    400,
    "m9-deacon",
  );
});

test("sends one daily deacon summary without details, notes or task titles, rechecking the deacon role", async ({
  request,
}) => {
  const tick = (now: string) =>
    call(request, "runLocalCommunicationTick", { now }, 200, "pastor");
  const deaconDigests = async () =>
    (
      await db
        .collection("messages")
        .where("source", "==", "deacon-digest")
        .get()
    ).docs;
  await chairs(request);
  await db.doc("users/m9-deacon").update({ personId: "ruth" });
  await db.doc("people/ruth").update({
    email: "ruth@example.test",
    emailOptIn: true,
    mobilePhone: "+12025550102",
    smsOptIn: true,
  });
  await db.doc("communicationSettings/church").update({
    emailEnabled: true,
    smsEnabled: true,
    bulletinEnabled: false,
    absenceEnabled: false,
    dailySummaryEnabled: false,
    deaconDigestEnabled: true,
    deaconDigestHour: 7,
    deaconDigestChannel: "both",
  });
  try {
    await call(request, "saveMercyRequest", {
      ...meals,
      neededBy: "2027-03-10",
    });
    await call(request, "triageMercyRequest", {
      id: "m9-request",
      expectedRevision: 1,
      action: "approve",
      deaconUids: ["m9-deacon"],
    });
    await call(
      request,
      "saveMercyTask",
      {
        id: "m9-task",
        expectedRevision: 0,
        requestId: "m9-request",
        title: "Fictional secret task title",
        assignedToUid: "m9-deacon",
        dueDate: "2027-03-08",
      },
      200,
      "m9-deacon",
    );
    await call(
      request,
      "saveMercyVisit",
      {
        ...pastVisit,
        requestId: "m9-request",
        start: "2027-03-08T20:00:00Z",
        officerUids: [],
      },
      200,
      "m9-deacon",
    );
    // 6:59 AM church time is too early. 2:00 PM, twice, queues one notice per channel.
    await tick("2027-03-08T10:59:00Z");
    expect(await deaconDigests()).toHaveLength(0);
    await tick("2027-03-08T18:00:00Z");
    await tick("2027-03-08T18:01:00Z");
    const sent = await deaconDigests();
    expect(sent.map((row) => row.id).sort()).toEqual([
      "deacon_2027-03-08_ruth_email",
      "deacon_2027-03-08_ruth_sms",
    ]);
    const email = sent.find((row) => row.id.endsWith("_email"))!;
    const text = sent.find((row) => row.id.endsWith("_sms"))!;
    expect(email.get("sessionOnly")).toBe(true);
    expect(email.get("recipientRole")).toBe("deacon");
    expect(email.get("body")).toContain("Mercy ministry summary");
    expect(email.get("body")).toContain(
      "Your open requests (1)\nCalder · Meals · by 2027-03-10 · Urgent",
    );
    expect(email.get("body")).toContain(
      "Your tasks due (1)\nCalder · 2027-03-08",
    );
    expect(email.get("body")).toContain("Visits today (1)\n3:00 PM · Calder");
    for (const body of [email.get("body"), text.get("body")])
      expect(body).not.toMatch(/Fictional|hospital|secret/);
    expect(text.get("body")).not.toContain("Calder");
    expect(
      (
        await db
          .doc("messages/deacon_2027-03-08_ruth_email/recipients/ruth_email")
          .get()
      ).get("status"),
    ).not.toBe("skipped");
    // A notice still waiting for someone who is no longer a deacon is skipped at dispatch.
    await grantTestStaff("m9-deacon", ["readOnly"]);
    await db.doc("messages/m9-stale-digest").set({
      channel: "email",
      subject: "Mercy ministry summary",
      body: "Dear {FirstName}",
      audience: { kind: "people", ids: ["ruth"] },
      scheduledFor: Timestamp.fromMillis(Date.now() - 60_000),
      status: "queued",
      createdByUid: "automation",
      selectedPersonIds: ["ruth"],
      sessionOnly: true,
      recipientRole: "deacon",
      attachments: [],
      activeCount: 0,
      source: "deacon-digest",
      serviceTime: "",
      dateLabel: "",
      expiresAt: null,
      totals: { pending: 1 },
    });
    await db.doc("messages/m9-stale-digest/recipients/ruth_email").set({
      personId: "ruth",
      channel: "email",
      address: "ruth@example.test",
      status: "pending",
      providerId: "",
      attemptKey: "",
    });
    await tick("2027-03-09T18:00:00Z");
    expect(
      (
        await db.doc("messages/m9-stale-digest/recipients/ruth_email").get()
      ).get("status"),
    ).toBe("skipped");
    // And no new summary is queued for them.
    expect(
      (await deaconDigests()).filter((row) =>
        row.id.startsWith("deacon_2027-03-09"),
      ),
    ).toHaveLength(0);
  } finally {
    await grantTestStaff("m9-deacon", ["deacon"]);
    await db.doc("users/m9-deacon").update({ personId: "" });
    await db
      .doc("communicationSettings/church")
      .update({ deaconDigestEnabled: false });
    await db.recursiveDelete(db.doc("messages/m9-stale-digest"));
  }
});
