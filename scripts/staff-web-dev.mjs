import { execFileSync } from "node:child_process";
import { createServer } from "vite";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("The staff web demo requires local emulators");
execFileSync(process.execPath, ["scripts/seed.mjs"], { stdio: "inherit" });
// The portal serves the passkey page; the staff web serves the staff screens at /staff/.
const portal = await createServer({ configFile: "apps/portal/vite.config.ts" });
await portal.listen();
const staff = await createServer({
  configFile: "apps/desktop/vite.web.config.ts",
});
await staff.listen();
console.log(
  "Open the staff web at http://localhost:5175/staff/. Sign in as pastor@example.test or volunteer@example.test with LocalDemo123!.",
);
process.once("SIGINT", async () => {
  await staff.close();
  await portal.close();
  process.exit(0);
});
