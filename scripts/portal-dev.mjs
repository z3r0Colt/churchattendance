import { execFileSync } from "node:child_process";
import { createServer } from "vite";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Portal demo requires local emulators");
execFileSync(process.execPath, ["scripts/seed.mjs"], { stdio: "inherit" });
const server = await createServer({ configFile: "apps/portal/vite.config.ts" });
await server.listen();
console.log(
  "Open the local portal at http://127.0.0.1:5174. Sign in as member@example.test with LocalDemo123!.",
);
process.once("SIGINT", async () => {
  await server.close();
  process.exit(0);
});
