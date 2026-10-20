import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  envDir: fileURLToPath(new URL("../../", import.meta.url)),
  plugins: [react()],
  resolve: { preserveSymlinks: true },
  optimizeDeps: {
    exclude: ["@sycamore/shared"],
    esbuildOptions: { preserveSymlinks: true },
  },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  build: { manifest: true, outDir: "dist", emptyOutDir: true },
});

