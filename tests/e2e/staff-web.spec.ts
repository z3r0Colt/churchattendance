import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { grantTestStaff } from "./staff-fixture";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Staff web tests require emulators");
if (!getApps().length) initializeApp({ projectId: "demo-sycamore" });
const web = "http://localhost:5175/staff/";
// A Lord's Day no other spec uses, removed again after these tests.
const date = "2026-12-27";
const phone = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
async function signIn(page: Page, email: string) {
  await page.goto(web);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByLabel(/^Password/).fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance" }),
  ).toBeVisible();
}
async function openRoll(page: Page) {
  await expect(
    page.getByRole("combobox", { name: "Service", exact: true }),
  ).not.toHaveText("Choose a service");
  await page.getByLabel("Service date").fill(date);
  const start = page.getByRole("button", { name: "Start roll call" });
  await expect(
    start.or(page.getByRole("button", { name: /^Mary Baker,/ })),
  ).toBeVisible();
  if (await start.isVisible()) await start.click();
  await expect(
    page.getByRole("button", { name: /^Mary Baker,/ }),
  ).toBeVisible();
}
// Records every dialog the page raises and answers the leave-page prompt with Cancel.
function recordDialogs(page: Page) {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });
  return dialogs;
}
async function markOffline(page: Page, context: BrowserContext, name: string) {
  await context.setOffline(true);
  await page.getByRole("button", { name: `${name}, absent` }).click();
  await expect(
    page.getByRole("button", { name: `${name}, present` }),
  ).toBeVisible();
  await expect(
    page.getByText("Offline, keep this tab open", { exact: true }),
  ).toBeVisible();
}
// The tab must be able to load the sign-in page again, so the network returns
// while the church records stay out of reach and the mark stays unsaved.
async function keepRecordsUnreachable(page: Page, context: BrowserContext) {
  await context.route("http://127.0.0.1:8080/**", (route) => route.abort());
  await context.setOffline(false);
  await expect(page.getByText("Saving", { exact: true })).toBeVisible();
}
async function expectLocked(page: Page, dialogs: string[]) {
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(dialogs).toEqual([]);
  await expect(page.getByText(/Baker|Calder|Moss/)).toHaveCount(0);
}
test.afterAll(async () => {
  const db = getFirestore();
  const services = await db
    .collection("services")
    .where("date", "==", date)
    .get();
  await Promise.all(services.docs.map((row) => row.ref.delete()));
});
test("a phone and the desktop mark different names at once and both marks survive going offline", async ({
  browser,
}) => {
  const phoneContext = await browser.newContext(phone);
  const handset = await phoneContext.newPage();
  await signIn(handset, "volunteer@example.test");
  await openRoll(handset);
  const desktopContext = await browser.newContext();
  const desk = await desktopContext.newPage();
  await desk.goto("/");
  await desk.getByLabel("Email").fill("volunteer@example.test");
  await desk.getByLabel("Password").fill("LocalDemo123!");
  await desk.getByRole("button", { name: "Sign in", exact: true }).click();
  await openRoll(desk);
  await Promise.all([
    handset.getByRole("button", { name: "Mary Baker, absent" }).click(),
    desk.getByRole("button", { name: "John Baker, absent" }).click(),
  ]);
  for (const page of [handset, desk]) {
    await expect(
      page.getByRole("button", { name: "Mary Baker, present" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "John Baker, present" }),
    ).toBeVisible();
  }
  // The phone keeps an offline mark in memory and sends it on reconnecting,
  // while the desktop's independent change in the meantime is kept too.
  await phoneContext.setOffline(true);
  await handset.getByRole("button", { name: "Ruth Calder, absent" }).click();
  await expect(
    handset.getByText("Offline, keep this tab open", { exact: true }),
  ).toBeVisible();
  await expect(
    handset.getByText(/Marks are kept in this tab until the connection/),
  ).toBeVisible();
  await desk.getByRole("button", { name: "John Baker, present" }).click();
  await phoneContext.setOffline(false);
  await expect(handset.getByText("Online", { exact: true })).toBeVisible();
  await expect(
    desk.getByRole("button", { name: "Ruth Calder, present" }),
  ).toBeVisible();
  await expect(
    handset.getByRole("button", { name: "John Baker, absent" }),
  ).toBeVisible();
  await expect(
    handset.getByRole("button", { name: "Mary Baker, present" }),
  ).toBeVisible();
  // Touch targets and the phone layout.
  const chip = await handset
    .getByRole("button", { name: "Mary Baker, present" })
    .boundingBox();
  expect(chip!.height).toBeGreaterThanOrEqual(48);
  expect(
    await handset.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(handset.locator(".footer-service")).toHaveText(
    "Lord's Day Morning · Dec 27",
  );
  await handset.screenshot({
    path: "test-results/staff-web-attendance-light.png",
    animations: "disabled",
  });
  await handset.getByRole("button", { name: "Change theme" }).click();
  await handset.screenshot({
    path: "test-results/staff-web-attendance-dark.png",
    animations: "disabled",
  });
  await phoneContext.close();
  await desktopContext.close();
});
test("the staff web keeps nothing in browser storage and forgets an account after Lock now", async ({
  browser,
}) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  await page.goto(web);
  await expect(
    page.getByRole("button", { name: "Sign in with browser or passkey" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Keep this PC signed in")).toHaveCount(0);
  await signIn(page, "pastor@example.test");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  const care = page.getByRole("button", {
    name: "Pastoral care · Session only",
  });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(care).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(care).toBeVisible();
  await page.screenshot({
    path: "test-results/staff-web-menu.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await menu.click();
  await care.click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("heading", { name: "Pastoral care" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await menu.click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("THIS DEVICE AND THE CHURCH")).toBeVisible();
  await expect(page.getByText("Optional household kiosk")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start kiosk for open service" }),
  ).toHaveCount(0);
  const storage = await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    databases: (await indexedDB.databases()).map((row) => row.name || ""),
    bridge: "desktop" in window,
  }));
  expect(storage.databases.filter((name) => /firestore/i.test(name))).toEqual(
    [],
  );
  expect(storage.local.filter((key) => key !== "theme")).toEqual([]);
  expect(storage.bridge).toBe(false);
  // A second tab does not share this tab's sign-in.
  const other = await context.newPage();
  await other.goto(web);
  await expect(
    other.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await other.close();
  await page.getByRole("button", { name: "Lock now" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await signIn(page, "volunteer@example.test");
  await menu.click();
  await expect(page.locator(".nav-user")).toContainText("Alex Booth");
  await expect(page.locator(".nav-user")).not.toContainText("James Calder");
  await expect(page.getByRole("button", { name: /Pastoral care/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await context.close();
});
test("the staff web asks before leaving while a mark is unsaved", async ({
  browser,
}) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const dialogs = recordDialogs(page);
  await signIn(page, "volunteer@example.test");
  await openRoll(page);
  await markOffline(page, context, "Grace Calder");
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs).toEqual(["beforeunload"]);
  await context.close();
});
test("Lock anyway with an unsaved mark reloads past the leave-page prompt", async ({
  browser,
}) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const dialogs = recordDialogs(page);
  await signIn(page, "volunteer@example.test");
  await openRoll(page);
  await markOffline(page, context, "Eli Moss");
  await page.getByRole("button", { name: "Lock now" }).click();
  await keepRecordsUnreachable(page, context);
  await page.getByRole("button", { name: "Lock anyway" }).click();
  await expectLocked(page, dialogs);
  await context.close();
});
test("the idle lock with an unsaved mark reloads past the leave-page prompt", async ({
  browser,
}) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  await page.clock.install();
  const dialogs = recordDialogs(page);
  await signIn(page, "volunteer@example.test");
  await openRoll(page);
  await markOffline(page, context, "James Calder");
  await keepRecordsUnreachable(page, context);
  await page.clock.fastForward("31:00");
  await expectLocked(page, dialogs);
  // The idle lock discards a mark that never reached the church records.
  const services = await getFirestore()
    .collection("services")
    .where("date", "==", date)
    .get();
  expect(services.size).toBeGreaterThan(0);
  expect(services.docs.some((row) => row.data().present?.james)).toBe(false);
  await context.close();
});
test("a lock whose reload is held back shows no records", async ({
  browser,
}) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const dialogs = recordDialogs(page);
  await signIn(page, "volunteer@example.test");
  await openRoll(page);
  // Something other than the app holds back the reload, and the person cancels it.
  await page.evaluate(() =>
    window.addEventListener("beforeunload", (event) => event.preventDefault()),
  );
  await page.getByRole("button", { name: "Lock now" }).click();
  await expect.poll(() => dialogs).toEqual(["beforeunload"]);
  await expect(page.getByText("Opening Sycamore RPC")).toBeVisible();
  await expect(page.getByText(/Baker|Calder|Moss/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lock now" })).toHaveCount(0);
  await context.close();
});
test("a staff member signs in to the staff web with a passkey", async ({
  browser,
}) => {
  const uid = "phase12-passkey";
  await getAuth()
    .getUser(uid)
    .catch(() =>
      getAuth().createUser({
        uid,
        email: `${uid}@example.test`,
        password: "LocalDemo123!",
        emailVerified: true,
      }),
    );
  await grantTestStaff(uid, ["elder"]);
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
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
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill(`${uid}@example.test`);
  await page.getByLabel(/^Password/).fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await expect(page.getByText("Passkey added.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(web);
  await page.getByLabel("Passkey account email").fill(`${uid}@example.test`);
  await page
    .getByRole("button", { name: "Sign in with passkey", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Take attendance" }),
  ).toBeVisible();
  await context.close();
});
test("the built staff web carries no desktop bridge calls", () => {
  const folder = "apps/portal/dist/staff/assets";
  const code = readdirSync(folder)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(`${folder}/${name}`, "utf8"))
    .join("\n");
  expect(code.length).toBeGreaterThan(0);
  for (const name of [
    "ipcRenderer",
    "contextBridge",
    "openStaffSecurity",
    "saveReportPdf",
    "setKioskMode",
    "openDirections",
  ])
    expect(code).not.toContain(name);
});
