import { spawn } from "node:child_process";
import { build } from "esbuild";
import { createServer } from "vite";
import electron from "electron";
await import("./seed.mjs");
await build({
  entryPoints: ["apps/desktop/main/index.ts"],
  outfile: "apps/desktop/dist/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "electron-updater"],
});
await build({
  entryPoints: ["apps/desktop/preload/index.ts"],
  outfile: "apps/desktop/dist/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
const server = await createServer({
  configFile: "apps/desktop/vite.config.ts",
});
await server.listen();
const child = spawn(electron, ["apps/desktop"], {
  stdio: "inherit",
  env: { ...process.env, SYCAMORE_DEV: "1" },
});
child.once("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
