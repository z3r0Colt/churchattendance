import { grantTestStaff } from "./staff-fixture";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import ExcelJS from "exceljs";
import { personInputSchema } from "@sycamore/shared";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Administration tests require emulators");
if (!getApps().length)
  initializeApp({
    projectId: "demo-sycamore",
    storageBucket: "demo-sycamore.appspot.com",
  });
const db = getFirestore(),
  auth = getAuth(),
  base = "http://127.0.0.1:5001/demo-sycamore/us-central1";
const tokens: Record<string, string> = {};
async function token(request: APIRequestContext, email: string) {
  const result = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    { data: { email, password: "LocalDemo123!", returnSecureToken: true } },
  );
  return (await result.json()).idToken as string;
}
async function call(
  request: APIRequestContext,
  name: string,
  data: unknown,
  status = 200,
  account = "pastor",
) {
  const response = await request.post(`${base}/${name}`, {
    headers: { Authorization: `Bearer ${tokens[account]}` },
    data: { data },
  });
  const json = await response.json();
  expect(response.status(), JSON.stringify(json)).toBe(status);
  return json.result;
}
const person = personInputSchema.parse({
  firstName: "Nora",
  lastName: "Ashford",
  householdId: "phase5-family",
  membershipStatus: "visitor",
  email: "nora@example.test",
});
test.beforeAll(async ({ request }) => {
  tokens.pastor = await token(request, "pastor@example.test");
  for (const [uid, roles] of [
    ["phase5-admin", ["admin"]],
    ["phase5-reader", ["readOnly"]],
    ["phase5-elder", ["elder"]],
  ] as const) {
    await auth.getUser(uid).catch(() =>
      auth.createUser({
        uid,
        email: `${uid}@example.test`,
        password: "LocalDemo123!",
      }),
    );
    await grantTestStaff(uid, roles);
    tokens[uid] = await token(request, `${uid}@example.test`);
  }
});
test.beforeEach(async () => {
  await db.recursiveDelete(db.doc("people/phase5-person"));
  await db
    .doc("households/phase5-family")
    .set({ name: "Ashford", address: "", homePhone: "", revision: 0 });
  await db.doc("people/phase5-person").set(person);
  await db.doc("attendanceRoster/phase5-person").set({
    id: "phase5-person",
    firstName: "Nora",
    lastName: "Ashford",
    preferredName: "",
    householdId: "phase5-family",
    householdName: "Ashford",
    membershipStatus: "visitor",
    isDeceased: false,
  });
  await db.doc("people/phase5-person/membershipEvents/initial").set({
    date: "2026-01-01",
    fromStatus: null,
    toStatus: "visitor",
    method: "initial",
    otherChurch: "",
    reason: "Initial roll entry",
  });
});
test("merges independent profile fields and rejects stale same-field edits", async ({
  request,
}) => {
  await Promise.all([
    call(request, "savePerson", {
      id: "phase5-person",
      changes: { preferredName: "Nor" },
      expected: { preferredName: "" },
    }),
    call(request, "savePerson", {
      id: "phase5-person",
      changes: { birthDate: "1990-04-02" },
      expected: { birthDate: "" },
    }),
  ]);
  await call(
    request,
    "savePerson",
    {
      id: "phase5-person",
      changes: { preferredName: "Another" },
      expected: { preferredName: "" },
    },
    409,
  );
  await call(
    request,
    "savePerson",
    { id: "phase5-person", changes: { emailOptIn: true } },
    400,
  );
  await call(
    request,
    "savePerson",
    { id: "phase5-person", changes: { lastName: "Changed" } },
    403,
    "phase5-reader",
  );
  const row = (await db.doc("people/phase5-person").get()).data()!;
  expect(row.preferredName).toBe("Nor");
  expect(row.birthDate).toBe("1990-04-02");
  expect(row.emailOptIn).toBe(false);
  expect(
    (await db.doc("attendanceRoster/phase5-person").get()).get("preferredName"),
  ).toBe("Nor");
});
test("requires atomic membership history and validates chronology and death", async ({
  request,
}) => {
  const changes = { membershipStatus: "adherent" };
  await call(request, "savePerson", { id: "phase5-person", changes }, 400);
  const event = {
    date: "2026-02-01",
    fromStatus: "visitor",
    toStatus: "adherent",
    method: "other",
    reason: "Received as an adherent",
    otherChurch: "",
  };
  await call(request, "savePerson", {
    id: "phase5-person",
    changes,
    expected: { membershipStatus: "visitor" },
    membershipEvent: event,
  });
  expect(
    (await db.doc("people/phase5-person").get()).get("membershipStatus"),
  ).toBe("adherent");
  expect(
    (await db.collection("people/phase5-person/membershipEvents").get()).size,
  ).toBe(2);
  await call(
    request,
    "savePerson",
    {
      id: "phase5-person",
      changes: { membershipStatus: "communicant" },
      membershipEvent: {
        ...event,
        date: "2025-01-01",
        fromStatus: "adherent",
        toStatus: "communicant",
      },
    },
    400,
  );
  await call(
    request,
    "savePerson",
    { id: "phase5-person", changes: { isDeceased: true } },
    400,
  );
  await call(request, "savePerson", {
    id: "phase5-person",
    changes: { isDeceased: true, membershipStatus: "former" },
    membershipEvent: {
      ...event,
      date: "2026-03-01",
      fromStatus: "adherent",
      toStatus: "former",
      method: "death",
      reason: "Death recorded",
    },
  });
  expect(
    (await db.doc("attendanceRoster/phase5-person").get()).get("isDeceased"),
  ).toBe(true);
});
test("renames household roster entries atomically and adds a person with consent off", async ({
  request,
}) => {
  await call(request, "saveHousehold", {
    id: "phase5-family",
    expectedRevision: 0,
    name: "Ashford household",
    address: "12 Example Lane",
    homePhone: "",
  });
  expect(
    (await db.doc("attendanceRoster/phase5-person").get()).get("householdName"),
  ).toBe("Ashford household");
  await call(
    request,
    "saveHousehold",
    {
      id: "phase5-family",
      expectedRevision: 0,
      name: "Stale",
      address: "",
      homePhone: "",
    },
    409,
  );
  const added = await call(request, "addPerson", {
    date: "2026-10-18",
    person: { ...person, firstName: "Micah" },
  });
  const row = (await db.doc(`people/${added.id}`).get()).data()!;
  expect(row.emailOptIn).toBe(false);
  expect(row.smsOptIn).toBe(false);
  expect(
    (await db.collection(`people/${added.id}/membershipEvents`).get()).size,
  ).toBe(1);
  await call(
    request,
    "addPerson",
    { date: "2026-10-18", person: { ...person, smsOptIn: true } },
    400,
  );
  await call(
    request,
    "addPerson",
    { date: "2026-10-18", person },
    403,
    "phase5-reader",
  );
});
test("limits setup by role and rejects stale forms and invalid districts", async ({
  request,
}) => {
  const settings = (await db.doc("settings/church").get()).data()!;
  const input = {
    name: settings.name,
    address: settings.address || "",
    timeZone: settings.timeZone,
    expectedRevision: settings.revision || 0,
  };
  await call(
    request,
    "saveChurchSettings",
    { ...input, timeZone: "Church/Here" },
    400,
  );
  await call(request, "saveChurchSettings", input, 403, "phase5-elder");
  await call(request, "saveChurchSettings", input);
  await call(request, "saveChurchSettings", input, 409);
  await db.doc("serviceTypes/phase5-midweek").delete();
  const service = {
    id: "phase5-midweek",
    name: "Midweek prayer",
    defaultTime: "19:00",
    dayOfWeek: 3,
    isActive: true,
    expectedRevision: 0,
  };
  await call(request, "saveServiceType", service, 403, "phase5-reader");
  await call(request, "saveServiceType", service);
  await call(request, "saveServiceType", { ...service, name: "Stale" }, 409);
  // An active midweek service would become the next service on Lord's Day
  // evenings and change the default in later attendance specs.
  await db.doc("serviceTypes/phase5-midweek").delete();
  await db.doc("elderDistricts/phase5-north").delete();
  await call(
    request,
    "saveElderDistrict",
    {
      id: "phase5-north",
      name: "North",
      elderPersonId: "phase5-person",
      archived: false,
      expectedRevision: 0,
    },
    400,
  );
  await call(request, "saveElderDistrict", {
    id: "phase5-north",
    name: "North",
    elderPersonId: "james",
    archived: false,
    expectedRevision: 0,
  });
  await call(
    request,
    "savePerson",
    { id: "phase5-person", changes: { elderDistrictId: "missing" } },
    400,
  );
});
test("paginates administrative exports, preserves timestamps and blocks private and operational data", async ({
  request,
}) => {
  const batch = db.batch();
  for (let i = 0; i < 29; i++)
    batch.set(db.doc(`households/phase5-page-${String(i).padStart(2, "0")}`), {
      name: `Example ${i}`,
      at: new Timestamp(1700000000, 123456000),
    });
  batch.set(db.doc("sessionPrivate/phase5-private"), {
    disciplineFlag: true,
    entry: "Private example",
  });
  batch.set(db.doc("unrelated/phase5/membershipEvents/hidden"), {
    privateExample: true,
  });
  for (let i = 0; i < 25; i++)
    batch.set(db.doc(`aaa/hidden/membershipEvents/phase5-${i}`), {
      privateExample: true,
    });
  await batch.commit();
  const paths: string[] = [];
  let after = "";
  do {
    const page = await call(
      request,
      "exportDataPage",
      { collection: "households", after },
      200,
      "phase5-admin",
    );
    paths.push(...page.rows.map((row: { path: string }) => row.path));
    if (
      page.rows.some(
        (row: { path: string }) => row.path === "households/phase5-page-00",
      )
    )
      expect(
        page.rows.find(
          (row: { path: string }) => row.path === "households/phase5-page-00",
        ).data.at,
      ).toEqual({
        _type: "timestamp",
        seconds: 1700000000,
        nanoseconds: 123456000,
      });
    after = page.next;
  } while (after);
  expect(new Set(paths).size).toBe(paths.length);
  expect(
    paths.filter((path) => path.startsWith("households/phase5-page-")).length,
  ).toBe(29);
  const history = await call(
    request,
    "exportDataPage",
    { collection: "membershipEvents" },
    200,
    "phase5-admin",
  );
  expect(JSON.stringify(history)).not.toContain("privateExample");
  expect(history.rows).toEqual([]);
  const nextHistory = await call(
    request,
    "exportDataPage",
    { collection: "membershipEvents", after: history.next },
    200,
    "phase5-admin",
  );
  expect(
    nextHistory.rows.some(
      (row: { path: string }) =>
        row.path === "people/phase5-person/membershipEvents/initial",
    ),
  ).toBe(true);
  await call(
    request,
    "exportDataPage",
    { collection: "sessionPrivate" },
    403,
    "phase5-admin",
  );
  await call(
    request,
    "exportDataPage",
    { collection: "people" },
    403,
    "phase5-reader",
  );
  await call(
    request,
    "exportDataPage",
    { collection: "kioskConfiguration" },
    400,
  );
  await call(
    request,
    "exportDataPage",
    { collection: "people", after: "careNotes/private" },
    400,
  );
  const privatePage = await call(request, "exportDataPage", {
    collection: "sessionPrivate",
  });
  expect(JSON.stringify(privatePage)).toContain("Private example");
  try {
    await grantTestStaff("phase5-admin", ["readOnly"]);
    await call(
      request,
      "exportDataPage",
      { collection: "people" },
      403,
      "phase5-admin",
    );
    await grantTestStaff("phase5-admin", ["admin"]);
    await auth.updateUser("phase5-admin", { disabled: true });
    await call(
      request,
      "exportDataPage",
      { collection: "people" },
      403,
      "phase5-admin",
    );
  } finally {
    await grantTestStaff("phase5-admin", ["admin"]);
    await auth.updateUser("phase5-admin", { disabled: false });
  }
});
async function login(page: Page, email = "pastor@example.test") {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance" }),
  ).toBeVisible();
}
test("staff adds a person to a household and edits the household from the browser", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "People & households", exact: true })
    .click();
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("First name").fill("Seth");
  await dialog.getByLabel("Last name").fill("Ashford");
  await dialog
    .getByLabel("Household", { exact: false })
    .selectOption("phase5-family");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("Search people").fill("Seth Ashford");
  await expect(
    page.getByRole("button", { name: "Seth Ashford" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Households", exact: true }).click();
  await page.getByLabel("Search households").fill("Ashford");
  await page.getByRole("button", { name: "Ashford", exact: true }).click();
  await dialog.getByLabel("Household name").fill("Ashford family");
  await dialog.getByLabel("Address").fill("12 Example Lane");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ashford family", exact: true }),
  ).toBeVisible();
  expect(
    (await db.doc("attendanceRoster/phase5-person").get()).get("householdName"),
  ).toBe("Ashford family");
});
test("staff edits a profile and records a status change through the browser", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "People & households", exact: true })
    .click();
  await page.getByLabel("Search people").fill("Nora Ashford");
  await page.getByRole("button", { name: "Nora Ashford", exact: true }).click();
  await page.getByRole("button", { name: "Edit profile or status" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Preferred name").fill("Nor");
  await dialog.getByLabel("Membership status").selectOption("adherent");
  await dialog.getByLabel("Status change date").fill("2026-10-18");
  await dialog.getByLabel("Status change method").selectOption("other");
  await dialog
    .getByLabel("Status change reason")
    .fill("Received as an adherent by the Session");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("Received as an adherent by the Session", { exact: true }),
  ).toBeVisible();
  expect(
    (await db.doc("people/phase5-person").get()).get("preferredName"),
  ).toBe("Nor");
  await page.screenshot({
    path: "test-results/phase5-person.png",
    fullPage: true,
  });
});
test("staff creates a service type and downloads an inspectable scoped archive", async ({
  page,
}) => {
  test.setTimeout(120000);
  await login(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Add service type" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Service name").fill("Quarterly prayer gathering");
  await dialog.getByLabel("Day of week").selectOption("");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  expect(
    await dialog
      .getByLabel("Day of week")
      .evaluate(
        (element) => (element as HTMLSelectElement).validity.valueMissing,
      ),
  ).toBe(true);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Day of week").selectOption("3");
  await dialog.getByLabel("Service time").fill("18:30");
  await dialog.getByLabel("Active", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Quarterly prayer gathering" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export permitted records" }).click();
  const file = await download;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await file.path())!);
  expect(book.getWorksheet("Summary")).toBeTruthy();
  expect(book.getWorksheet("people")?.getColumn(1).values).toContain(
    "people/phase5-person",
  );
  expect(book.getWorksheet("sessionPrivate")).toBeTruthy();
  expect(book.getWorksheet("kioskConfiguration")).toBeUndefined();
  const sheet = book.getWorksheet("people")!;
  const record = sheet
    .getRows(2, sheet.rowCount - 1)!
    .find((row) => row.getCell(1).value === "people/phase5-person")!;
  expect(JSON.parse(String(record.getCell(3).value)).firstName).toBe("Nora");
  await page.screenshot({
    path: "test-results/phase5-settings.png",
    fullPage: true,
  });
});
