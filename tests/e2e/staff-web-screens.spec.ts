import {
  expect,
  test,
  type Browser,
  type Page,
  type Route,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
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
  await page.getByLabel("Email", { exact: true }).fill(email);
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
// A wildcard does not cover the Authorization header, so echo the requested headers.
function cors(route: Route) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers":
      route.request().headers()["access-control-request-headers"] ||
      "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
  };
}
// The real server accepts a fresh test sign-in, so the next `calls` account changes
// are answered as if the sign-in were more than five minutes old.
async function answerStale(page: Page) {
  const stale = { calls: 0 };
  await page.route("**/us-central1/createStaffAccount", async (route) => {
    const headers = cors(route);
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (stale.calls > 0) {
      stale.calls--;
      return route.fulfill({
        status: 401,
        headers: { ...headers, "content-type": "application/json" },
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
  return stale;
}
// The Auth emulator has no authenticator codes, so answer each password sign-in the
// way Firebase answers an account with one enrolled. Returns a function that stops.
async function askForAuthenticator(page: Page, email: string) {
  const { uid } = await getAuth().getUserByEmail(email);
  const pattern = "**/accounts:signInWithPassword*";
  await page.route(pattern, (route) => {
    const headers = cors(route);
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    return route.fulfill({
      status: 200,
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        mfaPendingCredential: "fictional-pending",
        mfaInfo: [
          {
            mfaEnrollmentId: "e1",
            displayName: "Church authenticator",
            totpInfo: {},
          },
        ],
        localId: uid,
      }),
    });
  });
  return () => page.unroute(pattern);
}
// True when any field on the page holds this text, whatever its type.
const anyFieldHolds = (page: Page, text: string) =>
  page
    .locator("input")
    .evaluateAll(
      (inputs, wanted) =>
        inputs.some((input) => (input as HTMLInputElement).value === wanted),
      text,
    );

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

test("a table wider than the booth display scrolls from the keyboard", async ({
  browser,
}) => {
  // Long fictional entries make Access history wider than the booth display. The
  // ids sort first, so they are on the first page of history whatever else is there.
  const db = getFirestore();
  const ids = [1, 2, 3].map((index) => `000-phase12-wide-${index}`);
  const batch = db.batch();
  for (const id of ids)
    batch.set(db.doc(`securityEvents/${id}`), {
      actorUid: `fictional-actor-${"a".repeat(48)}`,
      action: "private.read",
      outcome: "success",
      scope: "security",
      target: `careNotes/fictional-record-${"0123456789".repeat(8)}`,
      at: Timestamp.now(),
    });
  await batch.commit();
  const run = await context(browser, booth, true);
  const { page } = run;
  try {
    await signInDesktop(page, "pastor@example.test");
    await open(page, "Account security", false);
    const history = page.locator("main.content .table-scroll", {
      hasText: "fictional-record-",
    });
    // The check below means something only if the table really is too wide.
    expect(
      await history.evaluate((box) => box.scrollWidth > box.clientWidth),
    ).toBe(true);
    await accessible(page, "booth dark wide Account security");
    const scrollers = page.locator("main.content .table-scroll");
    expect(await scrollers.count()).toBeGreaterThan(0);
    for (const scroller of await scrollers.all()) {
      await expect(scroller).toHaveAttribute("tabindex", "0");
      await expect(scroller).toHaveAccessibleName(/\S/);
    }
    await expect(history).toHaveAccessibleName("Access history");
    // Tab reaches the table, shows a focus ring, and the arrow keys scroll it.
    await page
      .getByRole("button", { name: "Refresh access history", exact: true })
      .focus();
    for (let step = 0; step < 5; step++) {
      if (await history.evaluate((box) => box === document.activeElement))
        break;
      await page.keyboard.press("Tab");
    }
    await expect(history).toBeFocused();
    expect(
      await history.evaluate((box) => {
        const style = getComputedStyle(box);
        return style.outlineStyle === "none"
          ? 0
          : parseFloat(style.outlineWidth);
      }),
    ).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => history.evaluate((box) => box.scrollLeft))
      .toBeGreaterThan(0);
  } finally {
    await run.created.close();
    const cleanup = db.batch();
    for (const id of ids) cleanup.delete(db.doc(`securityEvents/${id}`));
    await cleanup.commit();
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
  const stale = await answerStale(page);
  await signInWeb(page, "pastor@example.test");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Account security" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Confirm it is you" });
  // Cancelling changes nothing and says so.
  stale.calls = 1;
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
  stale.calls = 1;
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

test("the confirm dialog clears the password when it asks for an authenticator code", async ({
  browser,
}) => {
  const run = await context(browser, phone());
  const { page } = run;
  const stale = await answerStale(page);
  await signInWeb(page, "pastor@example.test");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Account security" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Confirm it is you" });
  // Only the confirmation is answered as needing an authenticator code.
  const stop = await askForAuthenticator(page, "pastor@example.test");
  stale.calls = 1;
  await page.getByRole("button", { name: "Add staff account" }).click();
  await page.getByLabel(/^Sign-in email/).fill("phase12-mfa@example.test");
  await page.getByLabel(/^Display name/).fill("Fictional Helper");
  await page.getByRole("checkbox", { name: "readOnly" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByLabel(/^Password/).fill("LocalDemo123!");
  await confirm.getByRole("button", { name: "Confirm", exact: true }).click();
  const code = confirm.getByLabel(/^Authenticator code/);
  await expect(code).toBeVisible();
  await expect(code).toHaveValue("");
  expect(await anyFieldHolds(page, "LocalDemo123!")).toBe(false);
  await stop();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByText("Confirmation cancelled. Nothing was changed."),
  ).toBeVisible();
  await expect(
    getAuth().getUserByEmail("phase12-mfa@example.test"),
  ).rejects.toThrow();
  await run.created.close();
});

test("Confirm with passkey confirms in this tab and the change continues", async ({
  browser,
}) => {
  const uid = "phase12-confirm-passkey",
    email = `${uid}@example.test`;
  await getAuth()
    .getUser(uid)
    .catch(() =>
      getAuth().createUser({
        uid,
        email,
        password: "LocalDemo123!",
        displayName: "Fictional Administrator",
        emailVerified: true,
      }),
    );
  await grantTestStaff(uid, ["admin"]);
  const run = await context(browser, phone());
  const { page } = run;
  const cdp = await run.created.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  // Passkeys are added on the church security page, which shares the relying party.
  await page.goto("http://localhost:5174/staff-security");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByLabel(/^Password/).fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await expect(page.getByText("Passkey added.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const stale = await answerStale(page);
  await signInWeb(page, email);
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.click();
  await page.getByRole("button", { name: "Account security" }).click();
  // A reload would clear this mark.
  await page.evaluate(() => {
    (window as unknown as { tabMark: string }).tabMark = "kept";
  });
  const confirm = page.getByRole("alertdialog", { name: "Confirm it is you" });
  const created = `phase12-passkey-confirmed-${Date.now()}@example.test`;
  stale.calls = 1;
  await page.getByRole("button", { name: "Add staff account" }).click();
  await page.getByLabel(/^Sign-in email/).fill(created);
  await page.getByLabel(/^Display name/).fill("Fictional Helper");
  await page.getByRole("checkbox", { name: "readOnly" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(email);
  await confirm
    .getByRole("button", { name: "Confirm with passkey", exact: true })
    .click();
  await expect(confirm).toBeHidden();
  await expect(page.getByLabel("Account setup link")).toBeVisible();
  expect((await getAuth().getUserByEmail(created)).uid).toBeTruthy();
  expect(
    await page.evaluate(
      () => (window as unknown as { tabMark?: string }).tabMark,
    ),
  ).toBe("kept");
  await menu.click();
  await expect(page.locator(".nav-user")).toContainText(
    "Fictional Administrator",
  );
  await run.created.close();
});

test("Cancel stops in-tab confirmation and the next one starts fresh", async ({
  browser,
}) => {
  const run = await context(browser, booth);
  const { page } = run;
  const stale = await answerStale(page);
  await signInDesktop(page, "pastor@example.test");
  await page
    .getByRole("button", { name: "Account security", exact: true })
    .click();
  const confirm = page.getByRole("alertdialog", { name: "Confirm it is you" });
  const editor = page.getByRole("dialog", { name: "Add staff account" });
  stale.calls = 1;
  await page.getByRole("button", { name: "Add staff account" }).click();
  await page
    .getByLabel(/^Sign-in email/)
    .fill("phase12-browser-cancelled@example.test");
  await page.getByLabel(/^Display name/).fill("Fictional Helper");
  await page.getByRole("checkbox", { name: "readOnly" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Confirm with passkey", exact: true })).toBeEnabled();
  await expect(confirm.getByRole("button", { name: "Confirm in browser", exact: true })).toHaveCount(0);
  const cancel = confirm.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(
    page.getByText("Confirmation cancelled. Nothing was changed."),
  ).toBeVisible();
  await expect(confirm).toBeHidden();
  await expect(
    getAuth().getUserByEmail("phase12-browser-cancelled@example.test"),
  ).rejects.toThrow();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeHidden();
  // Trying again opens a dialog ready to use.
  stale.calls = 1;
  await page.getByRole("button", { name: "Add staff account" }).click();
  await page
    .getByLabel(/^Sign-in email/)
    .fill("phase12-browser-retried@example.test");
  await page.getByLabel(/^Display name/).fill("Fictional Helper");
  await page.getByRole("checkbox", { name: "readOnly" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(confirm).toBeVisible();
  await expect(confirm).not.toContainText("Finish sign-in in your browser");
  for (const name of ["Confirm", "Confirm with passkey", "Cancel"])
    await expect(
      confirm.getByRole("button", { name, exact: true }),
    ).toBeEnabled();
  await confirm.getByLabel(/^Password/).fill("LocalDemo123!");
  await confirm.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByLabel("Account setup link")).toBeVisible();
  expect(
    (await getAuth().getUserByEmail("phase12-browser-retried@example.test"))
      .uid,
  ).toBeTruthy();
  await run.created.close();
});

test("the sign-in authenticator step starts empty and Start again clears the password", async ({
  browser,
}) => {
  const run = await context(browser, phone());
  const { page } = run;
  const stop = await askForAuthenticator(page, "pastor@example.test");
  await page.goto(web);
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("pastor@example.test");
  await page.getByLabel(/^Password/).fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const code = page.getByLabel(/^Authenticator code/);
  await expect(code).toBeVisible();
  await expect(code).toHaveValue("");
  expect(await anyFieldHolds(page, "LocalDemo123!")).toBe(false);
  await code.fill("123456");
  await page.getByRole("button", { name: "Start again" }).click();
  const password = page.getByLabel(/^Password/);
  await expect(password).toBeVisible();
  await expect(password).toHaveValue("");
  await expect(password).toHaveAttribute("type", "password");
  expect(await anyFieldHolds(page, "123456")).toBe(false);
  await stop();
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
