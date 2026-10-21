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
import ExcelJS from "exceljs";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("ChMS tests require emulators");
if (!getApps().length)
  initializeApp({
    projectId: "demo-sycamore",
    storageBucket: "demo-sycamore.appspot.com",
  });
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
  account = "pastor",
) {
  const response = await request.post(`${base}/${name}`, {
    headers: { Authorization: `Bearer ${tokens[account] || account}` },
    data: { data },
  });
  const json = await response.json();
  expect(response.status(), JSON.stringify(json)).toBe(status);
  return json.result;
}
test.beforeAll(async ({ request }) => {
  tokens.pastor = await loginToken(request, "pastor@example.test");
  for (const [id, roles] of [
    ["adminonly", ["admin"]],
    ["elderone", ["elder"]],
    ["deaconone", ["deacon"]],
    ["deacontwo", ["deacon"]],
    ["reader", ["readOnly"]],
  ] as const) {
    const user = await auth.getUser(id).catch(() =>
      auth.createUser({
        uid: id,
        email: `${id}@example.test`,
        password: "LocalDemo123!",
        displayName: id,
      }),
    );
    await grantTestStaff(user.uid, roles);
    await db.doc(`users/${id}`).set({
      displayName: id,
      roles: [...roles],
      personId: id === "elderone" ? "james" : "",
    });
    tokens[id] = await loginToken(request, `${id}@example.test`);
  }
});
test.beforeEach(async () => {
  for (const name of [
    "groups",
    "events",
    "serving",
    "careNotes",
    "followUps",
    "sessionPrivate",
    "diaconalTasks",
    "kioskConfiguration",
    "kioskDevices",
    "kioskSearches",
    "servingSlots",
    "reportSettings",
    "messages",
    "emulatorDeliveries",
    "communicationBudgets",
    "communicationSuppressions",
  ])
    await db.recursiveDelete(db.collection(name));
  await db
    .doc("people/james")
    .update({ emailOptIn: true, smsOptIn: true, mobilePhone: "+12025550101" });
  await db
    .doc("people/ruth")
    .update({ emailOptIn: true, smsOptIn: true, mobilePhone: "+12025550102" });
  await db.doc("communicationSettings/church").update({
    emailEnabled: true,
    smsEnabled: true,
    bulletinEnabled: false,
    absenceEnabled: false,
  });
});
const group = {
  id: "choir",
  expectedRevision: 0,
  name: "Psalm choir",
  type: "choir",
  leaderPersonId: "james",
  memberIds: ["james", "ruth"],
  schedule: "First Saturday, 3 PM",
  archived: false,
};
const event = {
  id: "meal",
  expectedRevision: 0,
  title: "Congregational meal",
  start: "2027-03-07T17:00:00Z",
  end: "2027-03-07T19:00:00Z",
  location: "Fellowship hall",
  recurrence: "weekly",
  interval: 1,
  until: "2027-03-28",
  capacity: 1,
  cancelled: false,
};
const task = {
  id: "ride",
  expectedRevision: 0,
  personId: "ruth",
  title: "Arrange a ride to the church gathering",
  assignedToUid: "deaconone",
  dueDate: "2027-03-07",
  done: false,
};
test("preserves simultaneous group marks and rejects stale group edits", async ({
  request,
}) => {
  await call(request, "saveGroup", group);
  await Promise.all(
    ["james", "ruth"].map((personId) =>
      call(request, "markGroupAttendance", {
        groupId: "choir",
        date: "2027-03-06",
        personId,
        present: true,
      }),
    ),
  );
  expect(
    Object.keys(
      (await db.doc("groups/choir/meetings/2027-03-06").get()).get("present"),
    ),
  ).toHaveLength(2);
  await call(request, "saveGroup", { ...group, name: "Stale form" }, 409);
  await call(
    request,
    "markGroupAttendance",
    { groupId: "choir", date: "2027-03-06", personId: "eli", present: true },
    400,
  );
});
test("serializes concurrent RSVP capacity and separates weekly occurrences", async ({
  request,
}) => {
  await call(request, "saveChurchEvent", event);
  const results = await Promise.all(
    ["james", "ruth"].map((personId) =>
      request.post(`${base}/recordRsvp`, {
        headers: { Authorization: `Bearer ${tokens.pastor}` },
        data: {
          data: {
            eventId: "meal",
            date: "2027-03-07",
            personId,
            status: "yes",
          },
        },
      }),
    ),
  );
  expect(results.map((row) => row.status()).sort()).toEqual([200, 429]);
  await call(request, "recordRsvp", {
    eventId: "meal",
    date: "2027-03-14",
    personId: "ruth",
    status: "yes",
  });
  expect((await db.collection("events/meal/rsvps").get()).size).toBe(2);
  await call(
    request,
    "recordRsvp",
    { eventId: "meal", date: "2027-03-15", personId: "ruth", status: "yes" },
    400,
  );
});
test("rejects private care writes from Admin without Session and validates assignees", async ({
  request,
}) => {
  const note = {
    id: "visit",
    expectedRevision: 0,
    personId: "ruth",
    kind: "visit",
    date: "2027-03-07",
    body: "Fictional pastoral visit record.",
  };
  await call(request, "saveCareNote", note, 403, "adminonly");
  await call(request, "saveCareNote", note, 200, "elderone");
  await call(request, "saveCareNote", { ...note, body: "Overwritten" }, 409);
  await call(
    request,
    "saveFollowUp",
    { ...task, assignedToUid: "deaconone" },
    400,
  );
  await call(request, "saveFollowUp", { ...task, assignedToUid: "elderone" });
  await call(
    request,
    "recordDiscipline",
    {
      personId: "ruth",
      expectedRevision: 0,
      disciplineFlag: true,
      date: "2027-03-07",
      entry: "Fictional Session decision",
    },
    403,
    "adminonly",
  );
  expect((await db.collection("careNotes").get()).size).toBe(1);
});
test("lets only the assigned Deacon complete a sanitized task", async ({
  request,
}) => {
  await call(request, "saveDiaconalTask", task);
  await call(request, "completeDiaconalTask", { id: "ride" }, 403, "deacontwo");
  await call(
    request,
    "saveDiaconalTask",
    { ...task, title: "Forged reassignment" },
    403,
    "deaconone",
  );
  await call(request, "completeDiaconalTask", { id: "ride" }, 200, "deaconone");
  expect((await db.doc("diaconalTasks/ride").get()).get("done")).toBe(true);
  await call(
    request,
    "saveDiaconalTask",
    { ...task, title: "Stale edit" },
    409,
  );
});
test("sends one consented serving reminder, deduplicates ticks and suppresses changed assignments", async ({
  request,
}) => {
  const assignment = {
    id: "usher",
    expectedRevision: 0,
    role: "Usher",
    date: "2027-03-07",
    time: "10:30",
    personId: "james",
    location: "Front doors",
    reminderHours: 24,
    cancelled: false,
  };
  await call(request, "saveServingAssignment", assignment);
  await call(request, "runLocalCommunicationTick", {
    now: "2027-03-06T16:00:00Z",
  });
  await call(request, "runLocalCommunicationTick", {
    now: "2027-03-06T16:01:00Z",
  });
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(1);
  await call(request, "saveServingAssignment", {
    ...assignment,
    id: "second",
    personId: "ruth",
  });
  await db.doc("communicationBudgets/202703061602_sms").set({ count: 60 });
  await call(request, "runLocalCommunicationTick", {
    now: "2027-03-06T16:02:00Z",
  });
  await call(request, "saveServingAssignment", {
    ...assignment,
    id: "second",
    personId: "ruth",
    expectedRevision: 1,
    cancelled: true,
  });
  await call(request, "runLocalCommunicationTick", {
    now: "2027-03-06T16:03:00Z",
  });
  expect((await db.collection("emulatorDeliveries").get()).size).toBe(1);
  expect(
    (await db.doc("messages/serving_second_1").get()).get("totals.skipped"),
  ).toBe(1);
});
test("PWA deployments deny kiosk provisioning and legacy kiosk tokens", async ({ request }) => {
  await call(request, "configureKiosk", { enabled: true, pin: "718294" }, 400);
  await call(request, "startKiosk", { serviceId: "am_2027-03-07" }, 400);
  const token = await auth.createCustomToken("kiosk_retired", { kiosk: true });
  const signed = await request.post("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key", { data: { token, returnSecureToken: true } });
  const kiosk = (await signed.json()).idToken as string;
  for (const name of ["searchKioskHouseholds", "checkInKiosk", "exitKiosk", "kioskInfo"])
    await call(request, name, {}, 400, kiosk);
  expect((await db.doc("kioskDevices/kiosk_retired").get()).exists).toBe(false);
});
async function login(page: Page, email = "pastor@example.test") {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Service", exact: true }),
  ).toContainText("Lord's Day");
}
test("creates a group and records attendance through the desktop form", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Groups", exact: true }).click();
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  await page.getByLabel("Group name").fill("Psalm choir");
  await page
    .getByLabel("Meeting schedule", { exact: true })
    .fill("Saturday 3 PM");
  await page.getByLabel("James Calder", { exact: true }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Psalm choir", exact: true }).click();
  await page.getByLabel("Meeting date", { exact: true }).fill("2027-03-06");
  await page.getByLabel("James Calder", { exact: true }).check();
  await expect(page.getByText("1 present", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/phase3-groups.png",
    fullPage: true,
    animations: "disabled",
  });
});
test("opens private care only for Session and shows a Deacon only assigned tasks", async ({
  page,
  request,
}) => {
  await call(request, "saveDiaconalTask", task);
  await login(page, "deaconone@example.test");
  await expect(page.getByRole("button", { name: /Pastoral care/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Deacon tasks", exact: true }).click();
  await expect(page.getByText(task.title, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: `Complete ${task.title}`, exact: true })
    .click();
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();
});
test("exports annual statistics and monthly chart to a three-sheet workbook", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Annual reports", exact: true })
    .click();
  await expect(
    page.getByText("communicant at start", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Report year", { exact: true }).fill("2027");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export XLSX", exact: true }).click();
  const file = await download;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await file.path())!);
  expect(book.worksheets.map((row) => row.name)).toEqual([
    "Summary",
    "Detail",
    "Data",
  ]);
  expect(book.getWorksheet("Summary")!.getImages()).toHaveLength(1);
  await page.screenshot({
    path: "test-results/phase3-reports.png",
    fullPage: true,
    animations: "disabled",
  });
});
test("the supported staff Settings screen has no kiosk provisioning", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Optional household kiosk")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start kiosk for open service" })).toHaveCount(0);
});
test("prevents concurrent double booking and frees the slot after cancellation", async ({
  request,
}) => {
  const assignment = {
    expectedRevision: 0,
    role: "Usher",
    date: "2027-04-04",
    time: "10:30",
    personId: "james",
    location: "Doors",
    reminderHours: 24,
    cancelled: false,
  };
  const responses = await Promise.all(
    ["one", "two"].map((id) =>
      request.post(`${base}/saveServingAssignment`, {
        headers: { Authorization: `Bearer ${tokens.pastor}` },
        data: { data: { ...assignment, id } },
      }),
    ),
  );
  expect(responses.map((row) => row.status()).sort()).toEqual([200, 409]);
  const winner = (await db.collection("serving").get()).docs[0].id;
  await call(request, "saveServingAssignment", {
    ...assignment,
    id: winner,
    expectedRevision: 1,
    cancelled: true,
  });
  await call(request, "saveServingAssignment", {
    ...assignment,
    id: "replacement",
  });
});
test("creates print-ready annual and photo-directory PDFs without exposing private care", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Annual reports", exact: true })
    .click();
  await expect(
    page.getByText("communicant at start", { exact: true }),
  ).toBeVisible();
  const annualPopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print / PDF", exact: true }).click();
  const annual = await annualPopup;
  await annual.waitForLoadState();
  await expect(
    annual.getByRole("heading", {
      name: "Annual statistical report",
      exact: true,
    }),
  ).toBeVisible();
  await annual.pdf({
    path: "test-results/phase3-annual.pdf",
    format: "Letter",
    printBackground: true,
  });
  await annual.screenshot({
    path: "test-results/phase3-annual-print.png",
    fullPage: true,
  });
  await annual.close();
  await page.getByRole("tab", { name: "Photo directory", exact: true }).click();
  const directoryPopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print / PDF", exact: true }).click();
  const directory = await directoryPopup;
  await directory.waitForLoadState();
  await expect(
    directory.getByRole("heading", { name: "Photo directory", exact: true }),
  ).toBeVisible();
  await expect(directory.locator("body")).not.toContainText("Session only");
  await directory.pdf({
    path: "test-results/phase3-directory.pdf",
    format: "Letter",
    printBackground: true,
  });
  await directory.screenshot({
    path: "test-results/phase3-directory-print.png",
    fullPage: true,
  });
  await directory.close();
});

test("uncertain creation retries return the original visitor and household, without duplicate history", async ({ request }) => {
  await db.doc("services/am_2027-06-06").set({ serviceTypeId: "am", date: "2027-06-06", notes: "", present: {}, lastAttendancePersonId: "" });
  const visitor = { requestId: crypto.randomUUID(), firstName: "Fictional", lastName: "RetryVisitor", serviceId: "am_2027-06-06" };
  const [first, retry] = await Promise.all([call(request, "addVisitor", visitor), call(request, "addVisitor", visitor)]);
  expect(retry.id).toBe(first.id);
  expect((await db.collection("people").where("lastName", "==", "RetryVisitor").get()).size).toBe(1);
  expect((await db.collection(`people/${first.id}/membershipEvents`).get()).size).toBe(1);
  await call(request, "addVisitor", { ...visitor, firstName: "Changed" }, 409);
  const household = { requestId: crypto.randomUUID(), household: { name: "Fictional Retry Household", address: "", homePhone: "" }, people: [{ firstName: "Fictional", lastName: "RetryHousehold", membershipStatus: "visitor" }], date: "2027-06-06" };
  const family = await call(request, "createHousehold", household);
  expect((await call(request, "createHousehold", household)).id).toBe(family.id);
  expect((await db.collection("people").where("lastName", "==", "RetryHousehold").get()).size).toBe(1);
});
