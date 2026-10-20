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
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Family and import tests require emulators");
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
  account = "r12-office",
) {
  const response = await request.post(`${base}/${name}`, {
    headers: { Authorization: `Bearer ${tokens[account]}` },
    data: { data },
  });
  const json = await response.json();
  expect(response.status(), JSON.stringify(json)).toBe(status);
  return json.result;
}
let ruth: FirebaseFirestore.DocumentData = {};
async function clean() {
  await db.recursiveDelete(db.collection("relationships"));
  await db.recursiveDelete(db.collection("importBatches"));
  for (const row of (await db.collection("importantDates").get()).docs)
    if (row.id.startsWith("wedding_")) await row.ref.delete();
  for (const name of ["people", "households"])
    for (const row of (
      await db.collection(name).where("importBatchId", ">", "").get()
    ).docs) {
      await db.recursiveDelete(row.ref);
      await db.doc(`attendanceRoster/${row.id}`).delete();
    }
  for (const row of (await db.collection("consentEvents").get()).docs)
    if (String(row.get("source")).startsWith("Import")) await row.ref.delete();
  for (const row of (await db.collection("consentEvents").get()).docs)
    if (String(row.get("source")).startsWith("Mobile number changed by import"))
      await row.ref.delete();
}
test.beforeAll(async ({ request }) => {
  for (const [uid, roles, name] of [
    ["r12-office", ["admin"], "Office Admin"],
    ["r12-deacon", ["deacon"], "Deacon Fenn"],
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
  ruth = (await db.doc("people/ruth").get()).data()!;
  await clean();
});
test.afterAll(async () => {
  await clean();
  await db.doc("people/ruth").set(ruth);
});
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("r12-office@example.test");
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance", exact: true }),
  ).toBeVisible();
}

test("checks family links for cycles and keeps an anniversary record", async ({
  request,
}) => {
  const spouse = {
    id: "r12-marriage",
    personId: "james",
    relatedPersonId: "ruth",
    kind: "spouse",
    startDate: "2001-03-12",
    addAnniversary: true,
  };
  await call(request, "saveRelationship", spouse, 403, "r12-deacon");
  await call(request, "saveRelationship", spouse);
  const anniversary = await db.doc("importantDates/wedding_r12-marriage").get();
  expect(anniversary.get("kind")).toBe("weddingAnniversary");
  expect(anniversary.get("date")).toBe("2001-03-12");
  expect(anniversary.get("remindUid")).toBe("");
  await call(request, "saveRelationship", {
    id: "r12-parent",
    personId: "james",
    relatedPersonId: "grace",
    kind: "parent",
  });
  await call(
    request,
    "saveRelationship",
    {
      id: "r12-cycle",
      personId: "grace",
      relatedPersonId: "james",
      kind: "parent",
    },
    400,
  );
  await call(
    request,
    "saveRelationship",
    {
      id: "r12-second",
      personId: "james",
      relatedPersonId: "anna",
      kind: "spouse",
    },
    400,
  );
  await call(
    request,
    "saveRelationship",
    {
      id: "r12-self",
      personId: "james",
      relatedPersonId: "james",
      kind: "sibling",
    },
    400,
  );
});

test("shows the family list and tree and adds a link", async ({ page }) => {
  await login(page);
  await page
    .getByRole("button", { name: "People & households", exact: true })
    .click();
  await page.getByLabel("Search people").fill("James Calder");
  await page.getByRole("button", { name: "James Calder", exact: true }).click();
  await page.getByRole("tab", { name: "Family" }).click();
  await expect(page.getByText("· married March 12, 2001")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Children" }).getByText("Grace Calder"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add family link" }).click();
  await page
    .getByRole("combobox", { name: /^Relationship/ })
    .selectOption("sibling");
  await page
    .getByRole("combobox", { name: /^Family member/ })
    .selectOption("anna");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Brothers and sisters")).toBeVisible();
  await expect(page.getByText("Anna Calder", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/family.png" });
});

const csv = [
  "First Name,Last Name,Email,Mobile,Status,Household,Date received,How received,Email consent",
  "Hazel,Quill,hazel@example.test,,Communicant Member,Quill,2020-05-03,transfer,yes",
  "Ruth,Calder,ruth@example.test,(202) 555-0199,Communicant Member,Calder,,,",
  "=HYPERLINK(1),Bad,,,Visitor,,,,",
  "Hazel,Quill,hazel@example.test,,Communicant Member,Quill,,,",
  "Owen,Quill,,,Baptized Member,Quill,5/9/2021,baptism,",
].join("\n");

test("previews, reviews and imports people without unreviewed changes", async ({
  page,
  request,
}) => {
  await call(
    request,
    "previewPeopleImport",
    {
      rows: [{ firstName: "A", lastName: "B" }],
      defaults: { status: "", statusDate: "2026-01-01" },
    },
    403,
    "r12-deacon",
  );
  await login(page);
  await page
    .getByRole("button", { name: "Import people", exact: true })
    .click();
  await page.getByLabel("CSV or Excel file").setInputFiles({
    name: "fictional-roll.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.getByText("5 rows in fictional-roll.csv")).toBeVisible();
  await page.getByRole("button", { name: "Check rows" }).click();
  await expect(page.getByText("waiting for your decision")).toBeVisible();
  // Nothing is written by the preview.
  expect(
    (await db.collection("people").where("lastName", "==", "Quill").get()).size,
  ).toBe(0);
  await expect(
    page.getByRole("cell", {
      name: /First name looks like a spreadsheet formula/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Looks like the same person as row 1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import reviewed rows" }),
  ).toBeDisabled();
  await page
    .getByLabel("Decision for row 2")
    .selectOption({ label: "Update Ruth Calder" });
  await page.getByRole("button", { name: "Import reviewed rows" }).click();
  await expect(
    page.getByText("Import finished. The results are below."),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "Added" })).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "Updated" })).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "Skipped" })).toHaveCount(2);
  const batch = (await db.collection("importBatches").get()).docs[0];
  const batchId = batch.id;
  const hazel = await db.doc(`people/imp-${batchId}-r1`).get();
  const owen = await db.doc(`people/imp-${batchId}-r5`).get();
  expect(hazel.get("householdId")).toBe(owen.get("householdId"));
  // Consent evidence was not reviewed, so the email column did not opt anyone in.
  expect(hazel.get("emailOptIn")).toBe(false);
  expect(owen.get("birthDate")).toBe("");
  const event = await db
    .doc(`people/imp-${batchId}-r5/membershipEvents/import`)
    .get();
  expect([
    event.get("date"),
    event.get("method"),
    event.get("importBatchId"),
  ]).toEqual(["2021-05-09", "baptism", batchId]);
  const updated = (await db.doc("people/ruth").get()).data()!;
  expect(updated.mobilePhone).toBe("+12025550199");
  // A new mobile number turns texts off, and the import never changes consent otherwise.
  expect(updated.smsOptIn).toBe(false);
  expect(updated.emailOptIn).toBe(ruth.emailOptIn);
  // Retrying a finished batch changes nothing.
  expect(
    (await call(request, "processPeopleImport", { batchId })).remaining,
  ).toBe(0);
  expect((await db.doc(`importBatches/${batchId}`).get()).get("created")).toBe(
    2,
  );
  await page.screenshot({ path: "test-results/import.png" });
});

test("refuses unreviewed matches and leaves concurrent edits alone", async ({
  request,
}) => {
  const value = {
    firstName: "Ruth",
    lastName: "Calder",
    preferredName: "",
    email: "ruth@example.test",
    mobilePhone: "",
    birthDate: "1970-02-02",
    membershipStatus: "communicant",
    householdKey: "calder",
    householdName: "Calder",
    address: "",
    homePhone: "",
    statusDate: "2026-01-01",
    method: "initial",
    emailConsent: false,
    smsConsent: false,
  };
  await call(
    request,
    "startPeopleImport",
    {
      batchId: "r12-unreviewed",
      fileName: "fictional.csv",
      consentReviewed: false,
      rows: [{ row: 1, value, decision: { action: "create" } }],
    },
    400,
  );
  await call(request, "startPeopleImport", {
    batchId: "r12-stale",
    fileName: "fictional.csv",
    consentReviewed: false,
    rows: [
      {
        row: 1,
        value,
        decision: {
          action: "update",
          personId: "ruth",
          expected: { birthDate: "1969-01-01" },
        },
      },
    ],
  });
  expect(
    (await call(request, "processPeopleImport", { batchId: "r12-stale" }))
      .remaining,
  ).toBe(0);
  const row = await db.doc("importBatches/r12-stale/rows/0001").get();
  expect(row.get("outcome")).toBe("conflict");
  expect(row.get("message")).toBe("Changed since the preview: birthDate");
  expect((await db.doc("people/ruth").get()).get("birthDate")).not.toBe(
    "1970-02-02",
  );
});

test("concurrent starts and finished retries preserve import outcomes and counts", async ({
  request,
}) => {
  const input = {
    batchId: "review-concurrent-start",
    fileName: "fictional.csv",
    consentReviewed: false,
    rows: Array.from({ length: 401 }, (_, index) => ({
      row: index + 1,
      value: null,
      decision: { action: "skip" },
    })),
  };
  await Promise.all([
    call(request, "startPeopleImport", input),
    call(request, "startPeopleImport", input),
  ]);
  while (
    (await call(request, "processPeopleImport", { batchId: input.batchId }))
      .remaining > 0
  ) {
    /* bounded by the recorded pending rows */
  }
  await Promise.all([
    call(request, "startPeopleImport", input),
    call(request, "startPeopleImport", input),
  ]);
  expect(
    (await call(request, "processPeopleImport", { batchId: input.batchId }))
      .remaining,
  ).toBe(0);
  const batch = await db.doc(`importBatches/${input.batchId}`).get();
  expect([
    batch.get("state"),
    batch.get("pending"),
    batch.get("skipped"),
  ]).toEqual(["ready", 0, 401]);
  expect(
    (await batch.ref.collection("rows").where("outcome", "==", "pending").get())
      .size,
  ).toBe(0);
  await call(
    request,
    "startPeopleImport",
    { ...input, fileName: "different.csv" },
    409,
  );
});

test("household creation cannot establish messaging consent", async ({
  request,
}) => {
  await call(
    request,
    "createHousehold",
    {
      household: {
        name: "Fictional consent household",
        address: "",
        homePhone: "",
      },
      date: "2026-10-20",
      people: [
        {
          firstName: "Fictional",
          lastName: "Consent",
          membershipStatus: "visitor",
          email: "fictional-consent@example.test",
          emailOptIn: true,
        },
      ],
    },
    400,
  );
  expect(
    (
      await db
        .collection("people")
        .where("email", "==", "fictional-consent@example.test")
        .get()
    ).size,
  ).toBe(0);
});
