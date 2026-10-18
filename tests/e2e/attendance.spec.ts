import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
async function login(page: Page, email = "volunteer@example.test") {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Service", exact: true }),
  ).not.toHaveText("Choose a service");
  await page.getByLabel("Service date").fill("2026-11-01");
  const start = page.getByRole("button", { name: "Start roll call" });
  if (await start.isVisible()) await start.click();
  await expect(
    page.getByRole("button", { name: "James Calder,", exact: false }),
  ).toBeVisible();
}
test("a volunteer marks while offline and the mark reaches a second PC after reconnecting", async ({
  page,
  browser,
}) => {
  await login(page);
  const james = page.getByRole("button", {
    name: "James Calder,",
    exact: false,
  });
  if ((await james.getAttribute("aria-pressed")) === "true")
    await james.click();
  await expect(james).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await james.click();
  await expect(james).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("Offline, changes saved on this PC", { exact: true }),
  ).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  const second = await browser.newContext();
  const other = await second.newPage();
  await login(other);
  await expect(
    other.getByRole("button", { name: "James Calder,", exact: false }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "People & households", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pastoral/ })).toHaveCount(0);
  await page.screenshot({
    path: "test-results/attendance-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Change theme" }).click();
  await expect(james).toBeEnabled();
  await page.screenshot({
    path: "test-results/attendance-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await second.close();
});
test("visitor quick add validates, creates a new name and marks it present", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Add visitor", exact: true }).click();
  await page.getByLabel("First name").fill("Simon");
  await page.getByLabel("Last name").fill("Alder");
  await page.getByRole("button", { name: "Add and mark present" }).click();
  await expect(
    page.getByRole("button", { name: "Simon Alder, present" }),
  ).toBeVisible();
});
test("a pastor adds a household, searches names and marks its people together", async ({
  page,
}) => {
  await login(page, "pastor@example.test");
  await page
    .getByRole("button", { name: "People & households", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add household", exact: true })
    .click();
  await page.getByLabel("Household name").fill("Linden");
  await page.getByLabel("First name").fill("Miriam");
  await page.getByLabel("Last name").fill("Linden");
  await page
    .getByRole("button", { name: "Save household", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Miriam Linden", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Attendance", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search name or family" });
  await search.fill("Miriam");
  await search.press("Enter");
  await expect(
    page.getByRole("button", { name: "Miriam Linden, present" }),
  ).toBeVisible();
  await search.fill("Calder");
  const family = page.locator("section.household").filter({ hasText: "James" });
  if (await family.getByRole("button", { name: "Clear household" }).isVisible())
    await family.getByRole("button", { name: "Clear household" }).click();
  await family.getByRole("button", { name: "Mark all 3" }).click();
  await expect(
    page.getByRole("button", { name: "Grace Calder, present" }),
  ).toBeVisible();
});
test("exports only the filtered report to an Excel workbook with three sheets", async ({
  page,
}) => {
  await login(page, "pastor@example.test");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-11-01");
  await page.getByLabel("Through", { exact: true }).fill("2026-11-01");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Excel workbook" }).click();
  const path = await (await download).path();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path!);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    "Summary",
    "Detail",
    "Data",
  ]);
  expect(workbook.getWorksheet("Data")!.getRow(4).getCell(1).value).toBe(
    "2026-11-01",
  );
  expect(workbook.getWorksheet("Data")!.views[0]).toMatchObject({
    state: "frozen",
    ySplit: 3,
  });
});
