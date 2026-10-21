import { build } from "esbuild";
// Bundle shared validation into the upload. There is no private npm package to resolve in Cloud Build.
await build({
  entryPoints: { index: "src/index.ts", "recovery-encryption": "src/security/encryption.ts" },
  outdir: "lib",
  bundle: true,
  preserveSymlinks: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["firebase-admin/*", "firebase-functions/*", "twilio", "@simplewebauthn/server"],
});
