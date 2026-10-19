import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { grantTestStaff } from "./staff-fixture";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Staff web screen tests require emulators");
if (!getApps().length) initializeApp({ projectId: "demo-sycamore" });
const web = "http://localhost:5175/staff/";
const phone = (width = 390) => ({
  viewport: { width, height: 844 },
  hasTouch: true,
  isMobile: true,
});
// The older Windows booth display.
const booth = { viewport: { width: 1024, height: 768 } };

// Elements that reach past the right edge of the screen, other than those inside a
// deliberate sideways scroller such as a wide table.
function offscreen() {
  const main = document.querySelector("main.content");
  if (!main) return ["main.content is missing"];
  const found: Element[] = [];
  for (const element of main.querySelectorAll("*")) {
    const box = element.getBoundingClientRect();
    if (!box.width || box.right <= window.innerWidth + 1) continue;
    let parent = element.parentElement,
      scrolls = false;
    while (parent && parent !== main) {
      if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX)) {
        scrolls = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (!scrolls && !found.some((outer) => outer.contains(element)))
      found.push(element);
  }
  return found.map(
    (element) =>
      `${element.tagName} "${(element.textContent || "").trim().slice(0, 40)}"`,
  );
}
async function accessible(page: Page, where: string) {
  // Fluent's focus sentinels are hidden, focusable placeholders by design.
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .exclude("[data-tabster-dummy]")
    .analyze();
  const serious = result.violations.filter((row) =>
    ["serious", "critical"].includes(row.impact || ""),
  );
  expect(
    serious.map((row) => `${where}: ${row.id} ${row.nodes[0]?.target}`),
  ).toEqual([]);
}
async function signInWeb(page: Page, email: string) {
  await page.goto(web);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByLabel(/^Password/).fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance" }),
  ).toBeVisible();
}
async function signInDesktop(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance" }),
  ).toBeVisible();
}
const navNames = (page: Page) =>
  page
    .locator("#main-nav .nav-item")
    .evaluateAll((items) =>
      items.map(
        (item) =>
          item.getAttribute("aria-label") || (item.textContent || "").trim(),
      ),
    );
async function open(page: Page, name: string, narrow: boolean) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (narrow) await menu.click();
  await page.getByRole("button", { name, exact: true }).click();
  if (narrow) await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("main.content h1").first()).toBeVisible();
  // Let snapshot listeners and callables fill the page before measuring.
  await page.waitForTimeout(1200);
}
// Visits every destination this account can open, and each tab on it, checking
// that nothing runs off the screen and, when asked, that axe finds nothing serious.
async function sweep(
  page: Page,
  options: { narrow: boolean; tabs: boolean; axe: boolean; label: string },
) {
  const names = await navNames(page);
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    await open(page, name, options.narrow);
    expect(await page.evaluate(offscreen), `${options.label} ${name}`).toEqual(
      [],
    );
    if (options.axe) await accessible(page, `${options.label} ${name}`);
    if (!options.tabs) continue;
    const tabs = page.locator("main.content [role=tablist] [role=tab]");
    for (let index = 0; index < (await tabs.count()); index++) {
      const tab = tabs.nth(index);
      if (!(await tab.isVisible())) continue;
      await tab.click();
      await page.waitForTimeout(500);
      expect(
        await page.evaluate(offscreen),
        `${options.label} ${name} tab ${index}`,
      ).toEqual([]);
    }
  }
  return names;
}
async function staff(uid: string, roles: string[]) {
  await getAuth()
    .getUser(uid)
    .catch(() =>
      getAuth().createUser({
        uid,
        email: `${uid}@example.test`,
        password: "LocalDemo123!",
        displayName: "Fictional Deacon",
        emailVerified: true,
      }),
    );
  await grantTestStaff(uid, roles);
}
async function context(browser: Browser, options: object, dark = false) {
  const created = await browser.newContext({
    ...options,
    colorScheme: dark ? "dark" : "light",
  });
  return { created, page: await created.newPage() };
}

test.describe.configure({ timeout: 300_000 });

test("every Pastor destination and tab works at phone width in light and dark", async ({
  browser,
}) => {
  const light = await context(browser, phone());
  await signInWeb(light.page, "pastor@example.test");
  const names = await sweep(light.page, {
    narrow: true,
    tabs: true,
    axe: true,
    label: "phone light",
  });
  expect(names).toContain("Pastoral care · Session only");
  await light.created.close();
  const dark = await context(browser, phone(), true);
  await signInWeb(dark.page, "pastor@example.test");
  await expect(dark.page.locator(".app")).toHaveAttribute("data-theme", "dark");
  await sweep(dark.page, {
    narrow: true,
    tabs: false,
    axe: true,
    label: "phone dark",
  });
  await dark.created.close();
});

test("every Pastor destination fits the booth display in light and dark", async ({
  browser,
}) => {
  for (const dark of [false, true]) {
    const run = await context(browser, booth, dark);
    await signInDesktop(run.page, "pastor@example.test");
    await expect(run.page.locator(".app")).toHaveAttribute(
      "data-theme",
      dark ? "dark" : "light",
    );
    await sweep(run.page, {
      narrow: false,
      tabs: false,
      axe: dark,
      label: dark ? "booth dark" : "booth light",
    });
    await run.created.close();
  }
});

test("a deacon on a small phone has a working path to each permitted job and no Session screens", async ({
  browser,
}) => {
  await staff("phase12-deacon", ["deacon"]);
  const run = await context(browser, phone(360));
  await signInWeb(run.page, "phase12-deacon@example.test");
  const names = await sweep(run.page, {
    narrow: true,
    tabs: true,
    axe: true,
    label: "deacon",
  });
  expect(names).toEqual(
    expect.arrayContaining(["Deacon tasks", "Mercy ministry"]),
  );
  expect(names.filter((name) => name.includes("Session only"))).toEqual([]);
  expect(names).not.toContain("Messages");
  await run.created.close();
});

test("a volunteer on a phone sees only attendance and their account", async ({
  browser,
}) => {
  const run = await context(browser, phone(360));
  await signInWeb(run.page, "volunteer@example.test");
  expect(await navNames(run.page)).toEqual(["Attendance", "Account security"]);
  await run.created.close();
});

test("the phone menu works from the keyboard alone", async ({ browser }) => {
  const run = await context(browser, phone());
  const { page } = run;
  await signInWeb(page, "pastor@example.test");
  await page.locator("body").focus();
  await page.keyboard.press("Tab");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await expect(menu).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Dashboard", exact: true }),
  ).toBeFocused();
  const people = page.getByRole("button", {
    name: "People & households",
    exact: true,
  });
  for (let step = 0; step < 12; step++) {
    if (await people.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(people).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("heading", { name: "People & households" }),
  ).toBeVisible();
  await run.created.close();
});

test("a sensitive account change asks the person to confirm it is them, then continues", async ({
  browser,
}) => {
  const run = await context(browser, phone());
  const { page } = run;
  // The real server accepts this fresh sign-in, so the first call is answered as if
  // the sign-in were more than five minutes old.
  let stale = 0;
  await page.route("**/us-central1/createStaffAccount", async (route) => {
    // A wildcard does not cover the Authorization header, so echo the requested headers.
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        route.request().headers()["access-control-request-headers"] ||
        "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    if (stale > 0) {
      stale--;
      return route.fulfill({
        status: 401,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          error: {
            status: "UNAUTHENTICATED",
            message: "Sign in again before changing security settings.",
            details: { reason: "recent-sign-in" },
          },
        }),
      });
    }
    return route.continue();
  });
  await signInWeb(page, "pastor@example.test");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Account security" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Confirm it is you" });
  // Cancelling changes nothing and says so.
  stale = 1;
  await page.getByRole("button", { name: "Add staff account" }).click();
  await page
    .getByLabel(/^Sign-in email/)
    .fill("phase12-cancelled@example.test");
  await page.getByLabel(/^Display name/).fill("Fictional Helper");
  await page.getByRole("checkbox", { name: "readOnly" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("pastor@example.test");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByText("Confirmation cancelled. Nothing was changed."),
  ).toBeVisible();
  // The form beneath stays usable once the confirm dialog closes.
  const editor = page.getByRole("dialog", { name: "Add staff account" });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(
    getAuth().getUserByEmail("phase12-cancelled@example.test"),
  ).rejects.toThrow();
  // Confirming with the password runs the change once more.
  stale = 1;
  await page.getByRole("button", { name: "Add staff account" }).click();
  await page
    .getByLabel(/^Sign-in email/)
    .fill("phase12-confirmed@example.test");
  await page.getByLabel(/^Display name/).fill("Fictional Helper");
  await page.getByRole("checkbox", { name: "readOnly" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(confirm).toBeVisible();
  await page.screenshot({
    path: "test-results/staff-web-confirm.png",
    animations: "disabled",
  });
  await confirm.getByLabel(/^Password/).fill("LocalDemo123!");
  await confirm.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByLabel("Account setup link")).toBeVisible();
  expect(
    (await getAuth().getUserByEmail("phase12-confirmed@example.test")).uid,
  ).toBeTruthy();
  await run.created.close();
});

test("the statistical report reads the same in the browser as on the desktop", async ({
  browser,
}) => {
  async function figures(page: Page) {
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Annual reports",
    );
    const table = page.locator("main.content table").first();
    await expect(table.locator("tbody tr").first()).toBeVisible();
    await page.waitForTimeout(1500);
    return table
      .locator("tbody td")
      .evaluateAll((cells) => cells.map((cell) => cell.textContent?.trim()));
  }
  const desk = await context(browser, booth);
  await signInDesktop(desk.page, "pastor@example.test");
  await desk.page
    .getByRole("button", { name: "Annual reports", exact: true })
    .click();
  const desktop = await figures(desk.page);
  const handset = await context(browser, phone());
  await signInWeb(handset.page, "pastor@example.test");
  await handset.page.getByRole("button", { name: "Menu", exact: true }).click();
  await handset.page
    .getByRole("button", { name: "Annual reports", exact: true })
    .click();
  const browserFigures = await figures(handset.page);
  expect(browserFigures.length).toBeGreaterThan(10);
  expect(browserFigures).toEqual(desktop);
  await desk.created.close();
  await handset.created.close();
});
