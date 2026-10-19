import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
// The staff web: the same renderer built for browsers, served from the portal origin at /staff/.
// It has no preload, so every native call falls back to browser save, print and open.
export default defineConfig({
  root: fileURLToPath(new URL("./renderer", import.meta.url)),
  envDir: fileURLToPath(new URL("../../", import.meta.url)),
  base: "/staff/",
  plugins: [react()],
  define: { __STAFF_WEB__: "true" },
  resolve: { preserveSymlinks: true },
  optimizeDeps: {
    exclude: ["@sycamore/shared"],
    esbuildOptions: { preserveSymlinks: true },
  },
  server: { host: "127.0.0.1", port: 5175, strictPort: true },
  // The portal build empties apps/portal/dist, so this build runs after it.
  build: { outDir: "../../portal/dist/staff", emptyOutDir: true },
});
