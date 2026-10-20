import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1366, height: 768 },
    trace: "retain-on-failure",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH },
  },
});
