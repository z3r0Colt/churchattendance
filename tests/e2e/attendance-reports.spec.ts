import { grantTestStaff } from "./staff-fixture";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import ExcelJS from "exceljs";
import { personInputSchema, toRoster } from "@sycamore/shared";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Report tests require emulators");
if (!getApps().length) initializeApp({ projectId: "demo-sycamore" });
const db = getFirestore(),
  auth = getAuth(),
  typeId = "phase6-worship";
const latest = DateTime.now()
  .setZone("America/Indiana/Indianapolis")
  .startOf("week")
  .minus({ days: 1 });
const dates = [2, 1, 0].map((weeks) => latest.minus({ weeks }).toISODate()!);
const received = latest.minus({ weeks: 1, days: 1 }).toISODate()!;
const tokens: Record<string, string> = {};
async function token(request: APIRequestContext, email: string) {
  const result = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    { data: { email, password: "LocalDemo123!", returnSecureToken: true } },
  );
  return (await result.json()).idToken as string;
}
test.beforeAll(async ({ request }) => {
  for (const [uid, roles] of [
    ["phase6-admin", ["admin"]],
    ["phase6-deacon", ["deacon"]],
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
  tokens.volunteer = await token(request, "volunteer@example.test");
});
async function fixture() {
  await db.doc(`serviceTypes/${typeId}`).set({
    name: "Recorded worship",
    dayOfWeek: 0,
    defaultTime: "08:00",
    isActive: false,
  });
  await db.doc("elderDistricts/phase6-east").set({
    name: "East district",
    elderPersonId: "phase6-rowan",
    archived: false,
  });
  for (const [id, firstName, lastName, status] of [
    ["rowan", "Rowan", "Brook", "communicant"],
    ["nolan", "Nolan", "Frost", "baptized"],
    ["quinn", "Quinn", "Aspen", "communicant"],
  ] as const) {
    await db.recursiveDelete(db.doc(`people/phase6-${id}`));
    const person = personInputSchema.parse({
      firstName,
      lastName,
      householdId: `phase6-${id}`,
      membershipStatus: status,
      elderDistrictId: "phase6-east",
      email: `${id}@example.test`,
    });
    await db.doc(`people/phase6-${id}`).set(person);
    await db
      .doc(`households/phase6-${id}`)
      .set({ name: lastName, address: "1 Example Lane", homePhone: "" });
    await db
      .doc(`attendanceRoster/phase6-${id}`)
      .set(toRoster(`phase6-${id}`, person, lastName));
    if (id !== "quinn") {
      await db.doc(`people/phase6-${id}/membershipEvents/initial`).set({
        date: latest.minus({ months: 4 }).toISODate(),
        fromStatus: null,
        toStatus: id === "rowan" ? "visitor" : "baptized",
        method: "initial",
        otherChurch: "",
        reason: "Initial example entry",
      });
      if (id === "rowan")
        await db.doc(`people/phase6-${id}/membershipEvents/received`).set({
          date: received,
          fromStatus: "visitor",
          toStatus: "communicant",
          method: "profession",
          otherChurch: "",
          reason: "Profession of faith recorded",
        });
    }
  }
  for (const [index, date] of dates.entries())
    await db.doc(`services/${typeId}_${date}`).set({
      serviceTypeId: typeId,
      date,
      notes: "",
      present: Object.fromEntries(
        (index === 0
          ? ["phase6-rowan", "phase6-quinn", "phase6-orphan"]
          : index === 1
            ? ["phase6-rowan"]
            : []
        ).map((id) => [id, { at: null, method: "roll", byUid: "demo-pastor" }]),
      ),
      lastAttendancePersonId: "",
    });
  await db.doc("followUps/phase6-followup").set({
    personId: "phase6-rowan",
    title: "Private appointment title",
    assignedToUid: "demo-pastor",
    dueDate: latest.toISODate(),
    done: false,
    revision: 1,
  });
  await db.doc("careNotes/phase6-visit").set({
    personId: "phase6-rowan",
    kind: "visit",
    date: latest.toISODate(),
    body: "Private report fixture body",
    authorUid: "demo-pastor",
    revision: 1,
  });
  await db
    .doc("sessionPrivate/phase6-hidden/membershipEvents/hidden")
    .set({ privateBody: "Forbidden nested history" });
}
test.beforeEach(fixture);
test.afterAll(async () => {
  for (const id of ["rowan", "nolan", "quinn"]) {
    await db.recursiveDelete(db.doc(`people/phase6-${id}`));
    await db.doc(`households/phase6-${id}`).delete();
    await db.doc(`attendanceRoster/phase6-${id}`).delete();
  }
  for (const date of dates) await db.doc(`services/${typeId}_${date}`).delete();
  for (const path of [
    `serviceTypes/${typeId}`,
    "elderDistricts/phase6-east",
    "followUps/phase6-followup",
    "careNotes/phase6-visit",
    "sessionPrivate/phase6-hidden",
  ])
    await db.recursiveDelete(db.doc(path));
});
async function login(page: Page, email = "pastor@example.test") {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance" }),
  ).toBeVisible();
}
async function reports(page: Page) {
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill(dates[0]);
  await page.getByLabel("Through", { exact: true }).fill(dates[2]);
  await page.getByLabel("Service type filter").selectOption(typeId);
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toBeVisible();
}
async function downloadBook(page: Page) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Excel workbook" }).click();
  const file = await download;
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile((await file.path())!);
  return book;
}
const cells = (book: ExcelJS.Workbook) =>
  JSON.stringify(book.worksheets.map((sheet) => sheet.getSheetValues()));
test("exposes only ordinary report records to Deacons and rejects volunteers", async ({
  request,
}) => {
  for (const [account, status] of [
    ["phase6-deacon", 200],
    ["volunteer", 403],
  ] as const) {
    const response = await request.post(
      "http://127.0.0.1:5001/demo-sycamore/us-central1/getReportingRecords",
      {
        headers: { Authorization: `Bearer ${tokens[account]}` },
        data: { data: {} },
      },
    );
    expect(response.status()).toBe(status);
    const json = JSON.stringify(await response.json());
    expect(json).not.toContain("Forbidden nested history");
    expect(json).not.toContain("Private report fixture body");
  }
});
test("exports historical categories, source rows and a chart, then filters an attendance matrix", async ({
  page,
}) => {
  await login(page);
  await reports(page);
  let book = await downloadBook(page);
  expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
    "Summary",
    "Detail",
    "Data",
  ]);
  expect(book.getWorksheet("Summary")!.getImages()).toHaveLength(1);
  const detail = book.getWorksheet("Detail")!,
    keys = detail.getRow(3).values as string[];
  expect(detail.getRow(4).getCell(keys.indexOf("Visitors")).value).toBe(1);
  expect(detail.getRow(4).getCell(keys.indexOf("Unclassified")).value).toBe(2);
  expect(detail.getRow(4).getCell(keys.indexOf("Total")).value).toBe(3);
  expect(cells(book)).not.toContain("Private report fixture body");
  await page.getByLabel("Report", { exact: true }).selectOption("matrix");
  await page.getByLabel("Membership filter").selectOption("baptized");
  await expect(
    page.getByRole("cell", { name: "Nolan Frost", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Rowan Brook", exact: true }),
  ).toHaveCount(0);
  book = await downloadBook(page);
  const matrix = book.getWorksheet("Detail")!,
    headers = matrix.getRow(3).values as string[];
  expect(matrix.getRow(4).getCell(headers.indexOf("Eligible")).value).toBe(3);
  expect(matrix.getRow(4).getCell(headers.indexOf("Attendance %")).value).toBe(
    0,
  );
  await page.screenshot({
    path: "test-results/phase6-matrix.png",
    fullPage: true,
  });
});
test("keeps follow-up details and their exports private from Admin without Session", async ({
  page,
}) => {
  const privateRequests: string[] = [];
  page.on("request", (request) => {
    const body = request.postData() || "";
    if (/careNotes|followUps/.test(decodeURIComponent(body)))
      privateRequests.push(body);
  });
  await login(page, "phase6-admin@example.test");
  await reports(page);
  await page.getByLabel("Report", { exact: true }).selectOption("visitors");
  await expect(
    page.getByRole("columnheader", { name: "Follow-up information" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Current open follow-ups" }),
  ).toHaveCount(0);
  const book = await downloadBook(page);
  expect(cells(book)).not.toContain("Latest recorded visit");
  expect(cells(book)).not.toContain("Private appointment title");
  expect(privateRequests).toEqual([]);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print / PDF" }).click();
  const print = await popup;
  await print.waitForLoadState();
  await expect(print.locator("body")).not.toContainText(
    "Current open follow-ups",
  );
  await print.pdf({
    path: "test-results/phase6-public-report.pdf",
    format: "Letter",
  });
  await print.close();
});
test("labels Session care exports and prints a readable attendance matrix", async ({
  page,
}) => {
  await login(page);
  await reports(page);
  await page.getByLabel("Report", { exact: true }).selectOption("visitors");
  await expect(
    page.getByRole("columnheader", { name: "Current open follow-ups" }),
  ).toBeVisible();
  await expect(
    page.locator(".fui-Badge").filter({ hasText: "Session only" }),
  ).toBeVisible();
  const book = await downloadBook(page);
  expect(cells(book)).toContain("Session only");
  expect(cells(book)).toContain("Latest recorded visit");
  expect(cells(book)).not.toContain("Private report fixture body");
  const sourceSheet = book.getWorksheet("Data")!,
    sourceHeaders = sourceSheet.getRow(3).values as string[];
  const attendanceRows = sourceSheet
    .getRows(4, sourceSheet.rowCount - 3)!
    .filter(
      (row) =>
        row.getCell(sourceHeaders.indexOf("Record")).value === "Attendance",
    );
  expect(attendanceRows).toHaveLength(1);
  expect(
    attendanceRows[0].getCell(sourceHeaders.indexOf("Person ID")).value,
  ).toBe("phase6-rowan");
  await page.getByLabel("Report", { exact: true }).selectOption("matrix");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print / PDF" }).click();
  const print = await popup;
  await print.waitForLoadState();
  await expect(
    print.getByRole("heading", { name: "Services 1 to 3" }),
  ).toBeVisible();
  await expect(print.locator("body")).not.toContainText(
    "Private report fixture body",
  );
  await print.pdf({
    path: "test-results/phase6-matrix.pdf",
    format: "Letter",
    printBackground: true,
  });
  await print.screenshot({
    path: "test-results/phase6-matrix-print.png",
    fullPage: true,
  });
  await print.close();
});
test("opens dashboard totals as filtered reports and hides private panels from Deacons", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByLabel("Dashboard service type").selectOption(typeId);
  await expect(
    page.getByText("1 open follow-ups are due", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Absent 3+ recorded Lord's Days",
      exact: false,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Shepherding report" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Absent 3+ recorded Lord's Days only"),
  ).toBeChecked();
  await expect(
    page.getByRole("cell", { name: "Nolan Frost", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Rowan Brook", exact: true }),
  ).toHaveCount(0);
  const absentBook = await downloadBook(page),
    absentSource = absentBook.getWorksheet("Data")!,
    absentHeaders = absentSource.getRow(3).values as string[];
  expect(
    absentSource
      .getRows(4, absentSource.rowCount - 3)!
      .filter(
        (row) =>
          row.getCell(absentHeaders.indexOf("Record")).value === "Attendance",
      ),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByLabel("Dashboard service type").selectOption(typeId);
  await expect(
    page.getByRole("button", {
      name: "Absent 3+ recorded Lord's Days",
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/phase6-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Lock now" }).click();
  await login(page, "phase6-deacon@example.test");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Follow-ups due" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(
    page
      .getByLabel("Report", { exact: true })
      .locator('option[value="shepherding"]'),
  ).toHaveCount(0);
});
