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
  throw new Error("Church record tests require emulators");
if (!getApps().length) initializeApp({ projectId: "demo-sycamore" });
const db = getFirestore(),
  auth = getAuth(),
  base = "http://127.0.0.1:5001/demo-sycamore/us-central1";
const tokens: Record<string, string> = {};
const collections = [
  "officerPolicies",
  "officerDecisions",
  "quorumPolicies",
  "quorumMeetings",
  "communionDecisions",
  "communionRecords",
];
// A fictional past Lord's Day used only by this spec.
let serviceId = "am_2026-03-01";
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
  account = "r11-clerk",
) {
  const response = await request.post(`${base}/${name}`, {
    headers: { Authorization: `Bearer ${tokens[account]}` },
    data: { data },
  });
  const json = await response.json();
  expect(response.status(), JSON.stringify(json)).toBe(status);
  return json.result;
}
async function clean() {
  for (const name of collections) await db.recursiveDelete(db.collection(name));
  for (const id of ["james", "ruth", "john"])
    await db.recursiveDelete(db.collection(`people/${id}/offices`));
  for (const id of ["am_2026-03-01", "pm_2026-03-01"])
    await db.doc(`services/${id}`).delete();
}
test.beforeAll(async ({ request }) => {
  for (const [uid, roles, name] of [
    ["r11-clerk", ["clerk"], "Clerk Ames"],
    ["r11-office", ["admin"], "Office Admin"],
    ["r11-deacon", ["deacon"], "Deacon Fenn"],
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
    await db.doc(`users/${uid}`).set({ displayName: name, roles: [...roles] });
    tokens[uid] = await loginToken(request, `${uid}@example.test`);
  }
  await clean();
});
test.afterAll(clean);

const elder = {
  id: "r11-james-elder",
  expectedRevision: 0,
  personId: "james",
  role: "pastor",
  ordainedOn: "2012-05-01",
  installedOn: "2015-09-01",
};
test("keeps office history with the Session and decisions sealed", async ({
  request,
}) => {
  await call(request, "saveOffice", elder, 403, "r11-office");
  await call(request, "saveOffice", elder, 403, "r11-deacon");
  await call(request, "saveOffice", elder);
  // A second period in the same office cannot overlap the first.
  await call(
    request,
    "saveOffice",
    { ...elder, id: "r11-overlap", installedOn: "2020-01-01" },
    400,
  );
  await call(
    request,
    "saveOffice",
    { ...elder, id: "r11-bad", installedOn: "2011-01-01" },
    400,
  );
  // Staff readers see office history through the reporting records.
  const records = await call(
    request,
    "getReportingRecords",
    {},
    200,
    "r11-deacon",
  );
  expect(
    records.offices.map((row: { id: string; personId: string }) => [
      row.id,
      row.personId,
    ]),
  ).toEqual([["r11-james-elder", "james"]]);
  const decision = {
    id: "r11-decision",
    expectedRevision: 0,
    personId: "ruth",
    role: "deacon",
    decision: "deferred",
    decidedOn: "2026-10-01",
    note: "Fictional note about timing",
  };
  await call(request, "saveOfficerDecision", decision, 403, "r11-office");
  await call(request, "saveOfficerDecision", decision);
  const stored = (await db.doc("officerDecisions/r11-decision").get()).data()!;
  expect(stored.note).toBeUndefined();
  expect(JSON.stringify(stored)).not.toContain("Fictional note");
  expect(stored.encrypted).toBeTruthy();
  await call(
    request,
    "getPrivateRecords",
    { collection: "officerDecisions" },
    403,
    "r11-office",
  );
  const read = await call(request, "getPrivateRecords", {
    collection: "officerDecisions",
  });
  expect(read.rows[0].note).toBe("Fictional note about timing");
  await call(
    request,
    "saveOfficerPolicy",
    { role: "elder", statuses: ["communicant"], minimumAge: 25 },
    403,
    "r11-office",
  );
  await call(request, "saveOfficerPolicy", {
    role: "elder",
    statuses: ["communicant"],
    minimumAge: 25,
    source: "Fictional Session minute",
  });
  // Quorum rules need a source and a requirement.
  await call(
    request,
    "saveQuorumPolicy",
    {
      id: "r11-rule",
      meetingType: "session",
      effectiveFrom: "2020-01-01",
      electorate: "officers",
      offices: ["pastor", "elder"],
      source: "",
    },
    400,
  );
  await call(
    request,
    "saveQuorumMeeting",
    {
      id: "r11-m",
      meetingType: "session",
      date: "2026-10-01",
      title: "Stated meeting",
      presentPersonIds: ["nobody-here"],
    },
    400,
  );
  await call(
    request,
    "saveQuorumMeeting",
    {
      id: "r11-m",
      meetingType: "session",
      date: "2026-10-01",
      title: "Stated meeting",
      presentPersonIds: ["james"],
    },
    403,
    "r11-office",
  );
});

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("r11-clerk@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance", exact: true }),
  ).toBeVisible();
}
test("records an elder and shows a quorum calculation", async ({
  page,
  request,
}) => {
  const today = DateTime.now().setZone("America/Indiana/Indianapolis");
  await call(request, "saveQuorumPolicy", {
    id: "r11-rule",
    expectedRevision: 0,
    meetingType: "session",
    effectiveFrom: "2020-01-01",
    electorate: "officers",
    offices: ["pastor", "elder"],
    minimumCount: 2,
    source: "Fictional Session rule",
  });
  await login(page);
  await page
    .getByRole("button", { name: "Officers · Session only", exact: true })
    .click();
  await page.getByRole("button", { name: "Add office record" }).click();
  await page.getByRole("combobox", { name: /^Person/ }).selectOption("john");
  await page.getByRole("combobox", { name: /^Office/ }).selectOption("elder");
  await page.getByLabel("Ordained on").fill("2018-03-04");
  await page.getByLabel("Installed here on").fill("2018-03-04");
  await page
    .getByLabel("Term ends on (leave empty for no term)")
    .fill(today.plus({ days: 20 }).toISODate()!);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("cell", { name: "John Baker" })).toBeVisible();
  await page.getByRole("tab", { name: "Term reviews (1)" }).click();
  await expect(page.getByRole("cell", { name: "Review due" })).toBeVisible();
  await page.getByRole("tab", { name: "Quorum" }).click();
  await expect(
    page.getByRole("cell", { name: "Fictional Session rule" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record a meeting" }).click();
  await page.getByLabel("Meeting name").fill("Stated meeting");
  await page.getByLabel("Calder, James").check();
  await expect(
    page.getByText("Quorum not met.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Baker, John").check();
  await expect(
    page.getByText(
      "Quorum met. At least 2. Required: 2. Present from the electorate: 2.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Show calculation" }).click();
  const calculation = page.getByRole("region", { name: "Quorum calculation" });
  await expect(calculation).toContainText("Quorum met.");
  await expect(
    page.getByRole("cell", { name: "Ruling elder", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/officers-quorum.png" });
});

test("keeps communion decisions and participation with the Session", async ({
  request,
}) => {
  const decision = {
    id: "r11-ruth-approved",
    personId: "ruth",
    approved: true,
    kind: "member",
    effectiveOn: "2026-01-01",
    note: "Fictional examination note",
  };
  await call(request, "saveCommunionDecision", decision, 403, "r11-office");
  await call(request, "saveCommunionDecision", decision, 403, "r11-deacon");
  await call(request, "saveCommunionDecision", decision);
  // A decision is never rewritten; a correction is a new decision.
  await call(
    request,
    "saveCommunionDecision",
    { ...decision, approved: false },
    409,
  );
  const stored = (
    await db.doc("communionDecisions/r11-ruth-approved").get()
  ).data()!;
  expect(JSON.stringify(stored)).not.toContain("Fictional examination");
  expect(stored.approved).toBe(true);
  for (const collection of ["communionDecisions", "communionRecords"])
    await call(request, "getPrivateRecords", { collection }, 403, "r11-office");
  // Only living communicant members can be approved together, and a retry adds nothing.
  await call(
    request,
    "approveCommunicants",
    {
      batchId: "r11-batch-1",
      personIds: ["james", "john"],
      effectiveOn: "2026-01-01",
    },
    400,
  );
  const bulk = {
    batchId: "r11-batch-1",
    personIds: ["james"],
    effectiveOn: "2026-01-01",
  };
  expect((await call(request, "approveCommunicants", bulk)).created).toBe(1);
  expect((await call(request, "approveCommunicants", bulk)).created).toBe(0);
  await call(
    request,
    "saveCommunionRecord",
    { serviceId: "am_1999-01-03", personIds: ["ruth"] },
    404,
  );
  await call(
    request,
    "saveCommunionRecord",
    { serviceId, personIds: ["ruth"] },
    403,
    "r11-office",
  );
});

test("marks an online worshipper and records who partook", async ({ page }) => {
  await login(page);
  // Use whichever Lord's Day service the roll call opened with.
  const type = page.getByRole("combobox", { name: "Service", exact: true });
  await expect(type).not.toHaveText("Choose a service");
  const typeId = (await type.textContent())?.includes("Evening") ? "pm" : "am";
  serviceId = `${typeId}_2026-03-01`;
  await db.doc(`services/${serviceId}`).set({
    serviceTypeId: typeId,
    date: "2026-03-01",
    notes: "",
    present: {},
    lastAttendancePersonId: "",
  });
  await page.getByLabel("Service date").fill("2026-03-01");
  await page.getByRole("button", { name: "James Calder, absent" }).click();
  await page
    .getByRole("switch", { name: "Marking online worshippers" })
    .check();
  await page.getByRole("button", { name: "Ruth Calder, absent" }).click();
  await expect(
    page.getByRole("button", { name: "Ruth Calder, online" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "James Calder, present" }),
  ).toBeVisible();
  await expect(page.getByText("· 1 online")).toBeVisible();
  await expect
    .poll(async () => {
      const present = (await db.doc(`services/${serviceId}`).get()).get(
        "present",
      );
      return [present?.james?.mode, present?.ruth?.mode];
    })
    .toEqual(["inPerson", "online"]);
  await page
    .getByRole("button", { name: "Communion · Session only", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Approved" }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Record participation" }).click();
  await page.getByLabel("Service").selectOption(serviceId);
  await page.getByLabel(/^Calder, James · present/).check();
  await page.getByLabel(/^Calder, Ruth · online/).check();
  await page.getByLabel(/^Baker, John/).check();
  await expect(
    page.getByText(
      "Please check: Ruth Calder (Marked as worshipping online); John Baker (Not on the approved list on this date, Not marked present).",
    ),
  ).toBeVisible();
  await page.getByLabel(/^Baker, John/).uncheck();
  await page.getByRole("button", { name: "Save participation" }).click();
  await expect(page.getByText("Saved 2 for Mar 1, 2026.")).toBeVisible();
  const record = (await db.doc(`communionRecords/${serviceId}`).get()).data()!;
  expect(record.personIds.sort()).toEqual(["james", "ruth"]);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("cell", { name: "Mar 1, 2026" })).toBeVisible();
  await page.screenshot({ path: "test-results/communion.png" });
});
