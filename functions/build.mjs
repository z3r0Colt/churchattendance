import { build } from "esbuild";
// Bundle shared validation into the upload. There is no private npm package to resolve in Cloud Build.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  preserveSymlinks: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["firebase-admin/*", "firebase-functions/*"],
});
