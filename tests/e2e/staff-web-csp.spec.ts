import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Staff web CSP tests require emulators");
if (!getApps().length) initializeApp({ projectId: "demo-sycamore" });
const web = "http://localhost:5175/staff/";
// A Lord's Day no other spec uses, cleared before and after.
const week = "2027-06-13";
const pdf = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
);
interface HostingSite {
  headers?: { headers: { key: string; value: string }[] }[];
}
// The live site's connect-src from firebase.json, widened only to the local emulators
// and the Vite dev server. Only connect-src, because Vite dev injects inline scripts.
function liveConnectSrc() {
  const config = JSON.parse(readFileSync("firebase.json", "utf8")) as {
    hosting: HostingSite | HostingSite[];
  };
  const policy = [config.hosting]
    .flat()
    .flatMap((site) => site.headers ?? [])
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === "Content-Security-Policy")?.value;
  const directive = policy
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src "));
  if (!directive) throw new Error("firebase.json sets no connect-src");
  return `${directive} http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*`;
}
// Serves each staff web page with the live connect-src and records what it refuses.
async function withLiveConnectSrc(page: Page) {
  const policy = liveConnectSrc();
  await page.route(
    (url) => url.port === "5175" && url.pathname.startsWith("/staff"),
    async (route) => {
      if (route.request().resourceType() !== "document")
        return route.fallback();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "content-security-policy": policy,
        },
      });
    },
  );
  await page.addInitScript(() => {
    const refused: string[] = [];
    (window as unknown as { refused: string[] }).refused = refused;
    document.addEventListener("securitypolicyviolation", (event) =>
      refused.push(`${event.effectiveDirective} ${event.blockedURI}`),
    );
  });
}
const refused = (page: Page) =>
  page.evaluate(() => (window as unknown as { refused: string[] }).refused);
async function clearWeek() {
  await getFirestore().doc(`bulletins/${week}`).delete();
}
test.beforeAll(clearWeek);
test.afterAll(clearWeek);
// A page fulfilled by the test has no local address, so Chromium would treat it as
// public and stop it reaching the emulators on this PC. The live site talks only to
// public Firebase hosts.
test.use({ permissions: ["local-network-access"] });

test("the bulletin preview opens under the live site's connect-src", async ({
  context,
  page,
}) => {
  await withLiveConnectSrc(page);
  await page.goto(web);
  // The policy is in force: the page may not fetch its own object URLs.
  expect(
    await page.evaluate(() =>
      fetch(URL.createObjectURL(new Blob(["x"]))).then(
        () => "fetched",
        () => "refused",
      ),
    ),
  ).toBe("refused");
  await page.evaluate(() => {
    (window as unknown as { refused: string[] }).refused.length = 0;
  });
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("pastor@example.test");
  await page.getByLabel(/^Password/).fill("LocalDemo123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Take attendance" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bulletin", exact: true }).click();
  await page.getByLabel("Lord's Day date").fill(week);
  await page.getByLabel("Upload bulletin PDF", { exact: true }).setInputFiles({
    name: "Fictional-bulletin.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(
    page.getByText("Fictional-bulletin.pdf", { exact: true }).first(),
  ).toBeVisible();
  const opened = context
    .waitForEvent("page", { timeout: 15_000 })
    .catch(() => null);
  await page.getByRole("button", { name: "Preview PDF", exact: true }).click();
  const done = page.getByText("PDF preview opened.", { exact: true });
  const failed = page.getByText("Failed to fetch");
  await expect(done.or(failed)).toBeVisible();
  expect(await refused(page)).toEqual([]);
  await expect(failed).toHaveCount(0);
  await expect(done).toBeVisible();
  // Headless Chromium has no PDF viewer, so only the new tab itself is checked.
  expect(await opened).not.toBeNull();
});
