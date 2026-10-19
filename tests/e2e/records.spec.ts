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
];
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
  await page.getByLabel("Email").fill("r11-clerk@example.test");
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
