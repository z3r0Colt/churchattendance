import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("./renderer", import.meta.url)),
  envDir: fileURLToPath(new URL("../../", import.meta.url)),
  base: "./",
  plugins: [react()],
  define: { __STAFF_WEB__: "false" },
  resolve: { preserveSymlinks: true },
  optimizeDeps: {
    exclude: ["@sycamore/shared"],
    esbuildOptions: { preserveSymlinks: true },
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { outDir: "../dist/renderer", emptyOutDir: true },
});
