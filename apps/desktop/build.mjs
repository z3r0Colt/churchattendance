import { build } from "esbuild";
import { loadEnv } from "vite";
const publicEnv = loadEnv("production", "../..", "VITE_");
await build({
  entryPoints: ["main/index.ts"],
  outfile: "dist/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "electron-updater"],
  define: { __STAFF_AUTH_ORIGIN__: JSON.stringify(publicEnv.VITE_STAFF_AUTH_ORIGIN || "https://not-configured.invalid") },
});
await build({
  entryPoints: ["preload/index.ts"],
  outfile: "dist/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
