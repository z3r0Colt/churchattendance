import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// The same source/build renders both public identities. No church records are mutated.
for (const church of ["cedar", "harbor"]) {
  const branding = JSON.parse(readFileSync(`config/examples/${church}-branding.json`, "utf8"));
  for (const route of ["http://127.0.0.1:5174/", "http://127.0.0.1:5175/staff/", "http://127.0.0.1:5174/launch", "http://127.0.0.1:5174/staff-security"]) {
    test(`${church} public branding on ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.route("**/getPublicBranding", async (request) => {
        await request.fulfill({ status: 200, headers: {
          "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,authorization,x-firebase-appcheck,x-firebase-gmpid",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
        }, contentType: "application/json", body: request.request().method() === "OPTIONS" ? "" : JSON.stringify({ result: branding }) });
      });
      await page.goto(route);
      await expect(page).toHaveTitle(`${branding.appName} · Foldkeeper`);
      await expect(page.locator(".church-wordmark")).toContainText(branding.appName);
      await expect(page.locator(".church-wordmark")).toContainText(branding.subtitle);
      await expect(page.locator(".church-wordmark .powered-by")).toHaveText("Powered by Foldkeeper");
      await expect(page.locator(".church-wordmark .powered-by")).toBeVisible();
      expect(await page.locator(".church-branding").evaluate((element) => getComputedStyle(element).getPropertyValue("--church-brand").trim())).toBe(church === "cedar" ? "#2F6B4F" : "#234E70");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
